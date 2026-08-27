export const RISK_GRAPH_CONTRACT_VERSION = "KCR-RISK-GRAPH-2026.08-v1" as const

export const RISK_GRAPH_COMPANIES_API_PATH =
  "api/v1/risk-graphs/companies" as const

export const RISK_GRAPH_VIEWS = [
  "enterprise-event",
  "external-subject",
] as const

export type RiskGraphView = (typeof RISK_GRAPH_VIEWS)[number]

export type RiskGraphAvailabilityStatus =
  "available" | "unavailable" | "service-unavailable"

export type RiskGraphSourceMode =
  "audited-snapshot" | "structured-event-projection" | "none"

export type RiskGraphEvidenceState = "verified" | "inferred" | "predictive"

export interface RiskGraphViewCoverage {
  status: RiskGraphAvailabilityStatus
  sourceMode: RiskGraphSourceMode
  missingReason: string | null
}

export interface RiskGraphCompanyCoverage {
  companyId: string
  companyName: string
  stockCode: string
  eventCount: number
  views: Record<RiskGraphView, RiskGraphViewCoverage>
}

export interface RiskGraphCompanyDirectoryResponse {
  contractVersion: typeof RISK_GRAPH_CONTRACT_VERSION
  sampleSize: number
  availableEnterpriseEventCount: number
  availableExternalSubjectCount: number
  companies: RiskGraphCompanyCoverage[]
}

export interface RiskGraphNode {
  id: string
  label: string
  type: string
  typeLabel: string
  confidence: number | null
  evidenceState: RiskGraphEvidenceState
  attributes: Record<string, unknown>
}

export interface RiskGraphEdge {
  id: string
  source: string
  target: string
  relation: string
  relationCode: string
  confidence: number | null
  evidenceState: RiskGraphEvidenceState
  attributes: Record<string, unknown>
}

export interface RiskGraphResponse {
  contractVersion: typeof RISK_GRAPH_CONTRACT_VERSION
  company: {
    companyId: string
    companyName: string
    stockCode: string
  }
  view: RiskGraphView
  availability: RiskGraphViewCoverage
  snapshotId: string | null
  minWeight: number
  nodes: RiskGraphNode[]
  edges: RiskGraphEdge[]
  summary: {
    nodeCount: number
    edgeCount: number
    eventCount: number
    indicatorCount: number
    limitation: string
  }
}

export function getRiskGraphViewApiPath(
  companyId: string,
  view: RiskGraphView
) {
  return `${RISK_GRAPH_COMPANIES_API_PATH}/${encodeURIComponent(companyId)}/views/${view}`
}
