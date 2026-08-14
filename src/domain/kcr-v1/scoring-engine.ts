import {
  KCR_DIMENSION_WEIGHTS,
  KCR_INDICATOR_WEIGHTS,
  KCR_METHOD_VERSION,
  KCR_RISK_DIMENSION_IDS,
  KCR_WEIGHTED_INDICATOR_IDS,
  type KcrRiskDimensionId,
  type KcrRiskLevel,
  type KcrWeightedIndicatorId,
} from "./model.ts"

export const KCR_SCORING_MODEL_VERSION = "KCR-SCORE-2026.08-v3" as const
export const KCR_SCORING_REVIEW_COVERAGE = 0.7
export const KCR_PROPAGATION_MINIMUM_COEFFICIENT = 0.05

export interface KcrAssessmentEvidenceInput {
  id: string
  title: string
  sourceTier:
    | "regulator"
    | "exchange"
    | "company-filing"
    | "official-company"
    | "commercial-api"
    | "research"
    | "media"
    | "manual"
  sourceName: string
  sourceUrl: string | null
  publishedAt: string | null
  locator: string
}

export interface KcrAssessmentEvidenceReference {
  evidenceId: string
  locator: string
  supportStrength: "direct" | "inferred" | "background"
  inferenceBasis: string | null
}

export interface KcrAssessmentIndicatorInput {
  id: KcrWeightedIndicatorId
  dimensionId: KcrRiskDimensionId
  label: string
  weight: number
  riskScore: number | null
  dataStatus: "complete" | "partial" | "missing"
  coverageFactor: 1 | 0.75 | 0
  evidenceConfidence: number
  rationale: string
  evidence: KcrAssessmentEvidenceReference[]
}

export interface KcrAssessmentEventInput {
  id: string
  title: string
  summary: string
  severity: "critical" | "high" | "medium" | "low" | "watch"
  redFlag: boolean
  occurredAt: string | null
  sourceIndicatorIds: KcrWeightedIndicatorId[]
  evidenceIds: string[]
}

export interface KcrPropagationEdgeInput {
  relationId: string
  strength: number
  timeDecay: number
  businessRelevance: number
}

export interface KcrPropagationPathInput {
  id: string
  label: string
  eventId: string
  eventRiskScore: number
  edges: KcrPropagationEdgeInput[]
}

export interface KcrAssessmentRequest {
  methodVersion: typeof KCR_METHOD_VERSION
  companyId: string
  assessmentAt: string
  dataCutoff: string
  indicators: KcrAssessmentIndicatorInput[]
  evidenceCatalog: KcrAssessmentEvidenceInput[]
  events: KcrAssessmentEventInput[]
  propagationPaths: KcrPropagationPathInput[]
}

export interface KcrAssessmentIndicatorResult extends KcrAssessmentIndicatorInput {
  riskLevel: KcrRiskLevel | null
  riskLevelLabel: string
  weightedContribution: number | null
  evidenceIds: string[]
  formulaTrace: string
}

export interface KcrAssessmentDimensionResult {
  dimensionId: KcrRiskDimensionId
  label: string
  score: number | null
  riskLevel: KcrRiskLevel | null
  riskLevelLabel: string
  coveredWeight: number
  totalWeight: number
  scoreWeightCoverage: number
  evidenceCoverage: number
  confidence: number
  indicatorIds: KcrWeightedIndicatorId[]
  missingIndicatorIds: KcrWeightedIndicatorId[]
  formulaTrace: string
}

export interface KcrRedFlagResult {
  eventId: string
  title: string
  summary: string
  severity: KcrAssessmentEventInput["severity"]
  priority: "P0" | "P1"
  sourceIndicatorIds: KcrWeightedIndicatorId[]
  evidenceIds: string[]
  affectsBaselineScore: false
}

export interface KcrPropagationPathResult {
  id: string
  label: string
  eventId: string
  eventRiskScore: number
  pathCoefficient: number
  candidateRisk: number
  propagatedRisk: number
  included: boolean
  edgeTraces: string[]
  formulaTrace: string
}

