import assert from "node:assert/strict"
import test from "node:test"

import unifiedData from "../src/data/industry/r01-r22-unified.json" with { type: "json" }
import exposureData from "../src/data/industry/r17-exposure-enrichment.json" with { type: "json" }
import {
  attachIndustryRiskR17ExposureEnrichment,
  scoreIndustryRiskDataset,
  type IndustryRiskDataset,
  type R17ExposureEnrichment,
} from "../src/domain/industry-risk-v1/index.ts"

const assessments = scoreIndustryRiskDataset(
  unifiedData as IndustryRiskDataset
)

function r17(companyId: string) {
  return assessments
    .find((assessment) => assessment.companyId === companyId)
    ?.metrics.find((metric) => metric.indicatorId === "R17")
}

test("R17 explicit zero supplier exposure receives the low-risk floor", () => {
  const metric = r17("star-688505")
  assert.ok(metric)
  assert.equal(metric.status, "scored")
  assert.equal(metric.rawValue, 0)
  assert.equal(metric.unit, "家（代理）")
  assert.equal(metric.riskPercentile, 0)
  assert.equal(metric.riskScore, 25)
  assert.equal(metric.sampleSize, 0)
  assert.match(metric.formulaTrace, /明确披露为零.*低风险保底/)
  assert.match(metric.limitation, /未识别到供应商不等于证明实际进口依赖为零/)
  assert.ok(metric.sourceId)
})

test("R17 unknown supplier geography remains missing instead of receiving the floor", () => {
  const metric = r17("star-688506")
  assert.ok(metric)
  assert.equal(metric.status, "missing")
  assert.equal(metric.rawValue, null)
  assert.equal(metric.riskPercentile, null)
  assert.equal(metric.riskScore, null)
  assert.match(metric.missingReason ?? "", /缺少可用数值/)
})

test("R17 floor is limited to explicit zero evidence in the current dataset", () => {
  const floorMetrics = assessments.flatMap((assessment) =>
    assessment.metrics.filter(
      (metric) =>
        metric.indicatorId === "R17" &&
        metric.metricName === "no_identified_external_supplier_floor"
    )
  )
  assert.equal(floorMetrics.length, 1)
})

test("R17 confirmed overseas procurement remains unscored until amounts exist", () => {
  const enrichedDataset = attachIndustryRiskR17ExposureEnrichment(
    unifiedData as IndustryRiskDataset,
    exposureData as R17ExposureEnrichment
  )
  const enrichedAssessments = scoreIndustryRiskDataset(enrichedDataset)
  const confirmedMetrics = enrichedAssessments.flatMap((assessment) =>
    assessment.metrics.filter(
      (metric) =>
        metric.indicatorId === "R17" &&
        metric.metricName === "verified_external_procurement_disclosure"
    )
  )

  assert.equal(confirmedMetrics.length, 40)
  for (const metric of confirmedMetrics) {
    assert.equal(metric.status, "missing")
    assert.equal(metric.rawValue, null)
    assert.equal(metric.riskPercentile, null)
    assert.equal(metric.riskScore, null)
    assert.ok(metric.sourceId)
    assert.match(metric.missingReason ?? "", /缺少境外采购金额与总采购金额/)
  }
})
