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
  | { data: IndustryRiskCytoscapeNodeData; position: { x: number; y: number } }
  | { data: IndustryRiskCytoscapeEdgeData }

function compact(value: string, maximum: number) {
  const normalized = value.replace(/\s+/g, " ").trim()
  return normalized.length > maximum ? `${normalized.slice(0, maximum)}…` : normalized
}

function scoreTone(score: number | null): IndustryRiskGraphNode["tone"] {
  if (score === null) return "neutral"
  if (score >= 65) return "critical"
  if (score >= 55) return "high"
  if (score >= 45) return "medium"
  return "low"
}

/** Kept as a public helper for existing score-legend consumers. */
export function riskHeatColor(score: number | null) {
  if (score === null) return "#64748b"
  if (score >= 65) return "#ef4444"
  if (score >= 55) return "#f97316"
  if (score >= 45) return "#facc15"
  return "#22d3ee"
}

export function selectIndustryRiskGraph(
  graph: IndustryRiskKnowledgeGraph,
  companyId: string
): IndustryRiskKnowledgeGraph {
  const edges = graph.edges.filter((edge) => edge.companyIds.includes(companyId))
  const ids = new Set(edges.flatMap((edge) => [edge.source, edge.target]))
  const company = graph.nodes.find(
    (node) => node.kind === "company" && node.entityId === companyId
  )
  if (company) ids.add(company.id)
  const nodes = graph.nodes
    .filter((node) => ids.has(node.id))
    .map((node) => {
      const score = node.scoresByCompany[companyId]
      return score === undefined || node.kind === "company"
        ? node
        : { ...node, score, tone: scoreTone(score) }
    })
  return { ...graph, nodes, edges, counts: { ...graph.counts, nodes: nodes.length, edges: edges.length } }
}

function eventColor(tone: IndustryRiskGraphNode["tone"]) {
  if (tone === "critical") return "#fb7185"
  if (tone === "high") return "#fb923c"
  if (tone === "medium") return "#fbbf24"
  return "#2dd4bf"
}

function nodeVisual(node: IndustryRiskGraphNode): Pick<IndustryRiskCytoscapeNodeData, "label" | "scoreLabel" | "color" | "size" | "width" | "height" | "fontSize"> {
  if (node.kind === "company") {
    const scoreLabel = node.score === null ? "风险传导" : `风险 ${node.score.toFixed(1)}`
    return { label: `${compact(node.label, 12)}\n${scoreLabel}`, scoreLabel, color: "#4f46e5", size: 128, width: 128, height: 128, fontSize: 15 }
  }
  if (node.kind === "event") {
    return { label: compact(node.label, 18), scoreLabel: "", color: eventColor(node.tone), size: 62, width: 124, height: 62, fontSize: 10 }
  }
  if (node.kind === "indicator") {
    return { label: compact(node.label, 14), scoreLabel: "", color: "#38bdf8", size: 52, width: 100, height: 52, fontSize: 9.5 }
  }
  if (node.kind === "subject") {
    return { label: compact(node.label, 14), scoreLabel: "", color: "#34d399", size: 48, width: 108, height: 48, fontSize: 9.5 }
  }
  if (node.kind === "evolution") {
    return { label: compact(node.label, 16), scoreLabel: "", color: "#a78bfa", size: 56, width: 110, height: 56, fontSize: 9.5 }
  }
  return { label: compact(node.label, 12), scoreLabel: "", color: "#64748b", size: 42, width: 76, height: 42, fontSize: 9 }
}

function polar(radius: number, angle: number) {
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius }
}

/** Semantic radial seed: company → events → transmission consequences. */
function transmissionPositions(graph: IndustryRiskKnowledgeGraph) {
  const positions = new Map<string, { x: number; y: number }>()
  const company = graph.nodes.find((node) => node.kind === "company")
  if (company) positions.set(company.id, { x: 0, y: 0 })
  const events = graph.nodes.filter((node) => node.kind === "event")
  const angleByEvent = new Map<string, number>()
  events.forEach((event, index) => {
    const angle = -Math.PI / 2 + (index * Math.PI * 2) / Math.max(events.length, 1)
    angleByEvent.set(event.id, angle)
    positions.set(event.id, polar(events.length > 10 ? 300 : 245, angle))
  })
  const nonEvents = graph.nodes.filter((node) => node.kind !== "company" && node.kind !== "event")
  const indexByEvent = new Map<string, number>()
  nonEvents.forEach((node, index) => {
    const anchorEdge = graph.edges.find((edge) =>
      (edge.source === node.id && angleByEvent.has(edge.target)) ||
      (edge.target === node.id && angleByEvent.has(edge.source))
    )
    const anchor = anchorEdge
      ? angleByEvent.get(anchorEdge.source === node.id ? anchorEdge.target : anchorEdge.source)
      : undefined
    const group = anchorEdge
      ? (anchorEdge.source === node.id ? anchorEdge.target : anchorEdge.source)
      : "unlinked"
    const groupIndex = indexByEvent.get(group) ?? 0
    indexByEvent.set(group, groupIndex + 1)
    const spread = groupIndex === 0 ? 0 : (Math.ceil(groupIndex / 2) * 0.23) * (groupIndex % 2 ? 1 : -1)
    const angle = (anchor ?? (-Math.PI / 2 + (index * Math.PI * 2) / Math.max(nonEvents.length, 1))) + spread
    const radius = node.kind === "evolution" ? 560 : 470 + (groupIndex % 2) * 44
    positions.set(node.id, polar(radius, angle))
  })
  return positions
}

function edgeColor(kind: IndustryRiskGraphEdgeKind) {
  if (kind === "event-link") return "#fb7185"
  if (kind === "impact") return "#38bdf8"
  if (kind === "subject-link") return "#34d399"
  if (kind === "evolution-link") return "#a78bfa"
  return "#64748b"
}

export function buildIndustryRiskCytoscapeElements(graph: IndustryRiskKnowledgeGraph): IndustryRiskCytoscapeElement[] {
  const positions = transmissionPositions(graph)
  const nodes = graph.nodes.map((node): IndustryRiskCytoscapeElement => {
    const visual = nodeVisual(node)
    return { data: { id: node.id, entityId: node.entityId, kind: node.kind, label: visual.label, fullLabel: node.label, caption: node.caption, score: node.score, scored: node.score !== null, scoreLabel: visual.scoreLabel, color: visual.color, size: visual.size, width: visual.width, height: visual.height, fontSize: visual.fontSize }, position: positions.get(node.id) ?? { x: 0, y: 0 } }
  })
  const edges = graph.edges.map((edge): IndustryRiskCytoscapeElement => ({
    data: { id: edge.id, source: edge.source, target: edge.target, kind: edge.kind, label: edge.label, detail: edge.detail, color: edgeColor(edge.kind), width: edge.kind === "event-link" ? 2.8 : 1.8 },
  }))
  return [...nodes, ...edges]
}
