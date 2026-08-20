import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

function readProjectFile(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
}

test("customer overview leads with decisions instead of raw database fields", () => {
  const panel = readProjectFile(
    "src/components/dashboard/industry-risk-review-panel.tsx"
  )

  assert.match(panel, /defaultValue="overview"/)
  assert.match(panel, /综合风险指数/)
  assert.match(panel, /当前最值得关注的风险/)
  assert.match(panel, /五大风险领域/)
  assert.match(panel, /待补充且不参与计算|暂不参与计算/)
  assert.doesNotMatch(panel, /observation\.textValue/)
  assert.doesNotMatch(panel, /coverage\?\.status \?\? "NA"/)
})

test("risk report page uses database reports, events, sources, and exports", () => {
  const reports = readProjectFile(
    "src/components/dashboard/risk-reports-tab.tsx"
  )
  const app = readProjectFile("src/App.tsx")

  assert.match(reports, /response\.reportAvailability/)
  assert.match(reports, /response\.events/)
  assert.match(reports, /response\.sources/)
  assert.match(reports, /导出客户版报告/)
  assert.match(reports, /缺失项目不会显示为\s*0/)
  assert.match(app, /loadReportsTab/)
  assert.match(app, /activeView === "reports"/)
})
