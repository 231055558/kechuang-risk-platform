import type { IndustryRiskDataset } from "./model.ts"
import type { IndustryRiskCompanyAssessment } from "./scoring-engine.ts"

export type IndustryRiskGraphNodeKind =
  "company" | "category" | "indicator" | "source" | "event"

export type IndustryRiskGraphEdgeKind =
  "hierarchy" | "provenance" | "event-link"

export interface IndustryRiskGraphNode {
  id: string
  entityId: string
  kind: IndustryRiskGraphNodeKind
  label: string
  caption: string
  score: number | null
  scoresByCompany: Record<string, number>
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
  schemaVersion: "KCR-INDUSTRY-GRAPH-2026.08-v2"
  nodes: IndustryRiskGraphNode[]
  edges: IndustryRiskGraphEdge[]
  counts: {
    nodes: number
    edges: number
    companies: number
    categories: number
    indicators: number
    sources: number
    events: number
  }
  scopeNote: string
}

function scoreTone(score: number | null): IndustryRiskGraphNode["tone"] {
  if (score === null) return "neutral"
  if (score >= 65) return "critical"
  if (score >= 55) return "high"
  if (score >= 45) return "medium"
  return "low"
}

function deepEventTone(eventType: string): IndustryRiskGraphNode["tone"] {
  if (eventType.includes("处罚") || eventType.includes("调查"))
    return "critical"
  if (
    eventType.includes("延期") ||
    eventType.includes("诉讼") ||
    eventType.includes("仲裁")
  ) {
    return "high"
  }
  if (eventType.includes("结项")) return "low"
  return "medium"
}

function nodeId(kind: IndustryRiskGraphNodeKind, id: string) {
  return `${kind}:${id}`
}

function unique<T>(items: readonly T[]) {
  return [...new Set(items)]
}

