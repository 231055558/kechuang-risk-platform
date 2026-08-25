import type {
  IndustryRiskGraphEdgeKind,
  IndustryRiskGraphNode,
  IndustryRiskKnowledgeGraph,
} from "../domain/industry-risk-v1/index.ts"

export interface IndustryRiskCytoscapeNodeData {
  id: string
  entityId: string
  kind: IndustryRiskGraphNode["kind"]
  label: string
  fullLabel: string
  caption: string
  score: number | null
  scored: boolean
  scoreLabel: string
  color: string
  size: number
  width: number
  height: number
  fontSize: number
}

export interface IndustryRiskCytoscapeEdgeData {
  id: string
  source: string
  target: string
  kind: IndustryRiskGraphEdgeKind
  label: string
  detail: string
  color: string
  width: number
}

export type IndustryRiskCytoscapeElement =
  | {
      data: IndustryRiskCytoscapeNodeData
      position: { x: number; y: number }
    }
  | { data: IndustryRiskCytoscapeEdgeData }

export type IndustryRiskGraphView = "all" | "objective" | "narrative"

const narrativeIndicatorIds = new Set(["R01", "R02", "R03", "R04"])

export function selectIndustryRiskGraphView(
  graph: IndustryRiskKnowledgeGraph,
  view: IndustryRiskGraphView
): IndustryRiskKnowledgeGraph {
  if (view === "all") return graph

  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]))
  const narrativeIndicatorNodeIds = new Set(
    graph.nodes
      .filter(
        (node) =>
          node.kind === "indicator" && narrativeIndicatorIds.has(node.entityId)
      )
      .map((node) => node.id)
  )
  const narrativeCategoryNodeIds = new Set(
    graph.edges.flatMap((edge) =>
      edge.kind === "hierarchy" && narrativeIndicatorNodeIds.has(edge.target)
        ? [edge.source]
        : []
    )
  )
  const includedNodeIds = new Set(
    graph.nodes.flatMap((node) => {
      if (node.kind === "company") return [node.id]
      if (node.kind === "category") {
        return narrativeCategoryNodeIds.has(node.id) === (view === "narrative")
          ? [node.id]
          : []
      }
      if (node.kind === "indicator") {
        return narrativeIndicatorNodeIds.has(node.id) === (view === "narrative")
          ? [node.id]
          : []
      }
      return []
    })
  )

  for (const edge of graph.edges) {
    const source = nodeById.get(edge.source)
    const target = nodeById.get(edge.target)
    if (!source || !target) continue
    if (
      includedNodeIds.has(source.id) &&
      (target.kind === "source" || target.kind === "event")
    ) {
      includedNodeIds.add(target.id)
    }
    if (
      includedNodeIds.has(target.id) &&
      (source.kind === "source" || source.kind === "event")
    ) {
      includedNodeIds.add(source.id)
    }
  }

  const nodes = graph.nodes.filter((node) => includedNodeIds.has(node.id))
  const edges = graph.edges.filter(
    (edge) =>
      includedNodeIds.has(edge.source) && includedNodeIds.has(edge.target)
  )
  const count = (kind: IndustryRiskGraphNode["kind"]) =>
    nodes.filter((node) => node.kind === kind).length
  return {
    ...graph,
    nodes,
    edges,
    counts: {
      nodes: nodes.length,
      edges: edges.length,
      companies: count("company"),
      categories: count("category"),
      indicators: count("indicator"),
      sources: count("source"),
      events: count("event"),
    },
  }
}

function scoreTone(score: number | null): IndustryRiskGraphNode["tone"] {
  if (score === null) return "neutral"
  if (score >= 65) return "critical"
  if (score >= 55) return "high"
  if (score >= 45) return "medium"
  return "low"
}

function average(values: readonly number[]) {
  if (values.length === 0) return null
  return Number(
    (values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2)
  )
}

export function selectIndustryRiskGraph(
  graph: IndustryRiskKnowledgeGraph,
  companyId: string
): IndustryRiskKnowledgeGraph {
  const edges = graph.edges.filter((edge) =>
    edge.companyIds.includes(companyId)
  )
  const nodeIds = new Set(edges.flatMap((edge) => [edge.source, edge.target]))
  const companyNode = graph.nodes.find(
    (node) => node.kind === "company" && node.entityId === companyId
  )
  if (companyNode) nodeIds.add(companyNode.id)

  const companyScopedNodes = graph.nodes
    .filter((node) => nodeIds.has(node.id))
    .map((node) => {
      const companyScore = node.scoresByCompany[companyId]
      if (companyScore === undefined || node.kind === "company") return node
      return {
        ...node,
        score: companyScore,
        tone: scoreTone(companyScore),
      }
    })
  const scopedNodeById = new Map(
    companyScopedNodes.map((node) => [node.id, node])
  )
  const nodes = companyScopedNodes.map((node) => {
    if (node.kind !== "category") return node
    const childScores = edges.flatMap((edge) => {
      if (edge.kind !== "hierarchy" || edge.source !== node.id) return []
      const child = scopedNodeById.get(edge.target)
      return child?.kind === "indicator" && child.score !== null
        ? [child.score]
        : []
    })
    const score = average(childScores)
    const childCount = edges.filter(
      (edge) => edge.kind === "hierarchy" && edge.source === node.id
    ).length
    return {
      ...node,
      score,
      scoresByCompany: score === null ? {} : { [companyId]: score },
      tone: scoreTone(score),
      caption: `${node.caption} · ${childScores.length}/${childCount} 项已有风险分`,
    }
  })

  return {
    ...graph,
    nodes,
    edges,
    counts: { ...graph.counts, nodes: nodes.length, edges: edges.length },
  }
}

