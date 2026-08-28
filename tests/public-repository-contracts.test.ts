import assert from "node:assert/strict"
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs"
import { dirname, extname, join, relative } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const projectRoot = dirname(
  fileURLToPath(new URL("../package.json", import.meta.url))
)
const ignoredDirectories = new Set([".git", "dist", "node_modules"])
const textExtensions = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".md",
  ".mjs",
  ".svg",
  ".ts",
  ".tsx",
  ".txt",
  ".yml",
  ".yaml",
])

function collectTextFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    if (ignoredDirectories.has(entry)) return []

    const absolutePath = join(directory, entry)
    if (absolutePath === fileURLToPath(import.meta.url)) return []

    const fileStat = statSync(absolutePath)
    if (fileStat.isDirectory()) {
      return collectTextFiles(absolutePath)
    }

    return textExtensions.has(extname(entry)) ? [absolutePath] : []
  })
}

test("public repository excludes private deployment artifacts", () => {
  for (const path of [
    "PROJECT_HANDOFF.md",
    "scripts/deploy.sh",
    "scripts/deploy-remote.sh",
    "tests/deployment-contracts.test.ts",
  ]) {
    assert.equal(existsSync(join(projectRoot, path)), false, path)
  }
})

test("public repository contains no private server or workstation references", () => {
  const prohibitedPatterns = [
    /haiiocean\.site/i,
    /\/root\/2026tzb/i,
    /ssh\s+ali\b/i,
    /\/Users\/ych\b/i,
    /2026-kechuang-fengxian-shibie(?!_public)/i,
    /gh[pousr]_[A-Za-z0-9_]{20,}/,
    /(?:^|[^A-Za-z0-9])sk-(?:proj-)?[A-Za-z0-9_]{20,}/,
    /AKIA[0-9A-Z]{16}/,
    /BEGIN (?:RSA|OPENSSH|EC) PRIVATE KEY/,
  ]

  for (const filePath of collectTextFiles(projectRoot)) {
    const source = readFileSync(filePath, "utf8")
    for (const pattern of prohibitedPatterns) {
      assert.doesNotMatch(
        source,
        pattern,
        `${relative(projectRoot, filePath)} matched ${pattern}`
      )
    }
  }
})

test("localhost development starts the frontend and local scoring API", () => {
  const packageJson = JSON.parse(
    readFileSync(join(projectRoot, "package.json"), "utf8")
  ) as {
    scripts: Record<string, string>
  }
  const viteSource = readFileSync(join(projectRoot, "vite.config.ts"), "utf8")
  const devScript = readFileSync(
    join(projectRoot, "scripts/dev.mjs"),
    "utf8"
  )
  const readme = readFileSync(join(projectRoot, "README.md"), "utf8")

  assert.equal(packageJson.scripts.dev, "node scripts/dev.mjs")
  assert.equal(packageJson.scripts["deploy:production"], undefined)
  assert.equal(
    packageJson.scripts["verify:localhost"],
    "node scripts/verify-localhost.mjs"
  )
  assert.match(viteSource, /process\.env\.API_PORT \?\? "5001"/)
  assert.match(viteSource, /"\/api"[\s\S]*127\.0\.0\.1:\$\{apiPort\}/)
  assert.match(devScript, /"--host", "127\.0\.0\.1"/)
  assert.match(devScript, /process\.env\.GRAPH_API_ORIGIN/)
  assert.match(devScript, /configuredGraphOrigin[\s\S]*\? \[\][\s\S]*serve_fee_kbg_preview/)
  assert.match(readme, /http:\/\/127\.0\.0\.1:5173/)
  assert.match(readme, /npm run dev/)
})
