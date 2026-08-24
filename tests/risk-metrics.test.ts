import assert from "node:assert/strict"
import test from "node:test"

import {
  buildRiskAssessment as buildRiskAssessmentFromRuntime,
  calculateResponseRate,
  createNormalizationRuleKey,
  summarizeEventStatuses,
  type NormalizationRuleRegistry,
} from "../src/lib/risk-metrics.ts"
import { calculateTechnologyBaseline } from "../src/lib/technology-baseline-engine.ts"
import {
  isEffectiveEvidence,
  summarizeEvidenceGovernance,
} from "../src/lib/source-governance.ts"
import type {
  CompanyDetail,
  EvidenceItem,
  EvidenceScoringBinding,
  IndicatorObservation,
  RiskIndicator,
  TechnologyRiskOverride,
  TechnologyRiskScoreResult,
  TechnologyBaselineQuantificationRequest,
  TechnologyBaselineQuantificationResult,
  TechnologyScoringCompanyState,
} from "../src/types/risk.ts"

test("calculateResponseRate returns zero for an empty event list", () => {
  assert.equal(calculateResponseRate([]), 0)
})

test("calculateResponseRate uses completed events over total events", () => {
  assert.equal(
    calculateResponseRate(["pending", "in-progress", "in-progress", "done"]),
    25
  )
  assert.equal(
    calculateResponseRate([
      { status: "pending" },
      { status: "pending" },
      { status: "in-progress" },
    ]),
    0
  )
})

test("summarizeEventStatuses reports counts and the shared response rate", () => {
  const summary = summarizeEventStatuses([
    { status: "pending" },
    { status: "in-progress" },
    { status: "in-progress" },
    { status: "done" },
  ])

  assert.deepEqual(summary, {
    pending: 1,
    inProgress: 2,
    done: 1,
    responseRate: 25,
  })
})

function evidence(
  id: string,
  supportStrength: EvidenceItem["supportStrength"],
  sourceName = "交易所公告",
  inferenceBasis?: string,
  indicatorIds: string[] = []
): EvidenceItem {
  return {
    id,
    type: "公告",
    title: id,
    sourceName,
    sourceUrl: `https://example.com/${id}`,
    publishedAt: "2026-07-01",
    summary: id,
    relatedRiskDimension: [],
    relatedStage: [],
    confidence: 0.9,
    supportStrength,
    inferenceBasis,
    indicatorIds,
    scoringLinks: indicatorIds.map((indicatorId) => ({
      indicatorId,
      period: "2026-Q2",
      unit: "分",
      locator: `${id} 第 12 页`,
    })),
  }
}

function indicator(id: string, primaryRisk = "技术"): RiskIndicator {
  return {
    id,
    sourceRow: 2,
    primaryRisk,
    secondaryRisk: "成熟度",
    tertiaryRisk: id,
    definition: id,
    formula: id,
    threshold: id,
    entityType: id,
    relatedEntities: id,
    dataSource: "交易所公告",
    frequency: "年度",
    admissionStatus: "validated",
    admissionNote: "test",
  }
}

function assessmentDetail(
  dimensionIds: string[],
  scores: number[]
): CompanyDetail {
  const evidenceItems = dimensionIds.map((id) =>
    evidence(`e-${id}`, "direct", "交易所公告", undefined, [`i-${id}`])
  )
  const dimensions = dimensionIds.map((id, index) => ({
    id,
    label: id,
    score: scores[index],
    level: "attention" as const,
    weight: "test",
    summary: `${id} summary`,
    evidenceIds: [`e-${id}`],
    indicatorIds: [`i-${id}`],
  }))

  return {
    id: "test-company",
    name: "测试企业",
    sector: "测试",
    description: "测试",
    headquarters: "杭州",
    stage: "测试",
    riskIndex: 0,
    benchmarkCompanyId: "benchmark",
    snapshotAt: "2026-07-14",
    metrics: {
      highRiskEvents: 0,
      mediumRiskEvents: 0,
      responseRate: 0,
      evidenceCoverage: 0,
      monitoredSources: 0,
      currentHighRiskType: "测试",
    },
    dimensions,
    lifecycle: [],
    trend: [],
    aiCoverage: {
      ingestedSourceTypes: [],
      extractedSignals: [],
    },
    comparisonNote: "",
    evidence: evidenceItems,
    events: [],
    transmissionGraph: { keyInsight: "", nodes: [], edges: [] },
    governance: [],
  }
}

