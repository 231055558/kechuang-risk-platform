import assert from "node:assert/strict"
import test from "node:test"

import {
  riskQuantificationCatalog,
  riskQuantificationCatalogByDimension,
} from "../src/data/risk-quantification-catalog.ts"
import { getScoringRule } from "../src/lib/scoring-rules.ts"

const dimensions = [
  "narrative",
  "technology",
  "compliance",
  "finance",
  "external",
  "personnel",
] as const

test("the quantification catalog covers all six risk dimensions", () => {
  assert.deepEqual([...riskQuantificationCatalogByDimension.keys()], dimensions)

  for (const dimension of dimensions) {
    assert.ok(
      (riskQuantificationCatalogByDimension.get(dimension) ?? []).length > 0,
      `${dimension} should have quantification items`
    )
  }
})

test("the technology specialization has eight weighted core indicators and one red flag", () => {
  const technologyItems =
    riskQuantificationCatalogByDimension.get("technology") ?? []
  const weightedItems = technologyItems.filter(
    (item) => item.indicatorWeight !== undefined
  )
  const redFlags = technologyItems.filter((item) => item.id === "ktr-red-flag")

  assert.equal(weightedItems.length, 8)
  assert.equal(
    weightedItems.reduce(
      (total, item) => total + (item.indicatorWeight ?? 0),
      0
    ),
    100
  )
  assert.equal(redFlags.length, 1)
  assert.equal(redFlags[0]?.indicatorWeight, undefined)
})

test("the five non-technology dimensions retain all 21 source indicators", () => {
  const nonTechnologyItems = riskQuantificationCatalog.filter(
    (item) => item.dimension !== "technology"
  )

  assert.equal(nonTechnologyItems.length, 21)
  assert.deepEqual(
    Object.fromEntries(
      dimensions
        .filter((dimension) => dimension !== "technology")
        .map((dimension) => [
          dimension,
          riskQuantificationCatalogByDimension.get(dimension)?.length ?? 0,
        ])
    ),
    {
      narrative: 5,
      compliance: 3,
      finance: 6,
      external: 4,
      personnel: 3,
    }
  )
})

test("only local-score indicators use local scoring rules", () => {
  for (const item of riskQuantificationCatalog) {
    if (item.method === "local-score") {
      assert.ok(item.indicatorId, `${item.id} needs a stable indicator ID`)
      assert.ok(
        getScoringRule(item.indicatorId),
        `${item.id} should have a local scoring rule`
      )
    }

    if (item.method === "technology-auto") {
      assert.equal(item.dimension, "technology")
    }

    if (item.method === "calibration" || item.method === "review") {
      assert.notEqual(
        item.readiness,
        "ready",
        `${item.id} must not be marked auto-score ready`
      )
    }
  }
})
