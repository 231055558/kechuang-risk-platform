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
const overviewSource = readFileSync(
  new URL(
    "../src/components/dashboard/overview-tab.tsx",
    import.meta.url
  ),
  "utf8"
)
const graphSource = readFileSync(
  new URL(
    "../src/components/dashboard/industry-risk-knowledge-graph.tsx",
    import.meta.url
  ),
  "utf8"
)

test("industry workspace keeps the current company primary and exposes auditable CRITIC detail", () => {
  assert.match(panelSource, /最新公式 · R01–R22 同业基准/)
  assert.match(panelSource, /当前企业是主视图/)
  assert.match(panelSource, /22项指标/)
  assert.match(panelSource, /风险分基准/)
  assert.match(panelSource, /companyId/)
  assert.match(panelSource, /查看行业参考样本/)
  assert.match(panelSource, /口径、来源与缺口/)
  assert.match(panelSource, /缺失不补零/)
  assert.match(panelSource, /公式、来源与限制/)
  assert.match(graphSource, /单企业语义径向图/)
  assert.match(graphSource, /沉浸查看/)
  assert.match(graphSource, /createPortal\(graphContent, document\.body\)/)
  assert.doesNotMatch(graphSource, /完整网络|useState<"full"/)
})

test("Cambricon MVP mounts the unified industry workspace in its default route", () => {
  assert.match(overviewSource, /<IndustryRiskReviewPanel companyId=\{detail\.id\}/)
  assert.doesNotMatch(overviewSource, /KcrV3AssessmentPanel/)
  assert.match(panelSource, /<IndustryRiskKnowledgeGraph/)
})
