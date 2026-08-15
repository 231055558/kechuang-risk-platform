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

test("KCR V3 result updates shell copy and prevents legacy report export", () => {
  const app = readProjectFile("src/App.tsx")
  const sidebar = readProjectFile("src/components/layout/sidebar-nav.tsx")

  assert.match(app, /KCR V3 客观风险基线/)
  assert.match(app, /本页面不会导出旧方法结果/)
  assert.match(app, /<KcrMethodSheet/)
  assert.match(app, /区分团队工作簿结论、程序复算结果与待团队确认/)
  assert.match(sidebar, /assessmentSummaryOverride\.methodVersion/)
})
