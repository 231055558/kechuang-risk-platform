import type { EnterpriseEvidenceCatalog } from "../enterprise-evidence-v1/index.ts"
import type { IndustryRiskDataset } from "./model.ts"
import type { IndustryRiskCompanyAssessment } from "./scoring-engine.ts"

export type IndustryRiskGraphNodeKind =
  | "sector"
  | "segment"
  | "company"
  | "indicator"
  | "source"
  | "event"
  | "artifact"

export type IndustryRiskGraphEdgeKind =
  "hierarchy" | "coverage" | "provenance" | "event-link" | "material"

export interface IndustryRiskGraphNode {
  id: string
  entityId: string
  kind: IndustryRiskGraphNodeKind
  label: string
  caption: string
  score: number | null
  tone: "low" | "medium" | "high" | "critical" | "neutral"
  companyIds: string[]
}

export interface IndustryRiskGraphEdge {
  id: string
  source: string
  target: string
  kind: IndustryRiskGraphEdgeKind
  label: string
  detail: string
  companyIds: string[]
}

export interface IndustryRiskKnowledgeGraph {
  schemaVersion: "KCR-INDUSTRY-GRAPH-2026.08-v1"
  nodes: IndustryRiskGraphNode[]
  edges: IndustryRiskGraphEdge[]
  counts: {
    nodes: number
    edges: number
    scoredCompanies: number
    evidenceOnlyCompanies: number
    indicators: number
    events: number
    artifacts: number
  }
  scopeNote: string
}

const categoryLabels = {
  "company-profile": "企业概况材料",
  "annual-reporting": "年报与招股材料",
  "financial-reporting": "财务与主营材料",
  "intellectual-property": "知识产权材料",
  "commercial-relations": "客户供应链材料",
  "corporate-governance": "治理与人员材料",
  "financing-investment": "融资投资材料",
  "regulatory-compliance": "监管合规材料",
  litigation: "诉讼司法材料",
  "risk-workbook": "风险工作簿",
  archive: "归档材料",
} as const

function scoreTone(score: number | null): IndustryRiskGraphNode["tone"] {
  if (score === null) return "neutral"
  if (score >= 65) return "critical"
  if (score >= 55) return "high"
  if (score >= 45) return "medium"
  return "low"
}

function nodeId(kind: IndustryRiskGraphNodeKind, id: string) {
  return `${kind}:${id}`
}

function unique<T>(items: readonly T[]) {
  return [...new Set(items)]
}

