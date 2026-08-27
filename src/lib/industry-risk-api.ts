import {
  INDUSTRY_RISK_INVESTOR_CONTRACT_VERSION,
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
    (value.status === "usable-benchmark" ||
      value.status === "partial-candidate" ||
      value.status === "unavailable") &&
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
    typeof value.peerGroupId === "string" &&
    typeof value.peerGroupLabel === "string" &&
    typeof value.benchmarkGroupId === "string" &&
    typeof value.benchmarkGroupLabel === "string" &&
    Number.isInteger(value.benchmarkSampleSize) &&
    (value.totalRiskScore === null || isFiniteNumber(value.totalRiskScore)) &&
    (value.financialNarrativeStatus === "data-pending" ||
      value.financialNarrativeStatus === "partially-assessable" ||
      value.financialNarrativeStatus === "assessed") &&
    isFiniteNumber(value.weightedDataCoverage) &&
    Number.isInteger(value.scoredIndicatorCount) &&
    Number.isInteger(value.totalIndicatorCount) &&
    Number.isInteger(value.coveredIndicatorCount) &&
    Number.isInteger(value.eventCount) &&
    Array.isArray(value.candidateAggregates) &&
    value.candidateAggregates.length === 2 &&
    value.candidateAggregates.every(isCandidateAggregate) &&
    Array.isArray(value.indicatorHeat) &&
    value.indicatorHeat.length === 18 &&
    value.indicatorHeat.every(
      (metric) =>
        isRecord(metric) &&
        typeof metric.indicatorId === "string" &&
        (metric.riskPercentile === null ||
          isFiniteNumber(metric.riskPercentile)) &&
        (metric.riskScore === null || isFiniteNumber(metric.riskScore)) &&
        Number.isInteger(metric.sampleSize) &&
        (metric.status === "scored" || metric.status === "missing")
    )
  )
}

function isPeerGroup(value: unknown) {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.label === "string" &&
    typeof value.reportingPeriod === "string" &&
    Array.isArray(value.companyIds) &&
    value.companyIds.every((id) => typeof id === "string") &&
    Array.isArray(value.scoreReadyIndicatorIds) &&
    value.scoreReadyIndicatorIds.every((id) => typeof id === "string")
  )
}

function isDirectoryResponse(
  value: unknown
): value is IndustryRiskCompanyDirectoryResponse {
  return (
    isRecord(value) &&
    value.contractVersion === INDUSTRY_RISK_INVESTOR_CONTRACT_VERSION &&
    value.schemaVersion === "KCR-INDUSTRY-DATA-2026.08-v1" &&
    value.methodVersion === "IRAWC-CRITIC-2026.08-v2" &&
    typeof value.dataVersion === "string" &&
    typeof value.reportingPeriod === "string" &&
    typeof value.sectorLabel === "string" &&
    Number.isInteger(value.sampleSize) &&
    Number.isInteger(value.scoreReadyIndicatorCount) &&
    value.industryRiskStatus === "fixed-anchor" &&
    Array.isArray(value.peerGroups) &&
    value.peerGroups.every(isPeerGroup) &&
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
    (value.centeredRiskScore === null ||
      isFiniteNumber(value.centeredRiskScore)) &&
    Number.isInteger(value.sampleSize) &&
    (value.sourceId === null || typeof value.sourceId === "string") &&
    Array.isArray(value.sourceIds) &&
    value.sourceIds.every((sourceId) => typeof sourceId === "string") &&
    (value.status === "scored" ||
      value.status === "missing" ||
      value.status === "not-score-ready") &&
    (value.direction === "higher-is-riskier" ||
      value.direction === "lower-is-riskier") &&
    (value.kind === "narrative" || value.kind === "weighted") &&
    (value.dimensionId === null || typeof value.dimensionId === "string") &&
    typeof value.formulaTrace === "string" &&
    typeof value.limitation === "string" &&
    (value.missingReason === null || typeof value.missingReason === "string")
  )
}

