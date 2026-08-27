import { spawn } from "node:child_process"
import { resolve } from "node:path"

const apiPort = process.env.API_PORT ?? "5001"
const webPort = process.env.PORT ?? "5173"
const graphPort = process.env.GRAPH_PORT ?? "8766"
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm"
const pythonCommand =
  process.env.PYTHON ?? (process.platform === "win32" ? "python" : "python3")

const children = [
  spawn(
    process.execPath,
    ["--experimental-strip-types", "server/production-server.ts"],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        HOST: "127.0.0.1",
        PORT: apiPort,
        STATIC_ROOT: process.cwd(),
        GRAPH_API_ORIGIN: `http://127.0.0.1:${graphPort}`,
      },
      stdio: "inherit",
    }
  ),
  spawn(
    pythonCommand,
    [
      "knowledge-graph/backend/tools/serve_fee_kbg_preview.py",
      "--db",
      resolve("knowledge-graph/demo/cambricon_fee_kbg_demo.sqlite"),
      "--run-id",
      "cambricon_fee_kbg_20260826_v1",
      "--host",
      "127.0.0.1",
      "--port",
      graphPort,
    ],
    {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
    }
  ),
  spawn(
    npmCommand,
    ["run", "dev:web", "--", "--host", "127.0.0.1", "--port", webPort],
    {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
    }
  ),
]

let shuttingDown = false

function stopChildren(signal) {
  if (shuttingDown) return
  shuttingDown = true

  for (const child of children) {
    if (!child.killed) {
      child.kill(signal)
    }
  }
}

for (const child of children) {
  child.on("error", (error) => {
    console.error("Local development process failed to start.", error)
    stopChildren("SIGTERM")
    process.exitCode = 1
  })

  child.on("exit", (code, signal) => {
    if (shuttingDown) return

    if (signal) {
      console.error(`Local development process stopped by ${signal}.`)
    } else if (code !== 0) {
      console.error(`Local development process exited with code ${code}.`)
    }

    stopChildren("SIGTERM")
    process.exitCode = code ?? 1
  })
}

process.on("SIGINT", () => stopChildren("SIGINT"))
process.on("SIGTERM", () => stopChildren("SIGTERM"))

console.log(`Frontend: http://127.0.0.1:${webPort}`)
console.log(`Local scoring API: http://127.0.0.1:${apiPort}`)
console.log(`Local audited graph API: http://127.0.0.1:${graphPort}`)