function observation(
  companyId: string,
  indicatorId: string,
  evidenceId: string,
  normalizedScore: number
): IndicatorObservation {
  return {
    companyId,
    indicatorId,
    status: "available",
    value: String(normalizedScore),
    unit: "分",
    normalizedScore,
    normalizationRuleVersion: "test-normalization-v1",
    reviewStatus: "reviewed",
    reviewedBy: "测试复核人",
    reviewedAt: "2026-07-14",
    period: "2026-Q2",
    evidenceIds: [evidenceId],
    note: "test",
  }
}

function normalizationRules(
  ...indicatorIds: string[]
): NormalizationRuleRegistry {
  return Object.fromEntries(
    indicatorIds.map((indicatorId) => [
      createNormalizationRuleKey(indicatorId, "test-normalization-v1"),
      (candidate: IndicatorObservation) => Number(candidate.value),
    ])
  )
}

function runtimeBinding(
  observation: IndicatorObservation,
  evidenceId: string,
  overrides: Partial<EvidenceScoringBinding> = {}
): EvidenceScoringBinding {
  return {
    id: `binding-${evidenceId}`,
    observationId: observation.id ?? "observation-1",
    companyId: observation.companyId,
    indicatorId: observation.indicatorId,
    evidenceId,
    period: observation.period,
    unit: observation.unit,
    locator: `${evidenceId} 第 12 页`,
    createdAt: "2026-07-14T01:00:00.000Z",
    updatedAt: "2026-07-14T01:00:00.000Z",
    ...overrides,
  }
}

function technologyResult(
  companyId: string,
  overrides: Partial<TechnologyRiskScoreResult> = {}
): TechnologyRiskScoreResult {
  return {
    companyId,
    period: "2026-Q2",
    asOfDate: "2026-07-18",
    modelVersion: "KTR-2026.07-v1",
    runId: "ktr-current-run",
    generatedAt: "2026-07-18T08:30:00.000Z",
    status: "scored",
    coveredWeight: 78,
    weightedCoverage: 78,
    baseScore: 68,
    score: 72,
    indicatorResults: [
      {
        indicatorId: "kci-006",
        label: "核心技术性能行业分位",
        weight: 10,
        status: "scored",
        capabilityScore: 30,
        riskScore: 70,
        formulaTrace: "风险分=100-行业百分位。",
        validationErrors: [],
        evidenceIds: ["e-tech"],
      },
      {
        indicatorId: "kci-007",
        label: "核心论文质量与技术转化关联",
        weight: 8,
        status: "missing",
        capabilityScore: null,
        riskScore: null,
        formulaTrace: "未提交该指标的原始观测值。",
        validationErrors: [],
        evidenceIds: ["e-ignored"],
      },
    ],
    incidentOverlay: {
      index: 0,
      level: "low",
      riskFloor: 0,
      incidentId: null,
      formulaTrace: "未提交具备计分证据的重大技术事故。",
    },
    forcedHighReasons: [],
    ...overrides,
  }
}

function technologyState(
  companyId: string,
  options: {
    result?: TechnologyRiskScoreResult | null
    override?: TechnologyRiskOverride | null
    baselineResult?: TechnologyBaselineQuantificationResult | null
  } = {}
): TechnologyScoringCompanyState {
  return {
    draftRequest: null,
    latestResult:
      options.result === undefined
        ? technologyResult(companyId)
        : options.result,
    override: options.override ?? null,
    baselineDraftRequest: null,
    latestBaselineResult: options.baselineResult ?? null,
    updatedAt: "2026-07-18T09:00:00.000Z",
  }
}

function technologyBaselineResult(
  companyId: string
): TechnologyBaselineQuantificationResult {
  const request: TechnologyBaselineQuantificationRequest = {
    companyId: "deepseek",
    period: "2025",
    asOfDate: "2026-07-21",
    lifecycleStage: "startup",
    values: {
      papersPublished: 8,
      validInventionPatents: 30,
      researchDevelopmentExpense: 32,
      operatingRevenue: 100,
      totalIntellectualProperty: 50,
      researchStaffCount: 200,
      technologyContractTransactionAmount: 1200,
      annualReportRiskNegativeProbability: 0.35,
    },
    evidence: [
      "tqi-001",
      "tqi-002",
      "tqi-003",
      "tqi-004",
      "tqi-005",
      "tqi-006",
    ].map((indicatorId) => ({
      indicatorId:
        indicatorId as TechnologyBaselineQuantificationRequest["evidence"][number]["indicatorId"],
      evidenceId: "ds-e2",
      locator: `公开披露第 ${indicatorId.slice(-1)} 节`,
      supportStrength: "direct" as const,
    })),
  }
  const generated = calculateTechnologyBaseline(
    request,
    new Date("2026-07-21T08:00:00.000Z")
  )

  return {
    ...generated,
    companyId,
    indicatorResults: generated.indicatorResults.map((item) => ({
      ...item,
      evidenceIds: item.evidenceIds.map(() => "e-tech"),
    })),
  }
}

