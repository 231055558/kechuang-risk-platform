export type RiskLevel = "low" | "attention" | "medium-high" | "high"
export type EventSeverity = "high" | "medium" | "watch"
export type EventStatus = "pending" | "in-progress" | "done"
export type TabValue =
  "overview" | "realtime" | "reports" | "intelligence" | "compare" | "events"

export type LegacyTabValue =
  TabValue | "lifecycle" | "ai-flow" | "transmission" | "governance"

export type ResearchSection = "profile" | "metrics" | "lifecycle" | "evidence"

export type OperationsSection =
  "events" | "transmission" | "governance" | "investment" | "advice"

export type CanonicalRiskDimensionId =
  | "narrative"
  | "technology"
  | "compliance"
  | "finance"
  | "external"
  | "personnel"

export type IndicatorAdmissionStatus = "validated" | "observation" | "candidate"

export type EvidenceSupportStrength =
  "direct" | "inferred" | "background" | "pending"

export type AssessmentReviewStatus =
  "reviewed" | "manual-review" | "insufficient-evidence"

export interface ManifestSourceStat {
  type: string
  count: number
}

export interface ManifestRecord {
  snapshotAt: string
  version: string
  coverage: string[]
  totalEvidence: number
  totalEvents: number
  sourceStats: ManifestSourceStat[]
  officialSourceCount?: number
  filingSourceCount?: number
  indicatorVersion?: string
  disclaimer?: string
  note: string
}

export interface CompanySummary {
  id: string
  name: string
  sector: string
  stage: string
  riskIndex: number | null
  topRisks: string[]
  snapshotAt: string
  evidenceCount: number
  highRiskEvents: number
  mediumRiskEvents: number
  responseRate: number
  trendDelta: number
  benchmarkCompanyId: string
  currentHighRiskEvent: string
}

export interface EvidenceItem {
  id: string
  type: string
  title: string
  sourceName: string
  sourceUrl: string
  publishedAt: string
  capturedAt?: string
  summary: string
  citationText?: string
  citationMetric?: string
  sourceReliability?: "official" | "exchange" | "filing" | "paper" | "media"
  recommendedUse?: string
  indicatorIds?: string[]
  relatedRiskDimension: string[]
  relatedStage: string[]
  confidence: number
  supportStrength?: EvidenceSupportStrength
  supportRationale?: string
  inferenceBasis?: string
  scoringLinks?: EvidenceScoringLink[]
}

export interface EvidenceScoringLink {
  indicatorId: string
  period: string
  unit: string
  locator: string
  numerator?: string
  denominator?: string
}

export interface EvidenceScoringBinding {
  id: string
  observationId: string
  companyId: string
  indicatorId: string
  evidenceId: string
  period: string
  unit: string
  locator: string
  inferenceBasis?: string
  createdAt: string
  updatedAt: string
}

export interface RiskDimensionScore {
  id: string
  label: string
  score: number
  level: RiskLevel
  weight: string
  summary: string
  evidenceIds: string[]
  indicatorIds?: string[]
}

export interface RiskAssessmentDimension {
  id: CanonicalRiskDimensionId
  label: string
  score: number | null
  level: RiskLevel | null
  assessable: boolean
  scoreBasis: "indicator-observation" | "technology-auto-score" | null
  summary: string
  evidenceIds: string[]
  indicatorIds: string[]
  evidenceIndicatorPairCount: number
}

export interface RiskAssessment {
  methodVersion: string
  label: "风险辅助研判指数"
  score: number | null
  scoreLabel: string
  dimensions: RiskAssessmentDimension[]
  assessableDimensionCount: number
  effectiveEvidenceCoverage: number
  indicatorAvailability: number
  reviewStatus: AssessmentReviewStatus
  scoreBasisLabel:
    "R05–R22 客观指标自动计算" | "技术自动评分与指标计算" | "自动评分与指标计算"
  reviewedAt: string
  disclaimer: string
}

export interface CompanyDisclosureMetric {
  label: string
  value: string
  unit?: string
  period: string
  sourceId: string
  riskImplication: string
}

export type IntelligenceVerificationStatus = "verified" | "partial" | "pending"
export type ResearchSourceStatus = "located" | "limited" | "pending"

export interface IntelligenceSourceRef {
  sourceName: string
  sourceUrl: string
  publishedAt: string
  capturedAt: string
  reliability: EvidenceItem["sourceReliability"]
}

export interface ResearchSourceRef extends Omit<
  IntelligenceSourceRef,
  "publishedAt"
> {
  publishedAt: string | null
  publicationNote?: string
  locator: string
}