function interpolate(
  start: readonly [number, number, number],
  end: readonly [number, number, number],
  ratio: number
) {
  return start.map((channel, index) =>
    Math.round(channel + (end[index] - channel) * ratio)
  ) as [number, number, number]
}

export function riskHeatColor(score: number | null) {
  if (score === null) return "#64748b"
  const bounded = Math.max(0, Math.min(100, score))
  const rgb =
    bounded <= 50
      ? interpolate([69, 117, 180], [226, 184, 75], bounded / 50)
      : interpolate([226, 184, 75], [189, 52, 71], (bounded - 50) / 50)
  return `#${rgb
    .map((channel) => channel.toString(16).padStart(2, "0"))
    .join("")}`
}

function eventColor(tone: IndustryRiskGraphNode["tone"]) {
  if (tone === "critical") return "#bd3447"
  if (tone === "high") return "#c56f20"
  if (tone === "medium") return "#d7aa3d"
  return "#277b6f"
}

function eventSize(tone: IndustryRiskGraphNode["tone"]) {
  if (tone === "critical") return 38
  if (tone === "high") return 32
  if (tone === "medium") return 27
  return 23
}

function compactLabel(value: string, maximum: number) {
  const normalized = value.replace(/\s+/g, " ").trim()
  return normalized.length > maximum
    ? `${normalized.slice(0, maximum)}…`
    : normalized
}

function nodeVisual(
  node: IndustryRiskGraphNode,
  degree: number
): Pick<
  IndustryRiskCytoscapeNodeData,
  "label" | "scoreLabel" | "color" | "size" | "width" | "height" | "fontSize"
> {
  if (node.kind === "company") {
    const scoreLabel = node.score === null ? "待评分" : node.score.toFixed(1)
    return {
      label: `${node.label}\n${scoreLabel}`,
      scoreLabel,
      color: riskHeatColor(node.score),
      size: 124,
      width: 124,
      height: 124,
      fontSize: 16,
    }
  }
  if (node.kind === "category") {
    const isNarrative = node.label.includes("叙事")
    const scoreLabel = isNarrative
      ? "独立观察"
      : node.score === null
        ? "待补数据"
        : `均值 ${node.score.toFixed(0)}`
    return {
      label: `${node.label}\n${scoreLabel}`,
      scoreLabel,
      color: isNarrative ? "#7c3aed" : riskHeatColor(node.score),
      size: 78,
      width: 132,
      height: 64,
      fontSize: 13,
    }
  }
  if (node.kind === "indicator") {
    const isNarrative = narrativeIndicatorIds.has(node.entityId)
    const scoreLabel = isNarrative
      ? "观察"
      : node.score === null
        ? "待补"
        : node.score.toFixed(0)
    const size = isNarrative
      ? 64
      : node.score === null
        ? 44
        : 44 + Math.sqrt(node.score / 100) * 64
    return {
      label: `${node.entityId} · ${compactLabel(node.label, 14)}\n${scoreLabel}`,
      scoreLabel,
      color: isNarrative ? "#8b5cf6" : riskHeatColor(node.score),
      size,
      width: size,
      height: size,
      fontSize: node.score === null ? 9 : 10,
    }
  }
  if (node.kind === "source") {
    const institution = node.caption.split("·")[0]?.trim()
    return {
      label: compactLabel(institution || node.label, 12),
      scoreLabel: "",
      color: "#38bdf8",
      size: 22 + Math.min(degree, 8) * 2.2,
      width: 22 + Math.min(degree, 8) * 2.2,
      height: 22 + Math.min(degree, 8) * 2.2,
      fontSize: 9,
    }
  }
  const size = eventSize(node.tone)
  return {
    label: compactLabel(node.label, 10),
    scoreLabel: "",
    color: eventColor(node.tone),
    size,
    width: size,
    height: size,
    fontSize: 9,
  }
}

