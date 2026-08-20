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
  if (node.kind === "company")
    return { width: 168, height: 58, shape: "label" as const }
  if (node.kind === "category")
    return { width: 148, height: 44, shape: "label" as const }
  if (node.kind === "indicator")
    return { width: 132, height: 40, shape: "label" as const }
  if (node.kind === "event")
    return { width: 17, height: 17, shape: "dot" as const }
  return { width: 12, height: 12, shape: "dot" as const }
}

function polar(
  node: IndustryRiskGraphNode,
  angle: number,
  radiusX: number,
  radiusY: number,
  center: { x: number; y: number }
): IndustryRiskGraphLayoutNode {
  return {
    id: node.id,
    x: center.x + Math.cos(angle) * radiusX,
    y: center.y + Math.sin(angle) * radiusY,
    ...dimensions(node),
  }
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
  const nodes = graph.nodes
    .filter((node) => nodeIds.has(node.id))
    .map((node) => {
      const companyScore = node.scoresByCompany[companyId]
      if (companyScore === undefined || node.kind === "company") return node
      return {
        ...node,
        score: companyScore,
        tone:
          companyScore >= 65
            ? ("critical" as const)
            : companyScore >= 55
              ? ("high" as const)
              : companyScore >= 45
                ? ("medium" as const)
                : ("low" as const),
      }
    })
  return {
    ...graph,
    nodes,
    edges,
    counts: { ...graph.counts, nodes: nodes.length, edges: edges.length },
  }
}

export function buildIndustryRiskGraphLayout(
  graph: IndustryRiskKnowledgeGraph
): IndustryRiskGraphLayout {
  const width = 1400
  const height = 1250
  const center = { x: width / 2, y: height / 2 }
  const companies = graph.nodes.filter((node) => node.kind === "company")
  const categories = graph.nodes.filter((node) => node.kind === "category")
  const indicators = graph.nodes.filter((node) => node.kind === "indicator")
  const sources = graph.nodes.filter((node) => node.kind === "source")
  const events = graph.nodes.filter((node) => node.kind === "event")

  const indicatorByCategory = new Map(
    categories.map((category) => [
      category.id,
      graph.edges
        .filter(
          (edge) =>
            edge.kind === "hierarchy" &&
            edge.source === category.id &&
            indicators.some((indicator) => indicator.id === edge.target)
        )
        .map((edge) => indicators.find((indicator) => indicator.id === edge.target))
        .filter((node): node is IndustryRiskGraphNode => node !== undefined),
    ])
  )
  const orderedCategories = [...categories].sort((left, right) => {
    const leftFirst = indicatorByCategory.get(left.id)?.[0]?.entityId ?? ""
    const rightFirst = indicatorByCategory.get(right.id)?.[0]?.entityId ?? ""
    return leftFirst.localeCompare(rightFirst, undefined, { numeric: true })
  })
  const totalIndicators = Math.max(indicators.length, 1)
  const indicatorAngles = new Map<string, number>()
  const categoryAngles = new Map<string, number>()
  let cursor = -Math.PI / 2
  for (const category of orderedCategories) {
    const group = indicatorByCategory.get(category.id) ?? []
    const span = (group.length / totalIndicators) * Math.PI * 2
    const step = span / Math.max(group.length, 1)
    categoryAngles.set(category.id, cursor + span / 2)
    group.forEach((indicator, index) => {
      indicatorAngles.set(indicator.id, cursor + step * (index + 0.5))
    })
    cursor += span
  }

  const parentIndicator = (nodeId: string) =>
    graph.edges.find(
      (edge) =>
        edge.target === nodeId &&
        (edge.kind === "provenance" || edge.kind === "event-link") &&
        indicatorAngles.has(edge.source)
    )?.source

  function evidencePositions(
    nodes: readonly IndustryRiskGraphNode[],
    baseRadiusX: number,
    baseRadiusY: number
  ) {
    const grouped = new Map<string, IndustryRiskGraphNode[]>()
    for (const node of nodes) {
      const parent = parentIndicator(node.id) ?? "company"
      grouped.set(parent, [...(grouped.get(parent) ?? []), node])
    }
    return [...grouped.entries()].flatMap(([parent, group], groupIndex) => {
      const baseAngle =
        indicatorAngles.get(parent) ??
        -Math.PI / 2 + (groupIndex * Math.PI * 2) / Math.max(grouped.size, 1)
      return group.map((node, index) => {
        const offset = (index - (group.length - 1) / 2) * 0.032
        const ringOffset = (index % 3) * 18
        return polar(
          node,
          baseAngle + offset,
          baseRadiusX + ringOffset,
          baseRadiusY + ringOffset,
          center
        )
      })
    })
  }

  return {
    width,
    height,
    nodes: [
      ...companies.map((node) => ({
        id: node.id,
        x: center.x,
        y: center.y,
        ...dimensions(node),
      })),
      ...orderedCategories.map((node) =>
        polar(node, categoryAngles.get(node.id) ?? 0, 190, 160, center)
      ),
      ...indicators.map((node) =>
        polar(node, indicatorAngles.get(node.id) ?? 0, 365, 315, center)
      ),
      ...evidencePositions(sources, 485, 420),
      ...evidencePositions(events, 610, 535),
    ],
  }
}
