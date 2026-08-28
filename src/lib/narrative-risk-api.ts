import {
  NARRATIVE_RISK_AUDIT_SUMMARY_API_PATH,
  NARRATIVE_RISK_ANNUAL_AUDIT_API_PATH,
  NARRATIVE_RISK_ANNUAL_METHODOLOGY_API_PATH,
  NARRATIVE_RISK_ANNUAL_TRENDS_API_PATH,
  NARRATIVE_RISK_COMPANIES_API_PATH,
  NARRATIVE_RISK_INDUSTRY_TRENDS_API_PATH,
  getNarrativeRiskCompanyApiPath,
  getNarrativeRiskCompanySourcesApiPath,
  isNarrativeRiskAuditSummaryResponse,
  isNarrativeAnnualAuditResponse,
  isNarrativeAnnualMethodologyResponse,
  isNarrativeAnnualTrendResponse,
  isNarrativeIndustryTrendResponse,
  isNarrativeRiskCompanyResponse,
  isNarrativeRiskDirectoryResponse,
  isNarrativeRiskSourcePageResponse,
  type NarrativeRiskAuditSummaryResponse,
  type NarrativeAnnualAuditResponse,
  type NarrativeAnnualMethodologyResponse,
  type NarrativeAnnualTrendResponse,
  type NarrativeIndustryTrendResponse,
  type NarrativeRiskCompanyDirectoryResponse,
  type NarrativeRiskCompanyResponse,
  type NarrativeRiskSourcePageResponse,
} from "@/domain/narrative-risk-v1"

interface ApiErrorPayload {
  error?: { code?: unknown; message?: unknown }
}

export class NarrativeRiskApiError extends Error {
  readonly status: number | null
  readonly code: string

  constructor(message: string, code: string, status: number | null) {
    super(message)
    this.name = "NarrativeRiskApiError"
    this.status = status
    this.code = code
  }
}

async function readJson(response: Response) {
  try {
    return (await response.json()) as unknown
  } catch {
    throw new NarrativeRiskApiError(
      "叙事风险服务返回了无法解析的响应。",
      "NARRATIVE_RISK_INVALID_RESPONSE",
      response.status
    )
  }
}

async function request<T>(
  path: string,
  validate: (value: unknown) => value is T
): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${import.meta.env.BASE_URL}${path}`, {
      headers: { accept: "application/json" },
    })
  } catch {
    throw new NarrativeRiskApiError(
      "无法连接叙事风险服务。",
      "NARRATIVE_RISK_NETWORK_ERROR",
      null
    )
  }
  const payload = await readJson(response)
  if (!response.ok) {
    const candidate = payload as ApiErrorPayload
    throw new NarrativeRiskApiError(
      typeof candidate.error?.message === "string"
        ? candidate.error.message
        : "叙事风险查询失败。",
      typeof candidate.error?.code === "string"
        ? candidate.error.code
        : "NARRATIVE_RISK_REQUEST_FAILED",
      response.status
    )
  }
  if (!validate(payload)) {
    throw new NarrativeRiskApiError(
      "叙事风险服务响应未通过运行时校验。",
      "NARRATIVE_RISK_SCHEMA_MISMATCH",
      response.status
    )
  }
  return payload
}

export function listNarrativeRiskCompanies(): Promise<NarrativeRiskCompanyDirectoryResponse> {
  return request(
    NARRATIVE_RISK_COMPANIES_API_PATH,
    isNarrativeRiskDirectoryResponse
  )
}

export function getNarrativeRiskCompany(
  companyKey: string
): Promise<NarrativeRiskCompanyResponse> {
  return request(
    getNarrativeRiskCompanyApiPath(companyKey),
    isNarrativeRiskCompanyResponse
  )
}

export interface NarrativeRiskSourceQuery {
  scopeId?: string
  channel?: string
  validationStatus?: string
  page?: number
  pageSize?: number
}

export function listNarrativeRiskSources(
  companyKey: string,
  query: NarrativeRiskSourceQuery = {}
): Promise<NarrativeRiskSourcePageResponse> {
  const search = new URLSearchParams()
  if (query.scopeId) search.set("scopeId", query.scopeId)
  if (query.channel) search.set("channel", query.channel)
  if (query.validationStatus)
    search.set("validationStatus", query.validationStatus)
  if (query.page) search.set("page", String(query.page))
  if (query.pageSize) search.set("pageSize", String(query.pageSize))
  const suffix = search.size > 0 ? `?${search}` : ""
  return request(
    `${getNarrativeRiskCompanySourcesApiPath(companyKey)}${suffix}`,
    isNarrativeRiskSourcePageResponse
  )
}

export function getNarrativeRiskAuditSummary(): Promise<NarrativeRiskAuditSummaryResponse> {
  return request(
    NARRATIVE_RISK_AUDIT_SUMMARY_API_PATH,
    isNarrativeRiskAuditSummaryResponse
  )
}

export function getNarrativeAnnualTrends(): Promise<NarrativeAnnualTrendResponse> {
  return request(
    NARRATIVE_RISK_ANNUAL_TRENDS_API_PATH,
    isNarrativeAnnualTrendResponse
  )
}

export function getNarrativeAnnualMethodology(): Promise<NarrativeAnnualMethodologyResponse> {
  return request(
    NARRATIVE_RISK_ANNUAL_METHODOLOGY_API_PATH,
    isNarrativeAnnualMethodologyResponse
  )
}

export function getNarrativeAnnualAudit(): Promise<NarrativeAnnualAuditResponse> {
  return request(
    NARRATIVE_RISK_ANNUAL_AUDIT_API_PATH,
    isNarrativeAnnualAuditResponse
  )
}

export function getNarrativeIndustryTrends(): Promise<NarrativeIndustryTrendResponse> {
  return request(
    NARRATIVE_RISK_INDUSTRY_TRENDS_API_PATH,
    isNarrativeIndustryTrendResponse
  )
}
