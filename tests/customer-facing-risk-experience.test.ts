import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

function readProjectFile(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
}

test("customer overview leads with decisions instead of raw database fields", () => {
  const panel = readProjectFile(
    "src/components/dashboard/industry-risk-review-panel.tsx"
  )
  const profileDesk = readProjectFile(
    "src/components/dashboard/industry-risk-profile-desk.tsx"
  )
  const customerOverview = `${panel}\n${profileDesk}`

  assert.doesNotMatch(customerOverview, /Tabs|IndustryRiskKnowledgeGraph/)
  assert.match(customerOverview, /综合风险指数/)
  assert.match(customerOverview, /Top 3 风险驱动/)
  assert.match(customerOverview, /五大风险领域/)
  assert.doesNotMatch(customerOverview, /缺失不补零|财报叙事风险|系统自动结论/)
  assert.match(customerOverview, /slice\(0, 3\)/)
  assert.match(customerOverview, /近期事件/)
  assert.doesNotMatch(
    customerOverview,
    /建议优先执行|处置任务|毛同学|深搜增强版/
  )
  assert.doesNotMatch(customerOverview, /observation\.textValue/)
  assert.doesNotMatch(customerOverview, /coverage\?\.status \?\? "NA"/)
})

test("default industry overview renders an animated five-domain radar without internal attribution", () => {
  const panel = readProjectFile(
    "src/components/dashboard/industry-risk-review-panel.tsx"
  )
  const radar = readProjectFile(
    "src/components/dashboard/industry-risk-radar.tsx"
  )
  const profileDesk = readProjectFile(
    "src/components/dashboard/industry-risk-profile-desk.tsx"
  )

  assert.match(panel, /<IndustryRiskProfileDesk/)
  assert.match(
    profileDesk,
    /<IndustryRiskRadar[\s\S]*dimensions=\{assessment\.dimensionScores\}/
  )
  assert.match(profileDesk, /data-count-to=/)
  assert.match(profileDesk, /data-growth-bar/)
  assert.match(profileDesk, /useGSAP\(/)
  assert.match(profileDesk, /usePrefersReducedMotion\(\)/)
  assert.doesNotMatch(
    `${panel}\n${profileDesk}`,
    /毛同学|深搜增强版|四个行业数据库|本地运行快照/
  )

  assert.match(radar, /五域风险雷达/)
  assert.match(radar, /role="img"/)
  assert.match(radar, /<title id=\{titleId\}>/)
  assert.match(radar, /<desc id=\{descriptionId\}>/)
  assert.match(radar, /data-radar-area/)
  assert.match(radar, /prefersReducedMotion/)
})

test("risk report page uses database reports, events, sources, and exports", () => {
  const reports = readProjectFile(
    "src/components/dashboard/risk-reports-tab.tsx"
  )
  const app = readProjectFile("src/App.tsx")

  assert.match(reports, /response\.reportAvailability/)
  assert.match(reports, /response\.events/)
  assert.match(reports, /response\.sources/)
  assert.match(reports, /导出企业报告/)
  assert.doesNotMatch(reports, /用于投资风险研究与来源核验/)
  assert.match(app, /loadReportsTab/)
  assert.match(app, /activeView === "reports"/)
})
