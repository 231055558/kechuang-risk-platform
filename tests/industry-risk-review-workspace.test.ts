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
const profileDeskSource = readFileSync(
  new URL(
    "../src/components/dashboard/industry-risk-profile-desk.tsx",
    import.meta.url
  ),
  "utf8"
)

test("industry workspace leads with customer conclusions and preserves auditable detail", () => {
  const customerOverviewSource = `${panelSource}\n${profileDeskSource}`

  assert.match(panelSource, /企业风险画像/)
  assert.match(panelSource, /风险概览/)
  assert.match(customerOverviewSource, /当前最值得关注的风险/)
  assert.match(panelSource, /数据与方法/)
  assert.match(panelSource, /companyId/)
  assert.match(panelSource, /查看行业参考样本/)
  assert.match(panelSource, /待补充数据/)
  assert.match(panelSource, /缺失(?:项|项目)不补零/)
  assert.match(panelSource, /公式、来源与限制/)
  assert.doesNotMatch(panelSource, /observation\.textValue/)
  assert.doesNotMatch(panelSource, /coverage\?\.status \?\? "NA"/)
  assert.match(graphSource, /单企业风险关系 · 来源可追溯/)
  assert.match(graphSource, /沉浸查看/)
  assert.match(graphSource, /createPortal\(graphContent, document\.body\)/)
  assert.doesNotMatch(graphSource, /完整网络|useState<"full"/)
})

test("every enterprise mounts the unified industry workspace in its default route", () => {
  assert.match(overviewSource, /<IndustryRiskReviewPanel/)
  assert.match(overviewSource, /companyId=\{detail\.id\}/)
  assert.match(overviewSource, /onNavigate=\{onNavigate\}/)
  assert.doesNotMatch(overviewSource, /KcrV3AssessmentPanel/)
  assert.match(panelSource, /<IndustryRiskKnowledgeGraph/)
})
