import { existsSync } from "node:fs"
import { resolve } from "node:path"

import unifiedData from "../src/data/industry/r01-r22-unified.json" with { type: "json" }
import { importIndustryRiskSqlite } from "../scripts/import-industry-risk-sqlite.ts"
import { buildRiskTransmissionGraph } from "./risk-transmission-graph.ts"
import {
  buildIndustryRiskKnowledgeGraph,
  scoreIndustryRiskDataset,
  type IndustryRiskAssessmentApiResponse,
  type IndustryRiskCompanyDirectoryResponse,
  type IndustryRiskDataset,
  type IndustryRiskEvent,
} from "../src/domain/industry-risk-v1/index.ts"

/**
 * The checked-in JSON remains a reproducible public fallback.  A local
 * deployment may instead point at the crawler master database; it is opened
 * read-only during API startup, so the risk platform never writes into the
 * crawler data chain.
 */
function loadDataset(): IndustryRiskDataset {
  const databasePath = process.env.RISK_CRAWLER_MASTER_DB?.trim()
  if (!databasePath) return unifiedData as IndustryRiskDataset

  const absolutePath = resolve(databasePath)
  if (!existsSync(absolutePath)) {
    throw new Error(
      `RISK_CRAWLER_MASTER_DB 指向的主数据库不存在：${absolutePath}`
    )
  }
  return importIndustryRiskSqlite(absolutePath)
}

const crawlerMasterDatabasePath = process.env.RISK_CRAWLER_MASTER_DB?.trim() ?? ""
const dataset = loadDataset()
const assessments = scoreIndustryRiskDataset(dataset)
const knowledgeGraph = crawlerMasterDatabasePath
  ? buildRiskTransmissionGraph(crawlerMasterDatabasePath, dataset, assessments)
  : buildIndustryRiskKnowledgeGraph(dataset, assessments)

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
