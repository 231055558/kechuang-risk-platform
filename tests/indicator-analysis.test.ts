import assert from "node:assert/strict"
import test from "node:test"

import type { IndustryRiskCompanySummary } from "../src/domain/industry-risk-v1/index.ts"
import {
  formatIndicatorRawValue,
  indicatorUnitExplanation,
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

test("peer matrix separates the lowest-risk companies from unique rank neighbors", () => {
  const companies = Array.from({ length: 12 }, (_, index) => company(index))
  const result = selectPeerRiskContext(companies, "company-9")
  assert.deepEqual(
    result.lowestRisk.map((item) => item.companyId),
    ["company-11", "company-10", "company-9", "company-8"]
  )
  assert.deepEqual(
    result.neighbors.map((item) => item.companyId),
    ["company-7"]
  )
  assert.equal(
    new Set(result.visible.map((item) => item.companyId)).size,
    result.visible.length
  )
})

test("missing scores are never presented as the lowest-risk companies", () => {
  const companies = Array.from({ length: 12 }, (_, index) => company(index))
  companies[11] = { ...companies[11], totalRiskScore: null }
  const result = selectPeerRiskContext(companies, "company-5")
  assert.deepEqual(
    result.lowestRisk.map((item) => item.companyId),
    ["company-10", "company-9", "company-8", "company-7"]
  )
  assert.deepEqual(
    result.neighbors.map((item) => item.companyId),
    ["company-3", "company-4", "company-5", "company-6"]
  )
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
