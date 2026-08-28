export const NARRATIVE_RISK_SCHEMA_VERSION =
  "KCR-NARRATIVE-RISK-2026.08-v1" as const

export type NarrativeRiskSourceMode = "postgres" | "snapshot"
export type NarrativeMetricClass = "formal" | "proxy" | "invalid" | "missing"
export type NarrativeArtifactStatus =
  "archived" | "unavailable" | "not-required" | "pending-review"

export interface NarrativeRiskEnvelope {
  schemaVersion: typeof NARRATIVE_RISK_SCHEMA_VERSION
  dataVersion: string
  asOfDate: string
  sourceMode: NarrativeRiskSourceMode
}

export interface NarrativeRiskScopeSummary {
  scopeId: string
  label: string
  methodology: string
  asOfDate: string | null
  companyCount: number
}

export interface NarrativeRiskCompanySummary {
  companyKey: string
  shortName: string
  fullName: string | null
  stockCode: string | null
  scopeIds: string[]
  sampleRoles: string[]
  assessmentCount: number
  objectiveRiskScore: number | null
  weightedCoverage: number | null
  metricCount: number
  formalMetricCount: number
  proxyMetricCount: number
  invalidMetricCount: number
  missingMetricCount: number
  sourceCount: number
  eventCount: number
  validationStatuses: string[]
}

export interface NarrativeRiskCompanyDirectoryResponse extends NarrativeRiskEnvelope {
  scopes: NarrativeRiskScopeSummary[]
  companies: NarrativeRiskCompanySummary[]
  counts: {
    uniqueCompanies: number
    scopeCompanyRecords: number
    sources: number
    metrics: number
    pendingReview: number
  }
}

export interface NarrativeRiskAssessmentRecord {
  scopeId: string
  scopeLabel: string
  sampleRole: string | null
  windowStart: string | null
  windowEnd: string | null
  dataCutoff: string | null
  objectiveRiskScore: number | null
  weightedCoverage: number | null
  pdqiValue: number | null
  pdqiVariant: string | null
  itagValue: number | null
  itagVariant: string | null
  toneValue: number | null
  toneVariant: string | null
  jointRiskLevel: string | null
  validationStatus: string
  conclusion: string | null
}

export interface NarrativeRiskMetricRecord {
  metricId: string
  scopeId: string
  indicatorId: string | null
  metricName: string
  metricVariant: string
  metricClass: NarrativeMetricClass
  rawNumericValue: number | null
  validatedNumericValue: number | null
  displayNumericValue: number | null
  unit: string | null
  status: string | null
  validationStatus: string
  confidenceScore: number | null
  confidenceLevel: string | null
  formula: string | null
  asOfDate: string | null
  limitation: string | null
  scoreEligible: boolean
  scoreExclusionReason: string | null
  sourceCount: number
}

export interface NarrativeRiskCoverageRecord {
  scopeId: string
  indicatorId: string
  coverageStatus: string
  originalDefinitionUsable: boolean | null
  documentMethodUsable: boolean | null
  confidenceScore: number | null
  confidenceLevel: string | null
  observationCount: number | null
  numericObservationCount: number | null
  limitation: string | null
}

export interface NarrativeRiskEventRecord {
  eventId: string
  scopeId: string
  eventDate: string | null
  eventTitle: string
  eventType: string | null
  featureRole: string | null
  labelRole: string | null
  severity: string | null
  sourceId: string | null
  notes: string | null
}

export interface NarrativeRiskAuditFindingRecord {
  findingId: string
  scopeId: string | null
  sourceId: string | null
  metricId: string | null
  severity: string
  status: string
  title: string
  detail: string
}

export interface NarrativeRiskCompanyResponse extends NarrativeRiskEnvelope {
  company: {
    companyKey: string
    shortName: string
    fullName: string | null
    stockCode: string | null
    aliases: string[]
  }
  assessments: NarrativeRiskAssessmentRecord[]
  metrics: NarrativeRiskMetricRecord[]
  coverage: NarrativeRiskCoverageRecord[]
  events: NarrativeRiskEventRecord[]
  auditFindings: NarrativeRiskAuditFindingRecord[]
  counts: {
    scopes: number
    sources: number
    archivedSources: number
    pendingReview: number
  }
}

export interface NarrativeRiskSourceRecord {
  sourceKey: string
  sourceId: string
  scopeId: string
  companyKey: string | null
  channel: string | null
  title: string | null
  institution: string | null
  publicationDate: string | null
  canonicalUrl: string | null
  validationStatus: string
  rawOccurrenceCount: number
  webUrlRequired: boolean
  browserValidated: boolean
  artifact: {
    status: NarrativeArtifactStatus
    artifactKind: string
    httpStatus: number | null
    contentType: string | null
    byteSize: number | null
    contentSha256: string | null
    fetchedAt: string | null
    publicExcerpt: string | null
  } | null
}

export interface NarrativeRiskSourcePageResponse extends NarrativeRiskEnvelope {
  companyKey: string
  filters: {
    scopeId: string | null
    channel: string | null
    validationStatus: string | null
  }
  page: number
  pageSize: number
  total: number
  items: NarrativeRiskSourceRecord[]
}