function buildRiskAssessment(
  detail: CompanyDetail,
  indicators: RiskIndicator[],
  methodVersion: string,
  observations: IndicatorObservation[] = [],
  rules: NormalizationRuleRegistry = {},
  evidenceBindings?: EvidenceScoringBinding[],
  technologyScoringState: TechnologyScoringCompanyState | null = null
) {
  const runtimeBindings =
    evidenceBindings ??
    observations.flatMap((candidate, observationIndex) =>
      candidate.evidenceIds.map((evidenceId, evidenceIndex) =>
        runtimeBinding(
          {
            ...candidate,
            id: candidate.id ?? `observation-${observationIndex + 1}`,
          },
          evidenceId,
          {
            id: `binding-${observationIndex + 1}-${evidenceIndex + 1}`,
          }
        )
      )
    )

  return buildRiskAssessmentFromRuntime(
    detail,
    indicators,
    methodVersion,
    observations,
    rules,
    runtimeBindings,
    technologyScoringState
  )
}

test("technology automatic scoring replaces the technology dimension with auditable result data", () => {
  const detail = assessmentDetail(["tech"], [88])
  const assessment = buildRiskAssessment(
    detail,
    [indicator("kci-006", "技术")],
    "test-v2",
    [],
    {},
    [],
    technologyState(detail.id)
  )
  const technology = assessment.dimensions.find(
    (dimension) => dimension.id === "technology"
  )

  assert.ok(technology)
  assert.equal(technology.assessable, true)
  assert.equal(technology.score, 72)
  assert.equal(technology.scoreBasis, "technology-auto-score")
  assert.deepEqual(technology.indicatorIds, ["kci-006"])
  assert.deepEqual(technology.evidenceIds, ["e-tech"])
  assert.equal(technology.evidenceIndicatorPairCount, 1)
  assert.match(technology.summary, /KTR-2026\.07-v1/)
  assert.match(technology.summary, /78%/)
  assert.equal(assessment.scoreBasisLabel, "技术自动评分与指标计算")
  assert.equal(assessment.reviewedAt, "2026-07-18T08:30:00.000Z")
})

test("a valid reviewed override for the current run takes precedence over the automatic score", () => {
  const detail = assessmentDetail(["tech"], [88])
  const assessment = buildRiskAssessment(
    detail,
    [indicator("kci-006", "技术")],
    "test-v2",
    [],
    {},
    [],
    technologyState(detail.id, {
      override: {
        companyId: detail.id,
        targetRunId: "ktr-current-run",
        enabled: true,
        score: 91,
        reason: "复核后确认事故影响需要上调。",
        reviewedBy: "技术风控负责人",
        reviewedAt: "2026-07-18T10:00:00.000Z",
      },
    })
  )
  const technology = assessment.dimensions.find(
    (dimension) => dimension.id === "technology"
  )

  assert.ok(technology)
  assert.equal(technology.score, 91)
  assert.equal(technology.scoreBasis, "technology-auto-score")
  assert.match(technology.summary, /确认调整/)
  assert.equal(assessment.reviewedAt, "2026-07-18T10:00:00.000Z")
})

