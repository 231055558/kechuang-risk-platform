import assert from "node:assert/strict"
import test from "node:test"

import pilotData from "../src/data/industry/semiconductor-risk-pilot.json" with { type: "json" }
import {
  INDUSTRY_RISK_FULL_METHOD_VERSION,
  INDUSTRY_RISK_MVP_METHOD_VERSION,
  calculateFullIrawcScore,
  calculateHistoricalAnchor,
  calculateMvpRiskScore,
  calculateObjectiveWeights,
  calculateRiskPercentile,
  buildIndustryRiskConclusion,
  generateIndustryRiskRecommendations,
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

test("single-indicator formula combines the fixed anchor and peer percentile", () => {
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
  assert.equal(result.score, 62.5)
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

test("pilot scoring produces missing-aware R01-R22 usable baselines", () => {
  const assessments = scoreIndustryRiskDataset(dataset)
  assert.equal(assessments.length, 10)
  for (const assessment of assessments) {
    assert.equal(assessment.methodVersion, INDUSTRY_RISK_MVP_METHOD_VERSION)
    assert.equal(assessment.industryRisk, 0.5)
    assert.equal(assessment.industryRiskStatus, "fixed-anchor")
    assert.equal(assessment.metrics.length, 22)
    assert.equal(assessment.scoredIndicatorCount, 9)
    assert.equal(assessment.weightedScoredIndicatorCount, 9)
    assert.equal(assessment.totalIndicatorCount, 22)
    assert.equal(assessment.isOfficialTotalScore, false)
    assert.equal(assessment.dimensionScores.length, 5)
    assert.equal(assessment.narrativeIndex.score, null)
    assert.equal(assessment.narrativeIndex.status, "unavailable")
    assert.ok(assessment.totalRiskScore !== null)
    assert.ok(
      assessment.metrics
        .filter((metric) => metric.kind === "narrative")
        .every(
          (metric) =>
            metric.status === "not-score-ready" &&
            metric.riskPercentile === null &&
            metric.riskScore === null &&
            !metric.formulaTrace.includes("r_rel=")
        )
    )
    assert.ok(
      assessment.metrics
        .filter((metric) => metric.status === "scored")
        .every(
          (metric) =>
            metric.riskScore !== null &&
            metric.sourceId !== null &&
            metric.sampleSize === assessment.benchmarkSampleSize
        )
    )
    assert.equal(
      assessment.candidateAggregates.find(
        (aggregate) => aggregate.method === "critic"
      )?.status,
      "usable-benchmark"
    )
    assert.ok(
      assessment.candidateAggregates.every(
        (aggregate) =>
          aggregate.score !== null && aggregate.note.includes("缺失不补零")
      )
    )
  }
})

test("system recommendations turn the highest weighted risks into direct actions", () => {
  const assessment = scoreIndustryRiskDataset(dataset)[0]
  const recommendations = generateIndustryRiskRecommendations(assessment)
  const scoredWeightedRisks = assessment.metrics
    .filter((metric) => metric.kind === "weighted" && metric.riskScore !== null)
    .sort((left, right) => (right.riskScore ?? 0) - (left.riskScore ?? 0))

  assert.equal(recommendations.length, 3)
  assert.deepEqual(
    recommendations.map((item) => item.indicatorId),
    scoredWeightedRisks.slice(0, 3).map((item) => item.indicatorId)
  )
  assert.ok(recommendations.every((item) => item.action.length > 20))
  assert.ok(recommendations.every((item) => item.trigger.includes("风险分")))
  assert.doesNotMatch(
    recommendations.map((item) => item.action).join("\n"),
    /人工复核|待复核/
  )
  assert.match(buildIndustryRiskConclusion(assessment), /综合风险指数为/)
  assert.match(buildIndustryRiskConclusion(assessment), /当前主要风险来自/)
})
