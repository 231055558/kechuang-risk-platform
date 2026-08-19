import assert from "node:assert/strict"
import test from "node:test"

import {
  IndustryRiskCompanyNotFoundError,
  getIndustryRiskAssessment,
  listIndustryRiskCompanies,
} from "./industry-risk-service.ts"

test("industry risk service exposes the 37-company design sample", () => {
  const directory = listIndustryRiskCompanies()
  assert.equal(directory.companies.length, 37)
  assert.equal(directory.sampleSize, 37)
  assert.equal(directory.scoreReadyIndicatorCount, 5)
  assert.equal(directory.candidateAggregateCompanyCount, 16)
  assert.equal(directory.industryRiskStatus, "placeholder")
  assert.ok(
    directory.companies.every(
      (company) =>
        company.candidateAggregates.length === 2 &&
        company.scoredIndicatorCount >= 2 &&
        company.totalIndicatorCount === 22
    )
  )
})

test("industry assessment keeps raw values, formula traces, and sources together", () => {
  const response = getIndustryRiskAssessment("star-688256")
  assert.equal(response.company.shortName, "寒武纪")
  assert.equal(response.assessment.metrics.length, 5)
  assert.ok(response.assessment.metrics.every((metric) => metric.sourceId))
  assert.equal(response.assessment.metrics[0].asOfDate, "2026-06-30")
  assert.ok(response.sources.length > 0)
  assert.equal(response.provenance.methodStatus, "mvp-candidate")
})

test("industry assessment rejects companies outside the sample", () => {
  assert.throws(
    () => getIndustryRiskAssessment("unknown"),
    IndustryRiskCompanyNotFoundError
  )
})
