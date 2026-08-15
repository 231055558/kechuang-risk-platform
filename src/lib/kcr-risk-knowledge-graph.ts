import type { KcrAssessmentApiResponse } from "../domain/kcr-v1/assessment-api.ts"
import type { KcrRiskDimensionId } from "../domain/kcr-v1/model.ts"

export type KcrRiskGraphNodeKind =
  "company" | "dimension" | "indicator" | "event" | "evidence"

export type KcrRiskGraphEdgeKind =
  | "structure"
  | "direct"
  | "inferred"
  | "background"
  | "event-link"
  | "propagation"

export interface KcrRiskGraphNode {
  id: string
  entityId: string
  kind: KcrRiskGraphNodeKind
  label: string
  caption: string
  score: number | null
  tone: "low" | "medium" | "high" | "critical" | "neutral"
  dimensionIds: KcrRiskDimensionId[]
}

export interface KcrRiskGraphEdge {
  id: string
  source: string
  target: string
  kind: KcrRiskGraphEdgeKind
  label: string
  detail: string | null
}

export interface KcrRiskKnowledgeGraph {
  nodes: KcrRiskGraphNode[]
  edges: KcrRiskGraphEdge[]
  counts: {
    nodes: number
    edges: number
    directEvidence: number
    inferredEvidence: number
    backgroundEvidence: number
    propagationPaths: number
  }
}

export type KcrRiskGraphLayoutMode = "desktop" | "compact"

export interface KcrRiskGraphLayoutNode {
  id: string
  x: number
  y: number
  radius: number
  angle: number
  layer: 0 | 1 | 2 | 3
  shape: "core" | "dimension" | "indicator" | "event" | "evidence"
}

export interface KcrRiskGraphRadialLayout {
  width: number
  height: number
  center: { x: number; y: number }
  nodes: KcrRiskGraphLayoutNode[]
}

const nodeId = {
  company: (id: string) => `company:${id}`,
  dimension: (id: string) => `dimension:${id}`,
  indicator: (id: string) => `indicator:${id}`,
  event: (id: string) => `event:${id}`,
  evidence: (id: string) => `evidence:${id}`,
}

function edgeId(...parts: string[]) {
  return parts.join(":")
}

export function distributeKcrRiskGraphPositions(
  count: number,
  start: number,
  end: number
) {
  if (count <= 0) return []
  if (count === 1) return [(start + end) / 2]
  return Array.from(
    { length: count },
    (_, index) => start + ((end - start) * index) / (count - 1)
  )
}

function polarPoint(
  center: { x: number; y: number },
  radiusX: number,
  radiusY: number,
  angle: number
) {
  return {
    x: center.x + Math.cos(angle) * radiusX,
    y: center.y + Math.sin(angle) * radiusY,
  }
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum)
}

