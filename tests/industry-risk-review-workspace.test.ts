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

test("industry workspace exposes company switching, comparison, and audit detail", () => {
  assert.match(panelSource, /sampleSize.*家数字芯片设计企业风险基线/s)
  assert.match(panelSource, /candidateAggregateCompanyCount/)
  assert.match(panelSource, /onValueChange=\{selectCompany\}/)
  assert.match(panelSource, /CRITIC 候选/)
  assert.match(panelSource, /公式、来源与限制/)
  assert.match(panelSource, /行业风险 0\.5 为会议占位值/)
})

test("Cambricon MVP mounts the industry workspace before its knowledge graph", () => {
  const workspaceIndex = assessmentSource.indexOf("<IndustryRiskReviewPanel")
  const graphIndex = assessmentSource.indexOf("<KcrRiskKnowledgeGraph")
  assert.ok(workspaceIndex > -1)
  assert.ok(graphIndex > workspaceIndex)
})
