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

test("Cambricon overview switches from the legacy shell to the KCR V3 panel", () => {
  const overview = readProjectFile("src/components/dashboard/overview-tab.tsx")
  const panel = readProjectFile(
    "src/components/dashboard/kcr-v3-assessment-panel.tsx"
  )

  assert.match(overview, /detail\.id === "cambricon"/)
  assert.match(overview, /<KcrV3AssessmentPanel/)
  assert.match(panel, /fetchKcrCompanyAssessment\(companyId/)
  assert.match(panel, /寒武纪客观风险基线/)
  assert.match(panel, /五维风险分布/)
  assert.match(panel, /红旗事件/)
  assert.match(panel, /团队工作簿复算/)
  assert.match(panel, /工程默认仍待团队确认/)
})

test("KCR V3 result updates shell copy and routes export to the V3 report", () => {
  const app = readProjectFile("src/App.tsx")
  const sidebar = readProjectFile("src/components/layout/sidebar-nav.tsx")

  assert.match(app, /KCR V3 客观风险基线/)
  assert.match(app, /printKcrAssessmentReport/)
  assert.match(app, /KCR V3 完整审计报告/)
  assert.match(app, /不会混入旧六维口径/)
  assert.match(app, /<KcrMethodSheet/)
  assert.match(app, /区分团队工作簿结论、程序复算结果与待团队确认/)
  assert.match(sidebar, /assessmentSummaryOverride\.methodVersion/)
})

test("MVP review workspace exposes a bounded scenario and traceable task flow", () => {
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