export type CompanyResearchHighlightType =
  "新闻动态" | "论文研究" | "专利披露" | "软件著作权"

export interface CompanyResearchHighlight {
  id: string
  type: CompanyResearchHighlightType
  title: string
  value: string
  asOf: string
  methodology: string
  summary: string
  sourceStatus: ResearchSourceStatus
  scoringEligible: false
  source: ResearchSourceRef
}

export interface CompanyProfileFact {
  id: string
  label: string
  value: string
  period: string
  summary: string
  status: IntelligenceVerificationStatus
  evidenceIds: string[]
}

export interface TechnologyAsset {
  id: string
  type:
    | "模型与算法"
    | "机器人产品"
    | "车载计算"
    | "AI 芯片"
    | "企业 AI 平台"
    | "智能感知"
  name: string
  maturity: "研发验证" | "产品化" | "量产扩张" | "生态建设"
  summary: string
  riskDimensionIds: string[]
  evidenceIds: string[]
}

export interface PatentWatchItem {
  id: string
  technicalTheme: string
  riskFocus: string
  verificationStatus: IntelligenceVerificationStatus
  countDisclosure: "未披露" | "待授权数据接入" | "公开披露可核验"
  summary: string
  riskDimensionIds: string[]
  evidenceIds: string[]
  source: IntelligenceSourceRef
}

export interface PolicyFundingItem {
  id: string
  category: "监管政策" | "资本与披露" | "产业支持" | "跨境与供应链"
  title: string
  status: IntelligenceVerificationStatus
  impact: string
  nextCheck: string
  riskDimensionIds: string[]
  evidenceIds: string[]
  source?: IntelligenceSourceRef
}

export interface CompanyIntelligence {
  companyId: string
  snapshotAt: string
  profileFacts: CompanyProfileFact[]
  technologyAssets: TechnologyAsset[]
  patentWatch: PatentWatchItem[]
  policyFunding: PolicyFundingItem[]
  coverage: {
    profile: number
    technology: number
    patent: number
    policyFunding: number
    note: string
  }
}

export interface LifecycleStage {
  id: string
  label: string
  status: "passed" | "current" | "next"
  riskScore: number
  summary: string
  keywords: string[]
  change: string
  evidenceIds: string[]
}

export interface TrendPoint {
  month: string
  riskIndex: number
  highRiskEvents: number
  mediumRiskEvents: number
  newEvents: number
}

export interface RiskEvent {
  id: string
  companyId: string
  riskType: string
  severity: EventSeverity
  status: EventStatus
  sourceType: string
  stage: string
  description: string
  evidenceIds: string[]
  indicatorIds?: string[]
  sourceName?: string
  sourceUrl?: string
  sourcePublishedAt?: string
  investmentImpact?: "low" | "medium" | "high"
  aiSummary: string
  recommendedAction: string
  identifiedAt: string
}

export type RealTimeSignalScope = "company" | "industry"
export type RealTimeSignalCategory =
  "企业披露" | "监管政策" | "技术论文/专利" | "供应链" | "资本市场"
export type SignalVerificationStatus = "pending" | "monitoring" | "verified"

export interface RealTimeSignal {
  id: string
  scope: RealTimeSignalScope
  companyIds: string[]
  category: RealTimeSignalCategory
  severity: EventSeverity
  title: string
  summary: string
  keyFacts: string[]
  historicalContext: string
  aiInsight: string
  potentialImpact: string
  recommendedAction: string
  researchQuestions: string[]
  riskDimensionIds: string[]
  indicatorIds: string[]
  eventIds: string[]
  heatScore: number
  sourceCount: number
  publishedAt: string
  capturedAt: string
  sourceName: string
  sourceUrl: string
  sourceLocator: string
  sourceReliability: EvidenceItem["sourceReliability"]
  verificationStatus: SignalVerificationStatus
}

export interface DailyRiskBrief {
  date: string
  capturedAt: string
  summary: string
  prioritySignalIds: string[]
  pendingVerificationCount: number
  highImpactCompanyIds: string[]
}

export interface RealTimeDataSet {
  snapshotAt: string
  note: string
  dailyBrief: DailyRiskBrief
  signals: RealTimeSignal[]
}

export interface TransmissionNode {
  id: string
  label: string
  layer: "source" | "mediator" | "impact" | "response"
  description: string
  evidenceIds: string[]
}

export interface TransmissionEdge {
  source: string
  target: string
  strength: "strong" | "medium"
}

