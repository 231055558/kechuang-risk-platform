import type {
  IndustryRiskBonusDefinition,
  IndustryRiskCompany,
  IndustryRiskDatasetMetadata,
  IndustryRiskReportAvailability,
  IndustryRiskSource,
  IndustryRiskSupplementaryObservation,
} from "./model.ts"
import type {
  IndustryRiskCandidateAggregate,
  IndustryRiskCompanyAssessment,
} from "./scoring-engine.ts"

export const INDUSTRY_RISK_COMPANIES_API_PATH =
  "api/v1/industry-risk/companies" as const
export const INDUSTRY_RISK_GRAPH_API_PATH =
  "api/v1/industry-risk/graph" as const

export interface IndustryRiskCompanySummary {
  companyId: string
  companyName: string
  stockCode: string
  chainSegment: string
  scoredIndicatorCount: number
  totalIndicatorCount: number
  candidateAggregates: IndustryRiskCandidateAggregate[]
}

export interface IndustryRiskCompanyDirectoryResponse {
  schemaVersion: IndustryRiskDatasetMetadata["schemaVersion"]
  methodVersion: IndustryRiskCompanyAssessment["methodVersion"]
  dataVersion: string
  reportingPeriod: string
  sectorLabel: string
  sampleSize: number
  scoreReadyIndicatorCount: number
  candidateAggregateCompanyCount: number
  industryRiskStatus: "placeholder"
  companies: IndustryRiskCompanySummary[]
}

export interface IndustryRiskAssessmentApiResponse {
  assessment: IndustryRiskCompanyAssessment
  company: IndustryRiskCompany
  sources: IndustryRiskSource[]
  reportAvailability: IndustryRiskReportAvailability | null
  supplementaryObservations: IndustryRiskSupplementaryObservation[]
  bonusDefinitions: IndustryRiskBonusDefinition[]
  provenance: {
    sourceAttribution: string
    sourceDate: string
    scopeNote: string
    methodStatus: "mvp-candidate"
  }
}

export function getIndustryRiskCompanyAssessmentApiPath(companyId: string) {
  return `${INDUSTRY_RISK_COMPANIES_API_PATH}/${encodeURIComponent(companyId)}/assessment`
}
