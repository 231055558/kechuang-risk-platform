export const INDUSTRY_RISK_DATA_SCHEMA_VERSION =
  "KCR-INDUSTRY-DATA-2026.08-v1" as const

export const INDUSTRY_RISK_INDICATOR_IDS = [
  "R01",
  "R02",
  "R03",
  "R04",
  "R05",
  "R06",
  "R07",
  "R08",
  "R09",
  "R10",
  "R11",
  "R12",
  "R13",
  "R14",
  "R15",
  "R16",
  "R17",
  "R18",
  "R19",
  "R20",
  "R21",
  "R22",
] as const

export const INDUSTRY_RISK_NARRATIVE_INDICATOR_IDS = [
  "R01",
  "R02",
  "R03",
  "R04",
] as const

export const INDUSTRY_RISK_WEIGHTED_INDICATOR_IDS = [
  "R05",
  "R06",
  "R07",
  "R08",
  "R09",
  "R10",
  "R11",
  "R12",
  "R13",
  "R14",
  "R15",
  "R16",
  "R17",
  "R18",
  "R19",
  "R20",
  "R21",
  "R22",
] as const

export type IndustryRiskIndicatorId =
  (typeof INDUSTRY_RISK_INDICATOR_IDS)[number]

export interface IndustryRiskDatasetMetadata {
  schemaVersion: typeof INDUSTRY_RISK_DATA_SCHEMA_VERSION
  dataVersion: string
  sourceDate: string
  reportingPeriod: string
  sectorLabel: string
  board: string
  sampleSize: number
  indicatorCount: number
  sourceAttribution: string
  scopeNote: string
  scoreReadyIndicatorIds: IndustryRiskIndicatorId[]
  peerGroups?: IndustryRiskPeerGroup[]
}

export interface IndustryRiskPeerGroup {
  id: string
  label: string
  reportingPeriod: string
  companyIds: string[]
  scoreReadyIndicatorIds: IndustryRiskIndicatorId[]
}

export interface IndustryRiskCompany {
  id: string
  sourceCompanyId: number
  stockCode: string
  shortName: string
  exchangeName: string
  fullName: string
  aliases: string[]
  chainSegment: string
  board: string
  exchange: string
  listDate: string | null
  industry: string
  selectionReason: string
  sourceUrl: string | null
  confidenceLabel: string
  confidence: number
  peerGroupId?: string
}

export interface IndustryRiskIndicator {
  id: IndustryRiskIndicatorId
  kind: "narrative-validation" | "weighted"
  primaryCategory: string
  label: string
  definition: string
  rawValueFormula: string
  updateFrequency: string
  academicSource: string
  entityType: string
  relation: string
  sourceRow: number
}

export type IndustryRiskRedistribution =
  "public-link-only" | "licensed-derived" | "manual"

export interface IndustryRiskSource {
  id: string
  sourceType: string
  institution: string
  title: string
  publicationDate: string | null
  url: string | null
  accessedAt: string | null
  notes: string
  redistribution: IndustryRiskRedistribution
  peerGroupId?: string
}

export interface IndustryRiskObservation {
  id: string
  companyId: string
  indicatorId: IndustryRiskIndicatorId
  metricName: string
  periodStart: string | null
  periodEnd: string | null
  asOfDate: string | null
  numericValue: number | null
  textValue: string | null
  unit: string | null
  status: string
  derived: boolean
  formula: string | null
  sourceId: string
  sourcePage: number | null
  confidenceLabel: string
  confidence: number
  confidenceReason: string
  limitations: string
  sourceIds?: string[]
}

export interface IndustryRiskCoverage {
  companyId: string
  indicatorId: IndustryRiskIndicatorId
  status: string
  usableForScoring: boolean
  confidenceLabel: string
  confidence: number
  reason: string
  recommendedNextSource: string
}

export interface IndustryRiskScreeningHit {
  id: string
  companyId: string
  sourceList: string
  listedName: string
  alternativeNames: string
  startDate: string | null
  noticeUrl: string | null
  sourceListUrl: string | null
  sourceInformationUrl: string | null
  matchScope: string
  confidenceLabel: string
  confidence: number
  confidenceReason: string
}

