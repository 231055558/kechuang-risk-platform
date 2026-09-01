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
    /系统自动结论|财报叙事风险|数值越高，表示该企业|>R05–R22</
  )
  assert.doesNotMatch(indicators, /客观指标按统一同业口径呈现/)
  assert.doesNotMatch(narrative, /年度财报原始指数 · 不合成总分/)
  assert.doesNotMatch(narrativeTrends, /跟随左上角当前研究对象/)
  assert.doesNotMatch(narrativeTrends, /折线保留原始指数/)
  assert.doesNotMatch(news, /新闻、公告、诉讼与监管信息支持/)
  assert.doesNotMatch(comparison, /对比边界|客观风险维度使用同一方法版本/)
  assert.doesNotMatch(reports, /用于投资风险研究与来源核验/)
  assert.doesNotMatch(
    decisions,
    /研究状态|是否具备投委会决策条件|每一步同时回答研判问题|企业风险消减建议|本页优先展示 · 均由指标触发|P75 以上标记为已触发/
  )
})
