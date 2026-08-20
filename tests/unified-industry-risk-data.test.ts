import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import unifiedData from "../src/data/industry/r01-r22-unified.json" with { type: "json" }
import {
  assertIndustryRiskDataset,
  type IndustryRiskDataset,
} from "../src/domain/industry-risk-v1/index.ts"

const dataset = unifiedData as IndustryRiskDataset

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
