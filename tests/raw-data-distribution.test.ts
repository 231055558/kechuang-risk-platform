import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import {
  createReadStream,
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
const rawRoot = join(projectRoot, "data/raw")
const checksumPath = join(rawRoot, "SHA256SUMS")
const metadataFiles = new Set(["README.md", "SHA256SUMS"])

function collectFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const absolutePath = join(directory, entry)
    return statSync(absolutePath).isDirectory()
      ? collectFiles(absolutePath)
      : [absolutePath]
  })
}

function digestFile(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256")
    const stream = createReadStream(path)
    stream.on("data", (chunk) => hash.update(chunk))
    stream.on("error", reject)
    stream.on("end", () => resolve(hash.digest("hex")))
  })
}

function digestManifestFile(path: string): Promise<string> | string {
  if (extname(path).toLowerCase() === ".md") {
    return createHash("sha256")
      .update(readFileSync(path, "utf8").replace(/\r\n/g, "\n"))
      .digest("hex")
  }
  return digestFile(path)
}

test("tracked raw snapshot contains the complete authorized input set", () => {
  assert.equal(existsSync(checksumPath), true)

  const originals = collectFiles(rawRoot).filter(
    (path) => !metadataFiles.has(relative(rawRoot, path))
  )
  const extensionCounts = originals.reduce<Record<string, number>>(
    (counts, path) => {
      const extension = extname(path).toLowerCase()
      counts[extension] = (counts[extension] ?? 0) + 1
      return counts
    },
    {}
  )

  assert.equal(originals.length, 92)
  assert.deepEqual(extensionCounts, {
    ".md": 3,
    ".pdf": 8,
    ".sqlite": 3,
    ".xlsx": 77,
    ".zip": 1,
  })
  assert.ok(originals.every((path) => statSync(path).size < 100_000_000))
})

test("raw snapshot matches its SHA-256 manifest", async () => {
  const entries = readFileSync(checksumPath, "utf8")
    .trim()
    .split(/\r?\n/)
    .map((line) => {
      const match = line.match(/^([a-f0-9]{64}) {2}(.+)$/)
      assert.ok(match, `invalid checksum line: ${line}`)
      return { checksum: match[1], path: match[2] }
    })

  const manifestFiles = collectFiles(rawRoot)
    .filter((path) => path !== checksumPath)
    .map((path) => `./${relative(rawRoot, path).replaceAll("\\", "/")}`)
    .sort()
  assert.deepEqual(entries.map((entry) => entry.path).sort(), manifestFiles)

  for (const entry of entries) {
    assert.equal(
      await digestManifestFile(join(rawRoot, entry.path)),
      entry.checksum
    )
  }
})
