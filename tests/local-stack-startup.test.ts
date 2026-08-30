import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
  scripts: Record<string, string>
}
const launcher = readFileSync("scripts/start-local-stack.mjs", "utf8")
const loginScript = readFileSync("scripts/start-at-login.ps1", "utf8")
const installer = readFileSync("scripts/install-local-autostart.ps1", "utf8")

test("production start owns the bundled graph and platform lifecycle", () => {
  assert.equal(
    packageJson.scripts.start,
    "node --env-file-if-exists=.env.local scripts/start-local-stack.mjs"
  )
  assert.match(launcher, /cambricon_fee_kbg_demo\.sqlite/)
  assert.match(launcher, /semidrive_fee_kbg_demo\.sqlite/)
  assert.match(launcher, /serve_fee_kbg_preview\.py/)
  assert.match(launcher, /args\.push\("--snapshot"/)
  assert.match(launcher, /snapshot_run_ids/)
  assert.match(launcher, /startsWith\("sqlite-preview"\)/)
  assert.match(launcher, /dist\/server\/production-server\.js/)
  assert.doesNotMatch(launcher, /NEO4J_PASSWORD/)
})

test("Windows sign-in task starts the stack without an interactive shell", () => {
  assert.match(loginScript, /npmCommand start/)
  assert.match(loginScript, /Join-Path \$projectRoot "logs"/)
  assert.match(loginScript, /Join-Path \$logDirectory "local-stack\.log"/)
  assert.match(installer, /New-ScheduledTaskTrigger -AtLogOn/)
  assert.match(installer, /WindowStyle Hidden/)
  assert.match(installer, /ExecutionTimeLimit \(\[TimeSpan\]::Zero\)/)
})
