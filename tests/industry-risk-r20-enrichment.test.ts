import assert from "node:assert/strict"
import test from "node:test"

import enrichment from "../src/data/industry/r20-controller-enrichment.json" with { type: "json" }
import {
  getIndustryRiskAssessment,
  listIndustryRiskCompanies,
} from "../server/industry-risk-service.ts"

test("R20 controller enrichment preserves its authorization and privacy audit", () => {
  assert.equal(enrichment.records.length, 37)
  assert.equal(enrichment.unresolved.length, 27)
  assert.equal(
    new Set(enrichment.records.map((item) => item.companyId)).size,
    37
  )
  assert.equal(enrichment.audit.paidApiRequestCount, 29)
  assert.equal(enrichment.audit.actualCostCny, 11)
  assert.ok(
    enrichment.audit.actualCostCny <= enrichment.audit.paidApiAuthorizedCapCny
  )
  assert.equal(enrichment.audit.rawApiResponseRedistributed, false)
  assert.equal(enrichment.audit.credentialStored, false)

  const serialized = JSON.stringify(enrichment)
  assert.doesNotMatch(serialized, /auth_token|authorization:\s*bearer/i)
  assert.doesNotMatch(serialized, /3f83b0cc/i)
})

test("R20 controller values enter the unified 64-company chip benchmark", () => {
  const cambricon = getIndustryRiskAssessment("star-688256")
  const cambriconR20 = cambricon.assessment.metrics.find(
    (item) => item.indicatorId === "R20"
  )
  assert.equal(cambriconR20?.rawValue, 28.5107)
  assert.equal(cambriconR20?.sampleSize, 37)
  assert.equal(cambriconR20?.status, "scored")
  assert.notEqual(cambriconR20?.riskScore, null)

  const aiwei = getIndustryRiskAssessment("star-688798")
  const aiweiR20 = aiwei.assessment.metrics.find(
    (item) => item.indicatorId === "R20"
  )
  assert.equal(aiweiR20?.rawValue, 41.8071)
  assert.equal(aiweiR20?.sampleSize, 37)
  assert.equal(aiweiR20?.status, "scored")

  const directory = listIndustryRiskCompanies()
  const cambriconDirectory = directory.companies.find(
    (item) => item.companyId === "star-688256"
  )
  assert.equal(
    cambriconDirectory?.indicatorHeat.find((item) => item.indicatorId === "R20")
      ?.status,
    "scored"
  )
})

test("unresolved R20 companies stay null with a specific coverage reason", () => {
  const montage = getIndustryRiskAssessment("star-688008")
  const metric = montage.assessment.metrics.find(
    (item) => item.indicatorId === "R20"
  )
  const coverage = montage.coverage.find((item) => item.indicatorId === "R20")
  assert.equal(metric?.rawValue, null)
  assert.equal(metric?.riskScore, null)
  assert.equal(metric?.status, "missing")
  assert.equal(coverage?.usableForScoring, false)
  assert.match(coverage?.reason ?? "", /经查无结果/)
})

test("R20 API exposes derived facts without raw paid responses", () => {
  const cambricon = getIndustryRiskAssessment("star-688256")
  const observation = cambricon.observations.find(
    (item) => item.id === "r20-enrichment:observation:688256"
  )
  const source = cambricon.sources.find(
    (item) => item.id === "r20-enrichment:source:688256"
  )
  assert.equal(observation?.numericValue, 28.5107)
  assert.equal(observation?.metricName, "maximum_controller_ratio_pct")
  assert.equal(source?.redistribution, "licensed-derived")
  assert.match(source?.url ?? "", /^https:\/\/www\.tianyancha\.com\/company\//)
  assert.doesNotMatch(JSON.stringify({ observation, source }), /auth_token/i)
})
