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
  assert.equal(directory.numericIndicatorCount, 18)
  assert.equal(directory.candidateMetricCount, 14)
  assert.equal(directory.candidateAggregateCompanyCount, 37)
  assert.ok(
    directory.companies.every(
      (company) =>
        company.candidateAggregate.status === "partial-candidate" &&
        company.scoredIndicatorCount >= 6 &&
        company.totalIndicatorCount === 18
    )
  )
})

test("industry assessment keeps raw values, formula traces, and sources together", () => {
  const response = getIndustryRiskAssessment("star-688256")
  assert.equal(response.company.shortName, "寒武纪")
  assert.equal(response.assessment.metrics.length, 18)
  assert.equal(response.assessment.scoredIndicatorCount, 13)
  assert.equal(response.assessment.candidateAggregate.score, 37.47)
  assert.equal(
    response.assessment.metrics.find((metric) => metric.indicatorId === "R07")
      ?.asOfDate,
    "2026-06-30"
  )
  assert.equal(response.reportAvailability?.latestPeriod, "2026H1")
  assert.equal(response.deepSearchEvents.length, 4)
  assert.equal(response.supplementaryObservations.length, 9)
  assert.ok(
    response.supplementaryObservations.every(
      (item) => item.affectsScore === false
    )
  )
  assert.equal(response.bonusDefinitions.length, 3)
  assert.ok(
    response.bonusDefinitions.every(
      (item) => item.status === "definition-only" && !item.affectsScore
    )
  )
  assert.ok(response.sources.length > 0)
  assert.equal(response.provenance.methodStatus, "mvp-candidate")
})

test("industry assessment rejects companies outside the sample", () => {
  assert.throws(
    () => getIndustryRiskAssessment("unknown"),
    IndustryRiskCompanyNotFoundError
  )
})