export interface GovernanceItem {
  id: string
  riskType: string
  title: string
  priority: "P0" | "P1" | "P2"
  stage: string
  problem: string
  action: string
  dataSupport: string
  evidenceIds: string[]
}

export interface InvestmentView {
  stance: string
  riskAppetite: string
  summary: string
  preInvestmentChecks: string[]
  dueDiligenceFocus: string[]
  valuationConstraints: string[]
  postInvestmentMonitoring: string[]
  stopLossTriggers: string[]
  evidenceIds: string[]
}

export interface CompanyDetail {
  id: string
  name: string
  sector: string
  description: string
  headquarters: string
  stage: string
  riskIndex: number
  benchmarkCompanyId: string
  snapshotAt: string
  metrics: {
    highRiskEvents: number
    mediumRiskEvents: number
    responseRate: number
    evidenceCoverage: number
    monitoredSources: number
    currentHighRiskType: string
  }
  dimensions: RiskDimensionScore[]
  lifecycle: LifecycleStage[]
  trend: TrendPoint[]
  aiCoverage: {
    ingestedSourceTypes: string[]
    extractedSignals: string[]
  }
  disclosureMetrics?: CompanyDisclosureMetric[]
  investmentView?: InvestmentView
  comparisonNote: string
  evidence: EvidenceItem[]
  events: RiskEvent[]
  transmissionGraph: {
    keyInsight: string
    nodes: TransmissionNode[]
    edges: TransmissionEdge[]
  }
  governance: GovernanceItem[]
}

export interface CommonPlaybookItem {
  riskType: string
  title: string
  priority: "P0" | "P1" | "P2"
  action: string
  dataSupport: string
}

export interface IndicatorMetricSample {
  secondary: string
  name: string
  definition: string
  threshold: string
  source: string
  frequency: string
  entityType: string
}

export interface IndicatorGroup {
  primary: string
  secondaryCount: number
  tertiaryCount: number
  secondaryLabels: string[]
  metricSamples: IndicatorMetricSample[]
}

export interface IndicatorTaxonomy {
  sourceFile: string
  methodVersion: string
  admissionGovernance: {
    decisionVersion: string
    decisionDate: string
    reviewerRole: string
    basis: string
  }
  primaryCount: number
  secondaryCount: number
  tertiaryCount: number
  admissionCounts: Record<IndicatorAdmissionStatus, number>
  note: string
  groups: IndicatorGroup[]
}

export interface RiskIndicator {
  id: string
  sourceRow: number
  primaryRisk: string
  secondaryRisk: string
  tertiaryRisk: string
  definition: string
  formula: string
  threshold: string
  entityType: string
  relatedEntities: string
  dataSource: string
  frequency: string
  admissionStatus: IndicatorAdmissionStatus
  admissionNote: string
}

export interface LegacyIndicatorMapping {
  legacyId: string
  indicatorId: string | null
  status: "mapped" | "removed"
  reason: string
}

export interface EvidenceGovernanceRecord {
  id: string
  supportStrength: EvidenceSupportStrength
  supportRationale: string
  inferenceBasis?: string
}

export type IndicatorObservationStatus = "available" | "partial" | "unavailable"

export interface IndicatorObservation {
  id?: string
  companyId: string
  indicatorId: string
  status: IndicatorObservationStatus
  value: string | null
  unit: string
  normalizedScore?: number
  normalizationRuleVersion: string
  reviewStatus?: "reviewed" | "pending"
  reviewedBy: string
  reviewedAt: string
  period: string
  evidenceIds: string[]
  note: string
  createdAt?: string
  updatedAt?: string
}

export interface ScoringWorkspaceState {
  version: 1
  observations: IndicatorObservation[]
  evidenceBindings: EvidenceScoringBinding[]
  defaultReviewer: string
  updatedAt: string
}

export type TechnologyRiskIndicatorId =
  | "kci-006"
  | "kci-007"
  | "kci-008"
  | "kci-009"
  | "kci-010"
  | "kci-011"
  | "kci-012"
  | "kci-013"

export interface TechnologyPerformanceValues {
  industryPercentile: number
}

export interface TechnologyResearchConversionValues {
  citationImpactScore: number
  topResearchQualityScore: number
  patentLinkageScore: number
  productConversionScore: number
  noCorePaperThreeYears: boolean
  unableToMapCoreTechnology: boolean
}

export interface TechnologyPatentBarrierValues {
  forwardCitationScore: number
  patentFamilyScore: number
  claimAndLegalScore: number
  technologyCoverageScore: number
  widespreadCorePatentFailure: boolean
}

