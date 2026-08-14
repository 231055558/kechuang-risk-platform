export const KCR_DATA_SCHEMA_VERSION = "KCR-DATA-2026.08-v1" as const
export const KCR_METHOD_VERSION = "KCR-2026.08-v1" as const

export const KCR_WEIGHTED_INDICATOR_IDS = [
  "T01",
  "T02",
  "T03",
  "T04",
  "T05",
  "C01",
  "C02",
  "C03",
  "F01",
  "F02",
  "F03",
  "F04",
  "E01",
  "E02",
  "E03",
  "P01",
  "P02",
  "P03",
] as const

export const KCR_NARRATIVE_INDICATOR_IDS = ["N01", "N02", "N03", "N04"] as const

export const KCR_INDICATOR_WEIGHTS = {
  T01: 4,
  T02: 5,
  T03: 6,
  T04: 5,
  T05: 5,
  C01: 5,
  C02: 4,
  C03: 11,
  F01: 6,
  F02: 4,
  F03: 4,
  F04: 6,
  E01: 7,
  E02: 4,
  E03: 9,
  P01: 5,
  P02: 4,
  P03: 6,
} as const

export const KCR_RISK_DIMENSION_IDS = [
  "technology",
  "compliance",
  "finance",
  "external",
  "personnel-governance",
] as const

export const KCR_DIMENSION_WEIGHTS = {
  technology: 25,
  compliance: 20,
  finance: 20,
  external: 20,
  "personnel-governance": 15,
} as const

export type KcrWeightedIndicatorId = (typeof KCR_WEIGHTED_INDICATOR_IDS)[number]
export type KcrNarrativeIndicatorId =
  (typeof KCR_NARRATIVE_INDICATOR_IDS)[number]
export type KcrIndicatorId = KcrWeightedIndicatorId | KcrNarrativeIndicatorId
export type KcrRiskDimensionId = (typeof KCR_RISK_DIMENSION_IDS)[number]

export type IsoDate = string
export type IsoDateTime = string
export type KcrEntityId = string

export interface KcrCompany {
  id: KcrEntityId
  legalName: string
  shortName: string
  aliases: string[]
  sector: string
  lifecycleStage: "startup" | "growth" | "mature"
  headquarters: string
  stockCodes: string[]
  createdAt: IsoDateTime
  updatedAt: IsoDateTime
}

export type KcrIndicatorValueType =
  "number" | "percentage" | "currency" | "count" | "boolean" | "text"

interface KcrIndicatorBase {
  id: KcrIndicatorId
  label: string
  definition: string
  valueType: KcrIndicatorValueType
  unit: string | null
  frequency: "event" | "monthly" | "quarterly" | "semiannual" | "annual"
}

export interface KcrWeightedIndicator extends KcrIndicatorBase {
  id: KcrWeightedIndicatorId
  kind: "weighted"
  dimensionId: KcrRiskDimensionId
  weight: number
  affectsScore: true
  scoringRuleVersion: string
}

export interface KcrNarrativeIndicator extends KcrIndicatorBase {
  id: KcrNarrativeIndicatorId
  kind: "narrative-validation"
  dimensionId: null
  weight: null
  affectsScore: false
  scoringRuleVersion: null
}

export type KcrIndicator = KcrWeightedIndicator | KcrNarrativeIndicator

export interface KcrObservationPeriod {
  label: string
  start: IsoDate
  end: IsoDate
}

export type KcrObservationValue = string | number | boolean | null

export interface KcrIndicatorObservation {
  id: KcrEntityId
  companyId: KcrEntityId
  indicatorId: KcrIndicatorId
  snapshotId: KcrEntityId | null
  status: "available" | "missing" | "manual-review"
  rawValue: KcrObservationValue
  unit: string | null
  normalizedRiskScore: number | null
  confidence: number | null
  period: KcrObservationPeriod
  asOfDate: IsoDate
  scoringRuleVersion: string | null
  reviewStatus: "unreviewed" | "reviewed" | "rejected"
  reviewedBy: string | null
  reviewedAt: IsoDateTime | null
  note: string
  createdAt: IsoDateTime
  updatedAt: IsoDateTime
}

export type KcrEvidenceSourceTier =
  | "regulator"
  | "exchange"
  | "company-filing"
  | "official-company"
  | "commercial-api"
  | "research"
  | "media"
  | "manual"

export interface KcrEvidence {
  id: KcrEntityId
  companyId: KcrEntityId
  sourceTier: KcrEvidenceSourceTier
  sourceName: string
  sourceUrl: string | null
  title: string
  publishedAt: IsoDateTime | null
  capturedAt: IsoDateTime
  locator: string
  summary: string
  contentHash: string | null
  confidence: number
  redistribution: "public-link-only" | "licensed-derived" | "manual"
  apiCallLogId: KcrEntityId | null
}