test("stale and incomplete technology overrides are ignored", () => {
  const detail = assessmentDetail(["tech"], [88])
  const invalidOverrides: Array<{
    label: string
    override: TechnologyRiskOverride
  }> = [
    {
      label: "stale run",
      override: {
        targetRunId: "ktr-old-run",
        enabled: true,
        score: 99,
        reason: "旧运行复核。",
        reviewedBy: "复核人",
        reviewedAt: "2026-07-18T10:00:00.000Z",
      },
    },
    {
      label: "out of range score",
      override: {
        targetRunId: "ktr-current-run",
        enabled: true,
        score: 101,
        reason: "分数越界。",
        reviewedBy: "复核人",
        reviewedAt: "2026-07-18T10:00:00.000Z",
      },
    },
    {
      label: "missing reason",
      override: {
        targetRunId: "ktr-current-run",
        enabled: true,
        score: 90,
        reason: " ",
        reviewedBy: "复核人",
        reviewedAt: "2026-07-18T10:00:00.000Z",
      },
    },
    {
      label: "missing reviewer",
      override: {
        targetRunId: "ktr-current-run",
        enabled: true,
        score: 90,
        reason: "已复核。",
        reviewedBy: " ",
        reviewedAt: "2026-07-18T10:00:00.000Z",
      },
    },
    {
      label: "invalid review date",
      override: {
        targetRunId: "ktr-current-run",
        enabled: true,
        score: 90,
        reason: "已复核。",
        reviewedBy: "复核人",
        reviewedAt: "not-a-date",
      },
    },
  ]

  for (const candidate of invalidOverrides) {
    const assessment = buildRiskAssessment(
      detail,
      [indicator("kci-006", "技术")],
      "test-v2",
      [],
      {},
      [],
      technologyState(detail.id, { override: candidate.override })
    )
    const technology = assessment.dimensions.find(
      (dimension) => dimension.id === "technology"
    )

    assert.ok(technology)
    assert.equal(technology.score, 72, candidate.label)
  }
})

test("invalid or insufficient automatic results fall back to legacy manual technology observations", () => {
  const detail = assessmentDetail(["tech"], [88])
  const manual = observation(detail.id, "kci-006", "e-tech", 66)
  const invalidResults: TechnologyRiskScoreResult[] = [
    technologyResult(detail.id, {
      status: "insufficient-coverage",
      score: null,
      coveredWeight: 55,
      weightedCoverage: 55,
    }),
    technologyResult(detail.id, { score: 101 }),
  ]

  for (const result of invalidResults) {
    const assessment = buildRiskAssessment(
      detail,
      [indicator("kci-006", "技术")],
      "test-v2",
      [manual],
      normalizationRules("kci-006"),
      undefined,
      technologyState(detail.id, { result })
    )
    const technology = assessment.dimensions.find(
      (dimension) => dimension.id === "technology"
    )

    assert.ok(technology)
    assert.equal(technology.score, 66)
    assert.equal(technology.scoreBasis, "indicator-observation")
    assert.equal(assessment.scoreBasisLabel, "R05–R22 客观指标自动计算")
  }
})

test("a valid TQB v4 raw quantification does not assess technology when KTR is unavailable", () => {
  const detail = assessmentDetail(["tech"], [88])
  const assessment = buildRiskAssessment(
    detail,
    [indicator("kci-006", "技术")],
    "test-v2",
    [],
    {},
    [],
    technologyState(detail.id, {
      result: technologyResult(detail.id, {
        status: "insufficient-coverage",
        score: null,
      }),
      baselineResult: technologyBaselineResult(detail.id),
    })
  )
  const technology = assessment.dimensions.find(
    (dimension) => dimension.id === "technology"
  )

  assert.ok(technology)
  assert.equal(technology.score, null)
  assert.equal(technology.scoreBasis, null)
  assert.equal(technology.assessable, false)
  assert.equal(assessment.scoreLabel, "暂无可用指标")
})

test("a valid KTR result takes precedence over the TQB baseline result", () => {
  const detail = assessmentDetail(["tech"], [88])
  const assessment = buildRiskAssessment(
    detail,
    [indicator("kci-006", "技术")],
    "test-v2",
    [],
    {},
    [],
    technologyState(detail.id, {
      baselineResult: technologyBaselineResult(detail.id),
    })
  )
  const technology = assessment.dimensions.find(
    (dimension) => dimension.id === "technology"
  )

  assert.ok(technology)
  assert.equal(technology.score, 72)
  assert.match(technology.summary, /KTR-2026\.07-v1/)
})

test("automatic technology scoring and manual dimensions produce the mixed basis label", () => {
  const detail = assessmentDetail(["tech", "data"], [88, 55])
  const manualCompliance = observation(detail.id, "i-data", "e-data", 55)
  const assessment = buildRiskAssessment(
    detail,
    [indicator("kci-006", "技术"), indicator("i-data", "合规")],
    "test-v2",
    [manualCompliance],
    normalizationRules("i-data"),
    undefined,
    technologyState(detail.id)
  )

  assert.equal(assessment.scoreBasisLabel, "自动评分与指标计算")
})

