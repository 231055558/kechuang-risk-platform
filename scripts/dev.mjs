import { spawn } from "node:child_process"

const apiPort = process.env.API_PORT ?? "5001"
const webPort = process.env.PORT ?? "5173"
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm"

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
      },
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
