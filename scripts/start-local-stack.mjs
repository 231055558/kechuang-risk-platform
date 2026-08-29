import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import path from "node:path"
import { setTimeout as delay } from "node:timers/promises"

const projectRoot = process.cwd()
const graphOrigin = (
  process.env.GRAPH_API_ORIGIN ?? "http://127.0.0.1:8766"
).replace(/\/+$/, "")
const graphUrl = new URL(graphOrigin)
const graphPort = Number(graphUrl.port || "8766")
const graphRuntimeMode = process.env.GRAPH_RUNTIME_MODE ?? "bundled"
const graphWebRoot = path.resolve(projectRoot, "knowledge-graph/frontend")
const graphSnapshots = [
  {
    runId: "cambricon_fee_kbg_20260826_v1",
    dbPath: path.resolve(
      projectRoot,
      process.env.GRAPH_CAMBRICON_SNAPSHOT_DB ??
        "knowledge-graph/demo/cambricon_fee_kbg_demo.sqlite"
    ),
  },
  {
    runId: "semidrive_fee_kbg_20260827_v1",
    dbPath: path.resolve(
      projectRoot,
      process.env.GRAPH_SEMIDRIVE_SNAPSHOT_DB ??
        "knowledge-graph/demo/semidrive_fee_kbg_demo.sqlite"
    ),
  },
]
const pythonCommand =
  process.env.PYTHON ?? (process.platform === "win32" ? "python" : "python3")
const children = []
let shuttingDown = false
let graphChild = null

if (!["127.0.0.1", "localhost"].includes(graphUrl.hostname)) {
  throw new Error("The local graph service must use a loopback address.")
}
if (!Number.isInteger(graphPort) || graphPort < 1 || graphPort > 65535) {
  throw new Error("GRAPH_API_ORIGIN must include a valid port.")
}
if (graphRuntimeMode === "bundled") {
  const missingSnapshot = graphSnapshots.find(
    (snapshot) => !existsSync(snapshot.dbPath)
  )
  if (missingSnapshot) {
    throw new Error(`Bundled graph snapshot not found: ${missingSnapshot.dbPath}`)
  }
}

async function readGraphHealth() {
  try {
    const response = await fetch(`${graphOrigin}/api/health`, {
      signal: AbortSignal.timeout(1_500),
    })
    return response.ok ? await response.json() : null
  } catch {
    return null
  }
}

function hasRequiredSnapshots(health) {
  if (!health?.ok) return false
  if (graphRuntimeMode === "external") return true
  return (
    health.neo4j === "sqlite-preview" &&
    graphSnapshots.every((snapshot) =>
      health.snapshot_run_ids?.includes(snapshot.runId)
    )
  )
}

function stopChildren(signal = "SIGTERM") {
  if (shuttingDown) return
  shuttingDown = true
  for (const child of children) {
    if (!child.killed) child.kill(signal)
  }
}

function watchChild(child, label) {
  children.push(child)
  child.on("error", (error) => {
    console.error(`${label} failed to start.`, error)
    stopChildren()
    process.exitCode = 1
  })
  child.on("exit", (code, signal) => {
    if (shuttingDown) return
    console.error(
      `${label} stopped unexpectedly (${signal ? `signal ${signal}` : `code ${code}`}).`
    )
    stopChildren()
    process.exitCode = code ?? 1
  })
}

async function ensureGraphService() {
  const existingHealth = await readGraphHealth()
  if (hasRequiredSnapshots(existingHealth)) return existingHealth
  if (existingHealth) {
    throw new Error(
      `Port ${graphPort} is serving a different graph runtime. Stop it before starting the bundled stack.`
    )
  }
  if (graphRuntimeMode === "external") {
    throw new Error(`External graph service is unavailable at ${graphOrigin}.`)
  }

  const args = [
    "knowledge-graph/backend/tools/serve_fee_kbg_preview.py",
    "--web-root",
    graphWebRoot,
    "--host",
    graphUrl.hostname,
    "--port",
    String(graphPort),
  ]
  for (const snapshot of graphSnapshots) {
    args.push("--snapshot", `${snapshot.runId}=${snapshot.dbPath}`)
  }
  graphChild = spawn(pythonCommand, args, {
    cwd: projectRoot,
    env: {
      ...process.env,
      PYTHONIOENCODING: "utf-8",
      PYTHONUTF8: "1",
    },
    stdio: "inherit",
  })
  watchChild(graphChild, "Bundled graph service")

  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    if (graphChild.exitCode !== null) {
      throw new Error("Bundled graph service exited before becoming ready.")
    }
    const health = await readGraphHealth()
    if (hasRequiredSnapshots(health)) return health
    await delay(250)
  }
  throw new Error("Timed out waiting for the bundled graph service.")
}

async function main() {
  const health = await ensureGraphService()
  console.log(
    `Graph snapshot ready: ${health.active_nodes} nodes at ${graphOrigin}`
  )

  const server = spawn(process.execPath, ["dist/server/production-server.js"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      GRAPH_API_ORIGIN: graphOrigin,
    },
    stdio: "inherit",
  })
  watchChild(server, "Risk platform server")
}

process.on("SIGINT", () => stopChildren("SIGINT"))
process.on("SIGTERM", () => stopChildren("SIGTERM"))
process.on("exit", () => {
  if (!shuttingDown) stopChildren()
})

main().catch((error) => {
  console.error(error)
  stopChildren()
  process.exitCode = 1
})