function isFinancialNarrativeDimension(value: unknown) {
  return (
    isRecord(value) &&
    (value.id === "management-tone" ||
      value.id === "innovation-talk-action-gap" ||
      value.id === "effective-information-uncertainty") &&
    typeof value.label === "string" &&
    typeof value.description === "string" &&
    (value.score === null || isFiniteNumber(value.score)) &&
    (value.status === "data-pending" || value.status === "assessable") &&
    (value.missingReason === null || typeof value.missingReason === "string")
  )
}

function isFinancialReportNarrativeRisk(value: unknown) {
  return (
    isRecord(value) &&
    value.methodVersion === "KCR-FINANCIAL-NARRATIVE-2026.08-v1" &&
    value.corpus === "annual-report" &&
    (value.status === "data-pending" ||
      value.status === "partially-assessable" ||
      value.status === "assessed") &&
    (value.score === null || isFiniteNumber(value.score)) &&
    Array.isArray(value.dimensions) &&
    value.dimensions.length === 3 &&
    value.dimensions.every(isFinancialNarrativeDimension) &&
    value.newsExcludedFromScore === true &&
    value.affectsObjectiveScore === false &&
    typeof value.note === "string"
  )
}

function isNarrativeNews(value: unknown) {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.companyId === "string" &&
    (value.publishedAt === null || typeof value.publishedAt === "string") &&
    typeof value.title === "string" &&
    typeof value.summary === "string" &&
    typeof value.mediaName === "string" &&
    isSafeSourceUrl(value.url) &&
    typeof value.positive === "boolean" &&
    typeof value.negative === "boolean" &&
    typeof value.concept === "boolean" &&
    Array.isArray(value.conceptKeywords) &&
    value.conceptKeywords.every((keyword) => typeof keyword === "string") &&
    typeof value.sourceId === "string"
  )
}

function isNarrativeNewsMetric(value: unknown) {
  return (
    isRecord(value) &&
    typeof value.companyId === "string" &&
    typeof value.cutoffDate === "string" &&
    Number.isInteger(value.retrievedCount) &&
    Number.isInteger(value.mediaCount) &&
    Number.isInteger(value.positiveCount) &&
    Number.isInteger(value.negativeCount) &&
    Number.isInteger(value.conceptCount) &&
    isFiniteNumber(value.positiveSharePercent) &&
    isFiniteNumber(value.negativeSharePercent) &&
    isFiniteNumber(value.toneBalancePercent) &&
    isFiniteNumber(value.conceptSharePercent) &&
    Number.isInteger(value.pagesFetched) &&
    typeof value.truncated === "boolean" &&
    typeof value.sourceId === "string" &&
    typeof value.limitations === "string"
  )
}

function isDimensionScore(value: unknown) {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.label === "string" &&
    (value.score === null || isFiniteNumber(value.score)) &&
    isFiniteNumber(value.weight) &&
    Number.isInteger(value.availableIndicatorCount) &&
    Number.isInteger(value.totalIndicatorCount) &&
    Array.isArray(value.indicatorIds) &&
    value.indicatorIds.every(
      (indicatorId) => typeof indicatorId === "string"
    ) &&
    isRecord(value.indicatorWeights) &&
    (value.status === "scored" || value.status === "missing")
  )
}

