import type {
  IndustryRiskCompany,
  IndustryRiskCoverage,
  IndustryRiskDatasetMetadata,
  IndustryRiskEvent,
  IndustryRiskIndicator,
  IndustryRiskObservation,
  IndustryRiskPeerGroup,
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
  peerGroupId: string
  peerGroupLabel: string
  benchmarkGroupId: string
  benchmarkGroupLabel: string
  benchmarkSampleSize: number
  totalRiskScore: number | null
  narrativeRiskIndex: number | null
  weightedDataCoverage: number
  scoredIndicatorCount: number
  totalIndicatorCount: number
  coveredIndicatorCount: number
  eventCount: number
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
  industryRiskStatus: "fixed-anchor"
  peerGroups: IndustryRiskPeerGroup[]
  companies: IndustryRiskCompanySummary[]
}

export interface IndustryRiskAssessmentApiResponse {
  assessment: IndustryRiskCompanyAssessment
  company: IndustryRiskCompany
  sources: IndustryRiskSource[]
  indicators: IndustryRiskIndicator[]
  observations: IndustryRiskObservation[]
  coverage: IndustryRiskCoverage[]
  events: IndustryRiskEvent[]
  supplementaryObservations: IndustryRiskSupplementaryObservation[]
  reportAvailability: IndustryRiskReportAvailability | null
  provenance: {
    sourceAttribution: string
    sourceDate: string
    scopeNote: string
    methodStatus: "usable-benchmark"
  }
}

export function getIndustryRiskCompanyAssessmentApiPath(companyId: string) {
  return `${INDUSTRY_RISK_COMPANIES_API_PATH}/${encodeURIComponent(companyId)}/assessment`
}
