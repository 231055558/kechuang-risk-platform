import assert from "node:assert/strict"
import test from "node:test"

import {
  IndustryRiskCompanyNotFoundError,
  getIndustryRiskAssessment,
  listIndustryRiskCompanies,
} from "./industry-risk-service.ts"

test("industry risk service exposes all 10 Mao sample companies", () => {
  const directory = listIndustryRiskCompanies()
  assert.equal(directory.companies.length, 10)
  assert.equal(directory.sampleSize, 10)
  assert.equal(directory.scoreReadyIndicatorCount, 5)
  assert.equal(directory.industryRiskStatus, "placeholder")
  assert.ok(
    directory.companies.every(
      (company) =>
        company.candidateAggregates.length === 2 &&
        company.scoredIndicatorCount === 5 &&
        company.totalIndicatorCount === 22
    )
  )
})

test("industry assessment keeps raw values, formula traces, and sources together", () => {
  const response = getIndustryRiskAssessment("star-688256")
  assert.equal(response.company.shortName, "寒武纪")
  assert.equal(response.assessment.metrics.length, 5)
  assert.ok(response.assessment.metrics.every((metric) => metric.sourceId))
  assert.ok(response.sources.length > 0)
  assert.equal(response.provenance.methodStatus, "mvp-candidate")
})

test("industry assessment rejects companies outside the sample", () => {
  assert.throws(
    () => getIndustryRiskAssessment("unknown"),
    IndustryRiskCompanyNotFoundError
  )
})
