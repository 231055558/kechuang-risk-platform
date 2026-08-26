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
const profileDeskSource = readFileSync(
  new URL(
    "../src/components/dashboard/industry-risk-profile-desk.tsx",
    import.meta.url
  ),
  "utf8"
)

test("industry workspace leads with a compact investor overview", () => {
  const customerOverviewSource = `${panelSource}\n${profileDeskSource}`

  assert.match(panelSource, /风险总览/)
  assert.match(customerOverviewSource, /Top 3 风险驱动/)
  assert.match(panelSource, /companyId/)
  assert.match(panelSource, /缺失不补零/)
  assert.match(panelSource, /近期事件/)
  assert.match(panelSource, /进入指标分析/)
  assert.doesNotMatch(
    panelSource,
    /IndustryRiskKnowledgeGraph|建议优先执行|叙事风险|Tabs/
  )
  assert.doesNotMatch(panelSource, /observation\.textValue/)
  assert.doesNotMatch(panelSource, /coverage\?\.status \?\? "NA"/)
})

test("every enterprise mounts the unified industry workspace in its default route", () => {
  assert.match(overviewSource, /<IndustryRiskReviewPanel/)
  assert.match(overviewSource, /companyId=\{detail\.id\}/)
  assert.match(overviewSource, /onNavigate=\{onNavigate\}/)
  assert.doesNotMatch(overviewSource, /KcrV3AssessmentPanel/)
  assert.doesNotMatch(panelSource, /<IndustryRiskKnowledgeGraph/)
})
