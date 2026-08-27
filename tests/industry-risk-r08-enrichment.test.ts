import assert from "node:assert/strict"
import test from "node:test"

import enrichment from "../src/data/industry/r08-milestone-enrichment.json" with { type: "json" }
import {
  getIndustryRiskAssessment,
  listIndustryRiskCompanies,
} from "../server/industry-risk-service.ts"

test("R08 milestone scan covers all 69 chip companies with explicit zeros", () => {
  assert.equal(enrichment.records.length, 69)
  assert.equal(
    new Set(enrichment.records.map((item) => item.companyId)).size,
    69
  )
  assert.equal(enrichment.audit.scannedCompanyCount, 69)
  assert.equal(enrichment.audit.nonzeroCompanyCount, 39)
  assert.equal(enrichment.audit.zeroCompanyCount, 30)
  assert.equal(
    enrichment.records.reduce((sum, item) => sum + item.delayEventCount, 0),
    63
  )
  assert.equal(enrichment.audit.primaryAnnouncementOnly, true)
  assert.equal(enrichment.audit.zeroRequiresCompleteScan, true)
  assert.equal(enrichment.audit.formalWeightedFulfillmentRateAvailable, false)
})

test("R08 also fills the semiconductor equipment and manufacturing benchmarks", () => {
  const directory = listIndustryRiskCompanies()
  const supplement = directory.companies.filter(
    (item) => item.peerGroupId === "semiconductor-supplement"
  )
  assert.equal(supplement.length, 5)
  assert.ok(
    supplement.every((company) => {
      const assessment = getIndustryRiskAssessment(company.companyId).assessment
      const metric = assessment.metrics.find(
        (item) => item.indicatorId === "R08"
      )
      return (
        metric?.status === "scored" &&
        metric.sampleSize === assessment.benchmarkSampleSize
      )
    })
  )
  assert.equal(
    directory.companies.filter(
      (company) =>
        getIndustryRiskAssessment(company.companyId).assessment.metrics.find(
          (item) => item.indicatorId === "R08"
        )?.status !== "scored"
    ).length,
    0
  )
})

test("R08 delay-event proxy forms one complete 64-company chip benchmark", () => {
  const directory = listIndustryRiskCompanies()
  const chipCompanies = directory.companies.filter((item) =>
    ["digital-chip", "analog-chip"].includes(item.peerGroupId)
  )
  assert.equal(chipCompanies.length, 64)
  assert.ok(
    chipCompanies.every((company) => {
      const metric = getIndustryRiskAssessment(
        company.companyId
      ).assessment.metrics.find((item) => item.indicatorId === "R08")
      return metric?.status === "scored" && metric.sampleSize === 64
    })
  )

  const cambricon = getIndustryRiskAssessment("star-688256")
  const metric = cambricon.assessment.metrics.find(
    (item) => item.indicatorId === "R08"
  )
  assert.equal(metric?.rawValue, 0)
  assert.equal(metric?.riskPercentile, 0.2063)
  assert.equal(metric?.riskScore, 35.32)
  assert.equal(metric?.missingReason, null)
})

test("R08 explicit zero remains evidence-backed rather than an imputed value", () => {
  const naxin = getIndustryRiskAssessment("star-688052")
  const observation = naxin.observations.find(
    (item) => item.id === "r08-enrichment:observation:688052"
  )
  const source = naxin.sources.find(
    (item) => item.id === "r08-enrichment:source:688052"
  )
  const coverage = naxin.coverage.find((item) => item.indicatorId === "R08")
  assert.equal(observation?.numericValue, 0)
  assert.match(observation?.confidenceReason ?? "", /完整.*扫描|统一窗口/)
  assert.match(
    source?.url ?? "",
    /^https:\/\/query\.sse\.com\.cn\/security\/stock\//
  )
  assert.equal(source?.redistribution, "public-link-only")
  assert.equal(coverage?.usableForScoring, true)
  assert.match(coverage?.reason ?? "", /事件计数/)
})

test("R08 public enrichment keeps the formal weighted rate unavailable", () => {
  const serialized = JSON.stringify(enrichment)
  assert.doesNotMatch(serialized, /\/Users\/|file:\/\//)
  assert.match(enrichment.limitations, /不是原R08定义的加权到期里程碑兑现率/)
})
