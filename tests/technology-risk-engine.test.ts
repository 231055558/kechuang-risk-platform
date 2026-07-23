import assert from "node:assert/strict"
import test from "node:test"

import {
  calculateTechnologyRisk,
  TECHNOLOGY_RISK_MODEL_VERSION,
} from "../src/lib/technology-risk-engine.ts"
import type {
  TechnologyRiskEvidenceReference,
  TechnologyRiskScoreRequest,
} from "../src/types/risk.ts"

type CompleteTechnologyRiskScoreRequest = Omit<
  TechnologyRiskScoreRequest,
  "indicators" | "incidents"
> & {
  indicators: Required<TechnologyRiskScoreRequest["indicators"]>
  incidents: NonNullable<TechnologyRiskScoreRequest["incidents"]>
}

const directEvidence = (
  evidenceId: string
): TechnologyRiskEvidenceReference[] => [
  {
    evidenceId,
    locator: `${evidenceId} 第 12 页`,
    supportStrength: "direct" as const,
  },
]

function completeRequest(): CompleteTechnologyRiskScoreRequest {
  return {
    companyId: "deepseek",
    period: "2026-Q2",
    asOfDate: "2026-07-19",
    indicators: {
      "kci-006": {
        values: { industryPercentile: 100 },
        evidence: directEvidence("ds-e2"),
      },
      "kci-007": {
        values: {
          citationImpactScore: 100,
          topResearchQualityScore: 100,
          patentLinkageScore: 100,
          productConversionScore: 100,
          noCorePaperThreeYears: false,
          unableToMapCoreTechnology: false,
        },
        evidence: directEvidence("ds-e2"),
      },
      "kci-008": {
        values: {
          forwardCitationScore: 100,
          patentFamilyScore: 100,
          claimAndLegalScore: 100,
          technologyCoverageScore: 100,
          widespreadCorePatentFailure: false,
        },
        evidence: directEvidence("ds-e2"),
      },
      "kci-009": {
        values: {
          researchInvestmentPeerScore: 100,
          updateCyclePeerScore: 100,
          noEffectiveUpdateThreeYears: false,
        },
        evidence: directEvidence("ds-e2"),
      },
      "kci-010": {
        values: {
          currentTrl: 9,
          targetTrl: 9,
          dueMilestones: 10,
          completedOnTimeMilestones: 10,
          selfAssessedWithoutExperimentEvidence: false,
        },
        evidence: directEvidence("ds-e2"),
      },
      "kci-011": {
        values: {
          completedProjects: 10,
          convertedProjects: 10,
        },
        evidence: directEvidence("ds-e2"),
      },
      "kci-012": {
        values: {
          criticalItemCount: 10,
          thirdPartyCoveredItems: 10,
          customerCoveredItems: 0,
          independentInternalCoveredItems: 0,
          selfTestCoveredItems: 0,
          requiredCriticalTests: 10,
          passedCriticalTests: 10,
          mandatoryOrSafetyTestFailure: false,
        },
        evidence: directEvidence("ds-e2"),
      },
      "kci-013": {
        values: {
          standardCriticalModules: 10,
          highImpactCriticalModules: 5,
          irreplaceableExternalStandardModules: 0,
          irreplaceableExternalHighImpactModules: 0,
          highImpactSingleSource: false,
          exportRestriction: false,
          nonRenewableCriticalLicense: false,
        },
        evidence: directEvidence("ds-e2"),
      },
    },
    incidents: [],
  }
}

test("technology model scores all eight prescribed indicators with 100% weight coverage", () => {
  const result = calculateTechnologyRisk(
    completeRequest(),
    new Date("2026-07-19T08:00:00.000Z")
  )

  assert.equal(result.modelVersion, TECHNOLOGY_RISK_MODEL_VERSION)
  assert.equal(result.weightedCoverage, 100)
  assert.equal(result.coveredWeight, 100)
  assert.equal(result.baseScore, 0)
  assert.equal(result.score, 0)
  assert.equal(result.indicatorResults.length, 8)
  assert.ok(
    result.indicatorResults.every((indicator) => indicator.status === "scored")
  )
})

