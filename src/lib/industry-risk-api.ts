import {
  INDUSTRY_RISK_COMPANIES_API_PATH,
  INDUSTRY_RISK_GRAPH_API_PATH,
  getIndustryRiskCompanyAssessmentApiPath,
  type IndustryRiskAssessmentApiResponse,
  type IndustryRiskCompanyDirectoryResponse,
  type IndustryRiskKnowledgeGraph,
} from "../domain/industry-risk-v1/index.ts"

interface ApiErrorPayload {
  error?: { code?: unknown; message?: unknown }
}

export class IndustryRiskApiError extends Error {
  readonly status: number | null
  readonly code: string

  constructor(message: string, code: string, status: number | null) {
    super(message)
    this.name = "IndustryRiskApiError"
    this.status = status
    this.code = code
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isFiniteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
}

function isSafeSourceUrl(value: unknown) {
  if (value === null) return true
  if (typeof value !== "string" || !value.trim()) return false
  try {
    const url = new URL(value)
    return url.protocol === "https:" || url.protocol === "http:"
  } catch {
    return false
  }
}

function isCandidateAggregate(value: unknown) {
  return (
    isRecord(value) &&
    (value.method === "entropy" || value.method === "critic") &&
    (value.score === null || isFiniteNumber(value.score)) &&
    isRecord(value.weights) &&
    Number.isInteger(value.sampleSize) &&
    (value.status === "partial-candidate" || value.status === "unavailable") &&
    typeof value.note === "string"
  )
}

function isCompanySummary(value: unknown) {
  return (
    isRecord(value) &&
    typeof value.companyId === "string" &&
    typeof value.companyName === "string" &&
    typeof value.stockCode === "string" &&
    typeof value.chainSegment === "string" &&
    Number.isInteger(value.scoredIndicatorCount) &&
    Number.isInteger(value.totalIndicatorCount) &&
    Array.isArray(value.candidateAggregates) &&
    value.candidateAggregates.length === 2 &&
    value.candidateAggregates.every(isCandidateAggregate)
  )
}

function isDirectoryResponse(
  value: unknown
): value is IndustryRiskCompanyDirectoryResponse {
  return (
    isRecord(value) &&
    value.schemaVersion === "KCR-INDUSTRY-DATA-2026.08-v1" &&
    value.methodVersion === "IRAWC-MVP-2026.08-v2" &&
    typeof value.dataVersion === "string" &&
    typeof value.reportingPeriod === "string" &&
    typeof value.sectorLabel === "string" &&
    Number.isInteger(value.sampleSize) &&
    Number.isInteger(value.scoreReadyIndicatorCount) &&
    Number.isInteger(value.candidateAggregateCompanyCount) &&
    value.industryRiskStatus === "placeholder" &&
    Array.isArray(value.companies) &&
    value.companies.length === value.sampleSize &&
    value.companies.every(isCompanySummary)
  )
}

function isMetricScore(value: unknown) {
  return (
    isRecord(value) &&
    typeof value.indicatorId === "string" &&
    typeof value.metricName === "string" &&
    typeof value.label === "string" &&
    typeof value.unit === "string" &&
    (value.rawValue === null || isFiniteNumber(value.rawValue)) &&
    (value.riskPercentile === null || isFiniteNumber(value.riskPercentile)) &&
    (value.riskScore === null || isFiniteNumber(value.riskScore)) &&
    Number.isInteger(value.sampleSize) &&
    (value.sourceId === null || typeof value.sourceId === "string") &&
    (value.asOfDate === null || typeof value.asOfDate === "string") &&
    typeof value.coverageStatus === "string" &&
    typeof value.providerMarkedUsable === "boolean" &&
    (value.status === "scored" ||
      value.status === "missing" ||
      value.status === "insufficient-sample") &&
    (value.direction === "higher-is-riskier" ||
      value.direction === "lower-is-riskier") &&
    typeof value.formulaTrace === "string" &&
    typeof value.limitation === "string"
  )
}

function isReportAvailability(value: unknown) {
  return (
    value === null ||
    (isRecord(value) &&
      typeof value.companyId === "string" &&
      typeof value.annual2025Status === "string" &&
      typeof value.latestPeriod === "string" &&
      (value.latestReportDate === null ||
        typeof value.latestReportDate === "string") &&
      typeof value.latestReportTitle === "string" &&
      isSafeSourceUrl(value.latestReportUrl) &&
      typeof value.notes === "string")
  )
}

function isSupplementaryObservation(value: unknown) {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.companyId === "string" &&
    typeof value.factName === "string" &&
    (value.period === null || typeof value.period === "string") &&
    (value.asOfDate === null || typeof value.asOfDate === "string") &&
    (value.numericValue === null || isFiniteNumber(value.numericValue)) &&
    (value.textValue === null || typeof value.textValue === "string") &&
    (value.unit === null || typeof value.unit === "string") &&
    (value.relatedIndicatorId === null ||
      typeof value.relatedIndicatorId === "string") &&
    (value.sourceId === null || typeof value.sourceId === "string") &&
    (value.sourcePage === null || isFiniteNumber(value.sourcePage)) &&
    typeof value.confidenceLabel === "string" &&
    isFiniteNumber(value.confidence) &&
    typeof value.confidenceReason === "string" &&
    typeof value.limitations === "string" &&
    value.affectsScore === false
  )
}