export function buildKcrRiskGraphRadialLayout(
  nodes: readonly KcrRiskGraphNode[],
  selectedDimensionId: KcrRiskDimensionId,
  mode: KcrRiskGraphLayoutMode
): KcrRiskGraphRadialLayout {
  const compact = mode === "compact"
  const width = compact ? 400 : 960
  const height = compact ? 450 : 700
  const center = compact ? { x: 200, y: 180 } : { x: 480, y: 340 }
  const dimensions = nodes.filter((node) => node.kind === "dimension")
  const indicators = nodes.filter((node) => node.kind === "indicator")
  const evidence = nodes.filter((node) => node.kind === "evidence")
  const events = nodes.filter((node) => node.kind === "event")
  const baseDimensionAngles = new Map(
    dimensions.map((dimension, index) => [
      dimension.entityId,
      -Math.PI / 2 + (index * Math.PI * 2) / Math.max(dimensions.length, 1),
    ])
  )
  const compactRotation = compact
    ? Math.PI / 2 -
      (baseDimensionAngles.get(selectedDimensionId) ?? -Math.PI / 2)
    : 0
  const dimensionAngles = new Map(
    [...baseDimensionAngles].map(([dimensionId, angle]) => [
      dimensionId,
      angle + compactRotation,
    ])
  )
  const selectedAngle = dimensionAngles.get(selectedDimensionId) ?? -Math.PI / 2
  const layoutNodes: KcrRiskGraphLayoutNode[] = []

  nodes
    .filter((node) => node.kind === "company")
    .forEach((node) =>
      layoutNodes.push({
        id: node.id,
        ...center,
        radius: compact ? 52 : 64,
        angle: 0,
        layer: 0,
        shape: "core",
      })
    )

  dimensions.forEach((node) => {
    const angle = dimensionAngles.get(node.entityId) ?? 0
    const point = polarPoint(
      center,
      compact ? 112 : 205,
      compact ? 95 : 155,
      angle
    )
    layoutNodes.push({
      id: node.id,
      ...point,
      radius: compact ? 38 : 44,
      angle,
      layer: 1,
      shape: "dimension",
    })
  })

  const detailGroups = [
    {
      nodes: indicators,
      radiusX: compact ? 165 : 330,
      radiusY: compact ? 170 : 245,
      radius: compact ? 27 : 30,
      span: compact ? 1 : 0.46,
      layer: 2 as const,
      shape: "indicator" as const,
    },
    {
      nodes: evidence,
      radiusX: compact ? 180 : 420,
      radiusY: compact ? 235 : 305,
      radius: compact ? 27 : 25,
      span: compact ? 1.45 : 0.92,
      layer: 3 as const,
      shape: "evidence" as const,
    },
  ]

  detailGroups.forEach((group) => {
    const angleOffsets = distributeKcrRiskGraphPositions(
      group.nodes.length,
      -group.span / 2,
      group.span / 2
    )
    group.nodes.forEach((node, index) => {
      const angle = selectedAngle + angleOffsets[index]
      const point = polarPoint(center, group.radiusX, group.radiusY, angle)
      const padding = group.radius + (compact ? 8 : 12)
      layoutNodes.push({
        id: node.id,
        x: clamp(point.x, padding, width - padding),
        y: clamp(point.y, padding, height - padding),
        radius: group.radius,
        angle,
        layer: group.layer,
        shape: group.shape,
      })
    })
  })

  events.forEach((node, index) => {
    const angle =
      selectedAngle + (compact ? 1.1 : 0.68) + index * (compact ? 0.18 : 0.22)
    const point = polarPoint(
      center,
      compact ? 176 : 370,
      compact ? 170 : 270,
      angle
    )
    const radius = compact ? 32 : 38
    const padding = radius + (compact ? 8 : 12)
    layoutNodes.push({
      id: node.id,
      x: clamp(point.x, padding, width - padding),
      y: clamp(point.y, padding, height - padding),
      radius,
      angle,
      layer: 2,
      shape: "event",
    })
  })

  return { width, height, center, nodes: layoutNodes }
}

