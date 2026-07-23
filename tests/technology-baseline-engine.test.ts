import assert from "node:assert/strict"
import test from "node:test"

import {
  calculateTechnologyBaseline,
  getTechnologyBaselineIndicatorIds,
  TECHNOLOGY_BASELINE_MODEL_VERSION,
} from "../src/lib/technology-baseline-engine.ts"
import type {
  TechnologyBaselineCalibrationIndicatorId,
  TechnologyBaselineEvidenceReference,
  TechnologyBaselineIndicatorId,
  TechnologyBaselineMetricId,
  TechnologyBaselineQuantificationRequest,
} from "../src/types/risk.ts"

const officialIndicatorIds = [
  "tqi-001",
  "tqi-002",
  "tqi-003",
  "tqi-004",
  "tqi-005",
  "tqi-006",
] as const satisfies readonly TechnologyBaselineIndicatorId[]

const calibrationIndicatorIds = [
  "tqc-001",
  "tqc-002",
  "tqc-003",
  "tqc-004",
  "tqc-005",
  "tqc-006",
  "tqc-007",
  "tqc-008",
] as const satisfies readonly TechnologyBaselineCalibrationIndicatorId[]

function evidence(
  ids: readonly TechnologyBaselineMetricId[] = [
    ...officialIndicatorIds,
    ...calibrationIndicatorIds,
  ],
  overrides: Partial<TechnologyBaselineEvidenceReference> = {}
): TechnologyBaselineEvidenceReference[] {
  return ids.map((indicatorId) => ({
    indicatorId,
    evidenceId: "ds-e2",
    locator: `公开披露：${indicatorId} 对应页码或章节`,
    supportStrength: "direct",
    ...overrides,
  }))
}

function completeRequest(): TechnologyBaselineQuantificationRequest {
  return {
    companyId: "deepseek",
    period: "2025",
    asOfDate: "2026-07-21",
    lifecycleStage: "startup",
    values: {
      papersPublished: 21,
      validInventionPatents: 30,
      researchDevelopmentExpense: 16,
      operatingRevenue: 100,
      totalIntellectualProperty: 50,
      researchStaffCount: 200,
      technologyContractTransactionAmount: 1200,
      annualReportRiskNegativeProbability: 0.6,
      patentApplications: 51,
      patentGrants: 31,
      intangibleAssets: 20,
      netAssets: 100,
      currentTrl: 7,
      coreTechnologyProductRevenue: 71,
    },
    evidence: evidence(),
  }
}

function calculate(request = completeRequest()) {
  return calculateTechnologyBaseline(
    request,
    new Date("2026-07-21T08:00:00.000Z")
  )
}

function calibrationResult(
  request: TechnologyBaselineQuantificationRequest,
  indicatorId: TechnologyBaselineCalibrationIndicatorId
) {
  const result = calculate(request).calibrationIndicatorResults.find(
    (item) => item.indicatorId === indicatorId
  )

  assert.ok(result)
  return result
}

test("technology baseline v5 keeps six official metrics separate from eight calibration metrics", () => {
  const result = calculate()

  assert.equal(TECHNOLOGY_BASELINE_MODEL_VERSION, "TQB-2026.07-v5")
  assert.deepEqual(getTechnologyBaselineIndicatorIds(), officialIndicatorIds)
  assert.equal(result.modelVersion, "TQB-2026.07-v5")
  assert.deepEqual(
    result.indicatorResults.map((item) => item.indicatorId),
    officialIndicatorIds
  )
  assert.deepEqual(
    result.calibrationIndicatorResults.map((item) => item.indicatorId),
    calibrationIndicatorIds
  )
  assert.equal(result.quantifiedIndicatorCount, 6)
  assert.equal(result.calibratedIndicatorCount, 8)
  assert.equal(result.calibrationStatus, "complete")
  assert.equal(result.scoringStatus, "calibration-observation-only")
  assert.equal(result.score, null)
  assert.equal(result.riskBand, null)
  assert.match(result.disclaimer, /不驱动六维雷达图/)
})