export interface KcrAssessmentResult {
  modelVersion: typeof KCR_SCORING_MODEL_VERSION
  methodVersion: typeof KCR_METHOD_VERSION
  runId: string
  companyId: string
  assessmentAt: string
  dataCutoff: string
  generatedAt: string
  status: "scored" | "partial" | "insufficient-data"
  reviewStatus: "ready" | "manual-review" | "insufficient-data"
  baselineScore: number | null
  riskLevel: KcrRiskLevel | null
  riskLevelLabel: string
  scoredWeight: number
  scoreWeightCoverage: number
  evidenceCoverage: number
  confidence: number
  dimensions: KcrAssessmentDimensionResult[]
  indicatorResults: KcrAssessmentIndicatorResult[]
  missingIndicatorIds: KcrWeightedIndicatorId[]
  redFlags: KcrRedFlagResult[]
  propagationPaths: KcrPropagationPathResult[]
  warnings: string[]
  formulaTrace: string
  disclaimer: string
}

export class KcrAssessmentRequestError extends Error {
  readonly statusCode = 422
  readonly code = "KCR_ASSESSMENT_REQUEST_INVALID"
  readonly details: string[]

  constructor(details: string[]) {
    super(`KCR V3 评分请求无效：${details.join("；")}`)
    this.name = "KcrAssessmentRequestError"
    this.details = details
  }
}

const dimensionLabels: Record<KcrRiskDimensionId, string> = {
  technology: "技术风险",
  compliance: "合规风险",
  finance: "财务与融资风险",
  external: "外部环境风险",
  "personnel-governance": "人员与治理风险",
}

const expectedDataStatus = {
  complete: 1,
  partial: 0.75,
  missing: 0,
} as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function finiteNumber(value: unknown, min: number, max: number) {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= min &&
    value <= max
  )
}

function expectedDimension(indicatorId: string): KcrRiskDimensionId | null {
  if (indicatorId.startsWith("T")) return "technology"
  if (indicatorId.startsWith("C")) return "compliance"
  if (indicatorId.startsWith("F")) return "finance"
  if (indicatorId.startsWith("E")) return "external"
  if (indicatorId.startsWith("P")) return "personnel-governance"
  return null
}