export function buildKcrRiskKnowledgeGraph(
  response: KcrAssessmentApiResponse,
  companyLabel: string
): KcrRiskKnowledgeGraph {
  const { assessment, evidenceCatalog } = response
  const dimensionByIndicator = new Map(
    assessment.indicatorResults.map((indicator) => [
      indicator.id,
      indicator.dimensionId,
    ])
  )
  const redFlagEventIds = new Set(
    assessment.redFlags.map((redFlag) => redFlag.eventId)
  )
  const nodes: KcrRiskGraphNode[] = [
    {
      id: nodeId.company(assessment.companyId),
      entityId: assessment.companyId,
      kind: "company",
      label: companyLabel,
      caption: `${assessment.baselineScore ?? "—"} 分 · ${assessment.riskLevelLabel}风险`,
      score: assessment.baselineScore,
      tone: assessment.riskLevel ?? "neutral",
      dimensionIds: assessment.dimensions.map(
        (dimension) => dimension.dimensionId
      ),
    },
    ...assessment.dimensions.map((dimension): KcrRiskGraphNode => ({
      id: nodeId.dimension(dimension.dimensionId),
      entityId: dimension.dimensionId,
      kind: "dimension",
      label: dimension.label,
      caption: `${dimension.score ?? "—"} 分 · ${dimension.riskLevelLabel}风险`,
      score: dimension.score,
      tone: dimension.riskLevel ?? "neutral",
      dimensionIds: [dimension.dimensionId],
    })),
    ...assessment.indicatorResults.map((indicator): KcrRiskGraphNode => ({
      id: nodeId.indicator(indicator.id),
      entityId: indicator.id,
      kind: "indicator",
      label: indicator.label,
      caption: `${indicator.id} · ${indicator.riskScore ?? "—"} 分`,
      score: indicator.riskScore,
      tone: indicator.riskLevel ?? "neutral",
      dimensionIds: [indicator.dimensionId],
    })),
    ...assessment.redFlags.map((redFlag): KcrRiskGraphNode => {
      const dimensionIds = [
        ...new Set(
          redFlag.sourceIndicatorIds.flatMap((indicatorId) => {
            const dimensionId = dimensionByIndicator.get(indicatorId)
            return dimensionId ? [dimensionId] : []
          })
        ),
      ]

      return {
        id: nodeId.event(redFlag.eventId),
        entityId: redFlag.eventId,
        kind: "event",
        label: redFlag.title,
        caption: `${redFlag.priority} · 独立红旗`,
        score: null,
        tone:
          redFlag.severity === "critical"
            ? "critical"
            : redFlag.severity === "high"
              ? "high"
              : "medium",
        dimensionIds,
      }
    }),
    ...evidenceCatalog.map((evidence): KcrRiskGraphNode => {
      const dimensionIds = [
        ...new Set(
          assessment.indicatorResults.flatMap((indicator) =>
            indicator.evidence.some(
              (reference) => reference.evidenceId === evidence.id
            )
              ? [indicator.dimensionId]
              : []
          )
        ),
      ]

      return {
        id: nodeId.evidence(evidence.id),
        entityId: evidence.id,
        kind: "evidence",
        label: evidence.title,
        caption: `${evidence.id} · ${evidence.sourceName}`,
        score: null,
        tone: "neutral",
        dimensionIds,
      }
    }),
  ]

  const edges: KcrRiskGraphEdge[] = [
    ...assessment.dimensions.map((dimension): KcrRiskGraphEdge => ({
      id: edgeId("structure", assessment.companyId, dimension.dimensionId),
      source: nodeId.company(assessment.companyId),
      target: nodeId.dimension(dimension.dimensionId),
      kind: "structure",
      label: "评估维度",
      detail: "KCR V3 固定五维结构",
    })),
    ...assessment.indicatorResults.map((indicator): KcrRiskGraphEdge => ({
      id: edgeId("structure", indicator.dimensionId, indicator.id),
      source: nodeId.dimension(indicator.dimensionId),
      target: nodeId.indicator(indicator.id),
      kind: "structure",
      label: "包含指标",
      detail: `固定权重 ${indicator.weight}`,
    })),
    ...assessment.indicatorResults.flatMap((indicator) =>
      indicator.evidence.map((reference): KcrRiskGraphEdge => ({
        id: edgeId(
          "evidence",
          indicator.id,
          reference.evidenceId,
          reference.supportStrength
        ),
        source: nodeId.indicator(indicator.id),
        target: nodeId.evidence(reference.evidenceId),
        kind: reference.supportStrength,
        label:
          reference.supportStrength === "direct"
            ? "直接支持"
            : reference.supportStrength === "inferred"
              ? "推断支持"
              : "背景核验",
        detail:
          reference.supportStrength === "inferred"
            ? reference.inferenceBasis
            : reference.locator,
      }))
    ),
    ...assessment.redFlags.flatMap((redFlag) => [
      ...redFlag.sourceIndicatorIds.map((indicatorId): KcrRiskGraphEdge => ({
        id: edgeId("event-indicator", redFlag.eventId, indicatorId),
        source: nodeId.indicator(indicatorId),
        target: nodeId.event(redFlag.eventId),
        kind: "event-link",
        label: "关联红旗",
        detail: "评分输入记录的事件—指标关联，不表示新增因果判断",
      })),
      ...redFlag.evidenceIds.map((evidenceId): KcrRiskGraphEdge => ({
        id: edgeId("event-evidence", redFlag.eventId, evidenceId),
        source: nodeId.event(redFlag.eventId),
        target: nodeId.evidence(evidenceId),
        kind: "event-link",
        label: "事件来源",
        detail: "评分输入记录的红旗事件证据",
      })),
    ]),
    ...assessment.propagationPaths.flatMap((path) =>
      path.included && redFlagEventIds.has(path.eventId)
        ? [
            {
              id: edgeId("propagation", path.id),
              source: nodeId.event(path.eventId),
              target: nodeId.company(assessment.companyId),
              kind: "propagation" as const,
              label: "风险传播",
              detail: path.formulaTrace,
            },
          ]
        : []
    ),
  ]

  return {
    nodes,
    edges,
    counts: {
      nodes: nodes.length,
      edges: edges.length,
      directEvidence: edges.filter((edge) => edge.kind === "direct").length,
      inferredEvidence: edges.filter((edge) => edge.kind === "inferred").length,
      backgroundEvidence: edges.filter((edge) => edge.kind === "background")
        .length,
      propagationPaths: edges.filter((edge) => edge.kind === "propagation")
        .length,
    },
  }
}

export function selectKcrRiskGraphDimension(
  graph: KcrRiskKnowledgeGraph,
  dimensionId: KcrRiskDimensionId
): KcrRiskKnowledgeGraph {
  const includedNodeIds = new Set(
    graph.nodes
      .filter(
        (node) =>
          node.kind === "company" ||
          node.kind === "dimension" ||
          node.dimensionIds.includes(dimensionId)
      )
      .map((node) => node.id)
  )
  const nodes = graph.nodes.filter((node) => includedNodeIds.has(node.id))
  const edges = graph.edges.filter(
    (edge) =>
      includedNodeIds.has(edge.source) && includedNodeIds.has(edge.target)
  )

  return {
    nodes,
    edges,
    counts: graph.counts,
  }
}
