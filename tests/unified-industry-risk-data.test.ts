import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import unifiedData from "../src/data/industry/r01-r22-unified.json" with { type: "json" }
import narrativeRuntimeData from "../src/data/industry/r01-r04-narrative-news.json" with { type: "json" }
import {
  attachIndustryRiskNarrativeRuntime,
  assertIndustryRiskDataset,
  type IndustryRiskDataset,
  type IndustryRiskNarrativeRuntime,
} from "../src/domain/industry-risk-v1/index.ts"

const baseDataset = unifiedData as IndustryRiskDataset
const dataset = attachIndustryRiskNarrativeRuntime(
  baseDataset,
  narrativeRuntimeData as IndustryRiskNarrativeRuntime
)

test("the unified runtime contains only the R01-R22 contract across 94 companies", () => {
  assert.doesNotThrow(() => assertIndustryRiskDataset(dataset))
  assert.equal(dataset.companies.length, 94)
  assert.equal(dataset.indicators.length, 22)
  assert.deepEqual(
    dataset.indicators.map((indicator) => indicator.id),
    Array.from(
      { length: 22 },
      (_, index) => `R${String(index + 1).padStart(2, "0")}`
    )
  )
  assert.equal(dataset.observations.length, 4321)
  assert.equal(dataset.coverage.length, 94 * 22)
  assert.equal(dataset.deepSearchEvents?.length, 391)
  assert.equal(dataset.supplementaryObservations?.length, 687)
  assert.equal(dataset.narrativeNewsMetrics?.length, 37)
  assert.equal(dataset.narrativeNewsEvidence?.length, 1850)
  for (const indicatorId of ["R01", "R02", "R04"]) {
    assert.equal(
      dataset.coverage.filter(
        (item) =>
          item.indicatorId === indicatorId &&
          item.status === "部分覆盖" &&
          item.companyId.startsWith("star-")
      ).length,
      37
    )
  }
  assert.equal(
    dataset.coverage.filter(
      (item) => item.indicatorId === "R21" && item.status === "部分覆盖"
    ).length,
    37
  )
  assert.equal(
    dataset.coverage.filter(
      (item) => item.indicatorId === "R09" && item.status === "部分覆盖"
    ).length,
    37
  )
})

test("the browser snapshot excludes server-only narrative news payloads", () => {
  assert.equal(Object.hasOwn(baseDataset, "narrativeNewsEvidence"), false)
  assert.equal(Object.hasOwn(baseDataset, "narrativeNewsMetrics"), false)
  assert.equal(narrativeRuntimeData.narrativeNewsEvidence.length, 1850)
  assert.equal(narrativeRuntimeData.narrativeNewsMetrics.length, 37)
  assert.throws(
    () =>
      attachIndustryRiskNarrativeRuntime(baseDataset, {
        ...(narrativeRuntimeData as IndustryRiskNarrativeRuntime),
        dataVersion: "mismatched-data-version",
      }),
    /版本不一致/
  )
})

test("Eastmoney narrative observations keep aggregates and traceable news samples", () => {
  const metric = dataset.narrativeNewsMetrics?.find(
    (item) => item.companyId === "star-688256"
  )
  const news =
    dataset.narrativeNewsEvidence?.filter(
      (item) => item.companyId === "star-688256"
    ) ?? []

  assert.ok(metric)
  assert.equal(metric.retrievedCount, 250)
  assert.equal(metric.mediaCount, 37)
  assert.equal(metric.positiveCount, 132)
  assert.equal(metric.negativeCount, 28)
  assert.equal(metric.conceptCount, 151)
  assert.equal(metric.truncated, true)
  assert.equal(news.length, 50)
  assert.ok(news.every((item) => item.title.length > 0))
  assert.ok(news.every((item) => /^https?:\/\//.test(item.url)))
})

test("specific peer groups win duplicate stock codes and remain comparable", () => {
  const stockCodes = dataset.companies.map((company) => company.stockCode)
  assert.equal(new Set(stockCodes).size, 94)
  assert.deepEqual(
    dataset.metadata.peerGroups?.map((group) => [
      group.id,
      group.companyIds.length,
    ]),
    [
      ["digital-chip", 37],
      ["analog-chip", 27],
      ["pharma", 25],
      ["semiconductor-supplement", 5],
    ]
  )
  assert.equal(
    dataset.companies.find((company) => company.stockCode === "688256")
      ?.peerGroupId,
    "digital-chip"
  )
})

test("the original browser framework consumes the R01-R22 data adapter", () => {
  const mainSource = readFileSync(
    new URL("../src/main.tsx", import.meta.url),
    "utf8"
  )
  const appSource = readFileSync(
    new URL("../src/App.tsx", import.meta.url),
    "utf8"
  )
  assert.match(mainSource, /\.\/App\.tsx/)
  assert.match(appSource, /<AppShell/)
  assert.match(appSource, /@\/lib\/data-r01/)
})
