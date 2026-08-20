import assert from "node:assert/strict"
import test from "node:test"

import {
  IndustryRiskCompanyNotFoundError,
  getIndustryRiskAssessment,
  listIndustryRiskCompanies,
} from "./industry-risk-service.ts"

test("industry risk service exposes the unified 94-company R01-R22 sample", () => {
  const directory = listIndustryRiskCompanies()
  assert.equal(directory.companies.length, 94)
  assert.equal(directory.sampleSize, 94)
  assert.equal(directory.peerGroups.length, 4)
  assert.equal(directory.scoreReadyIndicatorCount, 18)
  assert.equal(directory.industryRiskStatus, "fixed-anchor")
  assert.ok(
    directory.companies.every(
      (company) =>
        company.candidateAggregates.length === 2 &&
        company.coveredIndicatorCount >= 0 &&
        company.eventCount >= 0 &&
        company.totalIndicatorCount === 22
    )
  )
})

test("industry assessment keeps raw values, formula traces, and sources together", () => {
  const response = getIndustryRiskAssessment("star-688256")
  assert.equal(response.company.shortName, "寒武纪")
  assert.equal(response.assessment.metrics.length, 22)
  assert.equal(response.assessment.benchmarkSampleSize, 64)
  assert.equal(response.assessment.weightedScoredIndicatorCount, 16)
  assert.ok(response.assessment.totalRiskScore !== null)
  assert.equal(response.indicators.length, 22)
  assert.equal(response.coverage.length, 22)
  assert.ok(response.observations.length > 0)
  assert.ok(response.events.length > 0)
  assert.ok(
    response.assessment.metrics
      .filter((metric) => metric.status === "scored")
      .every((metric) => metric.sourceId)
  )
  assert.ok(response.sources.length > 0)
  assert.equal(response.provenance.methodStatus, "usable-benchmark")
})

test("industry assessment rejects companies outside the sample", () => {
  assert.throws(
    () => getIndustryRiskAssessment("unknown"),
    IndustryRiskCompanyNotFoundError
  )
})
