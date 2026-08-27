import {
  NARRATIVE_RISK_SCHEMA_VERSION,
  type NarrativeRiskAuditSummaryResponse,
  type NarrativeAnnualAuditResponse,
  type NarrativeAnnualMethodologyResponse,
  type NarrativeAnnualTrendResponse,
  type NarrativeIndustryTrendResponse,
  type NarrativeRiskCompanyDirectoryResponse,
  type NarrativeRiskCompanyResponse,
  type NarrativeRiskEnvelope,
  type NarrativeRiskSourcePageResponse,
} from "./model.ts"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function isNarrativeIndustryTrendResponse(
  value: unknown
): value is NarrativeIndustryTrendResponse {
  return (
    isEnvelope(value) &&
    Array.isArray(value.companies) &&
    value.companies.every(
      (item) =>
        isRecord(item) &&
        typeof item.companyId === "string" &&
        typeof item.companyName === "string" &&
        typeof item.industryGroupId === "string" &&
        Array.isArray(item.includedYears)
    ) &&
    Array.isArray(value.industryGroups) &&
    Array.isArray(value.methodology) &&
    value.methodology.length === 3 &&
    Array.isArray(value.documents) &&
    Array.isArray(value.observations) &&
    value.observations.every(
      (item) =>
        isRecord(item) &&
        typeof item.companyId === "string" &&
        Number.isInteger(item.year) &&
        typeof item.metricKey === "string" &&
        (item.value === null || typeof item.value === "number")
    ) &&
    Array.isArray(value.industryStatistics) &&
    value.industryStatistics.every(
      (item) =>
        isRecord(item) &&
        typeof item.industryGroupId === "string" &&
        Number.isInteger(item.year) &&
        typeof item.metricKey === "string" &&
        Number.isInteger(item.sampleSize)
    ) &&
    isRecord(value.audit)
  )
}

function isEnvelope(
  value: unknown
): value is Record<string, unknown> & NarrativeRiskEnvelope {
  return (
    isRecord(value) &&
    value.schemaVersion === NARRATIVE_RISK_SCHEMA_VERSION &&
    typeof value.dataVersion === "string" &&
    typeof value.asOfDate === "string" &&
    (value.sourceMode === "postgres" || value.sourceMode === "snapshot")
  )
}

export function isNarrativeRiskDirectoryResponse(
  value: unknown
): value is NarrativeRiskCompanyDirectoryResponse {
  return (
    isEnvelope(value) &&
    Array.isArray(value.scopes) &&
    Array.isArray(value.companies) &&
    value.companies.every(
      (item) =>
        isRecord(item) &&
        typeof item.companyKey === "string" &&
        typeof item.shortName === "string" &&
        Array.isArray(item.scopeIds)
    ) &&
    isRecord(value.counts)
  )
}

export function isNarrativeRiskCompanyResponse(
  value: unknown
): value is NarrativeRiskCompanyResponse {
  return (
    isEnvelope(value) &&
    isRecord(value.company) &&
    typeof value.company.companyKey === "string" &&
    Array.isArray(value.assessments) &&
    Array.isArray(value.metrics) &&
    Array.isArray(value.coverage) &&
    Array.isArray(value.events) &&
    Array.isArray(value.auditFindings) &&
    isRecord(value.counts)
  )
}

export function isNarrativeRiskSourcePageResponse(
  value: unknown
): value is NarrativeRiskSourcePageResponse {
  return (
    isEnvelope(value) &&
    typeof value.companyKey === "string" &&
    Number.isInteger(value.page) &&
    Number.isInteger(value.pageSize) &&
    Number.isInteger(value.total) &&
    Array.isArray(value.items)
  )
}

export function isNarrativeRiskAuditSummaryResponse(
  value: unknown
): value is NarrativeRiskAuditSummaryResponse {
  return isEnvelope(value) && isRecord(value.counts)
}

export function isNarrativeAnnualTrendResponse(
  value: unknown
): value is NarrativeAnnualTrendResponse {
  return (
    isEnvelope(value) &&
    typeof value.methodVersion === "string" &&
    Array.isArray(value.companies) &&
    value.companies.every(
      (item) =>
        isRecord(item) &&
        typeof item.companyKey === "string" &&
        typeof item.companyName === "string" &&
        Array.isArray(item.includedYears)
    ) &&
    Array.isArray(value.observations) &&
    value.observations.every(
      (item) =>
        isRecord(item) &&
        typeof item.companyKey === "string" &&
        Number.isInteger(item.year) &&
        typeof item.metricKey === "string" &&
        (item.value === null || typeof item.value === "number") &&
        (item.changeRate === null || typeof item.changeRate === "number") &&
        (item.riskScore === null ||
          (typeof item.riskScore === "number" &&
            item.riskScore >= 0 &&
            item.riskScore <= 100)) &&
        (item.riskScoreChange === null ||
          typeof item.riskScoreChange === "number") &&
        (item.status === "已计算" || item.status === "缺失")
    )
  )
}

export function isNarrativeAnnualMethodologyResponse(
  value: unknown
): value is NarrativeAnnualMethodologyResponse {
  return (
    isEnvelope(value) &&
    isRecord(value.methodVersion) &&
    typeof value.methodVersion.methodVersion === "string" &&
    Array.isArray(value.methodology) &&
    value.methodology.every(
      (item) =>
        isRecord(item) &&
        typeof item.metricKey === "string" &&
        typeof item.name === "string" &&
        typeof item.formula === "string" &&
        isRecord(item.riskMapping) &&
        typeof item.riskMapping.formula === "string" &&
        Array.isArray(item.riskMapping.parameters)
    )
  )
}

export function isNarrativeAnnualAuditResponse(
  value: unknown
): value is NarrativeAnnualAuditResponse {
  return (
    isEnvelope(value) &&
    typeof value.methodVersion === "string" &&
    Array.isArray(value.documents) &&
    value.documents.every(
      (item) =>
        isRecord(item) &&
        typeof item.documentId === "string" &&
        typeof item.companyKey === "string" &&
        Number.isInteger(item.year) &&
        typeof item.officialUrl === "string"
    ) &&
    Array.isArray(value.peerBenchmarks) &&
    Array.isArray(value.toneAudits) &&
    isRecord(value.audit)
  )
}
