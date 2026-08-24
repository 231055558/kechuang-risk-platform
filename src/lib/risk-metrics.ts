import { isEffectiveEvidence } from "./source-governance.ts"
import {
  CANONICAL_RISK_DIMENSION_LABELS,
  getCanonicalRiskDimensionId,
} from "./risk-dimensions.ts"
import type {
  CanonicalRiskDimensionId,
  CompanyDetail,
  EvidenceScoringBinding,
  EventStatus,
  IndicatorObservation,
  RiskAssessment,
  RiskEvent,
  RiskIndicator,
  RiskLevel,
  TechnologyRiskOverride,
  TechnologyRiskScoreResult,
  TechnologyScoringCompanyState,
} from "@/types/risk"

type EventWithStatus = Pick<RiskEvent, "status">

export type IndicatorNormalizationRule = (
  observation: IndicatorObservation
) => number | null

export type NormalizationRuleRegistry = Readonly<
  Record<string, IndicatorNormalizationRule>
>

export function createNormalizationRuleKey(
  indicatorId: string,
  normalizationRuleVersion: string
) {
  return `${indicatorId}::${normalizationRuleVersion}`
}

export function calculateResponseRate(
  eventsOrStatuses: Array<EventWithStatus | EventStatus>
) {
  if (eventsOrStatuses.length === 0) {
    return 0
  }

  const completedCount = eventsOrStatuses.filter((item) => {
    const status = typeof item === "string" ? item : item.status
    return status === "done"
  }).length

  return Math.round((completedCount / eventsOrStatuses.length) * 100)
}

export function summarizeEventStatuses(events: EventWithStatus[]) {
  return {
    pending: events.filter((event) => event.status === "pending").length,
    inProgress: events.filter((event) => event.status === "in-progress").length,
    done: events.filter((event) => event.status === "done").length,
    responseRate: calculateResponseRate(events),
  }
}

function scoreToLevel(score: number): RiskLevel {
  if (score >= 75) {
    return "high"
  }
  if (score >= 60) {
    return "medium-high"
  }
  if (score >= 40) {
    return "attention"
  }
  return "low"
}

function unique(values: string[]) {
  return [...new Set(values)]
}

function isValidScore(value: number | null | undefined): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 100
  )
}

function isNonEmptyString(value: string | null | undefined): value is string {
  return typeof value === "string" && Boolean(value.trim())
}

function isValidReviewDate(value: string | null | undefined): value is string {
  return isNonEmptyString(value) && !Number.isNaN(Date.parse(value))
}

type ReviewedTechnologyRiskOverride = TechnologyRiskOverride & {
  enabled: true
  targetRunId: string
  reason: string
  reviewedBy: string
  reviewedAt: string
}

function isCurrentReviewedOverride(
  override: TechnologyRiskOverride | null,
  result: TechnologyRiskScoreResult,
  companyId: string
): override is ReviewedTechnologyRiskOverride {
  return (
    override !== null &&
    override.enabled === true &&
    isNonEmptyString(result.runId) &&
    override.targetRunId?.trim() === result.runId.trim() &&
    (override.companyId === undefined ||
      override.companyId.trim() === companyId) &&
    isValidScore(override.score) &&
    isNonEmptyString(override.reason) &&
    isNonEmptyString(override.reviewedBy) &&
    isValidReviewDate(override.reviewedAt)
  )
}

type ResolvedTechnologyAssessment = {
  score: number
  summary: string
  evidenceIds: string[]
  indicatorIds: string[]
  evidenceIndicatorPairCount: number
  reviewedAtValues: string[]
}

