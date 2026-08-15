import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import {
  calculateKcrAssessment,
  KcrAssessmentRequestError,
  type KcrAssessmentRequest,
} from "../src/domain/kcr-v1/scoring-engine.ts"

interface ReferenceAcceptance {
  baselineScore: number
  riskLevel: string
  evidenceCoverage: number
  confidence: number
  dimensionScores: Record<string, number>
}

const projectRoot = dirname(
  fileURLToPath(new URL("../package.json", import.meta.url))
)
const golden = JSON.parse(
  readFileSync(
    join(projectRoot, "src/data/mvp/cambricon-scoring-input-v3.json"),
    "utf8"
  )
) as KcrAssessmentRequest
const reference = (
  JSON.parse(
    readFileSync(
      join(projectRoot, "src/data/methods/kcr-2026.08-v1.json"),
      "utf8"
    )
  ) as { referenceAcceptance: ReferenceAcceptance }
).referenceAcceptance
const fixedClock = () => new Date("2026-08-13T04:00:00.000Z")

function cloneGolden() {
  return structuredClone(golden)
}

function score(request: KcrAssessmentRequest = cloneGolden()) {
  return calculateKcrAssessment(request, { now: fixedClock })
}

test("V3 reproduces the Cambricon workbook acceptance result", () => {
  const result = score()

  assert.equal(result.modelVersion, "KCR-SCORE-2026.08-v3")
  assert.equal(result.baselineScore, reference.baselineScore)
  assert.equal(result.riskLevel, reference.riskLevel)
  assert.equal(result.riskLevelLabel, "中")
  assert.equal(result.evidenceCoverage, reference.evidenceCoverage)
  assert.equal(result.confidence, reference.confidence)
  assert.equal(result.status, "scored")
  assert.equal(result.reviewStatus, "ready")
  assert.equal(result.scoredWeight, 100)
  assert.equal(result.scoreWeightCoverage, 1)
  assert.equal(result.generatedAt, "2026-08-13T04:00:00.000Z")
  assert.equal(result.redFlags.length, 2)

  const actualDimensions = Object.fromEntries(
    result.dimensions.map((dimension) => [
      dimension.dimensionId,
      dimension.score,
    ])
  )
  const roundedReference = Object.fromEntries(
    Object.entries(reference.dimensionScores).map(([id, value]) => [
      id,
      Math.round(value * 10_000) / 10_000,
    ])
  )
  assert.deepEqual(actualDimensions, roundedReference)
})

test("risk band boundaries are low <25, medium <50, high <75, critical >=75", () => {
  const cases = [
    [24.999, "low", "低"],
    [25, "medium", "中"],
    [50, "high", "高"],
    [75, "critical", "极高"],
  ] as const

  for (const [riskScore, riskLevel, label] of cases) {
    const request = cloneGolden()
    for (const indicator of request.indicators) indicator.riskScore = riskScore
    const result = score(request)
    assert.equal(result.baselineScore, riskScore)
    assert.equal(result.riskLevel, riskLevel)
    assert.equal(result.riskLevelLabel, label)
  }
})

test("a missing observation is excluded and never silently scored as zero", () => {
  const request = cloneGolden()
  const missing = request.indicators.find((indicator) => indicator.id === "T01")
  assert.ok(missing)
  missing.riskScore = null
  missing.dataStatus = "missing"
  missing.coverageFactor = 0
  missing.evidenceConfidence = 0
  missing.evidence = []

  const result = score(request)
  assert.equal(result.baselineScore, 36.0417)
  assert.equal(result.scoredWeight, 96)
  assert.equal(result.scoreWeightCoverage, 0.96)
  assert.equal(result.evidenceCoverage, 0.92)
  assert.equal(result.confidence, 0.8575)
  assert.equal(result.status, "partial")
  assert.deepEqual(result.missingIndicatorIds, ["T01"])
  assert.match(result.formulaTrace, /3460\/96=36\.0417/)
})