function validateRequest(
  value: unknown
): asserts value is KcrAssessmentRequest {
  const errors: string[] = []
  if (!isRecord(value)) {
    throw new KcrAssessmentRequestError(["请求必须是对象。"])
  }
  if (value.methodVersion !== KCR_METHOD_VERSION) {
    errors.push(`方法版本必须为 ${KCR_METHOD_VERSION}。`)
  }
  for (const field of ["companyId", "assessmentAt", "dataCutoff"] as const) {
    if (typeof value[field] !== "string" || !value[field].trim()) {
      errors.push(`${field} 不能为空。`)
    }
  }
  const indicators = Array.isArray(value.indicators) ? value.indicators : []
  const evidenceCatalog = Array.isArray(value.evidenceCatalog)
    ? value.evidenceCatalog
    : []
  const events = Array.isArray(value.events) ? value.events : []
  const propagationPaths = Array.isArray(value.propagationPaths)
    ? value.propagationPaths
    : []
  if (!Array.isArray(value.indicators)) errors.push("indicators 必须是数组。")
  if (!Array.isArray(value.evidenceCatalog)) {
    errors.push("evidenceCatalog 必须是数组。")
  }
  if (!Array.isArray(value.events)) errors.push("events 必须是数组。")
  if (!Array.isArray(value.propagationPaths)) {
    errors.push("propagationPaths 必须是数组。")
  }

  const evidenceIds = new Set<string>()
  evidenceCatalog.forEach((item, index) => {
    if (!isRecord(item) || typeof item.id !== "string" || !item.id.trim()) {
      errors.push(`evidenceCatalog[${index}] 缺少有效 ID。`)
      return
    }
    if (evidenceIds.has(item.id)) {
      errors.push(`证据 ID 重复：${item.id}。`)
    }
    evidenceIds.add(item.id)
    if (
      typeof item.title !== "string" ||
      typeof item.sourceName !== "string" ||
      typeof item.locator !== "string"
    ) {
      errors.push(`证据 ${item.id} 缺少标题、来源或位置。`)
    }
  })

  const indicatorIds = new Set<string>()
  indicators.forEach((item, index) => {
    if (!isRecord(item) || typeof item.id !== "string") {
      errors.push(`indicators[${index}] 缺少指标 ID。`)
      return
    }
    const id = item.id as KcrWeightedIndicatorId
    if (!KCR_WEIGHTED_INDICATOR_IDS.includes(id)) {
      errors.push(`未知指标：${item.id}。`)
      return
    }
    if (indicatorIds.has(id)) errors.push(`指标 ID 重复：${id}。`)
    indicatorIds.add(id)
    if (item.dimensionId !== expectedDimension(id)) {
      errors.push(`${id} 的风险维度不正确。`)
    }
    if (item.weight !== KCR_INDICATOR_WEIGHTS[id]) {
      errors.push(`${id} 权重必须为 ${KCR_INDICATOR_WEIGHTS[id]}。`)
    }
    if (
      item.dataStatus !== "complete" &&
      item.dataStatus !== "partial" &&
      item.dataStatus !== "missing"
    ) {
      errors.push(`${id} 数据状态不正确。`)
    } else if (item.coverageFactor !== expectedDataStatus[item.dataStatus]) {
      errors.push(`${id} 数据状态与覆盖系数不一致。`)
    }
    if (item.riskScore !== null && !finiteNumber(item.riskScore, 0, 100)) {
      errors.push(`${id} 风险分必须为空或位于 0–100。`)
    }
    if (item.dataStatus === "missing" && item.riskScore !== null) {
      errors.push(`${id} 缺失时不得填入风险分。`)
    }
    if (item.dataStatus !== "missing" && item.riskScore === null) {
      errors.push(`${id} 非缺失观测必须提供风险分。`)
    }
    if (!finiteNumber(item.evidenceConfidence, 0, 1)) {
      errors.push(`${id} 证据置信度必须位于 0–1。`)
    }
    if (item.dataStatus === "missing" && item.evidenceConfidence !== 0) {
      errors.push(`${id} 缺失时证据置信度必须为 0。`)
    }
    if (!Array.isArray(item.evidence)) {
      errors.push(`${id} evidence 必须是数组。`)
      return
    }
    let effectiveEvidenceCount = 0
    item.evidence.forEach((reference, referenceIndex) => {
      if (!isRecord(reference) || typeof reference.evidenceId !== "string") {
        errors.push(`${id} evidence[${referenceIndex}] 格式错误。`)
        return
      }
      if (!evidenceIds.has(reference.evidenceId)) {
        errors.push(`${id} 引用了未知证据 ${reference.evidenceId}。`)
      }
      if (typeof reference.locator !== "string" || !reference.locator.trim()) {
        errors.push(`${id} 证据 ${reference.evidenceId} 缺少精确位置。`)
      }
      if (
        reference.supportStrength === "direct" ||
        (reference.supportStrength === "inferred" &&
          typeof reference.inferenceBasis === "string" &&
          reference.inferenceBasis.trim())
      ) {
        effectiveEvidenceCount += 1
      } else if (
        reference.supportStrength !== "background" &&
        reference.supportStrength !== "inferred"
      ) {
        errors.push(`${id} 证据 ${reference.evidenceId} 支持强度无效。`)
      }
      if (
        reference.supportStrength === "inferred" &&
        (typeof reference.inferenceBasis !== "string" ||
          !reference.inferenceBasis.trim())
      ) {
        errors.push(`${id} 的推断证据必须记录推断依据。`)
      }
    })
    if (item.riskScore !== null && effectiveEvidenceCount === 0) {
      errors.push(`${id} 进入评分前必须绑定有效证据。`)
    }
  })
  const missingIndicators = KCR_WEIGHTED_INDICATOR_IDS.filter(
    (id) => !indicatorIds.has(id)
  )
  if (missingIndicators.length > 0) {
    errors.push(`缺少指标：${missingIndicators.join("、")}。`)
  }

  const eventIds = new Set<string>()
  events.forEach((event, index) => {
    if (!isRecord(event) || typeof event.id !== "string" || !event.id.trim()) {
      errors.push(`events[${index}] 缺少有效 ID。`)
      return
    }
    if (eventIds.has(event.id)) errors.push(`事件 ID 重复：${event.id}。`)
    eventIds.add(event.id)
    if (
      typeof event.title !== "string" ||
      !event.title.trim() ||
      typeof event.summary !== "string" ||
      !event.summary.trim()
    ) {
      errors.push(`事件 ${event.id} 缺少标题或摘要。`)
    }
    if (
      event.severity !== "critical" &&
      event.severity !== "high" &&
      event.severity !== "medium" &&
      event.severity !== "low" &&
      event.severity !== "watch"
    ) {
      errors.push(`事件 ${event.id} 严重度无效。`)
    }
    if (typeof event.redFlag !== "boolean") {
      errors.push(`事件 ${event.id} 的 redFlag 必须是布尔值。`)
    }
    if (!Array.isArray(event.sourceIndicatorIds)) {
      errors.push(`事件 ${event.id} 缺少 sourceIndicatorIds。`)
    } else {
      for (const indicatorId of event.sourceIndicatorIds) {
        if (!KCR_WEIGHTED_INDICATOR_IDS.includes(indicatorId)) {
          errors.push(
            `事件 ${event.id} 引用了未知指标 ${String(indicatorId)}。`
          )
        }
      }
    }
    if (!Array.isArray(event.evidenceIds)) {
      errors.push(`事件 ${event.id} 缺少 evidenceIds。`)
    } else {
      for (const evidenceId of event.evidenceIds) {
        if (!evidenceIds.has(evidenceId)) {
          errors.push(`事件 ${event.id} 引用了未知证据 ${String(evidenceId)}。`)
        }
      }
      if (event.redFlag === true && event.evidenceIds.length === 0) {
        errors.push(`红旗事件 ${event.id} 必须绑定证据。`)
      }
    }
  })

  const pathIds = new Set<string>()
  propagationPaths.forEach((path, index) => {
    if (!isRecord(path) || typeof path.id !== "string" || !path.id.trim()) {
      errors.push(`propagationPaths[${index}] 缺少有效 ID。`)
      return
    }
    if (pathIds.has(path.id)) errors.push(`传播路径 ID 重复：${path.id}。`)
    pathIds.add(path.id)
    if (typeof path.eventId !== "string" || !eventIds.has(path.eventId)) {
      errors.push(`传播路径 ${path.id} 引用了未知事件。`)
    }
    if (!finiteNumber(path.eventRiskScore, 0, 100)) {
      errors.push(`传播路径 ${path.id} 的事件风险分必须位于 0–100。`)
    }
    if (!Array.isArray(path.edges) || path.edges.length === 0) {
      errors.push(`传播路径 ${path.id} 至少需要一条边。`)
      return
    }
    path.edges.forEach((edge, edgeIndex) => {
      if (
        !isRecord(edge) ||
        typeof edge.relationId !== "string" ||
        !finiteNumber(edge.strength, 0, 1) ||
        !finiteNumber(edge.timeDecay, 0, 1) ||
        !finiteNumber(edge.businessRelevance, 0, 1)
      ) {
        errors.push(`传播路径 ${path.id} 第 ${edgeIndex + 1} 条边格式错误。`)
      }
    })
  })

  if (errors.length > 0) throw new KcrAssessmentRequestError(errors)
}