function resolveTechnologyAssessment(
  companyId: string,
  state: TechnologyScoringCompanyState | null
): ResolvedTechnologyAssessment | null {
  const result = state?.latestResult
  if (result && result.companyId.trim() === companyId) {
    const scoredIndicatorResults = result.indicatorResults.filter(
      (indicatorResult) => indicatorResult.status === "scored"
    )
    const evidenceIds = unique(
      scoredIndicatorResults.flatMap((indicatorResult) =>
        indicatorResult.evidenceIds.filter(isNonEmptyString)
      )
    )
    const indicatorIds = unique(
      scoredIndicatorResults.map(
        (indicatorResult) => indicatorResult.indicatorId
      )
    )
    const evidenceIndicatorPairCount = scoredIndicatorResults.reduce(
      (total, indicatorResult) =>
        total +
        unique(indicatorResult.evidenceIds.filter(isNonEmptyString)).length,
      0
    )
    const reviewedAtValues = isValidReviewDate(result.generatedAt)
      ? [result.generatedAt]
      : []
    const override = state?.override ?? null

    if (isCurrentReviewedOverride(override, result, companyId)) {
      return {
        score: override.score,
        summary: `技术自动评分模型 ${result.modelVersion} 覆盖权重 ${result.coveredWeight}%；当前分值采用 ${override.reviewedBy.trim()} 对运行 ${result.runId} 的确认调整。调整理由：${override.reason.trim()}`,
        evidenceIds,
        indicatorIds,
        evidenceIndicatorPairCount,
        reviewedAtValues: [...reviewedAtValues, override.reviewedAt],
      }
    }

    if (result.status === "scored" && isValidScore(result.score)) {
      return {
        score: result.score,
        summary: `技术自动评分模型 ${result.modelVersion} 已完成，覆盖权重 ${result.coveredWeight}%；分值来自当前运行 ${result.runId} 的已计分指标。`,
        evidenceIds,
        indicatorIds,
        evidenceIndicatorPairCount,
        reviewedAtValues,
      }
    }
  }

  return null
}

function getScoreBasisLabel(
  dimensions: RiskAssessment["dimensions"]
): RiskAssessment["scoreBasisLabel"] {
  const hasAutomaticScore = dimensions.some(
    (dimension) => dimension.scoreBasis === "technology-auto-score"
  )
  const hasManualScore = dimensions.some(
    (dimension) => dimension.scoreBasis === "indicator-observation"
  )

  if (hasAutomaticScore && hasManualScore) {
    return "自动评分与指标计算"
  }
  if (hasAutomaticScore) {
    return "技术自动评分与指标计算"
  }
  return "R05–R22 客观指标自动计算"
}

function parseChineseNumber(value: string) {
  const chineseNumbers: Record<string, number> = {
    一: 1,
    二: 2,
    三: 3,
    四: 4,
  }
  return chineseNumbers[value] ?? Number(value)
}

function createPeriodSortValue(year: number, month: number, day = 31) {
  return year * 10000 + month * 100 + day
}

function parsePeriodSortValue(period: string) {
  const normalized = period.trim()
  if (!normalized) {
    return null
  }

  const fullDate = normalized.match(
    /^(\d{4})(?:年|-|\/|\.)(\d{1,2})(?:月|-|\/|\.)(\d{1,2})日?$/
  )
  if (fullDate) {
    return createPeriodSortValue(
      Number(fullDate[1]),
      Number(fullDate[2]),
      Number(fullDate[3])
    )
  }

  const quarter = normalized.match(
    /^(\d{4})\s*(?:-?\s*Q([1-4])|年?\s*第?([一二三四1-4])季度)$/i
  )
  if (quarter) {
    const quarterNumber = parseChineseNumber(quarter[2] ?? quarter[3])
    return createPeriodSortValue(Number(quarter[1]), quarterNumber * 3)
  }

  const halfYear = normalized.match(
    /^(\d{4})\s*(?:-?\s*H([12])|年?\s*(上|下)半年)$/i
  )
  if (halfYear) {
    const half = halfYear[2] ?? (halfYear[3] === "上" ? "1" : "2")
    return createPeriodSortValue(Number(halfYear[1]), Number(half) * 6)
  }

  const monthRange = normalized.match(
    /^(\d{4})年?\s*\d{1,2}\s*[—–-]\s*(\d{1,2})月$/
  )
  if (monthRange) {
    return createPeriodSortValue(Number(monthRange[1]), Number(monthRange[2]))
  }

  const month = normalized.match(/^(\d{4})(?:年|-|\/|\.)(\d{1,2})月?$/)
  if (month) {
    return createPeriodSortValue(Number(month[1]), Number(month[2]))
  }

  const year = normalized.match(/^(\d{4})(?:年|年度|年业绩)?$/)
  return year ? createPeriodSortValue(Number(year[1]), 12) : null
}

function compareObservationRecency(
  candidate: IndicatorObservation,
  current: IndicatorObservation
) {
  const candidatePeriod = parsePeriodSortValue(candidate.period)
  const currentPeriod = parsePeriodSortValue(current.period)
  if (
    candidatePeriod !== null &&
    currentPeriod !== null &&
    candidatePeriod !== currentPeriod
  ) {
    return candidatePeriod - currentPeriod
  }

  const reviewedAtComparison = candidate.reviewedAt.localeCompare(
    current.reviewedAt,
    "en",
    { numeric: true }
  )
  if (reviewedAtComparison !== 0) {
    return reviewedAtComparison
  }

  return candidate.period.localeCompare(current.period, "zh-CN", {
    numeric: true,
  })
}

