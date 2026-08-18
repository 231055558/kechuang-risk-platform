import {
  INDUSTRY_RISK_COMPANIES_API_PATH,
  getIndustryRiskCompanyAssessmentApiPath,
  type IndustryRiskAssessmentApiResponse,
  type IndustryRiskCompanyDirectoryResponse,
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
    value.methodVersion === "IRAWC-MVP-2026.08-v1" &&
    typeof value.dataVersion === "string" &&
    typeof value.reportingPeriod === "string" &&
    typeof value.sectorLabel === "string" &&
    Number.isInteger(value.sampleSize) &&
    Number.isInteger(value.scoreReadyIndicatorCount) &&
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
    (value.status === "scored" ||
      value.status === "missing" ||
      value.status === "not-score-ready") &&
    (value.direction === "higher-is-riskier" ||
      value.direction === "lower-is-riskier") &&
    typeof value.formulaTrace === "string" &&
    typeof value.limitation === "string"
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
    assessment.methodVersion === "IRAWC-MVP-2026.08-v1" &&
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
    typeof value.provenance.sourceAttribution === "string" &&
    typeof value.provenance.sourceDate === "string" &&
    typeof value.provenance.scopeNote === "string" &&
    value.provenance.methodStatus === "mvp-candidate"
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
