import assert from "node:assert/strict"
import test from "node:test"

import pilotData from "../src/data/industry/design37-risk-pilot.json" with { type: "json" }
import {
  INDUSTRY_RISK_MVP_METHOD_VERSION,
  INDUSTRY_RISK_SCORING_METRICS,
  calculateRiskPercentile,
  findLatestMetricObservation,
  getIndustryRiskPilotMetricReadiness,
  scoreIndustryRiskDataset,
  type IndustryRiskDataset,
} from "../src/domain/industry-risk-v1/index.ts"

const dataset = pilotData as IndustryRiskDataset

test("risk percentile applies direction and averages tied ranks", () => {
  assert.equal(
    calculateRiskPercentile(20, [10, 20, 20, 40], "higher-is-riskier"),
    0.5
  )
  assert.equal(
    calculateRiskPercentile(20, [10, 20, 20, 40], "lower-is-riskier"),
    0.5
  )
  assert.equal(calculateRiskPercentile(10, [10, 20, 30], "lower-is-riskier"), 1)
})

test("V3 exposes all R05-R22 metrics and keeps unavailable formulas explicit", () => {
  const readiness = getIndustryRiskPilotMetricReadiness(dataset)
  assert.equal(readiness.length, 18)
  assert.deepEqual(
    readiness.map((item) => [item.indicatorId, item.sampleSize, item.scoreReady]),
    [
      ["R05", 37, true],
      ["R06", 37, true],
      ["R07", 37, true],
      ["R08", 18, true],
      ["R09", 0, false],
      ["R10", 30, true],
      ["R11", 37, true],
      ["R12", 36, true],
      ["R13", 37, true],
      ["R14", 31, true],
      ["R15", 27, true],
      ["R16", 35, true],
      ["R17", 0, false],
      ["R18", 20, true],
      ["R19", 37, true],
      ["R20", 0, false],
      ["R21", 0, false],
      ["R22", 36, true],
    ]
  )
  assert.equal(readiness.filter((item) => item.scoreReady).length, 14)
  assert.deepEqual(
    readiness
      .filter((item) => item.basis === "unavailable")
      .map((item) => item.indicatorId),
    ["R09", "R17", "R20", "R21"]
  )
})

test("V3 scores every company from its available indicators", () => {
  const assessments = scoreIndustryRiskDataset(dataset)
  assert.equal(assessments.length, 37)
  for (const assessment of assessments) {
    assert.equal(assessment.methodVersion, INDUSTRY_RISK_MVP_METHOD_VERSION)
    assert.equal(assessment.metrics.length, 18)
    assert.equal(assessment.totalIndicatorCount, 18)
    assert.equal(assessment.narrativeIndicatorCount, 4)
    assert.equal(assessment.isOfficialTotalScore, false)
    assert.equal(assessment.candidateAggregate.method, "available-equal")
    assert.equal(assessment.candidateAggregate.status, "partial-candidate")
    assert.equal(
      assessment.candidateAggregate.availableIndicatorCount,
      assessment.scoredIndicatorCount
    )
    assert.ok(assessment.candidateAggregate.score !== null)
  }
  assert.equal(
    Math.min(...assessments.map((assessment) => assessment.scoredIndicatorCount)),
    6
  )
  assert.equal(
    Math.max(...assessments.map((assessment) => assessment.scoredIndicatorCount)),
    14
  )
})

test("V3 skips a company's missing metrics without zero filling", () => {
  const assessments = scoreIndustryRiskDataset(dataset)
  const changxin = assessments.find(
    (assessment) => assessment.companyId === "star-688825"
  )
  assert.ok(changxin)
  assert.equal(changxin.scoredIndicatorCount, 6)
  assert.equal(changxin.candidateAggregate.availableIndicatorCount, 6)
  assert.equal(changxin.candidateAggregate.coverageRate, 0.3333)
  assert.equal(changxin.candidateAggregate.score, 39.81)
  assert.deepEqual(Object.keys(changxin.candidateAggregate.weights), [
    "R05",
    "R06",
    "R07",
    "R11",
    "R13",
    "R19",
  ])
  assert.ok(
    changxin.metrics
      .filter((metric) => metric.status === "missing")
      .every(
        (metric) =>
          metric.riskScore === null && metric.formulaTrace.includes("不补零")
      )
  )
})

test("V3 keeps latest values, source traces, and proxy labels", () => {
  const rdMetric = INDUSTRY_RISK_SCORING_METRICS.find(
    (metric) => metric.indicatorId === "R07"
  )
  assert.ok(rdMetric)
  const latest = findLatestMetricObservation(dataset, "star-688256", rdMetric)
  assert.equal(latest?.asOfDate, "2026-06-30")
  assert.equal(latest?.numericValue, 11.72)

  const cambricon = scoreIndustryRiskDataset(dataset).find(
    (assessment) => assessment.companyId === "star-688256"
  )
  assert.ok(cambricon)
  assert.equal(cambricon.scoredIndicatorCount, 13)
  assert.equal(cambricon.candidateAggregate.score, 37.47)
  assert.equal(
    cambricon.metrics.find((metric) => metric.indicatorId === "R05")?.basis,
    "partial-proxy"
  )
  assert.equal(
    cambricon.metrics.find((metric) => metric.indicatorId === "R08")?.status,
    "missing"
  )
  assert.equal(
    cambricon.metrics.find((metric) => metric.indicatorId === "R09")?.status,
    "unavailable"
  )
})