test("the auxiliary index is the rounded equal-weight assessable average", () => {
  const dimensionIds = ["tech", "data", "finance", "external"]
  const detail = assessmentDetail(dimensionIds, [80, 70, 60, 50])
  const primaryRiskByDimension: Record<string, string> = {
    tech: "技术",
    data: "合规",
    finance: "财务与融资风险",
    external: "外部风险",
  }
  const indicators = dimensionIds.map((id) =>
    indicator(`i-${id}`, primaryRiskByDimension[id])
  )
  const observations = dimensionIds.map((id, index) =>
    observation(detail.id, `i-${id}`, `e-${id}`, [80, 70, 60, 50][index])
  )
  const assessment = buildRiskAssessment(
    detail,
    indicators,
    "test-v2",
    observations,
    normalizationRules(...observations.map((item) => item.indicatorId))
  )

  assert.equal(assessment.label, "风险辅助研判指数")
  assert.equal(assessment.assessableDimensionCount, 4)
  assert.equal(assessment.score, 65)
  assert.equal(assessment.scoreLabel, "65")
  assert.equal(assessment.reviewStatus, "manual-review")
  assert.equal(assessment.effectiveEvidenceCoverage, 100)
  assert.ok(
    assessment.dimensions
      .filter((dimension) => dimension.assessable)
      .every(
        (dimension) =>
          dimension.scoreBasis === "indicator-observation" &&
          dimension.evidenceIndicatorPairCount === 1
      )
  )
})

test("multiple periods of the same indicator use only the latest reviewed observation", () => {
  const detail = assessmentDetail(["tech"], [88])
  const older = observation(detail.id, "i-tech", "e-tech", 30)
  older.period = "2026-Q1"
  older.reviewedAt = "2026-04-10"
  const latest = observation(detail.id, "i-tech", "e-tech", 90)
  latest.period = "2026-Q2"
  latest.reviewedAt = "2026-07-10"

  const assessment = buildRiskAssessment(
    detail,
    [indicator("i-tech", "技术")],
    "test-v2",
    [older, latest],
    normalizationRules("i-tech")
  )
  const technology = assessment.dimensions.find(
    (dimension) => dimension.id === "technology"
  )

  assert.ok(technology)
  assert.equal(technology.score, 90)
  assert.equal(technology.indicatorIds.length, 1)
  assert.equal(technology.evidenceIndicatorPairCount, 1)
})

test("latest-period selection compares calendar periods instead of text order", () => {
  const detail = assessmentDetail(["tech"], [88])
  const september = observation(detail.id, "i-tech", "e-tech", 30)
  september.period = "2026-9"
  september.reviewedAt = "2026-10-05"
  detail.evidence[0].scoringLinks = [
    {
      indicatorId: "i-tech",
      period: "2026-9",
      unit: "分",
      locator: "第 9 页",
    },
    {
      indicatorId: "i-tech",
      period: "2026-10",
      unit: "分",
      locator: "第 10 页",
    },
  ]
  const october = observation(detail.id, "i-tech", "e-tech", 90)
  october.period = "2026-10"
  october.reviewedAt = "2026-11-05"

  const assessment = buildRiskAssessment(
    detail,
    [indicator("i-tech", "技术")],
    "test-v2",
    [october, september],
    normalizationRules("i-tech")
  )
  const technology = assessment.dimensions.find(
    (dimension) => dimension.id === "technology"
  )

  assert.ok(technology)
  assert.equal(technology.score, 90)
  assert.equal(assessment.reviewedAt, "2026-11-05")
})

test("runtime evidence bindings admit direct evidence without static scoring links", () => {
  const detail = assessmentDetail(["tech"], [88])
  detail.evidence[0].scoringLinks = []
  const candidate = observation(detail.id, "i-tech", "e-tech", 88)
  candidate.id = "observation-tech"

  const assessment = buildRiskAssessment(
    detail,
    [indicator("i-tech", "技术")],
    "test-v2",
    [candidate],
    normalizationRules("i-tech"),
    [runtimeBinding(candidate, "e-tech")]
  )
  const technology = assessment.dimensions.find(
    (dimension) => dimension.id === "technology"
  )

  assert.ok(technology)
  assert.equal(technology.assessable, true)
  assert.equal(technology.score, 88)
  assert.deepEqual(technology.evidenceIds, ["e-tech"])
})

