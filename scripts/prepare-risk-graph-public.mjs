import { copyFile, mkdir } from "node:fs/promises"
import { dirname, resolve } from "node:path"

const source = resolve("knowledge-graph/frontend/risk-knowledge-graph.html")
const destination = resolve("public/knowledge-graph/risk-knowledge-graph.html")

await mkdir(dirname(destination), { recursive: true })
await copyFile(source, destination)
console.log(`Prepared ${destination}`)