function round(value: number, digits = 4) {
  const multiplier = 10 ** digits
  return Math.round((value + Number.EPSILON) * multiplier) / multiplier
}

function riskLevel(score: number | null): KcrRiskLevel | null {
  if (score === null) return null
  if (score < 25) return "low"
  if (score < 50) return "medium"
  if (score < 75) return "high"
  return "critical"
}

function riskLevelLabel(level: KcrRiskLevel | null) {
  if (level === "low") return "低"
  if (level === "medium") return "中"
  if (level === "high") return "高"
  if (level === "critical") return "极高"
  return "数据不足"
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`
  }
  return JSON.stringify(value)
}

function createRunId(request: KcrAssessmentRequest) {
  let hash = 2166136261
  const source = stableStringify(request)
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `kcr3-${(hash >>> 0).toString(16).padStart(8, "0")}`
}

function calculatePropagationPath(
  path: KcrPropagationPathInput
): KcrPropagationPathResult {
  const edgeTraces = path.edges.map((edge) => {
    const coefficient = edge.strength * edge.timeDecay * edge.businessRelevance
    return `${edge.relationId}: ${edge.strength}×${edge.timeDecay}×${edge.businessRelevance}=${round(coefficient, 6)}`
  })
  const pathCoefficient = round(
    path.edges.reduce(
      (coefficient, edge) =>
        coefficient * edge.strength * edge.timeDecay * edge.businessRelevance,
      1
    ),
    6
  )
  const candidateRisk = round(path.eventRiskScore * pathCoefficient)
  const included = pathCoefficient >= KCR_PROPAGATION_MINIMUM_COEFFICIENT
  return {
    id: path.id,
    label: path.label,
    eventId: path.eventId,
    eventRiskScore: path.eventRiskScore,
    pathCoefficient,
    candidateRisk,
    propagatedRisk: included ? candidateRisk : 0,
    included,
    edgeTraces,
    formulaTrace: included
      ? `传播风险=${path.eventRiskScore}×${pathCoefficient}=${candidateRisk}。`
      : `路径系数 ${pathCoefficient}<${KCR_PROPAGATION_MINIMUM_COEFFICIENT}，不计入传播风险；候选值 ${candidateRisk} 仅保留审计。`,
  }
}

export function calculateKcrAssessment(
  value: unknown,
  options: { now?: () => Date } = {}
): KcrAssessmentResult {
  validateRequest(value)
  const request = value
  const scoredIndicators = request.indicators.filter(
    (indicator) => indicator.riskScore !== null
  )
  const scoredWeight = scoredIndicators.reduce(
    (total, indicator) => total + indicator.weight,
    0
  )
  const weightedRiskTotal = scoredIndicators.reduce(
    (total, indicator) => total + indicator.weight * (indicator.riskScore ?? 0),
    0
  )
  const baselineScore =
    scoredWeight === 0 ? null : round(weightedRiskTotal / scoredWeight)
  const baselineLevel = riskLevel(baselineScore)
  const scoreWeightCoverage = round(scoredWeight / 100, 6)
  const evidenceCoverage = round(
    request.indicators.reduce(
      (total, indicator) => total + indicator.weight * indicator.coverageFactor,
      0
    ) / 100,
    6
  )
  const confidence = round(
    request.indicators.reduce(
      (total, indicator) =>
        total + indicator.weight * indicator.evidenceConfidence,
      0
    ) / 100,
    6
  )

  const indicatorResults = request.indicators.map(
    (indicator): KcrAssessmentIndicatorResult => {
      const level = riskLevel(indicator.riskScore)
      return {
        ...indicator,
        riskLevel: level,
        riskLevelLabel: riskLevelLabel(level),
        weightedContribution:
          indicator.riskScore === null || scoredWeight === 0
            ? null
            : round((indicator.weight * indicator.riskScore) / scoredWeight),
        evidenceIds: [
          ...new Set(indicator.evidence.map((item) => item.evidenceId)),
        ],
        formulaTrace:
          indicator.riskScore === null
            ? `${indicator.id} 数据缺失，不进入风险分分子或分母。`
            : `${indicator.id} 贡献=${indicator.riskScore}×${indicator.weight}/${scoredWeight}=${round((indicator.riskScore * indicator.weight) / scoredWeight)}。`,
      }
    }
  )

  const dimensions = KCR_RISK_DIMENSION_IDS.map(
    (dimensionId): KcrAssessmentDimensionResult => {
      const indicators = request.indicators.filter(
        (indicator) => indicator.dimensionId === dimensionId
      )
      const scored = indicators.filter(
        (indicator) => indicator.riskScore !== null
      )
      const coveredWeight = scored.reduce(
        (total, indicator) => total + indicator.weight,
        0
      )
      const totalWeight = KCR_DIMENSION_WEIGHTS[dimensionId]
      const weightedTotal = scored.reduce(
        (total, indicator) =>
          total + indicator.weight * (indicator.riskScore ?? 0),
        0
      )
      const score =
        coveredWeight === 0 ? null : round(weightedTotal / coveredWeight)
      const level = riskLevel(score)
      const missingIndicatorIds = indicators
        .filter((indicator) => indicator.riskScore === null)
        .map((indicator) => indicator.id)
      return {
        dimensionId,
        label: dimensionLabels[dimensionId],
        score,
        riskLevel: level,
        riskLevelLabel: riskLevelLabel(level),
        coveredWeight,
        totalWeight,
        scoreWeightCoverage: round(coveredWeight / totalWeight, 6),
        evidenceCoverage: round(
          indicators.reduce(
            (total, indicator) =>
              total + indicator.weight * indicator.coverageFactor,
            0
          ) / totalWeight,
          6
        ),
        confidence: round(
          indicators.reduce(
            (total, indicator) =>
              total + indicator.weight * indicator.evidenceConfidence,
            0
          ) / totalWeight,
          6
        ),
        indicatorIds: indicators.map((indicator) => indicator.id),
        missingIndicatorIds,
        formulaTrace:
          score === null
            ? `${dimensionLabels[dimensionId]}没有可评分指标。`
            : `${dimensionLabels[dimensionId]}=Σ(指标风险分×权重)/${coveredWeight}=${score}。`,
      }
    }
  )

  const missingIndicatorIds = request.indicators
    .filter((indicator) => indicator.riskScore === null)
    .map((indicator) => indicator.id)
  const redFlags = request.events
    .filter((event) => event.redFlag)
    .map((event): KcrRedFlagResult => ({
      eventId: event.id,
      title: event.title,
      summary: event.summary,
      severity: event.severity,
      priority:
        event.severity === "critical" || event.severity === "high"
          ? "P0"
          : "P1",
      sourceIndicatorIds: [...event.sourceIndicatorIds],
      evidenceIds: [...event.evidenceIds],
      affectsBaselineScore: false,
    }))
  const propagationPaths = request.propagationPaths.map(
    calculatePropagationPath
  )
  const warnings: string[] = []
  if (missingIndicatorIds.length > 0) {
    warnings.push(
      `存在 ${missingIndicatorIds.length} 个缺失指标，风险分已按有效权重归一化。`
    )
  }
  if (evidenceCoverage < KCR_SCORING_REVIEW_COVERAGE) {
    warnings.push(
      `证据覆盖率 ${round(evidenceCoverage * 100, 2)}% 低于 ${KCR_SCORING_REVIEW_COVERAGE * 100}% 复核线。`
    )
  }
  const missingDimensions = dimensions.filter(
    (dimension) => dimension.score === null
  )
  if (missingDimensions.length > 0) {
    warnings.push(
      `以下风险维度无法评分：${missingDimensions.map((dimension) => dimension.label).join("、")}。`
    )
  }
  const status =
    baselineScore === null
      ? "insufficient-data"
      : missingIndicatorIds.length > 0
        ? "partial"
        : "scored"
  const reviewStatus =
    baselineScore === null
      ? "insufficient-data"
      : evidenceCoverage >= KCR_SCORING_REVIEW_COVERAGE &&
          missingDimensions.length === 0
        ? "ready"
        : "manual-review"

  return {
    modelVersion: KCR_SCORING_MODEL_VERSION,
    methodVersion: KCR_METHOD_VERSION,
    runId: createRunId(request),
    companyId: request.companyId,
    assessmentAt: request.assessmentAt,
    dataCutoff: request.dataCutoff,
    generatedAt: (options.now?.() ?? new Date()).toISOString(),
    status,
    reviewStatus,
    baselineScore,
    riskLevel: baselineLevel,
    riskLevelLabel: riskLevelLabel(baselineLevel),
    scoredWeight,
    scoreWeightCoverage,
    evidenceCoverage,
    confidence,
    dimensions,
    indicatorResults,
    missingIndicatorIds,
    redFlags,
    propagationPaths,
    warnings,
    formulaTrace:
      baselineScore === null
        ? "没有可评分指标，未生成客观风险基线。"
        : `客观基线=Σ(指标风险分×固定权重)/有效权重=${weightedRiskTotal}/${scoredWeight}=${baselineScore}；红旗事件和传播路径不改写该分数。`,
    disclaimer:
      "本结果基于指定评估时点前可获得且已记录来源的数据，用于风险识别与辅助研判，不构成投资、法律、审计或监管意见。数据缺失、来源更新与情景假设可能影响结果，使用者应结合专业尽调独立决策。",
  }
}