test("runtime evidence bindings enforce evidence admission and inference basis", () => {
  const cases: Array<{
    label: string
    supportStrength: EvidenceItem["supportStrength"]
    sourceName?: string
    evidenceInferenceBasis?: string
    bindingInferenceBasis?: string
    expectedAssessable: boolean
  }> = [
    {
      label: "direct",
      supportStrength: "direct",
      expectedAssessable: true,
    },
    {
      label: "inferred with both inference bases",
      supportStrength: "inferred",
      evidenceInferenceBasis: "由公告披露数据推导。",
      bindingInferenceBasis: "按指标口径完成推导。",
      expectedAssessable: true,
    },
    {
      label: "inferred without evidence basis",
      supportStrength: "inferred",
      bindingInferenceBasis: "按指标口径完成推导。",
      expectedAssessable: false,
    },
    {
      label: "inferred without binding basis",
      supportStrength: "inferred",
      evidenceInferenceBasis: "由公告披露数据推导。",
      expectedAssessable: false,
    },
    {
      label: "background",
      supportStrength: "background",
      expectedAssessable: false,
    },
    {
      label: "pending",
      supportStrength: "pending",
      expectedAssessable: false,
    },
    {
      label: "candidate source",
      supportStrength: "direct",
      sourceName: "Wind 财务数据",
      expectedAssessable: false,
    },
  ]

  for (const candidateCase of cases) {
    const detail = assessmentDetail(["tech"], [88])
    detail.evidence[0] = evidence(
      "e-tech",
      candidateCase.supportStrength,
      candidateCase.sourceName ?? "交易所公告",
      candidateCase.evidenceInferenceBasis,
      ["i-tech"]
    )
    detail.evidence[0].scoringLinks = []
    const candidate = observation(detail.id, "i-tech", "e-tech", 88)
    candidate.id = "observation-tech"
    const assessment = buildRiskAssessment(
      detail,
      [indicator("i-tech", "技术")],
      "test-v2",
      [candidate],
      normalizationRules("i-tech"),
      [
        runtimeBinding(candidate, "e-tech", {
          inferenceBasis: candidateCase.bindingInferenceBasis,
        }),
      ]
    )
    const technology = assessment.dimensions.find(
      (dimension) => dimension.id === "technology"
    )

    assert.ok(technology)
    assert.equal(
      technology.assessable,
      candidateCase.expectedAssessable,
      candidateCase.label
    )
  }
})

test("runtime evidence bindings must match observation identity and provenance", () => {
  const mismatchCases: Array<{
    label: string
    overrides: Partial<EvidenceScoringBinding>
  }> = [
    { label: "observation", overrides: { observationId: "observation-other" } },
    { label: "company", overrides: { companyId: "company-other" } },
    { label: "indicator", overrides: { indicatorId: "i-other" } },
    { label: "period", overrides: { period: "2026-Q1" } },
    { label: "unit", overrides: { unit: "%" } },
    { label: "evidence", overrides: { evidenceId: "e-other" } },
    { label: "locator", overrides: { locator: " " } },
  ]

  for (const mismatchCase of mismatchCases) {
    const detail = assessmentDetail(["tech"], [88])
    detail.evidence[0].scoringLinks = []
    const candidate = observation(detail.id, "i-tech", "e-tech", 88)
    candidate.id = "observation-tech"
    const assessment = buildRiskAssessment(
      detail,
      [indicator("i-tech", "技术")],
      "test-v2",
      [candidate],
      normalizationRules("i-tech"),
      [runtimeBinding(candidate, "e-tech", mismatchCase.overrides)]
    )
    const technology = assessment.dimensions.find(
      (dimension) => dimension.id === "technology"
    )

    assert.ok(technology)
    assert.equal(technology.assessable, false, mismatchCase.label)
  }
})

test("matching runtime bindings take precedence over legacy static links", () => {
  const detail = assessmentDetail(["tech"], [88])
  const candidate = observation(detail.id, "i-tech", "e-tech", 88)
  candidate.id = "observation-tech"
  const assessment = buildRiskAssessment(
    detail,
    [indicator("i-tech", "技术")],
    "test-v2",
    [candidate],
    normalizationRules("i-tech"),
    [
      runtimeBinding(candidate, "e-other", {
        id: "binding-other-evidence",
      }),
    ]
  )
  const technology = assessment.dimensions.find(
    (dimension) => dimension.id === "technology"
  )

  assert.ok(technology)
  assert.equal(technology.assessable, false)
  assert.equal(technology.score, null)
})

