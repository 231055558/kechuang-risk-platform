import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
}

test("customer pages omit the approved redundant helper copy", () => {
  const overview = source(
    "src/components/dashboard/industry-risk-review-panel.tsx"
  )
  const profile = source(
    "src/components/dashboard/industry-risk-profile-desk.tsx"
  )
  const indicators = source(
    "src/components/dashboard/indicator-analysis-tab.tsx"
  )
  const narrative = source("src/components/dashboard/narrative-risk-tab.tsx")
  const narrativeTrends = source(
    "src/components/dashboard/narrative-industry-trends.tsx"
  )
  const news = source("src/components/dashboard/realtime-tab.tsx")
  const comparison = source("src/components/dashboard/compare-tab.tsx")
  const reports = source("src/components/dashboard/risk-reports-tab.tsx")
  const decisions = source("src/components/dashboard/events-tab.tsx")

  assert.doesNotMatch(overview, /家样本|缺失不补零|数据截至/)
  assert.doesNotMatch(
    profile,
    /系统自动结论|财报叙事风险|>R05–R22</
  )
  assert.match(profile, /数值越高，表示该企业在当前行业样本中的相对风险越突出/)
  assert.doesNotMatch(indicators, /客观指标按统一同业口径呈现/)
  assert.doesNotMatch(narrative, /年度财报原始指数 · 不合成总分/)
  assert.doesNotMatch(narrativeTrends, /跟随左上角当前研究对象/)
  assert.doesNotMatch(narrativeTrends, /折线保留原始指数/)
  assert.doesNotMatch(news, /新闻、公告、诉讼与监管信息支持/)
  assert.doesNotMatch(comparison, /对比边界|客观风险维度使用同一方法版本/)
  assert.doesNotMatch(reports, /用于投资风险研究与来源核验/)
  assert.doesNotMatch(
    reports,
    /包含风险结论、重点领域|查看 R05–R22 原值|浏览数据库收录的公告/
  )
  assert.doesNotMatch(
    decisions,
    /研究状态|是否具备投委会决策条件|每一步同时回答研判问题|企业风险消减建议|本页优先展示 · 均由指标触发|P75 以上标记为已触发/
  )

  assert.match(overview, /汇总综合风险、同业位置和主要风险驱动/)
  assert.match(indicators, /查看各项指标的风险分位、原始数值和证据依据/)
  assert.match(news, /按风险重要度或发生时间查看公开风险信息/)
})

test("narrative and report pages share the standard visual language", () => {
  const narrative = source("src/components/dashboard/narrative-risk-tab.tsx")
  const narrativeStyles = source("src/styles/narrative-risk-workspace.css")
  const reportStyles = source("src/styles/pages.css")

  assert.match(narrative, /className="nr-page-header"/)
  assert.doesNotMatch(narrative, /nr-hero|新版年度叙事风险工作台/)
  assert.match(
    narrativeStyles,
    /\.nr-industry-workspace\s*\{[^}]*background: var\(--risk-os-surface\);/s
  )
  assert.match(
    narrativeStyles,
    /\.nr-industry-chart\s*\{[^}]*background: var\(--risk-os-surface-muted\);/s
  )
  assert.match(
    reportStyles,
    /\.risk-report-source-grid small\s*\{[^}]*font-size: 11px;/s
  )
  assert.match(
    reportStyles,
    /\.risk-report-event-list strong\s*\{[^}]*font-size: 12px;/s
  )
  assert.match(
    reportStyles,
    /\.risk-report-priority-list small\s*\{[^}]*font-size: 11px;/s
  )
})

test("main workspace spacing is slightly denser", () => {
  const styles = source("src/styles/risk-os.css")
  const overviewStyles = source("src/styles/investor-overview.css")
  const indicatorStyles = source("src/styles/indicator-analysis.css")

  assert.match(styles, /\.risk-os-content\s*\{[^}]*padding: 16px 22px 28px;/s)
  assert.match(
    styles,
    /\.risk-os-shell \.page-stack,[\s\S]*?gap: 12px;/
  )
  assert.match(overviewStyles, /\.investor-overview\s*\{[^}]*gap: 10px;/s)
  assert.match(
    overviewStyles,
    /\.investor-overview__header\s*\{[^}]*gap: 0;/s
  )
  assert.match(
    overviewStyles,
    /\.investor-overview > \.industry-risk-assessment\s*\{[^}]*margin-top: 8px;/s
  )
  assert.match(
    indicatorStyles,
    /\.indicator-analysis__header\s*\{[^}]*gap: 0;[^}]*padding: 0 2px 6px;/s
  )
  assert.match(
    indicatorStyles,
    /\.indicator-analysis\.page-stack\s*\{[^}]*gap: 12px;/s
  )
})