function isBonusDefinition(value: unknown) {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.definition === "string" &&
    typeof value.scoringRule === "string" &&
    isFiniteNumber(value.maxScore) &&
    typeof value.dataSource === "string" &&
    typeof value.basis === "string" &&
    value.affectsScore === false &&
    value.status === "definition-only"
  )
}

function isAssessmentResponse(
  value: unknown
): value is IndustryRiskAssessmentApiResponse {
  if (
    !isRecord(value) ||
    !isRecord(value.assessment) ||
    !isRecord(value.company) ||
    !isRecord(value.provenance)
  ) {
    return false
  }
  const assessment = value.assessment
  return (
    assessment.methodVersion === "IRAWC-MVP-2026.08-v2" &&
    typeof assessment.companyId === "string" &&
    typeof assessment.companyName === "string" &&
    typeof assessment.stockCode === "string" &&
    typeof assessment.reportingPeriod === "string" &&
    typeof assessment.sectorLabel === "string" &&
    isFiniteNumber(assessment.industryRisk) &&
    assessment.industryRiskStatus === "placeholder" &&
    Array.isArray(assessment.metrics) &&
    assessment.metrics.length === 5 &&
    assessment.metrics.every(isMetricScore) &&
    Array.isArray(assessment.candidateAggregates) &&
    assessment.candidateAggregates.length === 2 &&
    assessment.candidateAggregates.every(isCandidateAggregate) &&
    Number.isInteger(assessment.scoredIndicatorCount) &&
    Number.isInteger(assessment.totalIndicatorCount) &&
    assessment.isOfficialTotalScore === false &&
    value.company.id === assessment.companyId &&
    typeof value.company.shortName === "string" &&
    typeof value.company.chainSegment === "string" &&
    Array.isArray(value.sources) &&
    value.sources.every(
      (source) =>
        isRecord(source) &&
        typeof source.id === "string" &&
        typeof source.institution === "string" &&
        typeof source.title === "string" &&
        isSafeSourceUrl(source.url)
    ) &&
    isReportAvailability(value.reportAvailability) &&
    (value.reportAvailability === null ||
      (isRecord(value.reportAvailability) &&
        value.reportAvailability.companyId === assessment.companyId)) &&
    Array.isArray(value.supplementaryObservations) &&
    value.supplementaryObservations.every(
      (item) =>
        isSupplementaryObservation(item) &&
        isRecord(item) &&
        item.companyId === assessment.companyId
    ) &&
    Array.isArray(value.bonusDefinitions) &&
    value.bonusDefinitions.every(isBonusDefinition) &&
    typeof value.provenance.sourceAttribution === "string" &&
    typeof value.provenance.sourceDate === "string" &&
    typeof value.provenance.scopeNote === "string" &&
    value.provenance.methodStatus === "mvp-candidate"
  )
}

const graphNodeKinds = new Set([
  "sector",
  "segment",
  "company",
  "indicator",
  "source",
  "event",
  "artifact",
])
const graphEdgeKinds = new Set([
  "hierarchy",
  "coverage",
  "provenance",
  "event-link",
  "material",
])

