import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { dirname, join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import {
  buildRiskAssessment,
  calculateResponseRate,
  createNormalizationRuleKey,
} from "../src/lib/risk-metrics.ts"
import { isCandidateDataSource } from "../src/lib/source-governance.ts"
import type {
  CompanyDetail,
  EvidenceScoringBinding,
  IndicatorObservation,
  RiskIndicator,
} from "../src/types/risk.ts"

type JsonRecord = Record<string, unknown>
type AdmissionStatus = "validated" | "observation" | "candidate"
type WeightedRiskIndicator = RiskIndicator & { weight?: number }

const testDirectory = dirname(fileURLToPath(import.meta.url))
const projectRoot = join(testDirectory, "..")
const dataDirectory = join(projectRoot, "src", "data")
const companyDirectory = join(dataDirectory, "company")

function readJson<T>(path: string) {
  return JSON.parse(readFileSync(path, "utf8")) as T
}

function collectStringArrayValues(
  value: unknown,
  propertyName: string,
  collected: string[] = []
) {
  if (Array.isArray(value)) {
    value.forEach((item) =>
      collectStringArrayValues(item, propertyName, collected)
    )
    return collected
  }

  if (!value || typeof value !== "object") {
    return collected
  }

  Object.entries(value as JsonRecord).forEach(([key, item]) => {
    if (
      key === propertyName &&
      Array.isArray(item) &&
      item.every((entry) => typeof entry === "string")
    ) {
      collected.push(...item)
      return
    }

    collectStringArrayValues(item, propertyName, collected)
  })

  return collected
}

const summaries = readJson<
  Array<{
    id: string
    name: string
    benchmarkCompanyId: string
    responseRate: number
  }>
>(join(dataDirectory, "companies.json"))

const companyDetails = readdirSync(companyDirectory)
  .filter((fileName) => fileName.endsWith(".json"))
  .map((fileName) => readJson<CompanyDetail>(join(companyDirectory, fileName)))

const indicators = readJson<WeightedRiskIndicator[]>(
  join(dataDirectory, "risk-indicators.json")
)

const taxonomy = readJson<{
  methodVersion: string
  admissionGovernance: {
    decisionVersion: string
    decisionDate: string
    reviewerRole: string
    basis: string
  }
  primaryCount: number
  secondaryCount: number
  tertiaryCount: number
  admissionCounts: Record<AdmissionStatus, number>
  note: string
  groups: Array<{
    primary: string
    secondaryCount: number
    tertiaryCount: number
    secondaryLabels: string[]
  }>
}>(join(dataDirectory, "indicator-taxonomy.json"))

const indicatorObservations = readJson<IndicatorObservation[]>(
  join(dataDirectory, "indicator-observations.json")
)

const legacyMappings = readJson<
  Array<{
    legacyId: string
    indicatorId: string | null
    status: "mapped" | "removed"
    reason: string
  }>
>(join(dataDirectory, "legacy-indicator-map.json"))

const evidenceGovernance = readJson<
  Array<{
    id: string
    supportStrength: "direct" | "inferred" | "background" | "pending"
    supportRationale: string
    inferenceBasis?: string
  }>
>(join(dataDirectory, "evidence-governance.json"))

type RealtimeTestSignal = {
  id: string
  scope: "company" | "industry"
  companyIds: string[]
  category: "企业披露" | "监管政策" | "技术论文/专利" | "供应链" | "资本市场"
  severity: "high" | "medium" | "watch"
  title: string
  summary: string
  keyFacts?: string[]
  historicalContext?: string
  aiInsight: string
  potentialImpact: string
  recommendedAction: string
  researchQuestions?: string[]
  riskDimensionIds: string[]
  indicatorIds: string[]
  eventIds: string[]
  heatScore: number
  sourceCount: number
  publishedAt: string
  capturedAt: string
  sourceName: string
  sourceUrl: string
  sourceLocator?: string
  sourceReliability: "official" | "exchange" | "filing" | "paper" | "media"
  verificationStatus: "pending" | "monitoring" | "verified"
}

const realtimeBase = readJson<{
  snapshotAt: string
  note: string
  signals: RealtimeTestSignal[]
  dailyBrief: {
    date: string
    capturedAt: string
    summary: string
    prioritySignalIds: string[]
    highImpactCompanyIds: string[]
    pendingVerificationCount: number
  }
}>(join(dataDirectory, "realtime-signals.json"))

const realtimeSupplement = readJson<RealtimeTestSignal[]>(
  join(dataDirectory, "realtime-signals-supplement.json")
)

const combinedRealtimeSignals = [...realtimeBase.signals, ...realtimeSupplement]
  .map((signal) => ({
    ...signal,
    capturedAt: realtimeBase.snapshotAt,
  }))
  .sort((left, right) => right.publishedAt.localeCompare(left.publishedAt))

const realtime = {
  ...realtimeBase,
  dailyBrief: {
    ...realtimeBase.dailyBrief,
    capturedAt: realtimeBase.snapshotAt,
    pendingVerificationCount: combinedRealtimeSignals.filter(
      (signal) => signal.verificationStatus === "pending"
    ).length,
  },
  signals: combinedRealtimeSignals,
}

const intelligence = readJson<
  Array<{
    companyId: string
    profileFacts: unknown[]
    technologyAssets: unknown[]
    patentWatch: unknown[]
    policyFunding: unknown[]
  }>
>(join(dataDirectory, "company-intelligence.json"))

const researchHighlights = readJson<
  Array<{
    companyId: string
    highlights: Array<{
      id: string
      type: "新闻动态" | "论文研究" | "专利披露" | "软件著作权"
      title: string
      value: string
      asOf: string
      methodology: string
      summary: string
      sourceStatus: "located" | "limited" | "pending"
      scoringEligible: false
      source: {
        sourceName: string
        sourceUrl: string
        publishedAt: string | null
        publicationNote?: string
        capturedAt: string
        locator: string
      }
    }>
  }>
>(join(dataDirectory, "company-research-highlights.json"))

const summaryIds = new Set(summaries.map((company) => company.id))
const detailIds = new Set(companyDetails.map((company) => company.id))
const indicatorIds = new Set(indicators.map((indicator) => indicator.id))
const eventIds = new Set(
  companyDetails.flatMap((company) => company.events.map((event) => event.id))
)
const signalIds = new Set(realtime.signals.map((signal) => signal.id))
const mappingByLegacyId = new Map(
  legacyMappings.map((mapping) => [mapping.legacyId, mapping])
)

function migrateIndicatorIds(ids: string[] = []) {
  return [
    ...new Set(
      ids.flatMap((id) => {
        if (indicatorIds.has(id)) {
          return [id]
        }
        const mapping = mappingByLegacyId.get(id)
        return mapping?.status === "mapped" && mapping.indicatorId
          ? [mapping.indicatorId]
          : []
      })
    ),
  ]
}

test("company summaries, details, names, and benchmarks stay aligned", () => {
  assert.deepEqual([...summaryIds].sort(), [...detailIds].sort())

  summaries.forEach((summary) => {
    const detail = companyDetails.find((company) => company.id === summary.id)
    assert.ok(detail, `missing detail data for ${summary.id}`)
    assert.equal(detail.name, summary.name)
    assert.ok(
      summaryIds.has(summary.benchmarkCompanyId),
      `unknown summary benchmark ${summary.benchmarkCompanyId}`
    )
    assert.equal(detail.benchmarkCompanyId, summary.benchmarkCompanyId)
  })
})

test("response-rate helper derives completion from done events only", () => {
  summaries.forEach((summary) => {
    const detail = companyDetails.find((company) => company.id === summary.id)
    assert.ok(detail)

    const calculatedRate = calculateResponseRate(detail.events)
    const completedCount = detail.events.filter(
      (event) => event.status === "done"
    ).length
    const expectedRate =
      detail.events.length === 0
        ? 0
        : Math.round((completedCount / detail.events.length) * 100)

    assert.equal(
      calculatedRate,
      expectedRate,
      `${summary.id} response rate must use completed events over total events`
    )
  })
})

test("IP licensing events and governance actions stay classified as compliance", () => {
  const expectedComplianceRecords = {
    cambricon: {
      events: ["cb-ev3"],
      governance: ["cb-g3"],
    },
    deepseek: {
      events: ["ds-ev4"],
      governance: [],
    },
    horizon: {
      events: ["hz-ev3"],
      governance: ["hz-g4"],
    },
    unitree: {
      events: [],
      governance: ["ut-g4"],
    },
  }

  Object.entries(expectedComplianceRecords).forEach(
    ([companyId, expectedRecords]) => {
      const detail = companyDetails.find((company) => company.id === companyId)
      assert.ok(detail, `missing company detail for ${companyId}`)

      expectedRecords.events.forEach((eventId) => {
        const event = detail.events.find((item) => item.id === eventId)
        assert.equal(
          event?.riskType,
          "知识产权许可合规",
          `${eventId} must remain a compliance event`
        )
      })

      expectedRecords.governance.forEach((governanceId) => {
        const governance = detail.governance.find(
          (item) => item.id === governanceId
        )
        assert.equal(
          governance?.riskType,
          "知识产权许可合规",
          `${governanceId} must remain a compliance action`
        )
      })
    }
  )
})

test("empty indicator observations keep all six assessment scores null", () => {
  assert.equal(companyDetails.length, 6)
  assert.equal(indicatorObservations.length, 0)

  companyDetails.forEach((detail) => {
    const assessment = buildRiskAssessment(
      detail,
      indicators,
      taxonomy.methodVersion,
      indicatorObservations.filter(
        (observation) => observation.companyId === detail.id
      )
    )

    assert.equal(
      assessment.score,
      null,
      `${detail.id} must not fall back to a legacy score`
    )
    assert.equal(
      assessment.scoreLabel,
      "暂无可用指标",
      `${detail.id} must expose the pending-observation label`
    )
  })
})

test("indicator observations reference known companies, indicators, and company evidence", () => {
  const evidenceIdsByCompany = new Map(
    companyDetails.map((company) => [
      company.id,
      new Set(company.evidence.map((evidence) => evidence.id)),
    ])
  )

  indicatorObservations.forEach((observation) => {
    assert.ok(
      summaryIds.has(observation.companyId),
      `unknown observation company ${observation.companyId}`
    )
    assert.ok(
      indicatorIds.has(observation.indicatorId),
      `unknown observation indicator ${observation.indicatorId}`
    )

    const companyEvidenceIds = evidenceIdsByCompany.get(observation.companyId)
    assert.ok(companyEvidenceIds)
    observation.evidenceIds.forEach((evidenceId) => {
      assert.ok(
        companyEvidenceIds.has(evidenceId),
        `${observation.companyId}/${observation.indicatorId} references unknown evidence ${evidenceId}`
      )
    })
  })
})

test("scoring requires reviewed available validated observations with in-range scores and same-indicator effective evidence", () => {
  const baseCompany = companyDetails[0]
  const baseEvidence = baseCompany.evidence[0]
  const baseIndicator = indicators.find(
    (indicator) => indicator.admissionStatus === "validated"
  )
  assert.ok(baseIndicator)

  const validatedIndicator = {
    ...baseIndicator,
    id: "test-validated-indicator",
    primaryRisk: "技术",
    admissionStatus: "validated" as const,
  }
  const observationIndicator = {
    ...validatedIndicator,
    id: "test-observation-indicator",
    admissionStatus: "observation" as const,
  }
  const scoringEvidence = (
    id: string,
    indicatorIds: string[],
    supportStrength: "direct" | "background" = "direct"
  ) => ({
    ...baseEvidence,
    id,
    sourceName: "交易所公告",
    sourceUrl: `https://example.com/${id}`,
    indicatorIds,
    supportStrength,
    supportRationale: "test scoring eligibility",
    scoringLinks: indicatorIds.map((indicatorId) => ({
      indicatorId,
      period: "2026-Q2",
      unit: "分",
      locator: `${id} 第 8 页`,
    })),
  })
  const detail: CompanyDetail = {
    ...baseCompany,
    id: "test-scoring-company",
    dimensions: [
      {
        id: "tech",
        label: "技术风险",
        score: 88,
        level: "high",
        weight: "test",
        summary: "legacy reference only",
        evidenceIds: ["effective-same-indicator"],
        indicatorIds: [validatedIndicator.id],
      },
    ],
    evidence: [
      scoringEvidence("effective-same-indicator", [validatedIndicator.id]),
      scoringEvidence("effective-other-indicator", ["other-indicator"]),
      scoringEvidence(
        "ineffective-same-indicator",
        [validatedIndicator.id],
        "background"
      ),
      scoringEvidence("effective-observation-indicator", [
        observationIndicator.id,
      ]),
    ],
  }
  const observation = (
    overrides: Partial<IndicatorObservation> = {}
  ): IndicatorObservation => ({
    companyId: detail.id,
    indicatorId: validatedIndicator.id,
    status: "available",
    value: "72",
    unit: "分",
    normalizedScore: 72,
    normalizationRuleVersion: "test-rule-v1",
    reviewStatus: "reviewed",
    reviewedBy: "test-reviewer",
    reviewedAt: "2026-07-17T10:00:00+08:00",
    period: "2026-Q2",
    evidenceIds: ["effective-same-indicator"],
    note: "test",
    ...overrides,
  })
  const normalizationRules = {
    [createNormalizationRuleKey(validatedIndicator.id, "test-rule-v1")]: (
      candidate: IndicatorObservation
    ) => Number(candidate.value),
  }
  const scoringBindings: EvidenceScoringBinding[] = [
    {
      id: "test-scoring-binding",
      observationId: "test-observation",
      companyId: detail.id,
      indicatorId: validatedIndicator.id,
      evidenceId: "effective-same-indicator",
      period: "2026-Q2",
      unit: "分",
      locator: "test scoring evidence 第 8 页",
      createdAt: "2026-07-17T10:00:00+08:00",
      updatedAt: "2026-07-17T10:00:00+08:00",
    },
  ]
  const technologyDimension = (candidate: IndicatorObservation) => {
    const assessment = buildRiskAssessment(
      detail,
      [validatedIndicator, observationIndicator],
      "test-method",
      [candidate],
      normalizationRules,
      scoringBindings
    )
    const dimension = assessment.dimensions.find(
      (item) => item.id === "technology"
    )
    assert.ok(dimension)
    return dimension
  }

  ;[
    { label: "lower boundary", normalizedScore: 0 },
    { label: "eligible observation", normalizedScore: 72 },
    { label: "upper boundary", normalizedScore: 100 },
  ].forEach(({ label, normalizedScore }) => {
    const dimension = technologyDimension(
      observation({
        value: String(normalizedScore),
        normalizedScore,
        evidenceIds: [
          "effective-other-indicator",
          "ineffective-same-indicator",
          "effective-same-indicator",
        ],
      })
    )

    assert.equal(dimension.score, normalizedScore, label)
    assert.equal(dimension.assessable, true, label)
    assert.deepEqual(dimension.evidenceIds, ["effective-same-indicator"], label)
  })

  const rejectedCases: Array<{
    label: string
    overrides: Partial<IndicatorObservation>
  }> = [
    { label: "pending review", overrides: { reviewStatus: "pending" } },
    { label: "partial observation", overrides: { status: "partial" } },
    { label: "unavailable observation", overrides: { status: "unavailable" } },
    {
      label: "non-validated indicator",
      overrides: {
        indicatorId: observationIndicator.id,
        evidenceIds: ["effective-observation-indicator"],
      },
    },
    {
      label: "different-indicator evidence",
      overrides: { evidenceIds: ["effective-other-indicator"] },
    },
    {
      label: "ineffective evidence",
      overrides: { evidenceIds: ["ineffective-same-indicator"] },
    },
    { label: "score below range", overrides: { normalizedScore: -1 } },
    { label: "score above range", overrides: { normalizedScore: 101 } },
    {
      label: "persisted score disagrees with rule",
      overrides: { value: "70", normalizedScore: 72 },
    },
    {
      label: "different company",
      overrides: { companyId: "other-company" },
    },
  ]

  rejectedCases.forEach(({ label, overrides }) => {
    const dimension = technologyDimension(observation(overrides))
    assert.equal(dimension.score, null, label)
    assert.equal(dimension.assessable, false, label)
    assert.deepEqual(dimension.evidenceIds, [], label)
  })
})

test("the governed taxonomy contains 6 primary groups, 17 secondary groups, and 43 named tertiary indicators", () => {
  assert.equal(taxonomy.primaryCount, 6)
  assert.equal(taxonomy.secondaryCount, 17)
  assert.equal(taxonomy.tertiaryCount, 43)
  assert.match(taxonomy.note, /43 项具名三级指标/)
  assert.match(taxonomy.note, /空白、重复、错列或未定稿内容不进入正式指标清单/)
  assert.match(taxonomy.admissionGovernance.decisionVersion, /^ADM-/)
  assert.match(taxonomy.admissionGovernance.decisionDate, /^\d{4}-\d{2}-\d{2}$/)
  assert.ok(taxonomy.admissionGovernance.reviewerRole.trim())
  assert.match(taxonomy.admissionGovernance.basis, /不是 Excel 原生字段/)
  assert.equal(taxonomy.groups.length, taxonomy.primaryCount)
  assert.equal(
    taxonomy.groups.reduce((total, group) => total + group.secondaryCount, 0),
    taxonomy.secondaryCount
  )
  assert.equal(
    taxonomy.groups.reduce((total, group) => total + group.tertiaryCount, 0),
    taxonomy.tertiaryCount
  )
  assert.equal(indicators.length, taxonomy.tertiaryCount)
  assert.equal(
    new Set(indicators.map((indicator) => indicator.id)).size,
    indicators.length
  )

  taxonomy.groups.forEach((group) => {
    assert.equal(new Set(group.secondaryLabels).size, group.secondaryCount)
  })
})

test("indicator admission counts are complete and formal indicators are usable", () => {
  const statuses: AdmissionStatus[] = ["validated", "observation", "candidate"]

  assert.deepEqual(taxonomy.admissionCounts, {
    validated: 18,
    observation: 19,
    candidate: 6,
  })

  statuses.forEach((status) => {
    assert.equal(
      indicators.filter((indicator) => indicator.admissionStatus === status)
        .length,
      taxonomy.admissionCounts[status]
    )
  })
  assert.equal(
    statuses.reduce(
      (total, status) => total + taxonomy.admissionCounts[status],
      0
    ),
    43
  )
  assert.ok(indicators.every((indicator) => indicator.tertiaryRisk.trim()))

  indicators
    .filter((indicator) => indicator.admissionStatus === "validated")
    .forEach((indicator) => {
      assert.ok(indicator.definition.trim(), `${indicator.id} lacks definition`)
      assert.ok(indicator.threshold.trim(), `${indicator.id} lacks threshold`)
      assert.ok(indicator.dataSource.trim(), `${indicator.id} lacks source`)
      assert.equal(
        isCandidateDataSource(indicator.dataSource),
        false,
        `${indicator.id} depends on an unauthorized candidate source`
      )
      assert.doesNotMatch(
        `${indicator.definition} ${indicator.threshold}`,
        /建议换成|若不好统计|尚未定稿|两套口径/
      )
    })
})

test("the technology catalog contains eight validated weighted indicators for KTR-2026.07-v1", () => {
  const expectedTechnologyIndicators = [
    ["kci-006", "技术先进性", "核心技术性能行业分位", 10],
    ["kci-007", "技术先进性", "核心论文质量与技术转化关联", 8],
    ["kci-008", "技术先进性", "核心专利质量与技术壁垒", 9],
    ["kci-009", "技术先进性", "持续创新能力", 8],
    ["kci-010", "技术成熟度", "技术成熟与阶段兑现度（TRL 等级）", 20],
    ["kci-011", "技术成熟度", "工程化与商业转化率", 15],
    ["kci-012", "技术可靠和安全性", "独立验证与关键测试有效性", 18],
    [
      "kci-013",
      "技术可靠和安全性",
      "关键技术自主可控度（关键技术外部依赖度）",
      12,
    ],
  ] as const
  const technologyIndicators = indicators.filter(
    (indicator) => indicator.primaryRisk === "技术"
  )

  assert.deepEqual(
    technologyIndicators.map((indicator) => [
      indicator.id,
      indicator.secondaryRisk,
      indicator.tertiaryRisk,
      indicator.weight,
    ]),
    expectedTechnologyIndicators
  )
  assert.equal(
    technologyIndicators.reduce(
      (total, indicator) => total + (indicator.weight ?? 0),
      0
    ),
    100
  )
  assert.ok(
    technologyIndicators.every(
      (indicator) =>
        indicator.admissionStatus === "validated" &&
        indicator.admissionNote.includes("KTR-2026.07-v1")
    )
  )
})

test("indicators with unresolved comparability, disclosure, or source limits are forcibly downgraded", () => {
  const requiredAdmissions: Record<
    string,
    { status: AdmissionStatus; notePattern: RegExp }
  > = {
    "kci-016": {
      status: "observation",
      notePattern: /未披露不等同于企业缺少制度.*不参与得分/,
    },
    "kci-018": {
      status: "observation",
      notePattern: /未披露安全委员会不等同于企业未设立.*不参与得分/,
    },
    "kci-019": {
      status: "observation",
      notePattern: /未披露数据安全负责人不等同于企业未任命.*不参与得分/,
    },
    "kci-022": {
      status: "candidate",
      notePattern: /只能核验已披露正例.*不能据此证明零仲裁.*方法库/,
    },
    "kci-027": {
      status: "observation",
      notePattern: /分母可能为零.*风险方向反转.*不参与得分/,
    },
    "kci-034": {
      status: "observation",
      notePattern: /国产化率.*进口依赖度.*相反风险方向.*不参与得分/,
    },
    "kci-037": {
      status: "observation",
      notePattern: /0%.*低风险.*中风险.*20%.*无区间归属.*不参与得分/,
    },
    "kci-043": {
      status: "candidate",
      notePattern: /第 45 行字段错列.*未经复核.*方法库/,
    },
  }

  Object.entries(requiredAdmissions).forEach(
    ([indicatorId, { status, notePattern }]) => {
      const indicator = indicators.find((item) => item.id === indicatorId)
      assert.ok(indicator, `missing governed indicator ${indicatorId}`)
      assert.equal(indicator.admissionStatus, status)
      assert.match(indicator.admissionNote, notePattern)
    }
  )

  const misalignedIndicator = indicators.find(
    (indicator) => indicator.id === "kci-043"
  )
  assert.ok(misalignedIndicator)
  assert.match(misalignedIndicator.tertiaryRisk, /待复核.*第 45 行错列/)
})

test("every legacy indicator is mapped to the new catalog or explicitly removed", () => {
  assert.equal(legacyMappings.length, 56)
  assert.equal(
    new Set(legacyMappings.map((mapping) => mapping.legacyId)).size,
    legacyMappings.length
  )

  legacyMappings.forEach((mapping) => {
    assert.ok(
      mapping.reason.trim(),
      `${mapping.legacyId} lacks an audit reason`
    )
    if (mapping.status === "mapped") {
      assert.ok(mapping.indicatorId)
      assert.ok(
        indicatorIds.has(mapping.indicatorId),
        `${mapping.legacyId} maps to unknown ${mapping.indicatorId}`
      )
    } else {
      assert.equal(mapping.indicatorId, null)
    }
  })

  assert.equal(mappingByLegacyId.get("ri-016")?.indicatorId, "kci-010")
  assert.equal(mappingByLegacyId.get("ri-019")?.indicatorId, "kci-009")
  assert.equal(mappingByLegacyId.get("ri-066")?.indicatorId, "kci-011")
})

test("all 42 evidence records have a complete governance decision", () => {
  const allEvidenceIds = companyDetails.flatMap((company) =>
    company.evidence.map((evidence) => evidence.id)
  )
  const governanceIds = new Set(evidenceGovernance.map((record) => record.id))

  assert.equal(allEvidenceIds.length, 42)
  assert.equal(evidenceGovernance.length, 42)
  assert.equal(governanceIds.size, 42)
  allEvidenceIds.forEach((evidenceId) => {
    assert.ok(
      governanceIds.has(evidenceId),
      `missing governance for ${evidenceId}`
    )
  })
  evidenceGovernance.forEach((record) => {
    assert.ok(
      allEvidenceIds.includes(record.id),
      `orphan governance ${record.id}`
    )
    assert.ok(record.supportRationale.trim())
    if (record.supportStrength === "inferred") {
      assert.ok(record.inferenceBasis?.trim())
    }
  })

  const governanceById = new Map(
    evidenceGovernance.map((record) => [record.id, record])
  )
  ;["cb-e1", "fp-e2", "fp-e7", "hz-e1", "hz-e6", "rs-e2"].forEach(
    (evidenceId) => {
      assert.equal(
        governanceById.get(evidenceId)?.supportStrength,
        "background",
        `${evidenceId} is a directory or landing page and cannot be direct evidence`
      )
    }
  )
})

test("company, intelligence, event, and signal references resolve after migration", () => {
  companyDetails.forEach((company) => {
    const evidenceIds = new Set(company.evidence.map((evidence) => evidence.id))

    collectStringArrayValues(company, "evidenceIds").forEach((evidenceId) => {
      assert.ok(
        evidenceIds.has(evidenceId),
        `${company.id} references unknown evidence ${evidenceId}`
      )
    })

    collectStringArrayValues(company, "indicatorIds").forEach((indicatorId) => {
      const migrated = migrateIndicatorIds([indicatorId])
      const mapping = mappingByLegacyId.get(indicatorId)
      assert.ok(
        migrated.every((id) => indicatorIds.has(id)),
        `${company.id} cannot migrate indicator ${indicatorId}`
      )
      assert.ok(
        migrated.length > 0 || mapping?.status === "removed",
        `${company.id} has unaudited indicator ${indicatorId}`
      )
    })

    company.disclosureMetrics?.forEach((metric) => {
      assert.ok(
        evidenceIds.has(metric.sourceId),
        `${company.id} disclosure references unknown source ${metric.sourceId}`
      )
    })
  })

  intelligence.forEach((record) => {
    const company = companyDetails.find(
      (detail) => detail.id === record.companyId
    )
    assert.ok(company, `unknown intelligence company ${record.companyId}`)
    const evidenceIds = new Set(company.evidence.map((evidence) => evidence.id))

    collectStringArrayValues(record, "evidenceIds").forEach((evidenceId) => {
      assert.ok(
        evidenceIds.has(evidenceId),
        `${record.companyId} intelligence references unknown evidence ${evidenceId}`
      )
    })
  })

  realtime.signals.forEach((signal) => {
    assert.match(signal.sourceUrl, /^https?:\/\//)
    assert.equal(
      signal.sourceCount,
      1,
      `${signal.id} exposes one accessible source URL and must not overstate its source count`
    )
    signal.companyIds.forEach((companyId) => {
      assert.ok(summaryIds.has(companyId), `${signal.id} has unknown company`)
    })
    signal.indicatorIds.forEach((indicatorId) => {
      const migrated = migrateIndicatorIds([indicatorId])
      const mapping = mappingByLegacyId.get(indicatorId)
      assert.ok(migrated.every((id) => indicatorIds.has(id)))
      assert.ok(
        migrated.length > 0 || mapping?.status === "removed",
        `${signal.id} has unaudited indicator ${indicatorId}`
      )
    })
    signal.eventIds.forEach((eventId) => {
      assert.ok(
        eventIds.has(eventId),
        `${signal.id} has unknown event ${eventId}`
      )
    })
  })
})

test("every company has four source-bounded research and IP highlights", () => {
  assert.equal(researchHighlights.length, 6)
  assert.deepEqual(
    researchHighlights.map((record) => record.companyId).sort(),
    [...summaryIds].sort()
  )

  const highlights = researchHighlights.flatMap((record) => {
    assert.equal(
      record.highlights.length,
      4,
      `${record.companyId} must expose exactly four research highlights`
    )
    assert.deepEqual(
      record.highlights.map((highlight) => highlight.type).sort(),
      ["专利披露", "新闻动态", "论文研究", "软件著作权"].sort(),
      `${record.companyId} must cover news, research, patents, and software copyrights`
    )
    return record.highlights
  })

  assert.equal(highlights.length, 24)
  assert.equal(
    new Set(highlights.map((highlight) => highlight.id)).size,
    highlights.length
  )
  assert.equal(
    new Set(highlights.map((highlight) => highlight.source.locator)).size,
    highlights.length,
    "research source locators must be record-specific"
  )

  highlights.forEach((highlight) => {
    ;[
      highlight.id,
      highlight.type,
      highlight.title,
      highlight.value,
      highlight.asOf,
      highlight.methodology,
      highlight.summary,
      highlight.source.sourceName,
      highlight.source.capturedAt,
      highlight.source.locator,
    ].forEach((value) =>
      assert.ok(value.trim(), `${highlight.id} is incomplete`)
    )
    assert.match(highlight.source.sourceUrl, /^https?:\/\//)
    assert.notEqual(
      highlight.source.locator,
      "来源页面或文件正文；具体披露口径见本卡片说明",
      `${highlight.id} must not use the legacy placeholder locator`
    )
    assert.ok(
      ["located", "limited", "pending"].includes(highlight.sourceStatus)
    )
    assert.equal(highlight.scoringEligible, false)
    assert.equal(Object.hasOwn(highlight, "verificationStatus"), false)

    if (highlight.source.publishedAt) {
      assert.match(
        highlight.source.publishedAt,
        /^\d{4}(?:-\d{2}(?:-\d{2})?)?$/,
        `${highlight.id} must use a machine-readable publication date`
      )
    } else {
      assert.ok(
        highlight.source.publicationNote?.trim(),
        `${highlight.id} must explain a missing publication date`
      )
    }

    if (/暂无|未披露|未单列/.test(highlight.value)) {
      assert.match(
        `${highlight.methodology} ${highlight.summary}`,
        /不|需|未|后续/,
        `${highlight.id} must explain the missing or limited total`
      )
    }

    if (
      highlight.type === "软件著作权" &&
      /100\+ 项著作权/.test(highlight.value)
    ) {
      assert.match(
        `${highlight.title} ${highlight.methodology}`,
        /未拆分|不能全部标记为软件著作权/
      )
    }
  })

  const unitreePaper = highlights.find(
    (highlight) => highlight.id === "ut-research-h1-paper"
  )
  assert.equal(
    unitreePaper?.source.sourceUrl,
    "https://arxiv.org/abs/2406.10759"
  )
  assert.match(unitreePaper?.methodology ?? "", /H1，不是 G1/)
  assert.equal(
    highlights.find((highlight) => highlight.id === "ut-research-patent")
      ?.value,
    "专利权 262 项 · 境内 169 · 境外 93"
  )
  assert.equal(
    highlights.find((highlight) => highlight.id === "ut-research-software")
      ?.value,
    "软件著作权 8 项"
  )
  assert.equal(
    highlights.find((highlight) => highlight.id === "ut-research-delivery")
      ?.source.sourceUrl,
    "https://shop.unitree.com/blogs/news/clarification-regarding-unitrees-2025-sales-data"
  )
  assert.equal(
    highlights.find((highlight) => highlight.id === "hz-research-patent")
      ?.value,
    "授权专利 673 项 · 其中 585 项与发明相关"
  )
  assert.match(
    highlights.find((highlight) => highlight.id === "hz-research-patent")
      ?.methodology ?? "",
    /不将 585 项改写为发明专利授权量/
  )
  assert.equal(
    highlights.find((highlight) => highlight.id === "hz-research-patent")?.asOf,
    "2024-06-30"
  )
  assert.equal(
    highlights.find((highlight) => highlight.id === "hz-research-copyright")
      ?.value,
    "100+ 项著作权 · 含软件与设计著作权"
  )
  assert.equal(
    highlights.find((highlight) => highlight.id === "ds-research-software")
      ?.source.sourceUrl,
    "https://www.ccopyright.com.cn/"
  )
  const cambriconFilingHighlights = highlights.filter((highlight) =>
    [
      "cb-research-results",
      "cb-research-patent",
      "cb-research-software",
    ].includes(highlight.id)
  )
  assert.equal(cambriconFilingHighlights.length, 3)
  assert.ok(
    cambriconFilingHighlights.every(
      (highlight) =>
        highlight.source.sourceUrl ===
        "https://static.sse.com.cn/disclosure/listedinfo/announcement/c/new/2026-03-13/688256_20260313_GWH3.pdf"
    )
  )
  assert.equal(
    highlights.find((highlight) => highlight.id === "fp-research-patent")
      ?.value,
    "610 项 · 发明 388 · 实用新型 32 · 外观 190"
  )
  assert.equal(
    highlights.find((highlight) => highlight.id === "fp-research-software")
      ?.value,
    "软件著作权 215 项"
  )
  assert.equal(
    highlights.find((highlight) => highlight.id === "fp-research-papers")
      ?.value,
    "暂无可核验统一总量"
  )
  assert.equal(
    highlights.find((highlight) => highlight.id === "fp-research-papers")
      ?.sourceStatus,
    "limited"
  )
  assert.equal(
    highlights.find((highlight) => highlight.id === "rs-research-report")
      ?.value,
    "合计约 719,200 台 · ADAS 约 436,600 · 机器人及其他约 282,600"
  )
  assert.match(
    highlights.find((highlight) => highlight.id === "rs-research-report")
      ?.summary ?? "",
    /第二季度销量约 388,900 台.*ADAS 约 291,800 台.*机器人及其他约 97,100 台/
  )
  assert.equal(
    highlights.find((highlight) => highlight.id === "rs-research-report")
      ?.source.sourceUrl,
    "https://www1.hkexnews.hk/listedco/listconews/sehk/2026/0709/2026070900031.pdf"
  )
  assert.equal(
    highlights.find((highlight) => highlight.id === "rs-research-publications")
      ?.value,
    "外部研究覆盖 4 款激光扫描设备"
  )
  assert.equal(
    highlights.find((highlight) => highlight.id === "rs-research-publications")
      ?.source.sourceUrl,
    "https://doi.org/10.5194/isprs-archives-XLVIII-1-W6-2025-219-2025"
  )
  assert.match(
    highlights.find((highlight) => highlight.id === "rs-research-publications")
      ?.methodology ?? "",
    /四款设备第三方对比研究/
  )
  assert.equal(
    highlights.find((highlight) => highlight.id === "rs-research-patent")
      ?.value,
    "累计授权 759 项 · 2025 年新增 176 项"
  )
  assert.ok(
    highlights.every(
      (highlight) =>
        !/1,?400\+.*专利|400\+.*论文/.test(
          `${highlight.title} ${highlight.value}`
        )
    )
  )
})

test("risk brief references and pending count stay aligned", () => {
  realtime.dailyBrief.prioritySignalIds.forEach((signalId) => {
    assert.ok(signalIds.has(signalId), `daily brief has unknown ${signalId}`)
  })
  realtime.dailyBrief.highImpactCompanyIds.forEach((companyId) => {
    assert.ok(summaryIds.has(companyId), `daily brief has unknown ${companyId}`)
  })
  assert.equal(
    realtime.dailyBrief.pendingVerificationCount,
    realtime.signals.filter((signal) => signal.verificationStatus === "pending")
      .length
  )
})

test("realtime intelligence covers every company with current and historical primary-source records", () => {
  const canonicalRiskDimensionIds = new Set([
    "narrative",
    "technology",
    "compliance",
    "finance",
    "external",
    "personnel",
  ])
  const snapshotTime = Date.parse(realtime.snapshotAt)

  assert.ok(
    Number.isFinite(snapshotTime),
    "realtime snapshot must be parseable"
  )
  assert.equal(realtime.dailyBrief.date, realtime.snapshotAt.slice(0, 10))
  assert.equal(realtime.dailyBrief.capturedAt, realtime.snapshotAt)
  assert.ok(realtime.signals.length >= 54)
  assert.equal(
    new Set(realtime.signals.map((signal) => signal.id)).size,
    realtime.signals.length
  )
  assert.match(realtime.note, /当前及历史信息/)
  assert.match(realtime.note, /论文与专利研究/)

  const publicationDates = realtime.signals.map((signal) => signal.publishedAt)
  assert.deepEqual(
    publicationDates,
    [...publicationDates].sort((left, right) => right.localeCompare(left)),
    "realtime records must stay in descending publication order"
  )

  summaryIds.forEach((companyId) => {
    const companySignals = realtime.signals.filter(
      (signal) =>
        signal.scope === "company" && signal.companyIds.includes(companyId)
    )
    assert.ok(
      companySignals.length >= 8,
      `${companyId} must expose at least eight realtime records`
    )
    assert.ok(
      companySignals.some((signal) => signal.publishedAt.startsWith("2026-")),
      `${companyId} must include a 2026 current record`
    )
    assert.ok(
      companySignals.some((signal) => signal.publishedAt < "2026-01-01"),
      `${companyId} must include a historical record from 2025 or earlier`
    )
  })

  realtime.signals.forEach((signal) => {
    const publishedTime = Date.parse(signal.publishedAt)
    const capturedTime = Date.parse(signal.capturedAt)

    assert.ok(
      Number.isFinite(publishedTime),
      `${signal.id} has an invalid date`
    )
    assert.equal(signal.capturedAt, realtime.snapshotAt)
    assert.ok(
      publishedTime <= capturedTime && capturedTime === snapshotTime,
      `${signal.id} cannot be published after the snapshot`
    )
    assert.ok(signal.title.trim(), `${signal.id} needs a title`)
    assert.ok(signal.summary.trim(), `${signal.id} needs a summary`)
    assert.ok(signal.aiInsight.trim(), `${signal.id} needs research analysis`)
    assert.ok(
      signal.potentialImpact.trim(),
      `${signal.id} needs a potential impact`
    )
    assert.ok(
      signal.recommendedAction.trim(),
      `${signal.id} needs a recommended action`
    )
    assert.match(
      signal.aiInsight,
      /可能|需要|仍需|不能|不等同|不足|应/,
      `${signal.id} must label research inference cautiously`
    )
    assert.ok(
      signal.riskDimensionIds.every((id) => canonicalRiskDimensionIds.has(id)),
      `${signal.id} contains a legacy risk dimension`
    )
    assert.ok(
      signal.indicatorIds.every((id) => /^kci-\d{3}$/.test(id)),
      `${signal.id} contains a legacy indicator id`
    )
    assert.ok(
      signal.heatScore >= 0 && signal.heatScore <= 100,
      `${signal.id} heat score must be between 0 and 100`
    )
    assert.ok(
      ["official", "exchange", "filing", "paper"].includes(
        signal.sourceReliability
      ),
      `${signal.id} must use a primary or original source`
    )
  })

  assert.ok(
    realtime.signals.filter((signal) => signal.category === "技术论文/专利")
      .length >= 12,
    "the detailed feed must include substantial paper and patent coverage"
  )

  realtime.signals.forEach((signal) => {
    assert.ok(
      (signal.keyFacts?.length ?? 0) >= 3,
      `${signal.id} needs at least three key facts`
    )
    assert.ok(
      signal.historicalContext?.trim(),
      `${signal.id} needs historical context`
    )
    assert.ok(
      (signal.researchQuestions?.length ?? 0) >= 2,
      `${signal.id} needs at least two research questions`
    )
    assert.ok(signal.sourceLocator?.trim(), `${signal.id} needs a locator`)
  })
})