test("reviewed observations without scoring provenance cannot enter the assessment", () => {
  const detail = assessmentDetail(["tech"], [88])
  const incomplete = observation(detail.id, "i-tech", "e-tech", 88)
  incomplete.normalizationRuleVersion = ""

  const assessment = buildRiskAssessment(
    detail,
    [indicator("i-tech", "技术")],
    "test-v2",
    [incomplete],
    normalizationRules("i-tech")
  )
  const technology = assessment.dimensions.find(
    (dimension) => dimension.id === "technology"
  )

  assert.ok(technology)
  assert.equal(technology.assessable, false)
  assert.equal(technology.score, null)
})

test("persisted scores that disagree with the registered rule are rejected", () => {
  const detail = assessmentDetail(["tech"], [88])
  const inconsistent = observation(detail.id, "i-tech", "e-tech", 88)
  inconsistent.value = "72"

  const assessment = buildRiskAssessment(
    detail,
    [indicator("i-tech", "技术")],
    "test-v2",
    [inconsistent],
    normalizationRules("i-tech")
  )
  const technology = assessment.dimensions.find(
    (dimension) => dimension.id === "technology"
  )

  assert.ok(technology)
  assert.equal(technology.assessable, false)
  assert.equal(technology.score, null)
})

test("legacy static scoring links cannot replace runtime provenance", () => {
  const detail = assessmentDetail(["tech"], [88])
  const candidate = observation(detail.id, "i-tech", "e-tech", 88)
  detail.evidence[0].scoringLinks = [
    {
      indicatorId: candidate.indicatorId,
      period: candidate.period,
      unit: candidate.unit,
      locator: "第 12 页",
    },
  ]
  const assessment = buildRiskAssessment(
    detail,
    [indicator("i-tech", "技术")],
    "test-v2",
    [candidate],
    normalizationRules("i-tech"),
    []
  )
  const technology = assessment.dimensions.find(
    (dimension) => dimension.id === "technology"
  )

  assert.ok(technology)
  assert.equal(technology.assessable, false)
  assert.equal(technology.score, null)
})

test("the auxiliary index hides its number below four assessable dimensions", () => {
  const dimensionIds = ["tech", "data", "finance"]
  const detail = assessmentDetail(dimensionIds, [80, 70, 60])
  const indicators = [
    indicator("i-tech", "技术"),
    indicator("i-data", "合规"),
    indicator("i-finance", "财务与融资风险"),
  ]
  const observations = dimensionIds.map((id, index) =>
    observation(detail.id, `i-${id}`, `e-${id}`, [80, 70, 60][index])
  )
  const assessment = buildRiskAssessment(
    detail,
    indicators,
    "test-v2",
    observations,
    normalizationRules(...observations.map((item) => item.indicatorId))
  )

  assert.equal(assessment.assessableDimensionCount, 3)
  assert.equal(assessment.score, null)
  assert.equal(assessment.scoreLabel, "部分指标待补充")
  assert.equal(assessment.reviewStatus, "insufficient-evidence")
})

test("the auxiliary index applies the 0, 1-3, and 4+ dimension bands", () => {
  const dimensions = [
    { id: "narrative", primaryRisk: "叙事风险" },
    { id: "tech", primaryRisk: "技术" },
    { id: "data", primaryRisk: "合规" },
    { id: "finance", primaryRisk: "财务与融资风险" },
    { id: "external", primaryRisk: "外部风险" },
    { id: "personnel", primaryRisk: "人员风险" },
  ]

  for (const dimensionCount of [0, 1, 2, 3, 4, 5, 6]) {
    const selected = dimensions.slice(0, dimensionCount)
    const detail = assessmentDetail(
      selected.map((item) => item.id),
      selected.map(() => 60)
    )
    const indicators = selected.map((item) =>
      indicator(`i-${item.id}`, item.primaryRisk)
    )
    const observations = selected.map((item) =>
      observation(detail.id, `i-${item.id}`, `e-${item.id}`, 60)
    )
    const assessment = buildRiskAssessment(
      detail,
      indicators,
      "test-v2",
      observations,
      normalizationRules(...observations.map((item) => item.indicatorId))
    )

    assert.equal(
      assessment.assessableDimensionCount,
      dimensionCount,
      `${dimensionCount} dimensions`
    )
    assert.equal(
      assessment.score,
      dimensionCount >= 4 ? 60 : null,
      `${dimensionCount} dimensions`
    )
    assert.equal(
      assessment.scoreLabel,
      dimensionCount >= 4
        ? "60"
        : dimensionCount === 0
          ? "暂无可用指标"
          : "部分指标待补充",
      `${dimensionCount} dimensions`
    )
    assert.equal(
      assessment.reviewStatus,
      dimensionCount < 4
        ? "insufficient-evidence"
        : dimensionCount === 6
          ? "reviewed"
          : "manual-review",
      `${dimensionCount} dimensions`
    )
  }
})