test("coverage below 70% keeps the technology radar score null", () => {
  const request = completeRequest()
  request.indicators = {
    "kci-006": request.indicators["kci-006"],
    "kci-007": request.indicators["kci-007"],
    "kci-008": request.indicators["kci-008"],
    "kci-009": request.indicators["kci-009"],
    "kci-010": request.indicators["kci-010"],
  } as typeof request.indicators

  const result = calculateTechnologyRisk(request)

  assert.equal(result.coveredWeight, 55)
  assert.equal(result.weightedCoverage, 55)
  assert.equal(result.baseScore, null)
  assert.equal(result.score, null)
  assert.equal(result.status, "insufficient-coverage")
})

test("the weighted average normalizes over the actually scored weight", () => {
  const request = completeRequest()
  request.indicators["kci-006"].values.industryPercentile = 50
  request.indicators["kci-007"].values = {
    ...request.indicators["kci-007"].values,
    citationImpactScore: 50,
    topResearchQualityScore: 50,
    patentLinkageScore: 50,
    productConversionScore: 50,
  }
  request.indicators["kci-008"].values = {
    ...request.indicators["kci-008"].values,
    forwardCitationScore: 50,
    patentFamilyScore: 50,
    claimAndLegalScore: 50,
    technologyCoverageScore: 50,
  }
  request.indicators["kci-009"].values = {
    ...request.indicators["kci-009"].values,
    researchInvestmentPeerScore: 50,
    updateCyclePeerScore: 50,
  }
  request.indicators["kci-010"].values = {
    ...request.indicators["kci-010"].values,
    currentTrl: 7,
    targetTrl: 9,
    completedOnTimeMilestones: 5,
  }
  request.indicators["kci-011"].values = {
    completedProjects: 10,
    convertedProjects: 5,
  }
  const partialIndicators =
    request.indicators as TechnologyRiskScoreRequest["indicators"]
  delete partialIndicators["kci-012"]
  delete partialIndicators["kci-013"]

  const result = calculateTechnologyRisk(request)

  assert.equal(result.coveredWeight, 70)
  assert.equal(result.weightedCoverage, 70)
  assert.equal(result.baseScore, 50)
  assert.equal(result.score, 50)
})

test("background evidence and inferred evidence without reasoning cannot score", () => {
  const request = completeRequest()
  request.indicators["kci-006"].evidence = [
    {
      evidenceId: "ds-e1",
      locator: "官网首页",
      supportStrength: "background",
    },
  ]
  request.indicators["kci-007"].evidence = [
    {
      evidenceId: "ds-e3",
      locator: "年报第 20 页",
      supportStrength: "inferred",
    },
  ]

  const result = calculateTechnologyRisk(request)
  const performance = result.indicatorResults.find(
    (indicator) => indicator.indicatorId === "kci-006"
  )
  const papers = result.indicatorResults.find(
    (indicator) => indicator.indicatorId === "kci-007"
  )

  assert.equal(performance?.status, "ineligible-evidence")
  assert.equal(papers?.status, "ineligible-evidence")
  assert.equal(result.coveredWeight, 82)
})

test("unknown, cross-company, and governance-mismatched evidence cannot score", () => {
  const cases: Array<{
    label: string
    evidence: TechnologyRiskEvidenceReference[]
  }> = [
    {
      label: "unknown evidence",
      evidence: directEvidence("fabricated-evidence"),
    },
    {
      label: "cross-company evidence",
      evidence: directEvidence("ut-e1"),
    },
    {
      label: "support strength mismatch",
      evidence: [
        {
          evidenceId: "ds-e2",
          locator: "API 文档接口章节",
          supportStrength: "inferred",
          inferenceBasis: "依据接口章节推导技术能力与产品兑现关系。",
        },
      ],
    },
  ]

  for (const candidate of cases) {
    const request = completeRequest()
    request.indicators["kci-006"].evidence = candidate.evidence
    const result = calculateTechnologyRisk(request)
    const performance = result.indicatorResults.find(
      (indicator) => indicator.indicatorId === "kci-006"
    )

    assert.equal(
      performance?.status,
      "ineligible-evidence",
      candidate.label
    )
  }
})

test("TRL and milestone inputs follow the prescribed maturity formula", () => {
  const request = completeRequest()
  request.indicators["kci-010"].values = {
    currentTrl: 7,
    targetTrl: 9,
    dueMilestones: 10,
    completedOnTimeMilestones: 5,
    selfAssessedWithoutExperimentEvidence: false,
  }

  const result = calculateTechnologyRisk(request)
  const maturity = result.indicatorResults.find(
    (indicator) => indicator.indicatorId === "kci-010"
  )

  assert.equal(maturity?.capabilityScore, 50)
  assert.equal(maturity?.riskScore, 50)
  assert.match(maturity?.formulaTrace ?? "", /60%/)
})