export interface TechnologyInnovationContinuityValues {
  researchInvestmentPeerScore: number
  updateCyclePeerScore: number
  noEffectiveUpdateThreeYears: boolean
}

export interface TechnologyMaturityValues {
  currentTrl: number
  targetTrl: number
  dueMilestones: number
  completedOnTimeMilestones: number
  selfAssessedWithoutExperimentEvidence: boolean
}

export interface TechnologyEngineeringConversionValues {
  completedProjects: number
  convertedProjects: number
}

export interface TechnologyValidationValues {
  criticalItemCount: number
  thirdPartyCoveredItems: number
  customerCoveredItems: number
  independentInternalCoveredItems: number
  selfTestCoveredItems: number
  requiredCriticalTests: number
  passedCriticalTests: number
  mandatoryOrSafetyTestFailure: boolean
}

export interface TechnologyDependencyValues {
  standardCriticalModules: number
  highImpactCriticalModules: number
  irreplaceableExternalStandardModules: number
  irreplaceableExternalHighImpactModules: number
  highImpactSingleSource: boolean
  exportRestriction: boolean
  nonRenewableCriticalLicense: boolean
}

export interface TechnologyRiskEvidenceReference {
  evidenceId: string
  locator: string
  supportStrength: EvidenceSupportStrength
  inferenceBasis?: string
}

export interface TechnologyRiskIndicatorInput<Values> {
  values: Values
  evidence: TechnologyRiskEvidenceReference[]
}

export interface TechnologyIncidentInput {
  id: string
  occurredAt: string
  severity: number
  responsibility: "primary" | "secondary" | "indirect" | "none"
  description: string
  concealed: boolean
  repeatedSeriousIncident: boolean
  evidence: TechnologyRiskEvidenceReference[]
}

export interface TechnologyRiskScoreRequest {
  companyId: string
  period: string
  asOfDate: string
  indicators: Partial<{
    "kci-006": TechnologyRiskIndicatorInput<TechnologyPerformanceValues>
    "kci-007": TechnologyRiskIndicatorInput<TechnologyResearchConversionValues>
    "kci-008": TechnologyRiskIndicatorInput<TechnologyPatentBarrierValues>
    "kci-009": TechnologyRiskIndicatorInput<TechnologyInnovationContinuityValues>
    "kci-010": TechnologyRiskIndicatorInput<TechnologyMaturityValues>
    "kci-011": TechnologyRiskIndicatorInput<TechnologyEngineeringConversionValues>
    "kci-012": TechnologyRiskIndicatorInput<TechnologyValidationValues>
    "kci-013": TechnologyRiskIndicatorInput<TechnologyDependencyValues>
  }>
  incidents?: TechnologyIncidentInput[]
}

export type TechnologyBaselineLifecycleStage = "startup" | "growth" | "stable"

export type TechnologyBaselineIndicatorId =
  "tqi-001" | "tqi-002" | "tqi-003" | "tqi-004" | "tqi-005" | "tqi-006"

export type TechnologyBaselineCalibrationIndicatorId =
  | "tqc-001"
  | "tqc-002"
  | "tqc-003"
  | "tqc-004"
  | "tqc-005"
  | "tqc-006"
  | "tqc-007"
  | "tqc-008"

export type TechnologyBaselineMetricId =
  TechnologyBaselineIndicatorId | TechnologyBaselineCalibrationIndicatorId

export interface TechnologyBaselineValues {
  papersPublished?: number
  validInventionPatents?: number
  researchDevelopmentExpense?: number
  operatingRevenue?: number
  totalIntellectualProperty?: number
  researchStaffCount?: number
  annualReportRiskNegativeProbability?: number
  technologyContractTransactionAmount?: number
  patentApplications?: number
  patentGrants?: number
  intangibleAssets?: number
  netAssets?: number
  currentTrl?: number
  coreTechnologyProductRevenue?: number
}

export interface TechnologyBaselineEvidenceReference {
  indicatorId: TechnologyBaselineMetricId
  evidenceId: string
  locator: string
  supportStrength: EvidenceSupportStrength
  inferenceBasis?: string
}

export interface TechnologyBaselineQuantificationRequest {
  companyId: string
  period: string
  asOfDate: string
  lifecycleStage: TechnologyBaselineLifecycleStage
  values: TechnologyBaselineValues
  evidence: TechnologyBaselineEvidenceReference[]
}

export type TechnologyBaselineIndicatorStatus =
  "calculated" | "missing" | "ineligible-evidence" | "invalid-input"

export type TechnologyBaselineCalibrationStatus =
  "pending" | "partial" | "complete"