test("technology baseline preserves lifecycle-specific Excel weights for formal metrics", () => {
  const expected = {
    startup: { dimensionWeight: 30, weights: [4, 6, 7, 6, 5, 2] },
    growth: { dimensionWeight: 25, weights: [3, 6, 6, 5, 3, 2] },
    stable: { dimensionWeight: 20, weights: [2, 5, 5, 4, 3, 1] },
  } as const

  for (const [lifecycleStage, expectation] of Object.entries(expected)) {
    const result = calculate({
      ...completeRequest(),
      lifecycleStage:
        lifecycleStage as TechnologyBaselineQuantificationRequest["lifecycleStage"],
    })

    assert.equal(result.technologyDimensionWeight, expectation.dimensionWeight)
    assert.deepEqual(
      result.lifecycleWeights.map((item) => item.weight),
      expectation.weights
    )
    assert.equal(result.quantifiedWeight, expectation.dimensionWeight)
  }
})

test("technology baseline calibrates every threshold boundary without generating an aggregate", () => {
  const cases: ReadonlyArray<{
    indicatorId: TechnologyBaselineCalibrationIndicatorId
    values: Partial<TechnologyBaselineQuantificationRequest["values"]>
    expected: readonly ["low" | "medium" | "high", 25 | 60 | 85]
  }> = [
    { indicatorId: "tqc-001", values: { papersPublished: 4 }, expected: ["high", 85] },
    { indicatorId: "tqc-001", values: { papersPublished: 5 }, expected: ["medium", 60] },
    { indicatorId: "tqc-001", values: { papersPublished: 21 }, expected: ["low", 25] },
    { indicatorId: "tqc-002", values: { patentApplications: 9 }, expected: ["high", 85] },
    { indicatorId: "tqc-002", values: { patentApplications: 10 }, expected: ["medium", 60] },
    { indicatorId: "tqc-002", values: { patentApplications: 51 }, expected: ["low", 25] },
    { indicatorId: "tqc-003", values: { patentApplications: 100, patentGrants: 29 }, expected: ["high", 85] },
    { indicatorId: "tqc-003", values: { patentApplications: 100, patentGrants: 30 }, expected: ["medium", 60] },
    { indicatorId: "tqc-003", values: { patentApplications: 100, patentGrants: 61 }, expected: ["low", 25] },
    { indicatorId: "tqc-004", values: { researchDevelopmentExpense: 4, operatingRevenue: 100 }, expected: ["high", 85] },
    { indicatorId: "tqc-004", values: { researchDevelopmentExpense: 5, operatingRevenue: 100 }, expected: ["medium", 60] },
    { indicatorId: "tqc-004", values: { researchDevelopmentExpense: 16, operatingRevenue: 100 }, expected: ["low", 25] },
    { indicatorId: "tqc-006", values: { currentTrl: 3 }, expected: ["high", 85] },
    { indicatorId: "tqc-006", values: { currentTrl: 4 }, expected: ["medium", 60] },
    { indicatorId: "tqc-006", values: { currentTrl: 7 }, expected: ["low", 25] },
    { indicatorId: "tqc-007", values: { coreTechnologyProductRevenue: 29, operatingRevenue: 100 }, expected: ["high", 85] },
    { indicatorId: "tqc-007", values: { coreTechnologyProductRevenue: 30, operatingRevenue: 100 }, expected: ["medium", 60] },
    { indicatorId: "tqc-007", values: { coreTechnologyProductRevenue: 71, operatingRevenue: 100 }, expected: ["low", 25] },
    { indicatorId: "tqc-008", values: { annualReportRiskNegativeProbability: 0.19 }, expected: ["low", 25] },
    { indicatorId: "tqc-008", values: { annualReportRiskNegativeProbability: 0.2 }, expected: ["medium", 60] },
    { indicatorId: "tqc-008", values: { annualReportRiskNegativeProbability: 0.51 }, expected: ["high", 85] },
  ]

  for (const { indicatorId, values, expected } of cases) {
    const result = calibrationResult(
      {
        ...completeRequest(),
        values: { ...completeRequest().values, ...values },
      },
      indicatorId
    )

    assert.equal(result.status, "calculated")
    assert.equal(result.riskBand, expected[0])
    assert.equal(result.standardizedRiskScore, expected[1])
    assert.equal(result.scoringEligible, true)
    assert.ok(result.thresholdTrace)
  }
})

