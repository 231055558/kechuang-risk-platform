import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const panelSource = readFileSync(
  new URL(
    "../src/components/dashboard/industry-risk-review-panel.tsx",
    import.meta.url
  ),
  "utf8"
)
const assessmentSource = readFileSync(
  new URL(
    "../src/components/dashboard/kcr-v3-assessment-panel.tsx",
    import.meta.url
  ),
  "utf8"
)

test("industry workspace keeps the current company primary and peers referential", () => {
  assert.match(panelSource, /最新公式 · R01–R22 同业基准/)
  assert.match(panelSource, /当前企业是主视图/)
  assert.match(panelSource, /22项指标/)
  assert.match(panelSource, /风险分基准/)
  assert.match(panelSource, /companyId/)
  assert.match(panelSource, /查看行业参考样本/)
  assert.match(panelSource, /口径、来源与缺口/)
  assert.match(panelSource, /缺失不补零/)
})

test("Cambricon MVP mounts the industry workspace before its knowledge graph", () => {
  const workspaceIndex = assessmentSource.indexOf("<IndustryRiskReviewPanel")
  const graphIndex = assessmentSource.indexOf("<KcrRiskKnowledgeGraph")
  assert.ok(workspaceIndex > -1)
  assert.ok(graphIndex > workspaceIndex)
})
