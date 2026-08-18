import type {
  IndustryRiskGraphNode,
  IndustryRiskKnowledgeGraph,
} from "../domain/industry-risk-v1/index.ts"

export interface IndustryRiskGraphLayoutNode {
  id: string
  x: number
  y: number
  width: number
  height: number
  shape: "label" | "dot"
}

export interface IndustryRiskGraphLayout {
  width: number
  height: number
  nodes: IndustryRiskGraphLayoutNode[]
}

function dimensions(node: IndustryRiskGraphNode) {
  if (node.kind === "sector")
    return { width: 170, height: 62, shape: "label" as const }
  if (node.kind === "company")
    return { width: 126, height: 44, shape: "label" as const }
  if (node.kind === "segment")
    return { width: 112, height: 36, shape: "label" as const }
  if (node.kind === "indicator")
    return { width: 120, height: 38, shape: "label" as const }
  if (node.kind === "event")
    return { width: 15, height: 15, shape: "dot" as const }
  if (node.kind === "source")
    return { width: 12, height: 12, shape: "dot" as const }
  return { width: 10, height: 10, shape: "dot" as const }
}

function ringPositions(
  nodes: readonly IndustryRiskGraphNode[],
  radiusX: number,
  radiusY: number,
  center: { x: number; y: number },
  start = -Math.PI / 2
) {
  return nodes.map((node, index) => {
    const angle = start + (index * Math.PI * 2) / Math.max(nodes.length, 1)
    return {
      id: node.id,
      x: center.x + Math.cos(angle) * radiusX,
      y: center.y + Math.sin(angle) * radiusY,
      ...dimensions(node),
    }
  })
}

export function selectIndustryRiskGraph(
  graph: IndustryRiskKnowledgeGraph,
  companyId: string | null
): IndustryRiskKnowledgeGraph {
  if (!companyId) return graph
  const edges = graph.edges.filter((edge) =>
    edge.companyIds.includes(companyId)
  )
  const nodeIds = new Set(edges.flatMap((edge) => [edge.source, edge.target]))
  for (const node of graph.nodes) {
    if (node.kind === "sector" && node.companyIds.includes(companyId)) {
      nodeIds.add(node.id)
    }
  }
  const nodes = graph.nodes.filter((node) => nodeIds.has(node.id))
  return {
    ...graph,
    nodes,
    edges,
    counts: {
      ...graph.counts,
      nodes: nodes.length,
      edges: edges.length,
    },
  }
}

export function buildIndustryRiskGraphLayout(
  graph: IndustryRiskKnowledgeGraph
): IndustryRiskGraphLayout {
  const width = 1900
  const height = 1680
  const center = { x: width / 2, y: height / 2 }
  const byKind = (kind: IndustryRiskGraphNode["kind"]) =>
    graph.nodes.filter((node) => node.kind === kind)
  const sector = byKind("sector")
  const segments = byKind("segment")
  const companies = byKind("company")
  const indicators = byKind("indicator")
  const sources = byKind("source")
  const events = byKind("event")
  const artifacts = byKind("artifact")
  return {
    width,
    height,
    nodes: [
      ...sector.map((node) => ({
        id: node.id,
        x: center.x,
        y: center.y,
        ...dimensions(node),
      })),
      ...ringPositions(segments, 210, 175, center),
      ...ringPositions(companies, 365, 300, center, -Math.PI / 2 + 0.08),
      ...ringPositions(indicators, 545, 450, center),
      ...ringPositions(sources, 680, 570, center, -Math.PI / 2 + 0.03),
      ...ringPositions(events, 790, 665, center, -Math.PI / 2 + 0.06),
      ...ringPositions(artifacts, 900, 770, center),
    ],
  }
}
