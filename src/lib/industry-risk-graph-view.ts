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
  fontSize: number
  parent?: string
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
  | { data: IndustryRiskCytoscapeNodeData }
  | { data: IndustryRiskCytoscapeEdgeData }

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
  const edges = graph.edges.filter((edge) => edge.companyIds.includes(companyId))
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
      ? interpolate([34, 211, 238], [250, 204, 21], bounded / 50)
      : interpolate([250, 204, 21], [239, 68, 68], (bounded - 50) / 50)
  return `#${rgb
    .map((channel) => channel.toString(16).padStart(2, "0"))
    .join("")}`
}

function eventColor(tone: IndustryRiskGraphNode["tone"]) {
  if (tone === "critical") return "#ef4444"
  if (tone === "high") return "#f97316"
  if (tone === "medium") return "#facc15"
  return "#2dd4bf"
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
  "label" | "scoreLabel" | "color" | "size" | "fontSize"
> {
  if (node.kind === "company") {
    return {
      label: node.label,
      scoreLabel: node.score === null ? "" : node.score.toFixed(1),
      color: riskHeatColor(node.score),
      size: 94 + (node.score ?? 30) * 0.18,
      fontSize: 15,
    }
  }
  if (node.kind === "category") {
    return {
      label: node.label,
      scoreLabel: node.score === null ? "暂无可比值" : `均值 ${node.score.toFixed(1)}`,
      color: riskHeatColor(node.score),
      size: 0,
      fontSize: 15,
    }
  }
  if (node.kind === "indicator") {
    return {
      label: `${node.entityId}\n${compactLabel(node.label, 8)}`,
      scoreLabel: node.score === null ? "无分" : node.score.toFixed(1),
      color: riskHeatColor(node.score),
      size: node.score === null ? 34 : 38 + node.score * 0.46,
      fontSize: node.score === null ? 9 : 10 + node.score * 0.025,
    }
  }
  if (node.kind === "source") {
    const institution = node.caption.split("·")[0]?.trim()
    return {
      label: compactLabel(institution || node.label, 12),
      scoreLabel: "",
      color: "#38bdf8",
      size: 22 + Math.min(degree, 8) * 2.2,
      fontSize: 9,
    }
  }
  return {
    label: compactLabel(node.label, 10),
    scoreLabel: "",
    color: eventColor(node.tone),
    size: eventSize(node.tone),
    fontSize: 9,
  }
}

function edgeColor(kind: IndustryRiskGraphEdgeKind) {
  if (kind === "event-link") return "#fb7185"
  if (kind === "provenance") return "#38bdf8"
  return "#818cf8"
}

export function buildIndustryRiskCytoscapeElements(
  graph: IndustryRiskKnowledgeGraph
): IndustryRiskCytoscapeElement[] {
  const degreeByNode = new Map(
    graph.nodes.map((node) => [
      node.id,
      graph.edges.filter(
        (edge) => edge.source === node.id || edge.target === node.id
      ).length,
    ])
  )
  const categoryByIndicator = new Map(
    graph.edges.flatMap((edge) => {
      if (
        edge.kind !== "hierarchy" ||
        !edge.source.startsWith("category:") ||
        !edge.target.startsWith("indicator:")
      ) {
        return []
      }
      return [[edge.target, edge.source] as const]
    })
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
        fontSize: visual.fontSize,
        ...(node.kind === "indicator"
          ? { parent: categoryByIndicator.get(node.id) }
          : {}),
      },
    }
  })

  const edges = graph.edges.flatMap(
    (edge): IndustryRiskCytoscapeElement[] => {
      const representedByCompoundContainment =
        edge.kind === "hierarchy" &&
        edge.source.startsWith("category:") &&
        edge.target.startsWith("indicator:")
      if (representedByCompoundContainment) return []
      return [
        {
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
        },
      ]
    }
  )

  return [...nodes, ...edges]
}