function isAssessmentResponse(
  value: unknown
): value is IndustryRiskAssessmentApiResponse {
  if (
    !isRecord(value) ||
    !isRecord(value.assessment) ||
    !isRecord(value.company) ||
    !isRecord(value.contract) ||
    !isRecord(value.provenance)
  ) {
    return false
  }
  const assessment = value.assessment
  return (
    value.contract.version === INDUSTRY_RISK_INVESTOR_CONTRACT_VERSION &&
    value.contract.audience === "investor" &&
    value.contract.newsUsage === "information-only" &&
    value.contract.financialNarrativeCorpus === "annual-report-only" &&
    value.contract.financialNarrativeScoreStatus ===
      "structure-ready-data-pending" &&
    value.contract.missingValue === "null-with-reason" &&
    value.contract.heatEncoding === "peer-risk-percentile" &&
    value.contract.recommendationScope ===
      "risk-research-not-trade-instruction" &&
    value.contract.graphContract === "external-temporal-graph-pending" &&
    assessment.methodVersion === "IRAWC-CRITIC-2026.08-v2" &&
    typeof assessment.companyId === "string" &&
    typeof assessment.companyName === "string" &&
    typeof assessment.stockCode === "string" &&
    typeof assessment.peerGroupId === "string" &&
    typeof assessment.benchmarkGroupId === "string" &&
    typeof assessment.benchmarkGroupLabel === "string" &&
    Number.isInteger(assessment.benchmarkSampleSize) &&
    typeof assessment.reportingPeriod === "string" &&
    typeof assessment.sectorLabel === "string" &&
    isFiniteNumber(assessment.industryRisk) &&
    assessment.industryRiskStatus === "fixed-anchor" &&
    isFiniteNumber(assessment.alpha) &&
    isFiniteNumber(assessment.beta) &&
    Array.isArray(assessment.metrics) &&
    assessment.metrics.length === 22 &&
    assessment.metrics.every(isMetricScore) &&
    isFinancialReportNarrativeRisk(assessment.financialReportNarrativeRisk) &&
    Array.isArray(assessment.dimensionScores) &&
    assessment.dimensionScores.length === 5 &&
    assessment.dimensionScores.every(isDimensionScore) &&
    (assessment.totalRiskScore === null ||
      isFiniteNumber(assessment.totalRiskScore)) &&
    (assessment.totalRiskStatus === "usable-benchmark" ||
      assessment.totalRiskStatus === "unavailable") &&
    isFiniteNumber(assessment.weightedDataCoverage) &&
    Array.isArray(assessment.candidateAggregates) &&
    assessment.candidateAggregates.length === 2 &&
    assessment.candidateAggregates.every(isCandidateAggregate) &&
    Number.isInteger(assessment.scoredIndicatorCount) &&
    Number.isInteger(assessment.weightedScoredIndicatorCount) &&
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
    Array.isArray(value.indicators) &&
    value.indicators.length === 22 &&
    value.indicators.every(
      (indicator) =>
        isRecord(indicator) &&
        typeof indicator.id === "string" &&
        typeof indicator.label === "string"
    ) &&
    Array.isArray(value.observations) &&
    value.observations.every(
      (observation) =>
        isRecord(observation) &&
        typeof observation.id === "string" &&
        typeof observation.indicatorId === "string" &&
        typeof observation.metricName === "string"
    ) &&
    Array.isArray(value.coverage) &&
    value.coverage.length === 22 &&
    value.coverage.every(
      (item) =>
        isRecord(item) &&
        typeof item.indicatorId === "string" &&
        typeof item.status === "string"
    ) &&
    Array.isArray(value.events) &&
    value.events.every(
      (event) =>
        isRecord(event) &&
        typeof event.id === "string" &&
        typeof event.eventType === "string" &&
        typeof event.title === "string" &&
        isSafeSourceUrl(event.url)
    ) &&
    Array.isArray(value.narrativeNews) &&
    value.narrativeNews.every(isNarrativeNews) &&
    (value.narrativeNewsMetric === null ||
      isNarrativeNewsMetric(value.narrativeNewsMetric)) &&
    Array.isArray(value.supplementaryObservations) &&
    (value.reportAvailability === null ||
      (isRecord(value.reportAvailability) &&
        isSafeSourceUrl(value.reportAvailability.latestReportUrl))) &&
    typeof value.provenance.sourceAttribution === "string" &&
    typeof value.provenance.sourceDate === "string" &&
    typeof value.provenance.scopeNote === "string" &&
    value.provenance.methodStatus === "usable-benchmark"
  )
}

const graphNodeKinds = new Set([
  "company",
  "category",
  "indicator",
  "source",
  "event",
])
const graphEdgeKinds = new Set(["hierarchy", "provenance", "event-link"])

function isKnowledgeGraph(value: unknown): value is IndustryRiskKnowledgeGraph {
  if (
    !isRecord(value) ||
    value.schemaVersion !== "KCR-INDUSTRY-GRAPH-2026.08-v2" ||
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
        !isRecord(node.scoresByCompany) ||
        !Object.values(node.scoresByCompany).every(isFiniteNumber) ||
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
    Number.isInteger(value.counts.companies) &&
    Number.isInteger(value.counts.categories) &&
    Number.isInteger(value.counts.indicators) &&
    Number.isInteger(value.counts.sources) &&
    Number.isInteger(value.counts.events)
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