test("unlinked evidence and indicators cannot make a dimension assessable", () => {
  const detail = assessmentDetail(["tech"], [88])
  detail.evidence[0].scoringLinks = [
    {
      indicatorId: "i-other",
      period: "2026-Q2",
      unit: "分",
      locator: "第 12 页",
    },
  ]
  const assessment = buildRiskAssessment(
    detail,
    [indicator("i-tech", "技术"), indicator("i-other", "合规")],
    "test-v2",
    [observation(detail.id, "i-tech", "e-tech", 88)],
    normalizationRules("i-tech"),
    []
  )
  const technology = assessment.dimensions.find(
    (dimension) => dimension.id === "technology"
  )

  assert.ok(technology)
  assert.equal(technology.assessable, false)
  assert.equal(technology.score, null)
  assert.equal(technology.evidenceIds.length, 0)
  assert.equal(technology.indicatorIds.length, 0)
  assert.equal(assessment.effectiveEvidenceCoverage, 0)
})

test("scoring coverage excludes background and pending evidence from its denominator", () => {
  const detail = assessmentDetail(["tech"], [88])
  detail.evidence.push(
    evidence("background", "background"),
    evidence("pending", "pending")
  )
  const assessment = buildRiskAssessment(
    detail,
    [indicator("i-tech", "技术")],
    "test-v2",
    [observation(detail.id, "i-tech", "e-tech", 88)],
    normalizationRules("i-tech")
  )

  assert.equal(assessment.effectiveEvidenceCoverage, 100)
})

test("legacy expert scores stay out of the assessment without observations", () => {
  const detail = assessmentDetail(["tech"], [88])
  const assessment = buildRiskAssessment(
    detail,
    [indicator("i-tech", "技术")],
    "test-v2"
  )
  const technology = assessment.dimensions.find(
    (dimension) => dimension.id === "technology"
  )

  assert.ok(technology)
  assert.equal(technology.score, null)
  assert.equal(technology.assessable, false)
  assert.equal(technology.summary, "当前公开快照缺少可计算的企业指标观测值。")
  assert.equal(assessment.score, null)
  assert.equal(assessment.scoreLabel, "暂无可用指标")
})

test("only governed public evidence can enter scoring coverage", () => {
  const direct = evidence("direct", "direct")
  const inferred = evidence(
    "inferred",
    "inferred",
    "企业技术论文",
    "由论文实验设置推导成熟度，仅作辅助判断。"
  )
  const inferredWithoutBasis = evidence("inferred-empty", "inferred")
  const background = evidence("background", "background")
  const pending = evidence("pending", "pending")
  const candidate = evidence("candidate", "direct", "Wind 市值数据")

  assert.equal(isEffectiveEvidence(direct), true)
  assert.equal(isEffectiveEvidence(inferred), true)
  assert.equal(isEffectiveEvidence(inferredWithoutBasis), false)
  assert.equal(isEffectiveEvidence(background), false)
  assert.equal(isEffectiveEvidence(pending), false)
  assert.equal(isEffectiveEvidence(candidate), false)

  const summary = summarizeEvidenceGovernance([
    direct,
    inferred,
    inferredWithoutBasis,
    background,
    pending,
    candidate,
  ])
  assert.equal(summary.effectiveEvidenceCount, 2)
  assert.equal(summary.effectiveUniqueUrlCount, 2)
  assert.equal(summary.formalPublicSourceCount, 2)
  assert.equal(summary.candidateSourceCount, 1)
  assert.equal(summary.coverage, 33)
})
