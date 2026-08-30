import assert from "node:assert/strict"
import test from "node:test"

import type { IndustryRiskCompanySummary } from "../src/domain/industry-risk-v1/index.ts"
import {
  formatIndicatorRawValue,
  indicatorRankAssessment,
  indicatorRankFromRiskPercentile,
  indicatorUnitExplanation,
  riskPercentileFromAscendingRank,
  selectPeerRiskContext,
} from "../src/lib/indicator-analysis.ts"

function company(index: number): IndustryRiskCompanySummary {
  return {
    companyId: `company-${index}`,
    companyName: `企业${index}`,
    stockCode: String(600000 + index),
    chainSegment: "sample",
    peerGroupId: "peer",
    peerGroupLabel: "同业",
    benchmarkGroupId: "benchmark",
    benchmarkGroupLabel: "同业",
    benchmarkSampleSize: 12,
    totalRiskScore: 100 - index,
    financialNarrativeStatus: "data-pending",
    weightedDataCoverage: 1,
    scoredIndicatorCount: 18,
    totalIndicatorCount: 22,
    coveredIndicatorCount: 22,
    eventCount: 0,
    candidateAggregates: [
      {
        method: "entropy",
        score: null,
        weights: {},
        status: "unavailable",
        note: "",
      },
      {
        method: "critic",
        score: null,
        weights: {},
        status: "unavailable",
        note: "",
      },
    ],
    indicatorHeat: [],
  }
}

test("peer matrix ranks low risk first and collapses only the middle interval", () => {
  const companies = Array.from({ length: 12 }, (_, index) => company(index))
  const result = selectPeerRiskContext(companies, "company-9")
  assert.deepEqual(
    result.ranked.map((item) => item.companyId),
    [
      "company-11",
      "company-10",
      "company-9",
      "company-8",
      "company-7",
      "company-6",
      "company-5",
      "company-4",
      "company-3",
      "company-2",
      "company-1",
      "company-0",
    ]
  )
  assert.equal(result.currentRank, 3)
  assert.deepEqual(
    result.collapsedRows.map((row) =>
      row.kind === "company"
        ? `${row.rank}:${row.company.companyId}`
        : `gap:${row.fromRank}-${row.toRank}`
    ),
    [
      "1:company-11",
      "2:company-10",
      "3:company-9",
      "4:company-8",
      "5:company-7",
      "gap:6-8",
      "9:company-3",
      "10:company-2",
      "11:company-1",
      "12:company-0",
    ]
  )
})

test("overlapping head, neighbor, and tail ranges merge without duplicates", () => {
  const companies = Array.from({ length: 12 }, (_, index) => company(index))
  const result = selectPeerRiskContext(companies, "company-5")
  assert.equal(
    result.collapsedRows.filter((row) => row.kind === "gap").length,
    0
  )
  assert.equal(result.collapsedRows.length, result.ranked.length)
  assert.equal(
    new Set(
      result.collapsedRows.flatMap((row) =>
        row.kind === "company" ? [row.company.companyId] : []
      )
    ).size,
    result.ranked.length
  )
})

test("missing scores are excluded before assigning the low-risk-first rank", () => {
  const companies = Array.from({ length: 12 }, (_, index) => company(index))
  companies[11] = { ...companies[11], totalRiskScore: null }
  const result = selectPeerRiskContext(companies, "company-5")
  assert.equal(result.ranked[0]?.companyId, "company-10")
  assert.equal(result.ranked.at(-1)?.companyId, "company-0")
  assert.equal(
    result.ranked.some((item) => item.companyId === "company-11"),
    false
  )
})

test("indicator percentiles become low-risk-first ranks and relative assessments", () => {
  assert.equal(riskPercentileFromAscendingRank(1, 64), 0)
  assert.equal(riskPercentileFromAscendingRank(64, 64), 1)
  assert.equal(indicatorRankFromRiskPercentile(0.0556, 37), 3)
  assert.equal(indicatorRankFromRiskPercentile(0.95, 64), 61)
  assert.equal(indicatorRankAssessment(3, 37), "同业较优")
  assert.equal(indicatorRankAssessment(61, 64), "同业较弱")
  assert.equal(indicatorRankAssessment(1, 3), "样本有限")
})

test("raw values stay compact while percent and percentage-point units remain distinct", () => {
  assert.equal(formatIndicatorRawValue(108.133137), "108.13")
  assert.equal(formatIndicatorRawValue(-0.349998), "-0.35")
  assert.equal(formatIndicatorRawValue(0.001032), "0.001")
  assert.notEqual(
    indicatorUnitExplanation("%"),
    indicatorUnitExplanation("百分点")
  )
})
