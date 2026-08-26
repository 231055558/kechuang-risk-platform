import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const projectRoot = dirname(
  fileURLToPath(new URL("../package.json", import.meta.url))
)

function readProjectFile(path: string) {
  return readFileSync(join(projectRoot, path), "utf8")
}

test("all company overviews use the customer-facing industry workspace by default", () => {
  const overview = readProjectFile("src/components/dashboard/overview-tab.tsx")
  const panel = readProjectFile(
    "src/components/dashboard/industry-risk-review-panel.tsx"
  )
  const profileDesk = readProjectFile(
    "src/components/dashboard/industry-risk-profile-desk.tsx"
  )
  const customerOverview = `${panel}\n${profileDesk}`

  assert.match(overview, /<IndustryRiskReviewPanel/)
  assert.match(overview, /companyId=\{detail\.id\}/)
  assert.doesNotMatch(overview, /KcrV3AssessmentPanel/)
  assert.match(panel, /风险总览/)
  assert.match(panel, /风险总览/)
  assert.match(customerOverview, /Top 3 风险驱动/)
  assert.match(panel, /缺失不补零/)
  assert.match(panel, /进入指标分析/)
})

test("application shell no longer depends on the KCR V3 runtime result", () => {
  const app = readProjectFile("src/App.tsx")
  const sidebar = readProjectFile("src/components/layout/sidebar-nav.tsx")

  assert.match(app, /企业风险基准/)
  assert.match(app, /汇总企业风险结论、同业位置、关键事件与可追溯证据/)
  assert.match(app, /INDUSTRY_RISK_MVP_METHOD_VERSION/)
  assert.doesNotMatch(app, /kcrAssessmentResponse/)
  assert.doesNotMatch(app, /printKcrAssessmentReport/)
  assert.doesNotMatch(app, /KcrMethodSheet/)
  assert.match(sidebar, /assessmentSummaryOverride\.methodVersion/)
})

test("legacy KCR workflow stays isolated and testable for historical replay", () => {
  const workspace = readProjectFile(
    "src/components/dashboard/kcr-mvp-review-workspace.tsx"
  )
  const workflow = readProjectFile("src/lib/kcr-mvp-workflow.ts")

  assert.match(workspace, /三分钟 Review 路径/)
  assert.match(workspace, /客观基线.*永不覆盖/s)
  assert.match(workspace, /生成处置任务/)
  assert.match(workspace, /导出 V3 报告/)
  assert.doesNotMatch(workspace, /type="(?:number|range)"/)
  assert.match(workflow, /technology-diligence/)
  assert.match(workflow, /compliance-external/)
  assert.match(workflow, /missingDimensionIds/)
})