export interface NarrativeRiskAuditSummaryResponse extends NarrativeRiskEnvelope {
  latestRun: {
    runId: string
    status: string
    completedAt: string | null
  } | null
  counts: {
    linkedUniqueSources: number
    artifacts: number
    archived: number
    unavailable: number
    notRequired: number
    pendingReview: number
    duplicateSourceGroups: number
    invalidMetrics: number
    missingFormalPdqi: number
  }
}

export type NarrativeAnnualObservationStatus = "已计算" | "缺失"

export interface NarrativeAnnualCompany {
  companyKey: string
  companyName: string
  stockCode: string | null
  listingStatus: string
  includedYears: number[]
  exclusionReason: string | null
}

export interface NarrativeAnnualMethodologyItem {
  metricKey: string
  name: string
  category: string
  formula: string
  unit: string
  riskDirection: string
  methodStatus: string
  riskMapping: {
    name: string
    formula: string
    parameterSource: string
    parameters: Array<{ name: string; value: string }>
    limitation: string | null
  }
}

export interface NarrativeAnnualObservation {
  companyKey: string
  year: number
  metricKey: string
  value: number | null
  changeRate: number | null
  riskScore: number | null
  riskScoreChange: number | null
  status: NarrativeAnnualObservationStatus
  missingReason: string | null
  documentId: string | null
  methodVersion: string
  details: Record<string, unknown>
}

export interface NarrativeAnnualDocumentAudit {
  documentId: string
  companyKey: string
  year: number
  title: string
  officialUrl: string
  publicationDate: string | null
  archiveStatus: string
  parseStatus: string
  fileSha256: string | null
  byteSize: number | null
  pageCount: number | null
  sectionCoverage: Record<string, unknown>
  browserValidation: string
}

export interface NarrativeAnnualTrendResponse extends NarrativeRiskEnvelope {
  methodVersion: string
  companies: NarrativeAnnualCompany[]
  observations: NarrativeAnnualObservation[]
}

export interface NarrativeAnnualMethodologyResponse extends NarrativeRiskEnvelope {
  methodVersion: {
    methodVersion: string
    name: string
    effectiveDate: string
    sourceDocumentSha256: string | null
    innovationLexiconStatus: string
    innovationLexiconSize: number
    innovationLexiconSha256: string
    stopwordListSha256: string
    sentimentDictionaryName: string
    sentimentDictionarySha256: string
    sentimentDictionarySource: string
    peerBenchmarkStatus: string
    notes: string[]
  }
  methodology: NarrativeAnnualMethodologyItem[]
}

export interface NarrativeAnnualAuditResponse extends NarrativeRiskEnvelope {
  methodVersion: string
  documents: NarrativeAnnualDocumentAudit[]
  peerBenchmarks: Array<Record<string, unknown>>
  toneAudits: Array<Record<string, unknown>>
  audit: {
    generatedAt: string
    targetReportCount: number
    archivedReportCount: number
    parsedReportCount: number
    partialReportCount: number
    toneYearCount: number
    peerBenchmarkYearCount: number
    missingObservationCount: number
    calculatedObservationCount: number
    publicPayloadContainsFullText: boolean
    publicPayloadContainsPrivatePath: boolean
  }
}

export interface NarrativeIndustryCompany {
  companyId: string
  companyName: string
  stockCode: string
  peerGroupId: string
  industryGroupId: string
  includedYears: number[]
}

export interface NarrativeIndustryGroup {
  industryGroupId: string
  label: string
  peerGroupIds: string[]
}

export interface NarrativeIndustryMethodologyItem {
  metricKey: string
  name: string
  formula: string
  unit: string
  direction: string
}

export interface NarrativeIndustryObservation {
  companyId: string
  year: number
  metricKey: string
  value: number | null
  status: "已计算" | "缺失"
  missingReason: string | null
  documentId: string
  details: Record<string, unknown>
}

export interface NarrativeIndustryStatistic {
  industryGroupId: string
  year: number
  metricKey: string
  sampleSize: number
  mean: number | null
  minimum: number | null
  maximum: number | null
  standardDeviation: number | null
  domainMinimum: number | null
  domainMaximum: number | null
}

export interface NarrativeIndustryDocument {
  documentId: string
  companyId: string
  year: number
  title: string
  officialUrl: string | null
  publicationDate: string | null
  archiveStatus: string
  parseStatus: string
  sha256: string | null
  byteSize: number | null
  pageCount: number | null
  sectionCoverage: Record<string, unknown>
}

export interface NarrativeIndustryTrendResponse extends NarrativeRiskEnvelope {
  companies: NarrativeIndustryCompany[]
  industryGroups: NarrativeIndustryGroup[]
  methodology: NarrativeIndustryMethodologyItem[]
  documents: NarrativeIndustryDocument[]
  observations: NarrativeIndustryObservation[]
  industryStatistics: NarrativeIndustryStatistic[]
  audit: {
    generatedAt: string
    targetCompanyCount: number
    targetCompanyYearCount: number
    archivedReportCount: number
    parsedReportCount: number
    partialReportCount: number
    failedReportCount: number
    calculatedObservationCount: number
    missingObservationCount: number
    patentObservationCount: number
    paidPatentProxyObservationCount?: number
    paidApiCallCount?: number
    paidApiCostYuan?: number
    publicPayloadContainsFullText: boolean
    publicPayloadContainsPrivatePath: boolean
  }
}