test("low evidence coverage and empty dimensions force manual review", () => {
  const request = cloneGolden()
  for (const indicator of request.indicators) {
    if (indicator.id === "T01") continue
    indicator.riskScore = null
    indicator.dataStatus = "missing"
    indicator.coverageFactor = 0
    indicator.evidenceConfidence = 0
    indicator.evidence = []
  }

  const result = score(request)
  assert.equal(result.baselineScore, 25)
  assert.equal(result.evidenceCoverage, 0.03)
  assert.equal(result.confidence, 0.03)
  assert.equal(result.reviewStatus, "manual-review")
  assert.equal(
    result.dimensions.filter((dimension) => dimension.score === null).length,
    4
  )
  assert.ok(result.warnings.some((warning) => warning.includes("低于 70%")))
  assert.ok(result.warnings.some((warning) => warning.includes("无法评分")))
})

test("no scored observations returns an explicit insufficient-data state", () => {
  const request = cloneGolden()
  for (const indicator of request.indicators) {
    indicator.riskScore = null
    indicator.dataStatus = "missing"
    indicator.coverageFactor = 0
    indicator.evidenceConfidence = 0
    indicator.evidence = []
  }

  const result = score(request)
  assert.equal(result.baselineScore, null)
  assert.equal(result.riskLevel, null)
  assert.equal(result.riskLevelLabel, "数据不足")
  assert.equal(result.status, "insufficient-data")
  assert.equal(result.reviewStatus, "insufficient-data")
})

test("red flags stay visible without overwriting the objective baseline", () => {
  const withFlags = score()
  const request = cloneGolden()
  for (const event of request.events) event.redFlag = false
  const withoutFlags = score(request)

  assert.equal(withFlags.baselineScore, withoutFlags.baselineScore)
  assert.equal(withFlags.baselineScore, 35.6)
  assert.equal(withFlags.redFlags.length, 2)
  assert.equal(withoutFlags.redFlags.length, 0)
  assert.ok(
    withFlags.redFlags.every((redFlag) => !redFlag.affectsBaselineScore)
  )
})

test("propagation paths preserve audit values and ignore coefficients below 0.05", () => {
  const result = score()
  const direct = result.propagationPaths.find(
    (path) => path.id === "PATH-BIS-DIRECT"
  )
  const noise = result.propagationPaths.find(
    (path) => path.id === "PATH-SHAREHOLDER-NOISE"
  )

  assert.ok(direct)
  assert.equal(direct.pathCoefficient, 1)
  assert.equal(direct.propagatedRisk, 85)
  assert.equal(direct.included, true)
  assert.ok(noise)
  assert.equal(noise.pathCoefficient, 0.035)
  assert.equal(noise.candidateRisk, 1.75)
  assert.equal(noise.propagatedRisk, 0)
  assert.equal(noise.included, false)
})

test("run IDs are deterministic and calculation never mutates the request", () => {
  const request = cloneGolden()
  const before = structuredClone(request)
  const first = calculateKcrAssessment(request, {
    now: () => new Date("2026-08-13T04:00:00.000Z"),
  })
  const second = calculateKcrAssessment(request, {
    now: () => new Date("2026-08-14T04:00:00.000Z"),
  })

  assert.equal(first.runId, second.runId)
  assert.notEqual(first.generatedAt, second.generatedAt)
  assert.deepEqual(request, before)
})

test("invalid weights, evidence references, and unsupported scores fail safely", () => {
  const cases: Array<[string, (request: KcrAssessmentRequest) => void]> = [
    ["权重必须", (request) => (request.indicators[0].weight = 99)],
    [
      "未知证据",
      (request) => (request.indicators[0].evidence[0].evidenceId = "UNKNOWN"),
    ],
    [
      "进入评分前必须绑定有效证据",
      (request) => {
        request.indicators[0].evidence[0].supportStrength = "background"
        request.indicators[0].evidence[0].inferenceBasis = null
      },
    ],
    [
      "推断依据",
      (request) => (request.indicators[0].evidence[0].inferenceBasis = null),
    ],
    [
      "必须是 HTTP(S) URL",
      (request) =>
        (request.evidenceCatalog[0].sourceUrl = "javascript:alert(1)"),
    ],
  ]

  for (const [message, mutate] of cases) {
    const request = cloneGolden()
    mutate(request)
    assert.throws(
      () => score(request),
      (error: unknown) => {
        assert.ok(error instanceof KcrAssessmentRequestError)
        assert.equal(error.statusCode, 422)
        assert.equal(error.code, "KCR_ASSESSMENT_REQUEST_INVALID")
        assert.ok(error.details.some((detail) => detail.includes(message)))
        return true
      }
    )
  }
})