export type TechnologyBaselineRiskBand = "low" | "medium" | "high" | null

export type TechnologyBaselineScoringStatus = "calibration-observation-only"

export interface TechnologyBaselineIndicatorResult {
  indicatorId: TechnologyBaselineIndicatorId
  label: string
  sourceCategory:
    | "论文与研究"
    | "专利与知识产权"
    | "研发投入"
    | "技术成熟度"
    | "商业转化"
    | "年报文本"
  lifecycleWeight: number | null
  status: TechnologyBaselineIndicatorStatus
  value: number | null
  displayValue: string
  unit: string
  formulaTrace: string
  validationErrors: string[]
  evidenceIds: string[]
  classification: "official"
  scoringEligible: false
  contributesToAggregate: false
  riskBand: TechnologyBaselineRiskBand
  standardizedRiskScore: number | null
  thresholdTrace: string | null
}

export interface TechnologyBaselineCalibrationIndicatorResult {
  indicatorId: TechnologyBaselineCalibrationIndicatorId
  label: string
  sourceCategory:
    | "论文与研究"
    | "专利与知识产权"
    | "研发投入"
    | "财务结构"
    | "技术成熟度"
    | "商业转化"
    | "年报文本"
  status: TechnologyBaselineIndicatorStatus
  value: number | null
  displayValue: string
  unit: string
  formulaTrace: string
  validationErrors: string[]
  evidenceIds: string[]
  scoringEligible: boolean
  contributesToAggregate: false
  riskBand: TechnologyBaselineRiskBand
  standardizedRiskScore: 25 | 60 | 85 | null
  thresholdTrace: string | null
}

export interface TechnologyBaselineLifecycleWeight {
  label: string
  weight: number
}

export interface TechnologyBaselineQuantificationResult {
  companyId: string
  period: string
  asOfDate: string
  lifecycleStage: TechnologyBaselineLifecycleStage
  modelVersion: "TQB-2026.07-v5"
  runId: string
  generatedAt: string
  status: "completed" | "partial"
  technologyDimensionWeight: number
  lifecycleWeights: TechnologyBaselineLifecycleWeight[]
  quantifiedIndicatorCount: number
  calibrationStatus: TechnologyBaselineCalibrationStatus
  calibrationMessage: string
  score: number | null
  riskBand: TechnologyBaselineRiskBand
  quantifiedWeight: number
  scoringStatus: TechnologyBaselineScoringStatus
  indicatorResults: TechnologyBaselineIndicatorResult[]
  calibrationIndicatorResults: TechnologyBaselineCalibrationIndicatorResult[]
  calibratedIndicatorCount: number
  disclaimer: string
}

export type TechnologyRiskIndicatorStatus =
  "scored" | "missing" | "ineligible-evidence" | "invalid-input"

export interface TechnologyRiskIndicatorResult {
  indicatorId: TechnologyRiskIndicatorId
  label: string
  weight: number
  status: TechnologyRiskIndicatorStatus
  capabilityScore: number | null
  riskScore: number | null
  formulaTrace: string
  validationErrors: string[]
  evidenceIds: string[]
}

export interface TechnologyIncidentOverlay {
  index: number
  level: "low" | "medium-low" | "medium-high" | "high"
  riskFloor: 0 | 40 | 60 | 85
  incidentId: string | null
  formulaTrace: string
}

export interface TechnologyRiskScoreResult {
  companyId: string
  period: string
  asOfDate: string
  modelVersion: "KTR-2026.07-v1"
  runId: string
  generatedAt: string
  status: "scored" | "insufficient-coverage"
  coveredWeight: number
  weightedCoverage: number
  baseScore: number | null
  score: number | null
  indicatorResults: TechnologyRiskIndicatorResult[]
  incidentOverlay: TechnologyIncidentOverlay
  forcedHighReasons: string[]
}

export interface TechnologyRiskOverride {
  id?: string
  companyId?: string
  targetRunId?: string
  enabled?: boolean
  score: number
  reason: string
  reviewedBy?: string
  reviewedAt?: string
}

export interface TechnologyScoringCompanyState {
  draftRequest: TechnologyRiskScoreRequest | null
  latestResult: TechnologyRiskScoreResult | null
  override: TechnologyRiskOverride | null
  baselineDraftRequest?: TechnologyBaselineQuantificationRequest | null
  latestBaselineResult?: TechnologyBaselineQuantificationResult | null
  updatedAt: string
}

export interface TechnologyScoringWorkspaceState {
  version: 1
  companies: Record<string, TechnologyScoringCompanyState>
  updatedAt: string
}
