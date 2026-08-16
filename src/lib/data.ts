import manifestData from "@/data/manifest.json"
import companySummariesData from "@/data/companies.json"
import deepseekData from "@/data/company/deepseek.json"
import unitreeData from "@/data/company/unitree.json"
import horizonData from "@/data/company/horizon.json"
import cambriconData from "@/data/company/cambricon.json"
import fourthParadigmData from "@/data/company/fourth-paradigm.json"
import robosenseData from "@/data/company/robosense.json"
import governancePlaybookData from "@/data/governance-playbook.json"
import indicatorTaxonomyData from "@/data/indicator-taxonomy.json"
import riskIndicatorsData from "@/data/risk-indicators.json"
import realtimeSignalsData from "@/data/realtime-signals.json"
import realtimeSignalsSupplementData from "@/data/realtime-signals-supplement.json"
import companyIntelligenceData from "@/data/company-intelligence.json"
import evidenceGovernanceData from "@/data/evidence-governance.json"
import legacyIndicatorMapData from "@/data/legacy-indicator-map.json"
import indicatorObservationsData from "@/data/indicator-observations.json"
import {
  getCanonicalRiskDimensionIds,
  getCanonicalRiskDimensionLabel,
  getCanonicalRiskDimensionLabels,
} from "@/lib/risk-dimensions"
import { buildRiskAssessment } from "@/lib/risk-metrics"
import { normalizationRuleRegistry } from "@/lib/scoring-rules"
import type {
  CompanyIntelligence,
  CommonPlaybookItem,
  CompanyDetail,
  CompanySummary,
  EvidenceScoringBinding,
  EvidenceGovernanceRecord,
  IndicatorObservation,
  IndicatorTaxonomy,
  LegacyIndicatorMapping,
  ManifestRecord,
  RealTimeDataSet,
  RealTimeSignal,
  RiskIndicator,
  RiskAssessment,
  TabValue,
  TechnologyScoringCompanyState,
} from "@/types/risk"

export const manifest = manifestData as ManifestRecord
export const commonPlaybook = (
  governancePlaybookData as CommonPlaybookItem[]
).map((item) => ({
  ...item,
  riskType: getCanonicalRiskDimensionLabel(item.riskType),
}))
export const indicatorTaxonomy = indicatorTaxonomyData as IndicatorTaxonomy
export const riskIndicators = riskIndicatorsData as RiskIndicator[]
export const legacyIndicatorMappings =
  legacyIndicatorMapData as LegacyIndicatorMapping[]
export const evidenceGovernance =
  evidenceGovernanceData as EvidenceGovernanceRecord[]
export const indicatorObservations =
  indicatorObservationsData as IndicatorObservation[]
export const companyIntelligence = (
  companyIntelligenceData as CompanyIntelligence[]
).map((item) => ({
  ...item,
  technologyAssets: item.technologyAssets.map((asset) => ({
    ...asset,
    riskDimensionIds: getCanonicalRiskDimensionIds(asset.riskDimensionIds),
  })),
  patentWatch: item.patentWatch.map((record) => ({
    ...record,
    riskDimensionIds: getCanonicalRiskDimensionIds(record.riskDimensionIds),
  })),
  policyFunding: item.policyFunding.map((record) => ({
    ...record,
    riskDimensionIds: getCanonicalRiskDimensionIds(record.riskDimensionIds),
  })),
}))
export const companyIntelligenceRegistry = new Map(
  companyIntelligence.map((item) => [item.companyId, item])
)
export const riskIndicatorMap = new Map(
  riskIndicators.map((indicator) => [indicator.id, indicator])
)
export const legacyIndicatorMap = new Map(
  legacyIndicatorMappings.map((mapping) => [
    mapping.legacyId,
    mapping.indicatorId,
  ])
)
const evidenceGovernanceMap = new Map(
  evidenceGovernance.map((record) => [record.id, record])
)

export function mapLegacyIndicatorIds(indicatorIds: string[] = []) {
  return [
    ...new Set(
      indicatorIds.flatMap((indicatorId) => {
        if (riskIndicatorMap.has(indicatorId)) {
          return [indicatorId]
        }
        const mappedId = legacyIndicatorMap.get(indicatorId)
        return mappedId ? [mappedId] : []
      })
    ),
  ]
}

export function getCustomerVisibleIndicators(indicatorIds: string[] = []) {
  return mapLegacyIndicatorIds(indicatorIds)
    .map((id) => riskIndicatorMap.get(id))
    .filter(
      (indicator): indicator is RiskIndicator =>
        indicator !== undefined && indicator.admissionStatus !== "candidate"
    )
}