function polarPosition(radius: number, angle: number) {
  return {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius,
  }
}

function semanticRadialPositions(graph: IndustryRiskKnowledgeGraph) {
  const positions = new Map<string, { x: number; y: number }>()
  const angles = new Map<string, number>()
  const categories = graph.nodes.filter((node) => node.kind === "category")
  const categoryByIndicator = new Map(
    graph.edges.flatMap((edge) =>
      edge.kind === "hierarchy" &&
      edge.source.startsWith("category:") &&
      edge.target.startsWith("indicator:")
        ? [[edge.target, edge.source] as const]
        : []
    )
  )

  for (const node of graph.nodes) {
    if (node.kind === "company") {
      positions.set(node.id, { x: 0, y: 0 })
      angles.set(node.id, 0)
    }
  }

  categories.forEach((category, categoryIndex) => {
    const angle =
      -Math.PI / 2 + (categoryIndex * Math.PI * 2) / categories.length
    positions.set(category.id, polarPosition(205, angle))
    angles.set(category.id, angle)

    const indicators = graph.nodes
      .filter(
        (node) =>
          node.kind === "indicator" &&
          categoryByIndicator.get(node.id) === category.id
      )
      .sort((left, right) => left.entityId.localeCompare(right.entityId))
    indicators.forEach((indicator, indicatorIndex) => {
      const offset =
        indicators.length === 1
          ? 0
          : (indicatorIndex / (indicators.length - 1) - 0.5) * 0.58
      const indicatorAngle = angle + offset
      const radius = 370 + (indicatorIndex % 2) * 34
      positions.set(indicator.id, polarPosition(radius, indicatorAngle))
      angles.set(indicator.id, indicatorAngle)
    })
  })

  const peripheralNodes = graph.nodes.filter(
    (node) => node.kind === "source" || node.kind === "event"
  )
  const peripheralIndexByAnchor = new Map<string, number>()
  peripheralNodes.forEach((node, index) => {
    const connectedIndicator = graph.edges.find(
      (edge) =>
        (edge.source === node.id && edge.target.startsWith("indicator:")) ||
        (edge.target === node.id && edge.source.startsWith("indicator:"))
    )
    const anchorId = connectedIndicator
      ? connectedIndicator.source === node.id
        ? connectedIndicator.target
        : connectedIndicator.source
      : null
    const anchorAngle = anchorId === null ? null : angles.get(anchorId)
    const anchorKey = anchorId ?? "unanchored"
    const anchorIndex = peripheralIndexByAnchor.get(anchorKey) ?? 0
    peripheralIndexByAnchor.set(anchorKey, anchorIndex + 1)
    const fallbackAngle =
      -Math.PI / 2 + (index * Math.PI * 2) / Math.max(peripheralNodes.length, 1)
    const direction = anchorIndex % 2 === 0 ? 1 : -1
    const fan = Math.ceil(anchorIndex / 2) * 0.105 * direction
    const angle = (anchorAngle ?? fallbackAngle) + fan
    const radius = node.kind === "source" ? 535 : 510 + (anchorIndex % 3) * 34
    positions.set(node.id, polarPosition(radius, angle))
    angles.set(node.id, angle)
  })

  return positions
}

function edgeColor(kind: IndustryRiskGraphEdgeKind) {
  if (kind === "event-link") return "#fb7185"
  if (kind === "provenance") return "#38bdf8"
  return "#818cf8"
}

export function buildIndustryRiskCytoscapeElements(
  graph: IndustryRiskKnowledgeGraph
): IndustryRiskCytoscapeElement[] {
  const positions = semanticRadialPositions(graph)
  const degreeByNode = new Map(
    graph.nodes.map((node) => [
      node.id,
      graph.edges.filter(
        (edge) => edge.source === node.id || edge.target === node.id
      ).length,
    ])
  )
  const nodes = graph.nodes.map((node): IndustryRiskCytoscapeElement => {
    const visual = nodeVisual(node, degreeByNode.get(node.id) ?? 0)
    return {
      data: {
        id: node.id,
        entityId: node.entityId,
        kind: node.kind,
        label: visual.label,
        fullLabel: node.label,
        caption: node.caption,
        score: node.score,
        scored: node.score !== null,
        scoreLabel: visual.scoreLabel,
        color: visual.color,
        size: visual.size,
        width: visual.width,
        height: visual.height,
        fontSize: visual.fontSize,
      },
      position: positions.get(node.id) ?? { x: 0, y: 0 },
    }
  })

  const edges = graph.edges.map((edge): IndustryRiskCytoscapeElement => ({
    data: {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      kind: edge.kind,
      label: edge.label,
      detail: edge.detail,
      color: edgeColor(edge.kind),
      width: edge.kind === "hierarchy" ? 2.4 : 1.4,
    },
  }))

  return [...nodes, ...edges]
}
