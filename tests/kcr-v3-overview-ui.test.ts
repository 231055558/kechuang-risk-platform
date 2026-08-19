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

test("Cambricon overview uses the R01–R22 industry workspace by default", () => {
  const overview = readProjectFile("src/components/dashboard/overview-tab.tsx")
  const panel = readProjectFile(
    "src/components/dashboard/industry-risk-review-panel.tsx"
  )

  assert.match(overview, /detail\.id === "cambricon"/)
  assert.match(overview, /<IndustryRiskReviewPanel/)
  assert.doesNotMatch(overview, /KcrV3AssessmentPanel/)
  assert.match(panel, /R01–R22 · 团队统一指标/)
  assert.match(panel, /R05–R22 共[\s\S]*项全部进入候选范围/)
  assert.match(panel, /缺失项不补零、不插值、不进入分母/)
  assert.doesNotMatch(panel, /CRITIC|熵权|行业风险当前为 0\.5/)
})

test("application shell no longer depends on the KCR V3 runtime result", () => {
  const app = readProjectFile("src/App.tsx")
  const sidebar = readProjectFile("src/components/layout/sidebar-nav.tsx")

  assert.match(app, /R01–R22 行业主契约/)
  assert.match(app, /37 家同业样本/)
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
