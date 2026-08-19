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
  new URL("../src/components/dashboard/overview-tab.tsx", import.meta.url),
  "utf8"
)
const graphSource = readFileSync(
  new URL(
    "../src/components/dashboard/industry-risk-knowledge-graph.tsx",
    import.meta.url
  ),
  "utf8"
)

test("industry workspace exposes company switching, comparison, and audit detail", () => {
  assert.match(panelSource, /sampleSize.*家数字芯片设计企业风险研判/s)
  assert.match(panelSource, /candidateAggregateCompanyCount/)
  assert.match(panelSource, /onValueChange=\{selectCompany\}/)
  assert.match(panelSource, /CRITIC 候选/)
  assert.match(panelSource, /公式、来源与限制/)
  assert.match(panelSource, /正式报告可得性/)
  assert.match(panelSource, /补充事实/)
  assert.match(panelSource, /候选加分定义 · 未启用/)
  assert.match(panelSource, /行业风险当前为 0\.5 占位值/)
  assert.match(graphSource, /useState<"full" \| "company">\("company"\)/)
})

test("Cambricon MVP mounts only the industry workspace in its default route", () => {
  assert.match(overviewSource, /<IndustryRiskReviewPanel/)
  assert.doesNotMatch(overviewSource, /KcrV3AssessmentPanel/)
  assert.doesNotMatch(overviewSource, /KcrRiskKnowledgeGraph/)
})