test("technology baseline keeps the intangible-assets ratio formula-only", () => {
  const result = calibrationResult(completeRequest(), "tqc-005")

  assert.equal(result.status, "calculated")
  assert.equal(result.value, 20)
  assert.match(result.formulaTrace, /无形资产/)
  assert.equal(result.riskBand, null)
  assert.equal(result.standardizedRiskScore, null)
  assert.equal(result.thresholdTrace, null)
  assert.equal(result.scoringEligible, false)
  assert.equal(result.contributesToAggregate, false)
})

test("technology baseline rejects invalid calibration inputs and zero denominators", () => {
  const cases: ReadonlyArray<{
    indicatorId: TechnologyBaselineCalibrationIndicatorId
    values: Partial<TechnologyBaselineQuantificationRequest["values"]>
    message: RegExp
  }> = [
    {
      indicatorId: "tqc-002",
      values: { patentApplications: -1 },
      message: /不能小于 0/,
    },
    {
      indicatorId: "tqc-003",
      values: { patentApplications: 0, patentGrants: 0 },
      message: /专利申请量必须大于 0/,
    },
    {
      indicatorId: "tqc-004",
      values: { operatingRevenue: 0 },
      message: /营业收入必须大于 0/,
    },
    {
      indicatorId: "tqc-005",
      values: { netAssets: 0 },
      message: /净资产必须大于 0/,
    },
    {
      indicatorId: "tqc-006",
      values: { currentTrl: 4.5 },
      message: /TRL.*整数/,
    },
    {
      indicatorId: "tqc-006",
      values: { currentTrl: 10 },
      message: /TRL.*不能大于 9/,
    },
    {
      indicatorId: "tqc-008",
      values: { annualReportRiskNegativeProbability: 1.01 },
      message: /不能大于 1/,
    },
  ]

  for (const { indicatorId, values, message } of cases) {
    const result = calibrationResult(
      {
        ...completeRequest(),
        values: { ...completeRequest().values, ...values },
      },
      indicatorId
    )

    assert.equal(result.status, "invalid-input")
    assert.match(result.validationErrors.join(" "), message)
  }
})

test("technology baseline admits only governed direct or fully explained inferred evidence", () => {
  const direct = calibrationResult(completeRequest(), "tqc-006")
  assert.equal(direct.status, "calculated")

  for (const supportStrength of ["background", "pending"] as const) {
    const rejected = calibrationResult(
      {
        ...completeRequest(),
        evidence: evidence(["tqc-006"], { supportStrength }),
      },
      "tqc-006"
    )
    assert.equal(rejected.status, "ineligible-evidence")
  }

  const inferredWithoutReferenceBasis = calibrationResult(
    {
      ...completeRequest(),
      evidence: [
        {
          indicatorId: "tqc-006",
          evidenceId: "ds-e3",
          locator: "论文第 4 节",
          supportStrength: "inferred",
        },
      ],
    },
    "tqc-006"
  )
  assert.equal(inferredWithoutReferenceBasis.status, "ineligible-evidence")

  const inferredWithCompleteBasis = calibrationResult(
    {
      ...completeRequest(),
      evidence: [
        {
          indicatorId: "tqc-006",
          evidenceId: "ds-e3",
          locator: "论文第 4 节",
          supportStrength: "inferred",
          inferenceBasis: "依据公开实验设置和模型说明，推导技术成熟度观察。",
        },
      ],
    },
    "tqc-006"
  )
  assert.equal(inferredWithCompleteBasis.status, "calculated")
  assert.deepEqual(inferredWithCompleteBasis.evidenceIds, ["ds-e3"])
})
