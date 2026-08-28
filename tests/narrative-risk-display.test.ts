import assert from "node:assert/strict"
import test from "node:test"

import {
  getNarrativeFormulaLabel,
  getNarrativeIndicatorLabel,
  getNarrativeMetricLabel,
  getNarrativeUnitLabel,
  getNarrativeValidationLabel,
  getNarrativeVariantLabel,
  localizeNarrativeText,
} from "../src/lib/narrative-risk-display.ts"

test("narrative risk metric parameters have Chinese presentation labels", () => {
  const metricNames = [
    ["concept_related_revenue_share_pct", "R04"],
    ["DTQ_fundamental_gap_proxy", "R01"],
    ["formal_narrative_mean_adjacent_cosine", "R03"],
    ["itag", "ITAG"],
    ["ITAG_self_only", "R01"],
    ["management_tone", "TONE"],
    ["management_tone_stability_std", "R03"],
    ["pdqi", "PDQI"],
    ["self_third_party_exaggeration_density_gap", "R02"],
  ] as const

  for (const [metricName, indicatorId] of metricNames) {
    const label = getNarrativeMetricLabel(metricName, indicatorId)
    assert.notEqual(label, metricName)
    assert.doesNotMatch(label, /_/)
    assert.match(label, /[\u3400-\u9fff]/)
  }

  for (const indicatorId of ["R01", "R02", "R03", "R04", "PDQI", "ITAG", "TONE"]) {
    const label = getNarrativeIndicatorLabel(indicatorId)
    assert.notEqual(label, indicatorId)
    assert.match(label, /[\u3400-\u9fff]/)
  }
})

test("narrative risk variants, units, and statuses hide storage values", () => {
  assert.equal(
    getNarrativeVariantLabel("QA-only-36"),
    "36 条管理层问答口径"
  )
  assert.equal(
    getNarrativeVariantLabel("formal-industry-year-normalized"),
    "同行业同年度标准化正式口径"
  )
  assert.equal(getNarrativeUnitLabel("risk-score-0-100"), "0 至 100 分")
  assert.equal(
    getNarrativeValidationLabel("recomputed-deduplicated-proxy"),
    "来源去重后已重算（代理值）"
  )
  assert.equal(
    getNarrativeValidationLabel("ego-confirmed-official-url-20260826"),
    "浏览器已确认官方链接"
  )
})

test("narrative risk formulas and explanatory text replace internal abbreviations", () => {
  const formula = getNarrativeFormulaLabel(
    "固定窗口内各场业绩说明会TONE总体标准差；TONE=(POSPCT-NEGPCT)/(POSPCT+NEGPCT)"
  )
  assert.equal(
    formula,
    "固定窗口内各场业绩说明会管理者语调得分的标准差；语调得分为正向词占比与负向词占比之差，除以两者之和"
  )
  assert.doesNotMatch(formula, /TONE|POSPCT|NEGPCT/)

  const explanation = localizeNarrativeText(
    "R01 的 ITAG 缺 MD&A，PDQI 保持 NULL；采用 QA-only 口径。"
  )
  assert.doesNotMatch(explanation, /R01|ITAG|MD&A|PDQI|NULL|QA/)
  assert.match(explanation, /叙事热度与基本面背离/)
  assert.match(explanation, /管理层讨论与分析章节/)
})
