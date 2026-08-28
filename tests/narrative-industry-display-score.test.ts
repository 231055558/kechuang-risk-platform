import assert from "node:assert/strict"
import test from "node:test"

import {
  calculateIndustryPercentileRiskScore,
  calculateNarrativeCompanyDisplayScore,
  calculateNarrativeAnnualDisplayScores,
  calculateWeightedNarrativeDisplayScore,
} from "../src/domain/narrative-risk-v1/industry-display-score.ts"
import narrativeIndustryTrends from "../src/data/industry/narrative-risk-industry-trends.json" with { type: "json" }
import type {
  NarrativeIndustryCompany,
  NarrativeIndustryObservation,
  NarrativeIndustryTrendResponse,
} from "../src/domain/narrative-risk-v1/model.ts"

test("行业百分位风险分覆盖0至100并对并列值取平均名次", () => {
  assert.equal(calculateIndustryPercentileRiskScore(1, [1, 2, 3], true), 0)
  assert.equal(calculateIndustryPercentileRiskScore(3, [1, 2, 3], true), 100)
  assert.equal(calculateIndustryPercentileRiskScore(1, [1, 2, 3], false), 100)
  assert.equal(calculateIndustryPercentileRiskScore(3, [1, 2, 3], false), 0)
  assert.equal(calculateIndustryPercentileRiskScore(2, [1, 2, 3], true), 50)
  assert.equal(calculateIndustryPercentileRiskScore(2, [2, 2, 2], true), 50)
  assert.equal(calculateIndustryPercentileRiskScore(2, [2], true), 50)
})

test("年度展示分只使用同一行业组且披露充分性按低值高风险反向排名", () => {
  const companies: NarrativeIndustryCompany[] = [
    {
      companyId: "selected",
      companyName: "目标企业",
      stockCode: "1",
      peerGroupId: "a",
      industryGroupId: "industry-a",
      includedYears: [2024, 2025],
    },
    {
      companyId: "peer",
      companyName: "同行企业",
      stockCode: "2",
      peerGroupId: "a",
      industryGroupId: "industry-a",
      includedYears: [2024, 2025],
    },
    {
      companyId: "other",
      companyName: "其他行业",
      stockCode: "3",
      peerGroupId: "b",
      industryGroupId: "industry-b",
      includedYears: [2024, 2025],
    },
  ]
  const observations: NarrativeIndustryObservation[] = [
    ["selected", 2024, 2],
    ["peer", 2024, 4],
    ["other", 2024, 0],
    ["selected", 2025, 5],
    ["peer", 2025, 1],
  ].map(([companyId, year, value]) => ({
    companyId: String(companyId),
    year: Number(year),
    metricKey: "information_sufficiency",
    value: Number(value),
    status: "已计算",
    missingReason: null,
    documentId: `${companyId}:${year}`,
    details: {},
  }))

  const scores = calculateNarrativeAnnualDisplayScores({
    company: companies[0],
    metricKey: "information_sufficiency",
    companies,
    observations,
  })

  assert.deepEqual(scores, [
    { year: 2024, score: 100, weight: 4, sampleSize: 2 },
    { year: 2025, score: 0, weight: 5, sampleSize: 2 },
  ])
})

test("最终展示分按最新年份5、前一年4的权重加权且不修改原始分", () => {
  const annualScores = [
    { year: 2023, score: 20, weight: 3, sampleSize: 20 },
    { year: 2024, score: 40, weight: 4, sampleSize: 20 },
    { year: 2025, score: 80, weight: 5, sampleSize: 20 },
  ]
  const snapshot = structuredClone(annualScores)

  assert.equal(
    calculateWeightedNarrativeDisplayScore(annualScores),
    (20 * 3 + 40 * 4 + 80 * 5) / 12
  )
  assert.deepEqual(annualScores, snapshot)
  assert.equal(calculateWeightedNarrativeDisplayScore([]), null)
})

test("企业对照叙事分复用三项行业排名加权分并要求三项完整", () => {
  const data = structuredClone(
    narrativeIndustryTrends
  ) as NarrativeIndustryTrendResponse
  const result = calculateNarrativeCompanyDisplayScore(data, "688256")

  assert.ok(result)
  assert.equal(Object.keys(result.metricScores).length, 3)
  assert.equal(
    result.score,
    Math.round(
      (Object.values(result.metricScores).reduce((sum, score) => sum + score, 0) /
        3) *
        100
    ) / 100
  )

  data.observations = data.observations.filter(
    (item) =>
      item.companyId !== "star-688256" ||
      item.metricKey !== "innovation_divergence"
  )
  assert.equal(calculateNarrativeCompanyDisplayScore(data, "688256"), null)
  assert.equal(calculateNarrativeCompanyDisplayScore(data, "000000"), null)
})
