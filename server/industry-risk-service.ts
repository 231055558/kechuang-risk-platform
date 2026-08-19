import pilotData from "../src/data/industry/design37-risk-pilot.json" with { type: "json" }
import enterpriseEvidenceData from "../src/data/industry/enterprise-evidence-catalog.json" with { type: "json" }
import {
  buildIndustryRiskKnowledgeGraph,
  getIndustryRiskPilotMetricReadiness,
  scoreIndustryRiskDataset,
  type IndustryRiskAssessmentApiResponse,
  type IndustryRiskCompanyDirectoryResponse,
  type IndustryRiskDataset,
} from "../src/domain/industry-risk-v1/index.ts"
import type { EnterpriseEvidenceCatalog } from "../src/domain/enterprise-evidence-v1/index.ts"

const dataset = pilotData as IndustryRiskDataset
const enterpriseEvidenceCatalog =
  enterpriseEvidenceData as EnterpriseEvidenceCatalog
const assessments = scoreIndustryRiskDataset(dataset)
const metricReadiness = getIndustryRiskPilotMetricReadiness(dataset)
const knowledgeGraph = buildIndustryRiskKnowledgeGraph(
  dataset,
  assessments,
  enterpriseEvidenceCatalog
)

export class IndustryRiskCompanyNotFoundError extends Error {
  readonly statusCode = 404
  readonly code = "INDUSTRY_RISK_COMPANY_NOT_FOUND"

  constructor(companyId: string) {
    super(`企业 ${companyId} 不在当前行业样本中。`)
    this.name = "IndustryRiskCompanyNotFoundError"
  }
}

export function listIndustryRiskCompanies(): IndustryRiskCompanyDirectoryResponse {
  return {
    schemaVersion: dataset.metadata.schemaVersion,
    methodVersion: assessments[0].methodVersion,
    dataVersion: dataset.metadata.dataVersion,
    reportingPeriod: dataset.metadata.reportingPeriod,
    sectorLabel: dataset.metadata.sectorLabel,
    sampleSize: dataset.companies.length,
    scoreReadyIndicatorCount: metricReadiness.filter((item) => item.scoreReady)
      .length,
    candidateAggregateCompanyCount: assessments.filter((assessment) =>
      assessment.candidateAggregates.some(
        (aggregate) => aggregate.status === "partial-candidate"
      )
    ).length,
    industryRiskStatus: "placeholder",
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
        scoredIndicatorCount: assessment.scoredIndicatorCount,
        totalIndicatorCount: assessment.totalIndicatorCount,
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

  const sourceIds = new Set(
    assessment.metrics
      .map((metric) => metric.sourceId)
      .filter((sourceId): sourceId is string => sourceId !== null)
  )
  return {
    assessment,
    company,
    sources: dataset.sources.filter((source) => sourceIds.has(source.id)),
    provenance: {
      sourceAttribution: dataset.metadata.sourceAttribution,
      sourceDate: dataset.metadata.sourceDate,
      scopeNote: dataset.metadata.scopeNote,
      methodStatus: "mvp-candidate",
    },
  }
}

export function getIndustryRiskKnowledgeGraph() {
  return knowledgeGraph
}