export function buildIndustryRiskKnowledgeGraph(
  dataset: IndustryRiskDataset,
  assessments: readonly IndustryRiskCompanyAssessment[],
  evidenceCatalog: EnterpriseEvidenceCatalog
): IndustryRiskKnowledgeGraph {
  const sectorNodeId = nodeId("sector", "semiconductor-pilot")
  const segmentNames = unique(
    dataset.companies.map((company) => company.chainSegment)
  )
  const assessmentByCompany = new Map(
    assessments.map((assessment) => [assessment.companyId, assessment])
  )
  const companyNodes = dataset.companies.map(
    (company): IndustryRiskGraphNode => {
      const assessment = assessmentByCompany.get(company.id)
      const score =
        assessment?.candidateAggregates.find((item) => item.method === "critic")
          ?.score ?? null
      return {
        id: nodeId("company", company.id),
        entityId: company.id,
        kind: "company",
        label: company.shortName,
        caption: `${company.stockCode} · ${company.chainSegment} · ${score ?? "—"} 候选分`,
        score,
        tone: scoreTone(score),
        companyIds: [company.id],
      }
    }
  )
  const scoredCompanyIds = new Set(companyNodes.map((node) => node.entityId))
  const evidenceOnlyCompanyNodes = evidenceCatalog.companies
    .filter((company) => !scoredCompanyIds.has(company.companyId))
    .map((company): IndustryRiskGraphNode => ({
      id: nodeId("company", company.companyId),
      entityId: company.companyId,
      kind: "company",
      label: company.displayName,
      caption: `${company.artifactCount} 份私有材料元数据 · 未纳入本次行业评分`,
      score: null,
      tone: "neutral",
      companyIds: [company.companyId],
    }))
  const observationCompaniesByIndicator = new Map<string, string[]>()
  for (const observation of dataset.observations) {
    observationCompaniesByIndicator.set(
      observation.indicatorId,
      unique([
        ...(observationCompaniesByIndicator.get(observation.indicatorId) ?? []),
        observation.companyId,
      ])
    )
  }
  const averageScoresByIndicator = new Map<string, number>()
  for (const indicator of dataset.indicators) {
    const scores = assessments.flatMap((assessment) => {
      const score = assessment.metrics.find(
        (metric) => metric.indicatorId === indicator.id
      )?.riskScore
      return score === null || score === undefined ? [] : [score]
    })
    if (scores.length > 0) {
      averageScoresByIndicator.set(
        indicator.id,
        Number(
          (
            scores.reduce((sum, score) => sum + score, 0) / scores.length
          ).toFixed(2)
        )
      )
    }
  }
  const sourceCompanies = new Map<string, string[]>()
  for (const observation of dataset.observations) {
    sourceCompanies.set(
      observation.sourceId,
      unique([
        ...(sourceCompanies.get(observation.sourceId) ?? []),
        observation.companyId,
      ])
    )
  }
  const eventNodes: IndustryRiskGraphNode[] = [
    ...dataset.screeningHits.map((event): IndustryRiskGraphNode => ({
      id: nodeId("event", `screening:${event.id}`),
      entityId: `screening:${event.id}`,
      kind: "event",
      label: "出口管制清单命中",
      caption: `${event.sourceList} · ${event.startDate ?? "日期待核验"}`,
      score: null,
      tone: "critical",
      companyIds: [event.companyId],
    })),
    ...dataset.inquiryEvidence.map((event): IndustryRiskGraphNode => ({
      id: nodeId("event", `inquiry:${event.id}`),
      entityId: `inquiry:${event.id}`,
      kind: "event",
      label: event.countedAsInquiry ? "交易所问询" : "监管关注材料",
      caption: `${event.topicKey} · ${event.announcementDate ?? "日期待核验"}`,
      score: null,
      tone: event.countedAsInquiry ? "high" : "medium",
      companyIds: [event.companyId],
    })),
    ...dataset.litigationEvidence.map((event): IndustryRiskGraphNode => ({
      id: nodeId("event", `litigation:${event.id}`),
      entityId: `litigation:${event.id}`,
      kind: "event",
      label: event.cause || "诉讼事件",
      caption: `${event.role} · ${event.hearingTime ?? "日期待核验"}`,
      score: null,
      tone: "high",
      companyIds: [event.companyId],
    })),
  ]
  const nodes: IndustryRiskGraphNode[] = [
    {
      id: sectorNodeId,
      entityId: "semiconductor-pilot",
      kind: "sector",
      label: dataset.metadata.sectorLabel,
      caption: `${dataset.companies.length} 家评分样本 · ${evidenceCatalog.companyCount} 家企业材料目录`,
      score: null,
      tone: "neutral",
      companyIds: dataset.companies.map((company) => company.id),
    },
    ...segmentNames.map((segment): IndustryRiskGraphNode => ({
      id: nodeId("segment", segment),
      entityId: segment,
      kind: "segment",
      label: segment,
      caption: `${dataset.companies.filter((company) => company.chainSegment === segment).length} 家样本企业`,
      score: null,
      tone: "neutral",
      companyIds: dataset.companies
        .filter((company) => company.chainSegment === segment)
        .map((company) => company.id),
    })),
    ...companyNodes,
    ...evidenceOnlyCompanyNodes,
    ...dataset.indicators.map((indicator): IndustryRiskGraphNode => {
      const score = averageScoresByIndicator.get(indicator.id) ?? null
      return {
        id: nodeId("indicator", indicator.id),
        entityId: indicator.id,
        kind: "indicator",
        label: indicator.label,
        caption: `${indicator.id} · ${indicator.kind === "weighted" ? "客观评分候选" : "叙事校验"}`,
        score,
        tone: scoreTone(score),
        companyIds: observationCompaniesByIndicator.get(indicator.id) ?? [],
      }
    }),
    ...dataset.sources.map((source): IndustryRiskGraphNode => ({
      id: nodeId("source", source.id),
      entityId: source.id,
      kind: "source",
      label: source.title,
      caption: `${source.institution} · ${source.redistribution}`,
      score: null,
      tone: "neutral",
      companyIds: sourceCompanies.get(source.id) ?? [],
    })),
    ...eventNodes,
    ...evidenceCatalog.artifacts.map((artifact): IndustryRiskGraphNode => ({
      id: nodeId("artifact", artifact.id),
      entityId: artifact.id,
      kind: "artifact",
      label: categoryLabels[artifact.category],
      caption:
        artifact.format === "xlsx"
          ? `${artifact.sheetCount} 个工作表 · ${artifact.nonEmptyRowCount} 行派生元数据`
          : `${artifact.format.toUpperCase()} · 仅登记元数据`,
      score: null,
      tone: "neutral",
      companyIds: [artifact.companyId],
    })),
  ]

  const indicatorSourceRelations = new Map<string, string[]>()
  for (const observation of dataset.observations) {
    const key = `${observation.indicatorId}|${observation.sourceId}`
    indicatorSourceRelations.set(
      key,
      unique([
        ...(indicatorSourceRelations.get(key) ?? []),
        observation.companyId,
      ])
    )
  }
  const edges: IndustryRiskGraphEdge[] = [
    ...segmentNames.map((segment): IndustryRiskGraphEdge => ({
      id: `hierarchy:sector:${segment}`,
      source: sectorNodeId,
      target: nodeId("segment", segment),
      kind: "hierarchy",
      label: "包含环节",
      detail: "团队行业样本的产业链环节归类。",
      companyIds: dataset.companies
        .filter((company) => company.chainSegment === segment)
        .map((company) => company.id),
    })),
    ...dataset.companies.map((company): IndustryRiskGraphEdge => ({
      id: `hierarchy:segment:${company.id}`,
      source: nodeId("segment", company.chainSegment),
      target: nodeId("company", company.id),
      kind: "hierarchy",
      label: "样本企业",
      detail: company.selectionReason,
      companyIds: [company.id],
    })),
    ...dataset.coverage.map((coverage): IndustryRiskGraphEdge => ({
      id: `coverage:${coverage.companyId}:${coverage.indicatorId}`,
      source: nodeId("company", coverage.companyId),
      target: nodeId("indicator", coverage.indicatorId),
      kind: "coverage",
      label: coverage.status,
      detail: coverage.reason,
      companyIds: [coverage.companyId],
    })),
    ...[...indicatorSourceRelations.entries()].map(
      ([key, companyIds]): IndustryRiskGraphEdge => {
        const [indicatorId, sourceId] = key.split("|")
        return {
          id: `provenance:${indicatorId}:${sourceId}`,
          source: nodeId("indicator", indicatorId),
          target: nodeId("source", sourceId),
          kind: "provenance",
          label: "观测来源",
          detail: `为 ${companyIds.length} 家企业的该指标提供数据。`,
          companyIds,
        }
      }
    ),
    ...dataset.screeningHits.flatMap((event): IndustryRiskGraphEdge[] => [
      {
        id: `event-company:screening:${event.id}`,
        source: nodeId("company", event.companyId),
        target: nodeId("event", `screening:${event.id}`),
        kind: "event-link",
        label: "命中事件",
        detail: event.confidenceReason,
        companyIds: [event.companyId],
      },
      {
        id: `event-indicator:screening:${event.id}`,
        source: nodeId("indicator", "R19"),
        target: nodeId("event", `screening:${event.id}`),
        kind: "event-link",
        label: "R19 证据",
        detail: "出口管制与制裁暴露度的清单命中事实。",
        companyIds: [event.companyId],
      },
    ]),
    ...dataset.inquiryEvidence.flatMap((event): IndustryRiskGraphEdge[] => [
      {
        id: `event-company:inquiry:${event.id}`,
        source: nodeId("company", event.companyId),
        target: nodeId("event", `inquiry:${event.id}`),
        kind: "event-link",
        label: "问询材料",
        detail: event.notes,
        companyIds: [event.companyId],
      },
      {
        id: `event-indicator:inquiry:${event.id}`,
        source: nodeId("indicator", "R11"),
        target: nodeId("event", `inquiry:${event.id}`),
        kind: "event-link",
        label: "R11 证据",
        detail: "交易所问询次数的公开材料。",
        companyIds: [event.companyId],
      },
    ]),
    ...dataset.litigationEvidence.flatMap((event): IndustryRiskGraphEdge[] => [
      {
        id: `event-company:litigation:${event.id}`,
        source: nodeId("company", event.companyId),
        target: nodeId("event", `litigation:${event.id}`),
        kind: "event-link",
        label: "诉讼事件",
        detail: event.limitations,
        companyIds: [event.companyId],
      },
      {
        id: `event-indicator:litigation:${event.id}`,
        source: nodeId("indicator", "R12"),
        target: nodeId("event", `litigation:${event.id}`),
        kind: "event-link",
        label: "R12 证据",
        detail: "诉讼风险的许可数据派生事实。",
        companyIds: [event.companyId],
      },
    ]),
    ...evidenceCatalog.artifacts.map((artifact): IndustryRiskGraphEdge => ({
      id: `material:${artifact.id}`,
      source: nodeId("company", artifact.companyId),
      target: nodeId("artifact", artifact.id),
      kind: "material",
      label: "私有材料目录",
      detail: "仅登记派生元数据，原文件内容未进入公开仓库。",
      companyIds: [artifact.companyId],
    })),
  ]

  return {
    schemaVersion: "KCR-INDUSTRY-GRAPH-2026.08-v1",
    nodes,
    edges,
    counts: {
      nodes: nodes.length,
      edges: edges.length,
      scoredCompanies: dataset.companies.length,
      evidenceOnlyCompanies: evidenceOnlyCompanyNodes.length,
      indicators: dataset.indicators.length,
      events: eventNodes.length,
      artifacts: evidenceCatalog.artifacts.length,
    },
    scopeNote:
      "图谱重组毛同学行业数据库与学生企业材料的脱敏目录；关系表示数据覆盖、来源或材料归属，不新增因果结论。",
  }
}
