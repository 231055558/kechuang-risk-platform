import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

function readProjectFile(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
}

test("customer-facing UI and exports use public snapshot language", () => {
  const app = readProjectFile("src/App.tsx")
  const reportExport = readProjectFile("src/lib/report-export.ts")

  assert.match(app, /数据更新至 \{manifest\.snapshotAt\}/)
  assert.doesNotMatch(app, /数据清单版本 \{manifest\.version\}/)

  assert.match(reportExport, /\["数据更新至", manifest\.snapshotAt\]/)
  assert.doesNotMatch(reportExport, /数据清单版本|manifest\.version/)
})

test("public event descriptions do not expose collection internals", () => {
  const dataSource = readProjectFile("src/lib/data-r01.ts")

  assert.match(dataSource, /type: "结构化公开事件"/)
  assert.match(dataSource, /数据按企业与行业样本统一归集/)
  assert.doesNotMatch(
    dataSource,
    /数据库中的深搜事件|type: "深搜事件"|四个最新行业数据库按输入顺序去重/
  )
})
