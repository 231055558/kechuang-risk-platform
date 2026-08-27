import type {
  IndustryRiskCompany,
  IndustryRiskCoverage,
  IndustryRiskDatasetMetadata,
  IndustryRiskEvent,
  IndustryRiskIndicator,
  IndustryRiskNarrativeNewsEvidence,
  IndustryRiskNarrativeNewsMetric,
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
import type { IndustryRiskInvestorContract } from "./investor-contract.ts"

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
  financialNarrativeStatus: IndustryRiskCompanyAssessment["financialReportNarrativeRisk"]["status"]
  weightedDataCoverage: number
  scoredIndicatorCount: number
  totalIndicatorCount: number
  coveredIndicatorCount: number
  eventCount: number
  candidateAggregates: IndustryRiskCandidateAggregate[]
  indicatorHeat: Array<
    Pick<
      IndustryRiskCompanyAssessment["metrics"][number],
      "indicatorId" | "riskPercentile" | "riskScore" | "sampleSize" | "status"
    >
  >
}

export interface IndustryRiskCompanyDirectoryResponse {
  contractVersion: IndustryRiskInvestorContract["version"]
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
  contract: IndustryRiskInvestorContract
  assessment: IndustryRiskCompanyAssessment
  company: IndustryRiskCompany
  sources: IndustryRiskSource[]
  indicators: IndustryRiskIndicator[]
  observations: IndustryRiskObservation[]
  coverage: IndustryRiskCoverage[]
  events: IndustryRiskEvent[]
  narrativeNews: IndustryRiskNarrativeNewsEvidence[]
  narrativeNewsMetric: IndustryRiskNarrativeNewsMetric | null
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
