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

test("industry workspace exposes missing-aware scoring and source audit detail", () => {
  assert.match(panelSource, /sampleSize.*家数字芯片设计企业风险研判/s)
  assert.match(panelSource, /candidateAggregateCompanyCount/)
  assert.match(panelSource, /onValueChange=\{selectCompany\}/)
  assert.match(panelSource, /全指标候选基线/)
  assert.match(panelSource, /缺失项不补零、不插值、不进入分母/)
  assert.match(panelSource, /公式、来源与限制/)
  assert.match(panelSource, /正式报告可得性/)
  assert.match(panelSource, /上交所深搜事件/)
  assert.doesNotMatch(panelSource, /CRITIC|熵权|候选加分定义|补充事实/)
  assert.match(graphSource, /单企业语义径向图/)
  assert.match(graphSource, /沉浸查看/)
  assert.match(graphSource, /createPortal\(graphContent, document\.body\)/)
  assert.doesNotMatch(graphSource, /完整网络|useState<"full"/)
})

test("Cambricon MVP mounts only the industry workspace in its default route", () => {
  assert.match(overviewSource, /<IndustryRiskReviewPanel/)
  assert.doesNotMatch(overviewSource, /KcrV3AssessmentPanel/)
  assert.doesNotMatch(overviewSource, /KcrRiskKnowledgeGraph/)
})