export function getAdmittedIndicators(indicatorIds: string[] = []) {
  return getCustomerVisibleIndicators(indicatorIds).filter(
    (indicator) => indicator.admissionStatus === "validated"
  )
}

export function getObservationIndicators(indicatorIds: string[] = []) {
  return getCustomerVisibleIndicators(indicatorIds).filter(
    (indicator) => indicator.admissionStatus === "observation"
  )
}

function governCompanyDetail(rawDetail: CompanyDetail): CompanyDetail {
  return {
    ...rawDetail,
    metrics: {
      ...rawDetail.metrics,
      currentHighRiskType: getCanonicalRiskDimensionLabel(
        rawDetail.metrics.currentHighRiskType
      ),
    },
    dimensions: rawDetail.dimensions.map((dimension) => ({
      ...dimension,
      label: getCanonicalRiskDimensionLabel(dimension.label),
      indicatorIds: mapLegacyIndicatorIds(dimension.indicatorIds),
    })),
    lifecycle: rawDetail.lifecycle.map((stage) => ({
      ...stage,
      keywords: stage.keywords.map(getCanonicalRiskDimensionLabel),
    })),
    evidence: rawDetail.evidence.map((evidence) => ({
      ...evidence,
      ...evidenceGovernanceMap.get(evidence.id),
      indicatorIds: mapLegacyIndicatorIds(evidence.indicatorIds),
      relatedRiskDimension: getCanonicalRiskDimensionLabels(
        evidence.relatedRiskDimension
      ),
    })),
    events: rawDetail.events.map((event) => ({
      ...event,
      riskType: getCanonicalRiskDimensionLabel(event.riskType),
      indicatorIds: mapLegacyIndicatorIds(event.indicatorIds),
    })),
    governance: rawDetail.governance.map((item) => ({
      ...item,
      riskType: getCanonicalRiskDimensionLabel(item.riskType),
    })),
  }
}

const rawDetailRegistry: Record<string, CompanyDetail> = {
  deepseek: deepseekData as CompanyDetail,
  unitree: unitreeData as CompanyDetail,
  horizon: horizonData as CompanyDetail,
  cambricon: cambriconData as CompanyDetail,
  "fourth-paradigm": fourthParadigmData as CompanyDetail,
  robosense: robosenseData as CompanyDetail,
}

export const detailRegistry = Object.fromEntries(
  Object.entries(rawDetailRegistry).map(([companyId, detail]) => [
    companyId,
    governCompanyDetail(detail),
  ])
) as Record<string, CompanyDetail>

export function buildAssessmentRegistry(
  observations: IndicatorObservation[] = indicatorObservations,
  evidenceBindings: EvidenceScoringBinding[] = [],
  technologyScoringCompanies: Readonly<
    Record<string, TechnologyScoringCompanyState | undefined>
  > = {}
) {
  return Object.fromEntries(
    Object.entries(detailRegistry).map(([companyId, detail]) => [
      companyId,
      buildRiskAssessment(
        detail,
        riskIndicators,
        indicatorTaxonomy.methodVersion,
        observations.filter(
          (observation) => observation.companyId === companyId
        ),
        normalizationRuleRegistry,
        evidenceBindings.filter((binding) => binding.companyId === companyId),
        technologyScoringCompanies[companyId] ?? null
      ),
    ])
  ) as Record<string, RiskAssessment>
}

export function buildCompanySummaries(
  assessments: Record<string, RiskAssessment>
) {
  return (companySummariesData as CompanySummary[]).map((company) => ({
    ...company,
    riskIndex: assessments[company.id]?.score ?? null,
    topRisks: getCanonicalRiskDimensionLabels(company.topRisks),
  }))
}

export const assessmentRegistry = buildAssessmentRegistry()
export const companySummaries = buildCompanySummaries(assessmentRegistry)

type RawRealTimeSignal = Omit<
  RealTimeSignal,
  "keyFacts" | "historicalContext" | "researchQuestions" | "sourceLocator"
> &
  Partial<
    Pick<
      RealTimeSignal,
      "keyFacts" | "historicalContext" | "researchQuestions" | "sourceLocator"
    >
  >