export interface IndustryRiskInquiryEvidence {
  id: string
  companyId: string
  announcementDate: string | null
  title: string
  url: string | null
  topicKey: string
  countedAsInquiry: boolean
  confidenceLabel: string
  confidence: number
  notes: string
}

export interface IndustryRiskLitigationEvidence {
  id: string
  companyId: string
  cause: string
  court: string
  hearingTime: string | null
  role: string
  sourceUrl: string | null
  confidenceLabel: string
  confidence: number
  limitations: string
  redistribution: "licensed-derived"
}

export interface IndustryRiskSupplementaryObservation {
  id: string
  companyId: string
  factName: string
  period: string | null
  asOfDate: string | null
  numericValue: number | null
  textValue: string | null
  unit: string | null
  relatedIndicatorId: IndustryRiskIndicatorId | null
  sourceId: string | null
  sourcePage: number | null
  confidenceLabel: string
  confidence: number
  confidenceReason: string
  limitations: string
  affectsScore?: false
}

export interface IndustryRiskDeepSearchEvent {
  id: string
  companyId: string
  eventType: string
  eventDate: string | null
  title: string
  url: string | null
  sourceChannel: string
  confidenceLabel: string
  confidence: number
  relatedIndicatorId: IndustryRiskIndicatorId | null
  notes: string
}

export interface IndustryRiskNarrativeNewsEvidence {
  id: string
  companyId: string
  publishedAt: string | null
  title: string
  summary: string
  mediaName: string
  url: string
  positive: boolean
  negative: boolean
  concept: boolean
  conceptKeywords: string[]
  sourceId: string
  accessedAt: string | null
}

export interface IndustryRiskNarrativeNewsMetric {
  companyId: string
  cutoffDate: string
  newestDate: string | null
  oldestDate: string | null
  hitsTotal: number | null
  retrievedCount: number
  mediaCount: number
  positiveCount: number
  negativeCount: number
  conceptCount: number
  positiveSharePercent: number
  negativeSharePercent: number
  toneBalancePercent: number
  conceptSharePercent: number
  pagesFetched: number
  truncated: boolean
  sourceId: string
  limitations: string
}

export interface IndustryRiskReportAvailability {
  companyId: string
  annual2025Status: string
  latestPeriod: string | null
  latestReportDate: string | null
  latestReportTitle: string | null
  latestReportUrl: string | null
  notes: string
}

export interface IndustryRiskBonusDefinition {
  id: string
  name: string
  definition: string
  scoringRule: string
  maxScore: number
  dataSource: string
  basis: string
  affectsScore: false
  status: "definition-only"
}

export type IndustryRiskEventKind =
  "deep-search" | "screening-hit" | "exchange-inquiry" | "litigation"

export interface IndustryRiskEvent {
  id: string
  companyId: string
  kind: IndustryRiskEventKind
  eventType: string
  date: string | null
  title: string
  url: string | null
  indicatorId: IndustryRiskIndicatorId | null
  confidenceLabel: string
  confidence: number
  notes: string
}

export interface IndustryRiskDataset {
  metadata: IndustryRiskDatasetMetadata
  companies: IndustryRiskCompany[]
  indicators: IndustryRiskIndicator[]
  sources: IndustryRiskSource[]
  observations: IndustryRiskObservation[]
  coverage: IndustryRiskCoverage[]
  screeningHits: IndustryRiskScreeningHit[]
  inquiryEvidence: IndustryRiskInquiryEvidence[]
  litigationEvidence: IndustryRiskLitigationEvidence[]
  supplementaryObservations: IndustryRiskSupplementaryObservation[]
  deepSearchEvents: IndustryRiskDeepSearchEvent[]
  narrativeNewsEvidence?: IndustryRiskNarrativeNewsEvidence[]
  narrativeNewsMetrics?: IndustryRiskNarrativeNewsMetric[]
  reportAvailability: IndustryRiskReportAvailability[]
  bonusDefinitions: IndustryRiskBonusDefinition[]
}
