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

export interface IndustryRiskGraphLayoutZone {
  id: string
  x: number
  y: number
  radiusX: number
  radiusY: number
  rotation: number
  score: number | null
}

export interface IndustryRiskGraphLayout {
  width: number
  height: number
  nodes: IndustryRiskGraphLayoutNode[]
  zones: IndustryRiskGraphLayoutZone[]
}

function toneWeight(node: IndustryRiskGraphNode) {
  if (node.tone === "critical") return 1
  if (node.tone === "high") return 0.75
  if (node.tone === "medium") return 0.48
  if (node.tone === "low") return 0.2
  return 0
}

function dimensions(node: IndustryRiskGraphNode, degree = 0) {
  const score = node.score
  if (node.kind === "company") {
    const weight = score === null ? 0.35 : score / 100
    return {
      width: 188 + weight * 52,
      height: 62 + weight * 16,
      shape: "label" as const,
    }
  }
  if (node.kind === "category") {
    const weight = score === null ? 0 : score / 100
    return {
      width: 146 + weight * 82,
      height: 46 + weight * 24,
      shape: "label" as const,
    }
  }
  if (node.kind === "indicator") {
    if (score === null) {
      return { width: 112, height: 38, shape: "label" as const }
    }
    const weight = score / 100
    return {
      width: 116 + weight * 112,
      height: 42 + weight * 30,
      shape: "label" as const,
    }
  }
  if (node.kind === "event") {
    const size = 13 + toneWeight(node) * 18
    return { width: size, height: size, shape: "dot" as const }
  }
  const size = 10 + Math.min(degree, 9) * 1.45
  return { width: size, height: size, shape: "dot" as const }
}

function polar(
  node: IndustryRiskGraphNode,
  angle: number,
  radiusX: number,
  radiusY: number,
  center: { x: number; y: number },
  degree = 0
): IndustryRiskGraphLayoutNode {
  return {
    id: node.id,
    x: center.x + Math.cos(angle) * radiusX,
    y: center.y + Math.sin(angle) * radiusY,
    ...dimensions(node, degree),
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

export function buildIndustryRiskGraphLayout(
  graph: IndustryRiskKnowledgeGraph
): IndustryRiskGraphLayout {
  const width = 1520
  const height = 1280
  const center = { x: width / 2, y: height / 2 }
  const companies = graph.nodes.filter((node) => node.kind === "company")
  const categories = graph.nodes.filter((node) => node.kind === "category")
  const indicators = graph.nodes.filter((node) => node.kind === "indicator")
  const sources = graph.nodes.filter((node) => node.kind === "source")
  const events = graph.nodes.filter((node) => node.kind === "event")
  const degreeByNode = new Map(
    graph.nodes.map((node) => [
      node.id,
      graph.edges.filter(
        (edge) => edge.source === node.id || edge.target === node.id
      ).length,
    ])
  )

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
  const categoryWeights = new Map(
    orderedCategories.map((category) => {
      const indicatorCount = indicatorByCategory.get(category.id)?.length ?? 0
      const riskMultiplier =
        category.score === null ? 0.62 : 0.72 + category.score / 100
      return [category.id, Math.max(indicatorCount * riskMultiplier, 0.5)]
    })
  )
  const totalCategoryWeight = Math.max(
    [...categoryWeights.values()].reduce((sum, weight) => sum + weight, 0),
    1
  )
  const indicatorAngles = new Map<string, number>()
  const categoryAngles = new Map<string, number>()
  let cursor = -Math.PI / 2
  for (const category of orderedCategories) {
    const group = indicatorByCategory.get(category.id) ?? []
    const span =
      ((categoryWeights.get(category.id) ?? 0.5) / totalCategoryWeight) *
      Math.PI *
      2
    const gap = Math.min(0.075, span * 0.12)
    const usableSpan = Math.max(span - gap, span * 0.72)
    const indicatorWeights = group.map((indicator) =>
      indicator.score === null ? 0.54 : 0.7 + indicator.score / 100
    )
    const totalIndicatorWeight = Math.max(
      indicatorWeights.reduce((sum, weight) => sum + weight, 0),
      1
    )
    categoryAngles.set(category.id, cursor + span / 2)
    let indicatorCursor = cursor + gap / 2
    group.forEach((indicator, index) => {
      const indicatorSpan =
        (indicatorWeights[index] / totalIndicatorWeight) * usableSpan
      indicatorAngles.set(indicator.id, indicatorCursor + indicatorSpan / 2)
      indicatorCursor += indicatorSpan
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
          center,
          degreeByNode.get(node.id) ?? 0
        )
      })
    })
  }

  const zones = orderedCategories.map((category) => {
    const angle = categoryAngles.get(category.id) ?? 0
    const score = category.score
    const scoreWeight = score === null ? 0 : score / 100
    const groupSize = indicatorByCategory.get(category.id)?.length ?? 0
    const distanceX = 295 + scoreWeight * 26
    const distanceY = 255 + scoreWeight * 20
    return {
      id: category.id,
      x: center.x + Math.cos(angle) * distanceX,
      y: center.y + Math.sin(angle) * distanceY,
      radiusX: 78 + groupSize * 9 + scoreWeight * 68,
      radiusY: 48 + groupSize * 5 + scoreWeight * 40,
      rotation: (angle * 180) / Math.PI,
      score,
    }
  })

  return {
    width,
    height,
    zones,
    nodes: [
      ...companies.map((node) => ({
        id: node.id,
        x: center.x,
        y: center.y,
        ...dimensions(node, degreeByNode.get(node.id) ?? 0),
      })),
      ...orderedCategories.map((node) => {
        const riskWeight = node.score === null ? 0 : node.score / 100
        return polar(
          node,
          categoryAngles.get(node.id) ?? 0,
          178 + riskWeight * 38,
          152 + riskWeight * 30,
          center,
          degreeByNode.get(node.id) ?? 0
        )
      }),
      ...indicators.map((node) => {
        const riskWeight = node.score === null ? 0 : node.score / 100
        return polar(
          node,
          indicatorAngles.get(node.id) ?? 0,
          345 + riskWeight * 74,
          298 + riskWeight * 62,
          center,
          degreeByNode.get(node.id) ?? 0
        )
      }),
      ...evidencePositions(sources, 515, 448),
      ...evidencePositions(events, 665, 574),
    ],
  }
}