export function buildIndustryRiskKnowledgeGraph(
  dataset: IndustryRiskDataset,
  assessments: readonly IndustryRiskCompanyAssessment[]
): IndustryRiskKnowledgeGraph {
  const allCompanyIds = dataset.companies.map((company) => company.id)
  const assessmentByCompany = new Map(
    assessments.map((assessment) => [assessment.companyId, assessment])
  )
  const categories = unique(
    dataset.indicators.map((indicator) => indicator.primaryCategory)
  )
  const categoryIndicators = new Map(
    categories.map((category) => [
      category,
      dataset.indicators.filter(
        (indicator) => indicator.primaryCategory === category
      ),
    ])
  )
  const sourceCompanies = new Map<string, string[]>()
  const observationCompaniesByIndicator = new Map<string, string[]>()
  const indicatorSourceRelations = new Map<string, string[]>()
  for (const observation of dataset.observations) {
    sourceCompanies.set(
      observation.sourceId,
      unique([
        ...(sourceCompanies.get(observation.sourceId) ?? []),
        observation.companyId,
      ])
    )
    observationCompaniesByIndicator.set(
      observation.indicatorId,
      unique([
        ...(observationCompaniesByIndicator.get(observation.indicatorId) ?? []),
        observation.companyId,
      ])
    )
    const key = `${observation.indicatorId}|${observation.sourceId}`
    indicatorSourceRelations.set(
      key,
      unique([
        ...(indicatorSourceRelations.get(key) ?? []),
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

  const eventNodes: IndustryRiskGraphNode[] = [
    ...dataset.screeningHits.map((event): IndustryRiskGraphNode => ({
      id: nodeId("event", `screening:${event.id}`),
      entityId: `screening:${event.id}`,
      kind: "event",
      label: "出口管制清单命中",
      caption: `${event.sourceList} · ${event.startDate ?? "日期待核验"}`,
      score: null,
      scoresByCompany: {},
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
      scoresByCompany: {},
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
      scoresByCompany: {},
      tone: "high",
      companyIds: [event.companyId],
    })),
    ...(dataset.deepSearchEvents ?? []).map((event): IndustryRiskGraphNode => ({
      id: nodeId("event", `deep:${event.id}`),
      entityId: `deep:${event.id}`,
      kind: "event",
      label: event.eventType,
      caption: `${event.title} · ${event.eventDate ?? "日期待核验"}`,
      score: null,
      scoresByCompany: {},
      tone: deepEventTone(event.eventType),
      companyIds: [event.companyId],
    })),
  ]

  const companyNodes = dataset.companies.map(
    (company): IndustryRiskGraphNode => {
      const assessment = assessmentByCompany.get(company.id)
      const score = assessment?.totalRiskScore ?? null
      const coverage = assessment?.weightedScoredIndicatorCount ?? 0
      return {
        id: nodeId("company", company.id),
        entityId: company.id,
        kind: "company",
        label: company.shortName,
        caption: `${company.stockCode} · ${coverage}/18 项可评分 · ${score ?? "—"} 基准分`,
        score,
        scoresByCompany: score === null ? {} : { [company.id]: score },
        tone: scoreTone(score),
        companyIds: [company.id],
      }
    }
  )
  const categoryNodes = categories.map((category): IndustryRiskGraphNode => ({
    id: nodeId("category", category),
    entityId: category,
    kind: "category",
    label: category.replace("（主观校验项，不直接计入总权重）", ""),
    caption: `${categoryIndicators.get(category)?.length ?? 0} 项团队统一指标`,
    score: null,
    scoresByCompany: {},
    tone: "neutral",
    companyIds: allCompanyIds,
  }))
  const indicatorNodes = dataset.indicators.map(
    (indicator): IndustryRiskGraphNode => {
      const score = averageScoresByIndicator.get(indicator.id) ?? null
      const scoresByCompany = Object.fromEntries(
        assessments.flatMap((assessment) => {
          const companyScore = assessment.metrics.find(
            (metric) => metric.indicatorId === indicator.id
          )?.riskScore
          return companyScore === null || companyScore === undefined
            ? []
            : [[assessment.companyId, companyScore]]
        })
      )
      return {
        id: nodeId("indicator", indicator.id),
        entityId: indicator.id,
        kind: "indicator",
        label: indicator.label,
        caption: `${indicator.id} · ${
          indicator.kind === "weighted" ? "客观评分指标" : "叙事校验项"
        }`,
        score: null,
        scoresByCompany,
        tone: score === null ? "neutral" : scoreTone(score),
        companyIds:
          indicator.kind === "narrative-validation"
            ? allCompanyIds
            : (observationCompaniesByIndicator.get(indicator.id) ?? []),
      }
    }
  )
  const sourceNodes = dataset.sources
    .filter((source) => (sourceCompanies.get(source.id)?.length ?? 0) > 0)
    .map((source): IndustryRiskGraphNode => ({
      id: nodeId("source", source.id),
      entityId: source.id,
      kind: "source",
      label: source.title,
      caption: `${source.institution} · ${source.redistribution}`,
      score: null,
      scoresByCompany: {},
      tone: "neutral",
      companyIds: sourceCompanies.get(source.id) ?? [],
    }))
  const nodes: IndustryRiskGraphNode[] = [
    ...companyNodes,
    ...categoryNodes,
    ...indicatorNodes,
    ...sourceNodes,
    ...eventNodes,
  ]

  const edges: IndustryRiskGraphEdge[] = [
    ...dataset.companies.flatMap((company) =>
      categories.map((category): IndustryRiskGraphEdge => ({
        id: `hierarchy:company:${company.id}:${category}`,
        source: nodeId("company", company.id),
        target: nodeId("category", category),
        kind: "hierarchy",
        label: "风险维度",
        detail: `${company.shortName} 的 ${category} 指标组。`,
        companyIds: [company.id],
      }))
    ),
    ...dataset.indicators.map((indicator): IndustryRiskGraphEdge => ({
      id: `hierarchy:category:${indicator.id}`,
      source: nodeId("category", indicator.primaryCategory),
      target: nodeId("indicator", indicator.id),
      kind: "hierarchy",
      label: indicator.kind === "weighted" ? "客观指标" : "叙事校验",
      detail: indicator.definition,
      companyIds: allCompanyIds,
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
    ...dataset.screeningHits.map((event): IndustryRiskGraphEdge => ({
      id: `event-indicator:screening:${event.id}`,
      source: nodeId("indicator", "R19"),
      target: nodeId("event", `screening:${event.id}`),
      kind: "event-link",
      label: "R19 证据",
      detail: event.confidenceReason,
      companyIds: [event.companyId],
    })),
    ...dataset.inquiryEvidence.map((event): IndustryRiskGraphEdge => ({
      id: `event-indicator:inquiry:${event.id}`,
      source: nodeId("indicator", "R11"),
      target: nodeId("event", `inquiry:${event.id}`),
      kind: "event-link",
      label: "R11 证据",
      detail: event.notes,
      companyIds: [event.companyId],
    })),
    ...dataset.litigationEvidence.map((event): IndustryRiskGraphEdge => ({
      id: `event-indicator:litigation:${event.id}`,
      source: nodeId("indicator", "R12"),
      target: nodeId("event", `litigation:${event.id}`),
      kind: "event-link",
      label: "R12 证据",
      detail: event.limitations,
      companyIds: [event.companyId],
    })),
    ...(dataset.deepSearchEvents ?? []).map((event): IndustryRiskGraphEdge => ({
      id: `event-link:deep:${event.id}`,
      source:
        event.relatedIndicatorId === null
          ? nodeId("company", event.companyId)
          : nodeId("indicator", event.relatedIndicatorId),
      target: nodeId("event", `deep:${event.id}`),
      kind: "event-link",
      label:
        event.relatedIndicatorId === null
          ? event.eventType
          : `${event.relatedIndicatorId} 证据`,
      detail: `${event.sourceChannel} · ${event.confidenceLabel}置信度 · ${
        event.notes || event.title
      }`,
      companyIds: [event.companyId],
    })),
  ]

  return {
    schemaVersion: "KCR-INDUSTRY-GRAPH-2026.08-v2",
    nodes,
    edges,
    counts: {
      nodes: nodes.length,
      edges: edges.length,
      companies: companyNodes.length,
      categories: categoryNodes.length,
      indicators: indicatorNodes.length,
      sources: sourceNodes.length,
      events: eventNodes.length,
    },
    scopeNote:
      "每次只展示一家企业，以企业—风险维度—R01–R22 指标—来源/事件组织关系；连线只表达分类与证据归属，不新增因果结论。",
  }
}