export interface KcrEvidenceBinding {
  id: KcrEntityId
  companyId: KcrEntityId
  evidenceId: KcrEntityId
  targetType: "observation" | "event" | "relation" | "snapshot"
  targetId: KcrEntityId
  supportStrength: "direct" | "inferred" | "background"
  inferenceBasis: string | null
  createdAt: IsoDateTime
}

export interface KcrRiskEvent {
  id: KcrEntityId
  companyId: KcrEntityId
  title: string
  description: string
  eventType: string
  dimensionIds: KcrRiskDimensionId[]
  severity: "critical" | "high" | "medium" | "low" | "watch"
  status: "active" | "monitoring" | "resolved"
  redFlag: boolean
  occurredAt: IsoDateTime | null
  discoveredAt: IsoDateTime
  impact: string
  createdAt: IsoDateTime
  updatedAt: IsoDateTime
}

export type KcrGraphNodeType =
  | "company"
  | "risk-dimension"
  | "event"
  | "indicator"
  | "patent"
  | "supply-chain"
  | "person"
  | "product"

export type KcrGraphAttributeValue = string | number | boolean | null

export interface KcrGraphNode {
  id: KcrEntityId
  companyId: KcrEntityId
  type: KcrGraphNodeType
  label: string
  externalKey: string | null
  attributes: Record<string, KcrGraphAttributeValue>
}

export interface KcrRelationPropagation {
  enabled: boolean
  baseImpact: number
  timeDecay: number
  relevanceDecay: number
}

export interface KcrGraphRelation {
  id: KcrEntityId
  companyId: KcrEntityId
  snapshotId: KcrEntityId | null
  sourceNodeId: KcrEntityId
  targetNodeId: KcrEntityId
  relationType: string
  classification: "fact" | "inference"
  strength: number
  confidence: number
  validFrom: IsoDate | null
  validTo: IsoDate | null
  observedAt: IsoDateTime
  propagation: KcrRelationPropagation | null
}

export interface KcrDimensionAssessment {
  dimensionId: KcrRiskDimensionId
  score: number | null
  coveredWeight: number
  totalWeight: number
  coverage: number
  confidence: number | null
}

export type KcrRiskLevel = "low" | "medium" | "high" | "critical"

export interface KcrAssessmentSnapshot {
  id: KcrEntityId
  companyId: KcrEntityId
  methodVersion: typeof KCR_METHOD_VERSION
  assessmentAt: IsoDate
  dataCutoff: IsoDate
  generatedAt: IsoDateTime
  status: "draft" | "validated" | "published"
  baselineScore: number | null
  riskLevel: KcrRiskLevel | null
  dimensions: KcrDimensionAssessment[]
  evidenceCoverage: number
  confidence: number
  redFlagEventIds: KcrEntityId[]
  missingIndicatorIds: KcrWeightedIndicatorId[]
  observationIds: KcrEntityId[]
  disclaimer: string
}

export interface KcrActionTask {
  id: KcrEntityId
  companyId: KcrEntityId
  snapshotId: KcrEntityId
  sourceType: "event" | "indicator" | "relation"
  sourceId: KcrEntityId
  title: string
  description: string
  priority: "P0" | "P1" | "P2"
  owner: string | null
  dueDate: IsoDate
  status: "todo" | "in-progress" | "blocked" | "done"
  createdAt: IsoDateTime
  updatedAt: IsoDateTime
}

export interface KcrApiCallLog {
  id: KcrEntityId
  companyId: KcrEntityId
  snapshotId: KcrEntityId | null
  provider: string
  endpointLabel: string
  purpose: string
  requestedAt: IsoDateTime
  completedAt: IsoDateTime | null
  status: "planned" | "succeeded" | "failed" | "skipped"
  requestFingerprint: string
  responseRecordCount: number | null
  costCny: number
  errorCode: string | null
}

export interface KcrDataset {
  schemaVersion: typeof KCR_DATA_SCHEMA_VERSION
  methodVersion: typeof KCR_METHOD_VERSION
  exportedAt: IsoDateTime
  companies: KcrCompany[]
  indicators: KcrIndicator[]
  observations: KcrIndicatorObservation[]
  evidence: KcrEvidence[]
  evidenceBindings: KcrEvidenceBinding[]
  events: KcrRiskEvent[]
  graphNodes: KcrGraphNode[]
  graphRelations: KcrGraphRelation[]
  snapshots: KcrAssessmentSnapshot[]
  actionTasks: KcrActionTask[]
  apiCallLogs: KcrApiCallLog[]
}