function isKnowledgeGraph(value: unknown): value is IndustryRiskKnowledgeGraph {
  if (
    !isRecord(value) ||
    value.schemaVersion !== "KCR-INDUSTRY-GRAPH-2026.08-v1" ||
    !Array.isArray(value.nodes) ||
    !Array.isArray(value.edges) ||
    !isRecord(value.counts) ||
    typeof value.scopeNote !== "string"
  ) {
    return false
  }
  const nodeIds = new Set<string>()
  if (
    !value.nodes.every((node) => {
      if (
        !isRecord(node) ||
        typeof node.id !== "string" ||
        nodeIds.has(node.id) ||
        typeof node.entityId !== "string" ||
        typeof node.kind !== "string" ||
        !graphNodeKinds.has(node.kind) ||
        typeof node.label !== "string" ||
        typeof node.caption !== "string" ||
        (node.score !== null && !isFiniteNumber(node.score)) ||
        !Array.isArray(node.companyIds) ||
        !node.companyIds.every((id) => typeof id === "string")
      ) {
        return false
      }
      nodeIds.add(node.id)
      return true
    })
  ) {
    return false
  }
  const edgeIds = new Set<string>()
  if (
    !value.edges.every((edge) => {
      if (
        !isRecord(edge) ||
        typeof edge.id !== "string" ||
        edgeIds.has(edge.id) ||
        typeof edge.source !== "string" ||
        !nodeIds.has(edge.source) ||
        typeof edge.target !== "string" ||
        !nodeIds.has(edge.target) ||
        typeof edge.kind !== "string" ||
        !graphEdgeKinds.has(edge.kind) ||
        typeof edge.label !== "string" ||
        typeof edge.detail !== "string" ||
        !Array.isArray(edge.companyIds) ||
        !edge.companyIds.every((id) => typeof id === "string")
      ) {
        return false
      }
      edgeIds.add(edge.id)
      return true
    })
  ) {
    return false
  }
  return (
    value.counts.nodes === value.nodes.length &&
    value.counts.edges === value.edges.length &&
    Number.isInteger(value.counts.scoredCompanies) &&
    Number.isInteger(value.counts.evidenceOnlyCompanies) &&
    Number.isInteger(value.counts.indicators) &&
    Number.isInteger(value.counts.events) &&
    Number.isInteger(value.counts.artifacts)
  )
}

async function fetchPayload(
  path: string,
  options: { fetch?: typeof globalThis.fetch; signal?: AbortSignal }
) {
  const fetchImpl = options.fetch ?? globalThis.fetch
  const response = await fetchImpl(path, {
    method: "GET",
    headers: { accept: "application/json" },
    signal: options.signal,
  })
  let payload: unknown = null
  try {
    payload = await response.json()
  } catch {
    // The format error below is safer than exposing an HTML or proxy response.
  }
  if (!response.ok) {
    const error = isRecord(payload) ? (payload as ApiErrorPayload) : null
    throw new IndustryRiskApiError(
      typeof error?.error?.message === "string"
        ? error.error.message
        : "行业风险服务暂时不可用。",
      typeof error?.error?.code === "string"
        ? error.error.code
        : "INDUSTRY_RISK_FETCH_FAILED",
      response.status
    )
  }
  return { payload, status: response.status }
}

export async function fetchIndustryRiskCompanies(
  options: { fetch?: typeof globalThis.fetch; signal?: AbortSignal } = {}
) {
  const { payload, status } = await fetchPayload(
    INDUSTRY_RISK_COMPANIES_API_PATH,
    options
  )
  if (!isDirectoryResponse(payload)) {
    throw new IndustryRiskApiError(
      "行业样本目录响应格式不正确。",
      "INDUSTRY_RISK_RESPONSE_INVALID",
      status
    )
  }
  return payload
}

export async function fetchIndustryRiskAssessment(
  companyId: string,
  options: { fetch?: typeof globalThis.fetch; signal?: AbortSignal } = {}
) {
  const { payload, status } = await fetchPayload(
    getIndustryRiskCompanyAssessmentApiPath(companyId),
    options
  )
  if (!isAssessmentResponse(payload)) {
    throw new IndustryRiskApiError(
      "行业风险评估响应格式不正确。",
      "INDUSTRY_RISK_RESPONSE_INVALID",
      status
    )
  }
  return payload
}

export async function fetchIndustryRiskKnowledgeGraph(
  options: { fetch?: typeof globalThis.fetch; signal?: AbortSignal } = {}
) {
  const { payload, status } = await fetchPayload(
    INDUSTRY_RISK_GRAPH_API_PATH,
    options
  )
  if (!isKnowledgeGraph(payload)) {
    throw new IndustryRiskApiError(
      "行业风险图谱响应格式不正确。",
      "INDUSTRY_RISK_GRAPH_RESPONSE_INVALID",
      status
    )
  }
  return payload
}
