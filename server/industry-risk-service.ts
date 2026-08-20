import unifiedData from "../src/data/industry/r01-r22-unified.json" with { type: "json" }
import enterpriseEvidenceData from "../src/data/industry/enterprise-evidence-catalog.json" with { type: "json" }
import {
  buildIndustryRiskKnowledgeGraph,
  scoreIndustryRiskDataset,
  type IndustryRiskAssessmentApiResponse,
  type IndustryRiskCompanyDirectoryResponse,
  type IndustryRiskDataset,
  type IndustryRiskEvent,
} from "../src/domain/industry-risk-v1/index.ts"
import type { EnterpriseEvidenceCatalog } from "../src/domain/enterprise-evidence-v1/index.ts"

const dataset = unifiedData as IndustryRiskDataset
const enterpriseEvidenceCatalog =
  enterpriseEvidenceData as EnterpriseEvidenceCatalog
const assessments = scoreIndustryRiskDataset(dataset)
const knowledgeGraph = buildIndustryRiskKnowledgeGraph(
  dataset,
  assessments,
  enterpriseEvidenceCatalog
)

function getCompanyEvents(companyId: string): IndustryRiskEvent[] {
  const events: IndustryRiskEvent[] = [
    ...(dataset.deepSearchEvents ?? [])
      .filter((item) => item.companyId === companyId)
      .map((item) => ({
        id: item.id,
        companyId,
        kind: "deep-search" as const,
        eventType: item.eventType,
        date: item.eventDate,
        title: item.title,
        url: item.url,
        indicatorId: item.relatedIndicatorId,
        confidenceLabel: item.confidenceLabel,
        confidence: item.confidence,
        notes: item.notes,
      })),
    ...dataset.screeningHits
      .filter((item) => item.companyId === companyId)
      .map((item) => ({
        id: item.id,
        companyId,
        kind: "screening-hit" as const,
        eventType: "出口管制与限制清单命中",
        date: item.startDate,
        title: `${item.listedName} · ${item.sourceList}`,
        url: item.sourceInformationUrl ?? item.sourceListUrl ?? item.noticeUrl,
        indicatorId: "R19" as const,
        confidenceLabel: item.confidenceLabel,
        confidence: item.confidence,
        notes: `${item.matchScope}；${item.confidenceReason}`,
      })),
    ...dataset.inquiryEvidence
      .filter((item) => item.companyId === companyId)
      .map((item) => ({
        id: item.id,
        companyId,
        kind: "exchange-inquiry" as const,
        eventType: item.countedAsInquiry ? "交易所问询" : "监管关注材料",
        date: item.announcementDate,
        title: item.title,
        url: item.url,
        indicatorId: "R11" as const,
        confidenceLabel: item.confidenceLabel,
        confidence: item.confidence,
        notes: `${item.topicKey}；${item.notes}`,
      })),
    ...dataset.litigationEvidence
      .filter((item) => item.companyId === companyId)
      .map((item) => ({
        id: item.id,
        companyId,
        kind: "litigation" as const,
        eventType: "诉讼司法事件",
        date: item.hearingTime,
        title: item.cause || "诉讼事件",
        url: item.sourceUrl,
        indicatorId: "R12" as const,
        confidenceLabel: item.confidenceLabel,
        confidence: item.confidence,
        notes: `${item.role}；${item.limitations}`,
      })),
  ]
  return events.sort((left, right) =>
    (right.date ?? "").localeCompare(left.date ?? "")
  )
}

export class IndustryRiskCompanyNotFoundError extends Error {
  readonly statusCode = 404
  readonly code = "INDUSTRY_RISK_COMPANY_NOT_FOUND"

  constructor(companyId: string) {
    super(`企业 ${companyId} 不在当前行业样本中。`)
    this.name = "IndustryRiskCompanyNotFoundError"
  }
}

export function listIndustryRiskCompanies(): IndustryRiskCompanyDirectoryResponse {
  const peerGroups = dataset.metadata.peerGroups ?? []
  const peerGroupById = new Map(peerGroups.map((group) => [group.id, group]))
  return {
    schemaVersion: dataset.metadata.schemaVersion,
    methodVersion: assessments[0].methodVersion,
    dataVersion: dataset.metadata.dataVersion,
    reportingPeriod: dataset.metadata.reportingPeriod,
    sectorLabel: dataset.metadata.sectorLabel,
    sampleSize: dataset.companies.length,
    scoreReadyIndicatorCount: 18,
    industryRiskStatus: "fixed-anchor",
    peerGroups,
    companies: assessments.map((assessment) => {
      const company = dataset.companies.find(
        (item) => item.id === assessment.companyId
      )
      if (!company)
        throw new IndustryRiskCompanyNotFoundError(assessment.companyId)
      return {
        companyId: company.id,
        companyName: company.shortName,
        stockCode: company.stockCode,
        chainSegment: company.chainSegment,
        peerGroupId: company.peerGroupId ?? "default",
        peerGroupLabel:
          peerGroupById.get(company.peerGroupId ?? "")?.label ??
          dataset.metadata.sectorLabel,
        benchmarkGroupId: assessment.benchmarkGroupId,
        benchmarkGroupLabel: assessment.benchmarkGroupLabel,
        benchmarkSampleSize: assessment.benchmarkSampleSize,
        totalRiskScore: assessment.totalRiskScore,
        narrativeRiskIndex: assessment.narrativeIndex.score,
        weightedDataCoverage: assessment.weightedDataCoverage,
        scoredIndicatorCount: assessment.scoredIndicatorCount,
        totalIndicatorCount: assessment.totalIndicatorCount,
        coveredIndicatorCount: dataset.coverage.filter(
          (item) =>
            item.companyId === company.id && !item.status.startsWith("NA")
        ).length,
        eventCount: getCompanyEvents(company.id).length,
        candidateAggregates: assessment.candidateAggregates,
      }
    }),
  }
}

export function getIndustryRiskAssessment(
  companyId: string
): IndustryRiskAssessmentApiResponse {
  const assessment = assessments.find((item) => item.companyId === companyId)
  const company = dataset.companies.find((item) => item.id === companyId)
  if (!assessment || !company)
    throw new IndustryRiskCompanyNotFoundError(companyId)

  const observations = dataset.observations.filter(
    (item) => item.companyId === companyId
  )
  const coverage = dataset.coverage.filter(
    (item) => item.companyId === companyId
  )
  const supplementaryObservations = (
    dataset.supplementaryObservations ?? []
  ).filter((item) => item.companyId === companyId)
  const sourceIds = new Set<string>()
  for (const observation of observations) {
    sourceIds.add(observation.sourceId)
    observation.sourceIds?.forEach((id) => sourceIds.add(id))
  }
  for (const item of supplementaryObservations) {
    if (item.sourceId) sourceIds.add(item.sourceId)
  }
  return {
    assessment,
    company,
    sources: dataset.sources.filter((source) => sourceIds.has(source.id)),
    indicators: dataset.indicators,
    observations,
    coverage,
    events: getCompanyEvents(companyId),
    supplementaryObservations,
    reportAvailability:
      dataset.reportAvailability?.find(
        (item) => item.companyId === companyId
      ) ?? null,
    provenance: {
      sourceAttribution: dataset.metadata.sourceAttribution,
      sourceDate: dataset.metadata.sourceDate,
      scopeNote: dataset.metadata.scopeNote,
      methodStatus: "usable-benchmark",
    },
  }
}

export function getIndustryRiskKnowledgeGraph() {
  return knowledgeGraph
}
