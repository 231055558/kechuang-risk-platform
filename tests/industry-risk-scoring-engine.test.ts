import assert from "node:assert/strict"
import test from "node:test"

import pilotData from "../src/data/industry/design37-risk-pilot.json" with { type: "json" }
import {
  INDUSTRY_RISK_FULL_METHOD_VERSION,
  INDUSTRY_RISK_MVP_METHOD_VERSION,
  calculateFullIrawcScore,
  calculateHistoricalAnchor,
  calculateMvpRiskScore,
  calculateObjectiveWeights,
  calculateRiskPercentile,
  findLatestMetricObservation,
  getIndustryRiskPilotMetricReadiness,
  INDUSTRY_RISK_PILOT_METRICS,
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

test("MVP formula keeps the industry placeholder visible", () => {
  assert.equal(calculateMvpRiskScore(0, 0.5), 25)
  assert.equal(calculateMvpRiskScore(0.5, 0.5), 50)
  assert.equal(calculateMvpRiskScore(1, 0.5), 75)
})

test("full IRAWC refuses to score without a historical anchor", () => {
  assert.equal(calculateHistoricalAnchor([1, 2]), null)
  assert.deepEqual(
    calculateFullIrawcScore({
      historicalRiskDirectedValues: [1, 2],
      relativeRiskPercentile: 0.8,
    }),
    {
      methodVersion: INDUSTRY_RISK_FULL_METHOD_VERSION,
      score: null,
      historicalAnchor: null,
      status: "insufficient-history",
      formulaTrace: "历史样本不足，未计算 Ask，亦未补造风险分。",
    }
  )
})

test("full IRAWC uses the agreed historical anchor and beta correction", () => {
  const result = calculateFullIrawcScore({
    historicalRiskDirectedValues: [0, 25, 50, 75, 100],
    relativeRiskPercentile: 0.75,
  })
  assert.equal(result.methodVersion, INDUSTRY_RISK_FULL_METHOD_VERSION)
  assert.equal(result.historicalAnchor, 0.5)
  assert.equal(result.score, 60)
  assert.equal(result.status, "scored")
})

test("entropy and CRITIC weights are normalized", () => {
  const matrix = [
    [0, 0.5, 1],
    [0.5, 1, 0],
    [1, 0, 0.5],
  ]
  for (const method of ["entropy", "critic"] as const) {
    const weights = calculateObjectiveWeights(matrix, method)
    assert.equal(weights.length, 3)
    assert.ok(
      Math.abs(weights.reduce((sum, value) => sum + value, 0) - 1) < 1e-5
    )
  }
})

test("pilot scoring produces traceable five-indicator candidate baselines", () => {
  const assessments = scoreIndustryRiskDataset(dataset)
  assert.equal(assessments.length, 37)
  assert.deepEqual(
    getIndustryRiskPilotMetricReadiness(dataset).map((item) => ({
      indicatorId: item.indicatorId,
      sampleSize: item.sampleSize,
      scoreReady: item.scoreReady,
    })),
    [
      { indicatorId: "R07", sampleSize: 37, scoreReady: true },
      { indicatorId: "R13", sampleSize: 37, scoreReady: true },
      { indicatorId: "R14", sampleSize: 31, scoreReady: true },
      { indicatorId: "R16", sampleSize: 35, scoreReady: true },
      { indicatorId: "R18", sampleSize: 20, scoreReady: true },
    ]
  )
  for (const assessment of assessments) {
    assert.equal(assessment.methodVersion, INDUSTRY_RISK_MVP_METHOD_VERSION)
    assert.equal(assessment.industryRisk, 0.5)
    assert.equal(assessment.industryRiskStatus, "placeholder")
    assert.equal(assessment.metrics.length, 5)
    assert.ok(assessment.scoredIndicatorCount >= 2)
    assert.equal(assessment.totalIndicatorCount, 22)
    assert.equal(assessment.isOfficialTotalScore, false)
    assert.ok(assessment.metrics.every((metric) => metric.sampleSize >= 20))
  }
  const complete = assessments.filter((assessment) =>
    assessment.candidateAggregates.every(
      (aggregate) => aggregate.status === "partial-candidate"
    )
  )
  assert.equal(complete.length, 16)
  assert.ok(
    complete.every((assessment) =>
      assessment.candidateAggregates.every(
        (aggregate) =>
          aggregate.score !== null &&
          aggregate.sampleSize === 16 &&
          aggregate.note.includes("不是 R05–R22 官方总分")
      )
    )
  )
})

test("pilot scoring uses the latest company observation without filling gaps", () => {
  const rdMetric = INDUSTRY_RISK_PILOT_METRICS.find(
    (metric) => metric.indicatorId === "R07"
  )
  assert.ok(rdMetric)
  const latest = findLatestMetricObservation(dataset, "star-688256", rdMetric)
  assert.equal(latest?.asOfDate, "2026-06-30")
  assert.equal(latest?.numericValue, 11.72)

  const assessments = scoreIndustryRiskDataset(dataset)
  const cambricon = assessments.find(
    (assessment) => assessment.companyId === "star-688256"
  )
  assert.ok(cambricon)
  assert.deepEqual(
    cambricon.metrics.map((metric) => [
      metric.indicatorId,
      metric.rawValue,
      metric.asOfDate,
      metric.sampleSize,
    ]),
    [
      ["R07", 11.72, "2026-06-30", 37],
      ["R13", 108.133137, "2026-06-30", 37],
      ["R14", -0.349998, "2026-06-30", 31],
      ["R16", 18.355841, "2026-06-30", 35],
      ["R18", 0.001032, "2025-12-31", 20],
    ]
  )

  const changxin = assessments.find(
    (assessment) => assessment.companyId === "star-688825"
  )
  assert.ok(changxin)
  assert.equal(changxin.scoredIndicatorCount, 2)
  assert.ok(
    changxin.candidateAggregates.every(
      (aggregate) =>
        aggregate.status === "unavailable" && aggregate.score === null
    )
  )
})
