import { spawn } from "node:child_process"
import { setTimeout as delay } from "node:timers/promises"

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm"
const webPort = process.env.VERIFY_WEB_PORT ?? "4173"
const apiPort = process.env.VERIFY_API_PORT ?? "4174"
const baseUrl = `http://127.0.0.1:${webPort}`
const logs = []

const developmentServer = spawn(npmCommand, ["run", "dev"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    API_PORT: apiPort,
    PORT: webPort,
  },
  stdio: ["ignore", "pipe", "pipe"],
})

for (const stream of [developmentServer.stdout, developmentServer.stderr]) {
  stream.setEncoding("utf8")
  stream.on("data", (chunk) => {
    logs.push(chunk)
    if (logs.length > 80) logs.shift()
  })
}

const exitPromise = new Promise((resolve) => {
  developmentServer.once("exit", (code, signal) => {
    resolve({ code, signal })
  })
})

async function waitForServices() {
  const deadline = Date.now() + 20_000

  while (Date.now() < deadline) {
    if (developmentServer.exitCode !== null) {
      throw new Error("Local development server exited before becoming ready.")
    }

    try {
      const response = await fetch(`${baseUrl}/`, {
        signal: AbortSignal.timeout(1_000),
      })
      if (response.ok) {
        const html = await response.text()
        if (!html.includes('id="root"')) {
          await delay(250)
          continue
        }
        const apiResponse = await fetch(
          `${baseUrl}/api/v1/industry-risk/companies`,
          { signal: AbortSignal.timeout(1_000) }
        )
        if (!apiResponse.ok) {
          await delay(250)
          continue
        }
        const payload = await apiResponse.json()
        if (Array.isArray(payload?.companies)) return
      }
    } catch {
      // The server is still starting.
    }

    await delay(250)
  }

  throw new Error("Timed out waiting for the localhost frontend and API.")
}

async function verifyApi(path) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: "{}",
  })
  const payload = await response.json()

  if (
    response.status !== 422 ||
    typeof payload !== "object" ||
    payload === null ||
    !("error" in payload)
  ) {
    throw new Error(`${path} did not return the expected validation response.`)
  }
}

async function stopDevelopmentServer() {
  if (developmentServer.exitCode !== null) return

  developmentServer.kill("SIGTERM")
  const result = await Promise.race([
    exitPromise,
    delay(5_000).then(() => null),
  ])

  if (result === null && developmentServer.exitCode === null) {
    developmentServer.kill("SIGKILL")
    await exitPromise
  }
}

try {
  await waitForServices()
  await verifyApi("/api/v1/technology-risk/score")
  await verifyApi("/api/v1/technology-risk/baseline-quantify")
  console.log(`Localhost verification passed at ${baseUrl}`)
} catch (error) {
  console.error(error)
  console.error(logs.join(""))
  process.exitCode = 1
} finally {
  await stopDevelopmentServer()
}