function getDefaultResearchQuestions(signal: RawRealTimeSignal) {
  switch (signal.category) {
    case "技术论文/专利":
      return [
        "原始材料中的技术、实验或权利口径能否由第三方复核？",
        "该论文或知识产权与当前在售产品、软件版本之间如何对应？",
      ]
    case "资本市场":
      return [
        "后续正式公告、审计结果或监管进展是否改变当前判断？",
        "该事项对现金流、股本、估值或治理的实际影响是多少？",
      ]
    case "监管政策":
      return [
        "监管措施的适用主体、司法辖区和整改范围是什么？",
        "后续决定或企业整改材料是否已公开？",
      ]
    case "供应链":
      return [
        "关键供应商、设备或零部件是否具备可验证的第二来源？",
        "相关投入与客户需求、设备利用率和交付收入是否匹配？",
      ]
    case "企业披露":
      return [
        "该披露口径是否会在后续审计、业绩或产品材料中得到确认？",
        "公告中的进展如何转化为收入、现金流、客户交付或风险变化？",
      ]
  }

  return [
    "该材料中的主体、时间、范围与关键口径是否已由原始来源确认？",
    "该信息将通过哪些指标、事件或后续披露改变当前风险判断？",
  ]
}

function normalizeRealtimeSignal(
  signal: RawRealTimeSignal,
  snapshotAt: string
): RealTimeSignal {
  const canonicalRiskDimensionIds = getCanonicalRiskDimensionIds(
    signal.riskDimensionIds
  )

  return {
    ...signal,
    keyFacts: signal.keyFacts ?? [
      signal.summary,
      `公开来源：${signal.sourceName}，发布日期 ${signal.publishedAt.slice(0, 10)}`,
      `当前关联 ${canonicalRiskDimensionIds.length} 个风险维度，核验状态为${signal.verificationStatus === "verified" ? "已核验" : signal.verificationStatus === "monitoring" ? "持续观察" : "待核验"}`,
    ],
    historicalContext:
      signal.historicalContext ??
      `该记录按原始材料发布日期 ${signal.publishedAt.slice(0, 10)} 归档，并与同企业后续公告、产品版本、论文和经营结果进行连续对照；快照更新至 ${snapshotAt.slice(0, 10)}。`,
    researchQuestions:
      signal.researchQuestions ?? getDefaultResearchQuestions(signal),
    sourceLocator:
      signal.sourceLocator ??
      `${signal.sourceName}中与“${signal.title}”对应的公告、正文或原始记录`,
    capturedAt: snapshotAt,
    riskDimensionIds: canonicalRiskDimensionIds,
    indicatorIds: mapLegacyIndicatorIds(signal.indicatorIds),
  }
}

const realtimeBase = realtimeSignalsData as Omit<RealTimeDataSet, "signals"> & {
  signals: RawRealTimeSignal[]
}
const realtimeSnapshotAt = realtimeBase.snapshotAt
const normalizedRealtimeSignals = [
  ...realtimeBase.signals,
  ...(realtimeSignalsSupplementData as RawRealTimeSignal[]),
]
  .map((signal) => normalizeRealtimeSignal(signal, realtimeSnapshotAt))
  .sort((left, right) => right.publishedAt.localeCompare(left.publishedAt))

export const realtimeData = {
  ...realtimeBase,
  dailyBrief: {
    ...realtimeBase.dailyBrief,
    capturedAt: realtimeSnapshotAt,
    pendingVerificationCount: normalizedRealtimeSignals.filter(
      (signal) => signal.verificationStatus === "pending"
    ).length,
  },
  signals: normalizedRealtimeSignals,
} satisfies RealTimeDataSet
export const realtimeSignals = realtimeData.signals

const mvpDefaultCompanyId = "cambricon"
export const defaultCompanyId = companySummaries.some(
  (company) => company.id === mvpDefaultCompanyId
)
  ? mvpDefaultCompanyId
  : (companySummaries[0]?.id ?? "deepseek")
export const defaultCompareId =
  detailRegistry[defaultCompanyId]?.benchmarkCompanyId ?? "fourth-paradigm"

export const tabs: Array<{ value: TabValue; label: string }> = [
  { value: "overview", label: "风险研判" },
  { value: "realtime", label: "实时情报" },
  { value: "intelligence", label: "企业详情" },
  { value: "compare", label: "对比分析" },
  { value: "events", label: "事件处理" },
]

export function getCompanySummary(companyId: string) {
  return companySummaries.find((company) => company.id === companyId)
}

export function getCompanyDetail(companyId: string) {
  return detailRegistry[companyId] ?? detailRegistry[defaultCompanyId]
}

export function getCompanyIntelligence(companyId: string) {
  return companyIntelligenceRegistry.get(companyId) ?? companyIntelligence[0]
}

export function getCompanyAssessment(companyId: string) {
  return assessmentRegistry[companyId] ?? assessmentRegistry[defaultCompanyId]
}

export function getCompanyName(companyId: string) {
  return getCompanySummary(companyId)?.name ?? getCompanyDetail(companyId).name
}
