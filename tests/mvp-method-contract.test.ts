import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

interface MethodDimension {
  id: string
  label: string
  weight: number
  indicatorIds: string[]
}

interface MethodIndicator {
  id: string
  kind: "weighted" | "narrative-validation"
  dimensionId: string | null
  label: string
  weight: number | null
  affectsScore: boolean
}

interface MethodContract {
  schemaVersion: string
  methodVersion: string
  status: string
  scoreDirection: string
  scoreRange: { min: number; max: number }
  counts: {
    dimensions: number
    weightedIndicators: number
    narrativeIndicators: number
    totalIndicators: number
    totalWeight: number
  }
  rules: Record<string, string>
  requiredOutputs: string[]
  referenceAcceptance: {
    baselineScore: number
    riskLevel: string
    evidenceCoverage: number
    confidence: number
    dimensionScores: Record<string, number>
  }
  dimensions: MethodDimension[]
  indicators: MethodIndicator[]
}

const projectRoot = dirname(
  fileURLToPath(new URL("../package.json", import.meta.url))
)
const contract = JSON.parse(
  readFileSync(
    join(projectRoot, "src/data/methods/kcr-2026.08-v1.json"),
    "utf8"
  )
) as MethodContract

test("KCR-2026.08-v1 freezes one unambiguous MVP method contract", () => {
  assert.equal(contract.schemaVersion, "1.0.0")
  assert.equal(contract.methodVersion, "KCR-2026.08-v1")
  assert.equal(contract.status, "frozen-for-mvp")
  assert.equal(contract.scoreDirection, "higher-means-higher-risk")
  assert.deepEqual(contract.scoreRange, { min: 0, max: 100 })
  assert.deepEqual(contract.counts, {
    dimensions: 5,
    weightedIndicators: 18,
    narrativeIndicators: 4,
    totalIndicators: 22,
    totalWeight: 100,
  })
})

test("weighted indicators have stable IDs and exactly 100 total weight", () => {
  const weighted = contract.indicators.filter(
    (indicator) => indicator.kind === "weighted"
  )
  const dimensionIds = new Set(
    contract.dimensions.map((dimension) => dimension.id)
  )

  assert.equal(weighted.length, contract.counts.weightedIndicators)
  assert.equal(
    weighted.reduce((total, indicator) => total + (indicator.weight ?? 0), 0),
    contract.counts.totalWeight
  )

  for (const indicator of weighted) {
    assert.match(indicator.id, /^[TCFEP]\d{2}$/)
    assert.ok(indicator.label.trim().length > 0)
    assert.ok(indicator.dimensionId)
    assert.ok(dimensionIds.has(indicator.dimensionId))
    assert.ok(typeof indicator.weight === "number" && indicator.weight > 0)
    assert.equal(indicator.affectsScore, true)
  }
})

test("dimension declarations and indicator weights cannot drift apart", () => {
  assert.equal(contract.dimensions.length, contract.counts.dimensions)
  assert.equal(
    contract.dimensions.reduce(
      (total, dimension) => total + dimension.weight,
      0
    ),
    contract.counts.totalWeight
  )

  for (const dimension of contract.dimensions) {
    const indicators = contract.indicators.filter(
      (indicator) => indicator.dimensionId === dimension.id
    )
    assert.deepEqual(
      indicators.map((indicator) => indicator.id),
      dimension.indicatorIds
    )
    assert.equal(
      indicators.reduce(
        (total, indicator) => total + (indicator.weight ?? 0),
        0
      ),
      dimension.weight
    )
  }
})

test("narrative validation indicators can never affect a risk score", () => {
  const narrative = contract.indicators.filter(
    (indicator) => indicator.kind === "narrative-validation"
  )

  assert.equal(narrative.length, contract.counts.narrativeIndicators)
  for (const indicator of narrative) {
    assert.match(indicator.id, /^N\d{2}$/)
    assert.equal(indicator.dimensionId, null)
    assert.equal(indicator.weight, null)
    assert.equal(indicator.affectsScore, false)
  }
})

test("method outputs keep score, quality, red flags, and provenance separate", () => {
  assert.deepEqual(
    new Set(contract.requiredOutputs),
    new Set([
      "baselineScore",
      "riskLevel",
      "dimensionScores",
      "evidenceCoverage",
      "confidence",
      "redFlags",
      "evidenceTrace",
      "missingData",
      "methodVersion",
      "snapshotAt",
      "disclaimer",
    ])
  )
  assert.equal(
    contract.rules.missingObservation,
    "missing-is-not-zero-and-is-excluded-from-scoring"
  )
  assert.equal(
    contract.rules.narrative,
    "validation-only-and-never-affects-score"
  )
  assert.equal(
    contract.rules.scenario,
    "objective-baseline-is-immutable-and-results-are-side-by-side"
  )
})

test("the frozen Cambricon acceptance target matches the agreed golden case", () => {
  assert.equal(contract.referenceAcceptance.baselineScore, 35.6)
  assert.equal(contract.referenceAcceptance.riskLevel, "medium")
  assert.equal(contract.referenceAcceptance.evidenceCoverage, 0.95)
  assert.equal(contract.referenceAcceptance.confidence, 0.8875)
  assert.deepEqual(contract.referenceAcceptance.dimensionScores, {
    technology: 20.8,
    compliance: 46.5,
    finance: 28.5,
    external: 63.75,
    "personnel-governance": 17.666666666666668,
  })
})
