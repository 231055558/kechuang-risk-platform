export const NARRATIVE_RISK_COMPANIES_API_PATH =
  "api/v1/narrative-risk/companies" as const
export const NARRATIVE_RISK_AUDIT_SUMMARY_API_PATH =
  "api/v1/narrative-risk/audit-summary" as const
export const NARRATIVE_RISK_ANNUAL_TRENDS_API_PATH =
  "api/v1/narrative-risk/annual-trends" as const
export const NARRATIVE_RISK_ANNUAL_METHODOLOGY_API_PATH =
  "api/v1/narrative-risk/annual-trends/methodology" as const
export const NARRATIVE_RISK_ANNUAL_AUDIT_API_PATH =
  "api/v1/narrative-risk/annual-trends/audit" as const
export const NARRATIVE_RISK_INDUSTRY_TRENDS_API_PATH =
  "api/v1/narrative-risk/industry-trends" as const

export function getNarrativeRiskCompanyApiPath(companyKey: string) {
  return `${NARRATIVE_RISK_COMPANIES_API_PATH}/${encodeURIComponent(companyKey)}`
}

export function getNarrativeRiskCompanySourcesApiPath(companyKey: string) {
  return `${getNarrativeRiskCompanyApiPath(companyKey)}/sources`
}