function getNormalizedObservationScore(
  observation: IndicatorObservation,
  normalizationRules: NormalizationRuleRegistry
) {
  const rule =
    normalizationRules[
      createNormalizationRuleKey(
        observation.indicatorId,
        observation.normalizationRuleVersion
      )
    ]
  if (!rule) {
    return null
  }

  const computedScore = rule(observation)
  if (
    typeof computedScore !== "number" ||
    !Number.isFinite(computedScore) ||
    computedScore < 0 ||
    computedScore > 100
  ) {
    return null
  }

  if (
    observation.normalizedScore !== undefined &&
    (!Number.isFinite(observation.normalizedScore) ||
      Math.abs(observation.normalizedScore - computedScore) > 0.0001)
  ) {
    return null
  }

  return computedScore
}

function hasMatchingScoringLink(
  detail: CompanyDetail,
  evidenceId: string,
  observation: IndicatorObservation,
  evidenceBindings: EvidenceScoringBinding[]
) {
  const evidence = detail.evidence.find((item) => item.id === evidenceId)
  if (!evidence || !isEffectiveEvidence(evidence)) {
    return false
  }

  const observationBindings = evidenceBindings.filter(
    (binding) =>
      binding.companyId === observation.companyId &&
      binding.indicatorId === observation.indicatorId &&
      binding.period.trim() === observation.period.trim() &&
      binding.unit.trim() === observation.unit.trim() &&
      (!observation.id || binding.observationId === observation.id)
  )

  return observationBindings.some(
    (binding) =>
      binding.evidenceId === evidenceId &&
      Boolean(binding.locator.trim()) &&
      (evidence.supportStrength !== "inferred" ||
        Boolean(binding.inferenceBasis?.trim()))
  )
}

function calculateScoringEvidenceCoverage(
  detail: CompanyDetail,
  scoringEvidenceIds: string[]
) {
  const effectiveUrls = new Set(
    detail.evidence
      .filter(isEffectiveEvidence)
      .map((evidence) => evidence.sourceUrl)
      .filter(Boolean)
  )
  const scoringEvidenceIdSet = new Set(scoringEvidenceIds)
  const scoringUrls = new Set(
    detail.evidence
      .filter((evidence) => scoringEvidenceIdSet.has(evidence.id))
      .map((evidence) => evidence.sourceUrl)
      .filter(Boolean)
  )

  return effectiveUrls.size === 0
    ? 0
    : Math.round((scoringUrls.size / effectiveUrls.size) * 100)
}