test("independent validation and external dependency formulas are auditable", () => {
  const request = completeRequest()
  request.indicators["kci-012"].values = {
    criticalItemCount: 10,
    thirdPartyCoveredItems: 2,
    customerCoveredItems: 2,
    independentInternalCoveredItems: 2,
    selfTestCoveredItems: 2,
    requiredCriticalTests: 10,
    passedCriticalTests: 8,
    mandatoryOrSafetyTestFailure: false,
  }
  request.indicators["kci-013"].values = {
    standardCriticalModules: 6,
    highImpactCriticalModules: 2,
    irreplaceableExternalStandardModules: 2,
    irreplaceableExternalHighImpactModules: 1,
    highImpactSingleSource: false,
    exportRestriction: false,
    nonRenewableCriticalLicense: false,
  }

  const result = calculateTechnologyRisk(request)
  const validation = result.indicatorResults.find(
    (indicator) => indicator.indicatorId === "kci-012"
  )
  const dependency = result.indicatorResults.find(
    (indicator) => indicator.indicatorId === "kci-013"
  )

  assert.equal(validation?.capabilityScore, 68)
  assert.equal(validation?.riskScore, 32)
  assert.equal(dependency?.riskScore, 40)
})

test("forced-high conditions raise a sufficiently covered final score to at least 85", () => {
  const request = completeRequest()
  request.indicators[
    "kci-010"
  ].values.selfAssessedWithoutExperimentEvidence = true

  const result = calculateTechnologyRisk(request)

  assert.equal(result.baseScore, 0)
  assert.equal(result.score, 85)
  assert.ok(
    result.forcedHighReasons.some((reason) =>
      reason.includes("TRL 仅为自评")
    )
  )
})

test("major technology incidents remain a separate red-flag overlay", () => {
  const request = completeRequest()
  request.incidents = [
    {
      id: "incident-1",
      occurredAt: "2026-01-15",
      severity: 8,
      responsibility: "secondary",
      description: "重大安全事故",
      concealed: false,
      repeatedSeriousIncident: false,
      evidence: directEvidence("ds-e2"),
    },
  ]

  const result = calculateTechnologyRisk(request)

  assert.equal(result.incidentOverlay.index, 4)
  assert.equal(result.incidentOverlay.level, "medium-high")
  assert.equal(result.incidentOverlay.riskFloor, 60)
  assert.equal(result.baseScore, 0)
  assert.equal(result.score, 60)
})

test("indicator validation errors are isolated so other indicators can still score", () => {
  const request = completeRequest()
  request.indicators["kci-011"].values = {
    completedProjects: 2,
    convertedProjects: 3,
  }

  const result = calculateTechnologyRisk(request)
  const conversion = result.indicatorResults.find(
    (indicator) => indicator.indicatorId === "kci-011"
  )

  assert.equal(conversion?.status, "invalid-input")
  assert.ok(
    conversion?.validationErrors.some((message) =>
      message.includes("不能大于")
    )
  )
  assert.equal(result.coveredWeight, 85)
  assert.notEqual(result.score, null)
})

test("malformed request envelopes return an intentional 422 error", () => {
  assert.throws(
    () => calculateTechnologyRisk({ companyId: "", indicators: [] }),
    (error: unknown) => {
      assert.equal(
        (error as { statusCode?: number }).statusCode,
        422
      )
      assert.equal(
        (error as { code?: string }).code,
        "TECHNOLOGY_SCORE_REQUEST_INVALID"
      )
      return true
    }
  )
})

test("run IDs are stable for the same auditable scoring request", () => {
  const request = completeRequest()
  const first = calculateTechnologyRisk(
    request,
    new Date("2026-07-19T08:00:00.000Z")
  )
  const second = calculateTechnologyRisk(
    JSON.parse(JSON.stringify(request)),
    new Date("2026-07-19T09:00:00.000Z")
  )

  assert.equal(first.runId, second.runId)
  assert.notEqual(first.generatedAt, second.generatedAt)
})