export function buildRiskAssessment(
  detail: CompanyDetail,
  indicators: RiskIndicator[],
  methodVersion: string,
  observations: IndicatorObservation[] = [],
  normalizationRules: NormalizationRuleRegistry = {},
  evidenceBindings: EvidenceScoringBinding[] = [],
  technologyScoringState: TechnologyScoringCompanyState | null = null
): RiskAssessment {
  const indicatorMap = new Map(
    indicators.map((indicator) => [indicator.id, indicator])
  )
  const evidenceMap = new Map(
    detail.evidence.map((evidence) => [evidence.id, evidence])
  )
  const technologyAssessment = resolveTechnologyAssessment(
    detail.id,
    technologyScoringState
  )

  const dimensions = (
    Object.keys(CANONICAL_RISK_DIMENSION_LABELS) as CanonicalRiskDimensionId[]
  ).map((id) => {
    const latestObservationByIndicator = new Map<string, IndicatorObservation>()

    observations.forEach((observation) => {
      const indicator = indicatorMap.get(observation.indicatorId)
      if (
        observation.companyId !== detail.id ||
        observation.status !== "available" ||
        observation.reviewStatus !== "reviewed" ||
        !observation.value ||
        !observation.unit.trim() ||
        !observation.period.trim() ||
        !observation.normalizationRuleVersion.trim() ||
        !observation.reviewedBy.trim() ||
        !observation.reviewedAt.trim() ||
        indicator?.admissionStatus !== "validated" ||
        getCanonicalRiskDimensionId(indicator.primaryRisk) !== id
      ) {
        return
      }

      const current = latestObservationByIndicator.get(observation.indicatorId)
      if (!current || compareObservationRecency(observation, current) > 0) {
        latestObservationByIndicator.set(observation.indicatorId, observation)
      }
    })

    const scoredObservations = [
      ...latestObservationByIndicator.values(),
    ].flatMap((observation) => {
      const normalizedScore = getNormalizedObservationScore(
        observation,
        normalizationRules
      )
      if (normalizedScore === null) {
        return []
      }

      const evidenceIds = unique(observation.evidenceIds).filter(
        (evidenceId) =>
          evidenceMap.has(evidenceId) &&
          hasMatchingScoringLink(
            detail,
            evidenceId,
            observation,
            evidenceBindings
          )
      )

      return evidenceIds.length > 0
        ? [
            {
              observation,
              normalizedScore,
              evidenceIds,
            },
          ]
        : []
    })
    const evidenceIds = unique(
      scoredObservations.flatMap((item) => item.evidenceIds)
    )
    const indicatorIds = unique(
      scoredObservations.map((item) => item.observation.indicatorId)
    )
    const evidenceIndicatorPairCount = scoredObservations.reduce(
      (total, item) => total + item.evidenceIds.length,
      0
    )
    const assessable = scoredObservations.length > 0
    const score = assessable
      ? Math.round(
          scoredObservations.reduce(
            (total, item) => total + item.normalizedScore,
            0
          ) / scoredObservations.length
        )
      : null

    if (id === "technology" && technologyAssessment) {
      return {
        id,
        label: CANONICAL_RISK_DIMENSION_LABELS[id],
        score: technologyAssessment.score,
        level: scoreToLevel(technologyAssessment.score),
        assessable: true,
        scoreBasis: "technology-auto-score" as const,
        summary: technologyAssessment.summary,
        evidenceIds: technologyAssessment.evidenceIds,
        indicatorIds: technologyAssessment.indicatorIds,
        evidenceIndicatorPairCount:
          technologyAssessment.evidenceIndicatorPairCount,
      }
    }

    return {
      id,
      label: CANONICAL_RISK_DIMENSION_LABELS[id],
      score,
      level: score === null ? null : scoreToLevel(score),
      assessable,
      scoreBasis: assessable ? ("indicator-observation" as const) : null,
      summary: assessable
        ? `已接入 ${scoredObservations.length} 项有效企业观测，并完成指标与评分证据配对。`
        : "当前公开快照缺少可计算的企业指标观测值。",
      evidenceIds,
      indicatorIds,
      evidenceIndicatorPairCount,
    }
  })

  const assessableDimensions = dimensions.filter(
    (dimension) => dimension.assessable && dimension.score !== null
  )
  const score =
    assessableDimensions.length >= 4
      ? Math.round(
          assessableDimensions.reduce(
            (total, dimension) => total + (dimension.score ?? 0),
            0
          ) / assessableDimensions.length
        )
      : null
  const validatedIndicatorCount = indicators.filter(
    (indicator) => indicator.admissionStatus === "validated"
  ).length
  const referencedValidatedIndicators = new Set(
    dimensions
      .flatMap((dimension) => dimension.indicatorIds)
      .filter(
        (indicatorId) =>
          indicatorMap.get(indicatorId)?.admissionStatus === "validated"
      )
  ).size
  const latestReviewedAt = observations
    .filter(
      (observation) =>
        observation.companyId === detail.id &&
        observation.reviewStatus === "reviewed" &&
        observation.reviewedAt.trim()
    )
    .map((observation) => observation.reviewedAt)
    .concat(technologyAssessment?.reviewedAtValues ?? [])
    .sort()
    .at(-1)

  return {
    methodVersion,
    label: "风险辅助研判指数",
    score,
    scoreLabel:
      score !== null
        ? String(score)
        : assessableDimensions.length === 0
          ? "暂无可用指标"
          : "部分指标待补充",
    dimensions,
    assessableDimensionCount: assessableDimensions.length,
    effectiveEvidenceCoverage: calculateScoringEvidenceCoverage(
      detail,
      dimensions.flatMap((dimension) => dimension.evidenceIds)
    ),
    indicatorAvailability:
      validatedIndicatorCount === 0
        ? 0
        : Math.round(
            Math.min(
              100,
              (referencedValidatedIndicators / validatedIndicatorCount) * 100
            )
          ),
    reviewStatus:
      assessableDimensions.length < 4
        ? "insufficient-evidence"
        : assessableDimensions.length === dimensions.length
          ? "reviewed"
          : "manual-review",
    scoreBasisLabel: getScoreBasisLabel(dimensions),
    reviewedAt: latestReviewedAt ?? detail.snapshotAt,
    disclaimer:
      "技术维度采用版本化自动评分模型；其他维度由具备单位、期间和来源定位的企业指标观测按注册规则自动计算，同一指标使用最新有效期间。本结果用于风险识别与行动排序。",
  }
}
