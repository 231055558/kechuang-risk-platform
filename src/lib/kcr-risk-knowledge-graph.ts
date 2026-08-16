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
export type KcrRiskGraphViewMode = "overview" | "network" | "focus" | "lineage"

export interface KcrRiskGraphLayoutNode {
  id: string
  x: number
  y: number
  radius: number
  width?: number
  height?: number
  angle: number
  layer: 0 | 1 | 2 | 3
  shape: "core" | "dimension" | "indicator" | "event" | "evidence"
}

export interface KcrRiskGraphLayout {
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

function graphNodeBox(node: KcrRiskGraphNode) {
  if (node.kind === "company") return { width: 142, height: 52 }
  if (node.kind === "dimension") return { width: 112, height: 42 }
  if (node.kind === "event") return { width: 86, height: 38 }
  if (node.kind === "indicator") return { width: 78, height: 34 }
  return { width: 68, height: 30 }
}

function graphNodeLayer(node: KcrRiskGraphNode): 0 | 1 | 2 | 3 {
  if (node.kind === "company") return 0
  if (node.kind === "dimension") return 1
  if (node.kind === "evidence") return 3
  return 2
}

function stableGraphJitter(value: string) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return ((hash >>> 0) % 1000) / 999 - 0.5
}

/**
 * Deterministic force-directed layout for the complete KCR snapshot. It uses
 * semantic starting clusters, then relaxes only the relations already present
 * in the graph. The result has the exploratory density of a force graph while
 * remaining stable across renders and test runs.
 */
export function buildKcrRiskGraphExplorationLayout(
  nodes: readonly KcrRiskGraphNode[],
  edges: readonly KcrRiskGraphEdge[],
  mode: KcrRiskGraphLayoutMode
): KcrRiskGraphLayout {
  const compact = mode === "compact"
  const width = compact ? 760 : 1060
  const height = compact ? 820 : 690
  const center = { x: width / 2, y: height / 2 }
  const dimensions = nodes.filter((node) => node.kind === "dimension")
  const dimensionAngles = new Map<KcrRiskDimensionId, number>()
  dimensions.forEach((dimension, index) => {
    dimensionAngles.set(
      dimension.entityId as KcrRiskDimensionId,
      -Math.PI / 2 + (index * Math.PI * 2) / Math.max(dimensions.length, 1)
    )
  })
  const dimensionGroups = new Map<KcrRiskDimensionId, KcrRiskGraphNode[]>()
  nodes.forEach((node) => {
    const dimensionId = node.dimensionIds.find((id) => dimensionAngles.has(id))
    if (!dimensionId || node.kind === "company" || node.kind === "dimension") {
      return
    }
    const group = dimensionGroups.get(dimensionId) ?? []
    group.push(node)
    dimensionGroups.set(dimensionId, group)
  })

  const positions = nodes.map((node) => {
    const dimensionId = node.dimensionIds.find((id) => dimensionAngles.has(id))
    const baseAngle = dimensionId
      ? (dimensionAngles.get(dimensionId) ?? -Math.PI / 2)
      : -Math.PI / 2
    const group = dimensionId ? (dimensionGroups.get(dimensionId) ?? []) : []
    const groupIndex = Math.max(
      group.findIndex((candidate) => candidate.id === node.id),
      0
    )
    const groupOffset =
      group.length <= 1 ? 0 : -0.48 + (groupIndex * 0.96) / (group.length - 1)
    const jitter = stableGraphJitter(node.id) * 0.18
    let x = center.x
    let y = center.y

    if (node.kind === "dimension") {
      const angle =
        dimensionAngles.get(node.entityId as KcrRiskDimensionId) ?? -Math.PI / 2
      x += Math.cos(angle) * (compact ? 168 : 228)
      y += Math.sin(angle) * (compact ? 145 : 174)
    } else if (node.kind === "indicator") {
      const angle = baseAngle + groupOffset + jitter
      x += Math.cos(angle) * (compact ? 292 : 374)
      y += Math.sin(angle) * (compact ? 264 : 284)
    } else if (node.kind === "event") {
      const angle = baseAngle + groupOffset * 0.45 + jitter
      x += Math.cos(angle) * (compact ? 236 : 308)
      y += Math.sin(angle) * (compact ? 218 : 235)
    } else if (node.kind === "evidence") {
      const angle = baseAngle + groupOffset + jitter
      x += Math.cos(angle) * (compact ? 336 : 446)
      y += Math.sin(angle) * (compact ? 326 : 316)
    }

    return { x, y, initialX: x, initialY: y, velocityX: 0, velocityY: 0 }
  })
  const indexById = new Map(nodes.map((node, index) => [node.id, index]))
  const radii = nodes.map((node) => {
    const box = graphNodeBox(node)
    return Math.max(box.width, box.height) * 0.54
  })

  for (let iteration = 0; iteration < 180; iteration += 1) {
    const acceleration = nodes.map(() => ({ x: 0, y: 0 }))

    for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < nodes.length;
        rightIndex += 1
      ) {
        const left = positions[leftIndex]
        const right = positions[rightIndex]
        let dx = right.x - left.x
        let dy = right.y - left.y
        let distance = Math.hypot(dx, dy)
        if (distance < 0.01) {
          dx = stableGraphJitter(
            `${nodes[leftIndex].id}:${nodes[rightIndex].id}`
          )
          dy = 1
          distance = Math.hypot(dx, dy)
        }
        const minimumDistance = radii[leftIndex] + radii[rightIndex] + 8
        const repulsion =
          1900 / Math.max(distance * distance, 80) +
          Math.max(minimumDistance - distance, 0) * 0.075
        const forceX = (dx / distance) * repulsion
        const forceY = (dy / distance) * repulsion
        acceleration[leftIndex].x -= forceX
        acceleration[leftIndex].y -= forceY
        acceleration[rightIndex].x += forceX
        acceleration[rightIndex].y += forceY
      }
    }

    edges.forEach((edge) => {
      const sourceIndex = indexById.get(edge.source)
      const targetIndex = indexById.get(edge.target)
      if (sourceIndex === undefined || targetIndex === undefined) return
      const source = positions[sourceIndex]
      const target = positions[targetIndex]
      const dx = target.x - source.x
      const dy = target.y - source.y
      const distance = Math.hypot(dx, dy) || 1
      const desiredLength =
        edge.kind === "propagation"
          ? 235
          : edge.kind === "structure"
            ? 138
            : edge.kind === "event-link"
              ? 120
              : 108
      const spring = (distance - desiredLength) * 0.012
      const forceX = (dx / distance) * spring
      const forceY = (dy / distance) * spring
      acceleration[sourceIndex].x += forceX
      acceleration[sourceIndex].y += forceY
      acceleration[targetIndex].x -= forceX
      acceleration[targetIndex].y -= forceY
    })

    nodes.forEach((node, index) => {
      const position = positions[index]
      if (node.kind === "company") {
        position.x = center.x
        position.y = center.y
        position.velocityX = 0
        position.velocityY = 0
        return
      }
      const anchorStrength = node.kind === "dimension" ? 0.028 : 0.0035
      acceleration[index].x += (position.initialX - position.x) * anchorStrength
      acceleration[index].y += (position.initialY - position.y) * anchorStrength
      acceleration[index].x += (center.x - position.x) * 0.0005
      acceleration[index].y += (center.y - position.y) * 0.0005
      position.velocityX = (position.velocityX + acceleration[index].x) * 0.82
      position.velocityY = (position.velocityY + acceleration[index].y) * 0.82
      position.x += position.velocityX
      position.y += position.velocityY
      const box = graphNodeBox(node)
      position.x = Math.min(
        Math.max(position.x, box.width / 2 + 18),
        width - box.width / 2 - 18
      )
      position.y = Math.min(
        Math.max(position.y, box.height / 2 + 18),
        height - box.height / 2 - 18
      )
    })
  }

  for (let pass = 0; pass < 32; pass += 1) {
    for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < nodes.length;
        rightIndex += 1
      ) {
        const left = positions[leftIndex]
        const right = positions[rightIndex]
        const leftBox = graphNodeBox(nodes[leftIndex])
        const rightBox = graphNodeBox(nodes[rightIndex])
        const dx = right.x - left.x
        const dy = right.y - left.y
        const overlapX = (leftBox.width + rightBox.width) / 2 + 7 - Math.abs(dx)
        const overlapY =
          (leftBox.height + rightBox.height) / 2 + 7 - Math.abs(dy)
        if (overlapX <= 0 || overlapY <= 0) continue
        const leftFixed = nodes[leftIndex].kind === "company"
        const rightFixed = nodes[rightIndex].kind === "company"
        const leftShare = leftFixed ? 0 : rightFixed ? 1 : 0.5
        const rightShare = rightFixed ? 0 : leftFixed ? 1 : 0.5
        if (overlapX < overlapY) {
          const direction = dx === 0 ? 1 : Math.sign(dx)
          left.x -= direction * overlapX * leftShare
          right.x += direction * overlapX * rightShare
        } else {
          const direction = dy === 0 ? 1 : Math.sign(dy)
          left.y -= direction * overlapY * leftShare
          right.y += direction * overlapY * rightShare
        }
      }
    }
    nodes.forEach((node, index) => {
      const box = graphNodeBox(node)
      positions[index].x = Math.min(
        Math.max(positions[index].x, box.width / 2 + 18),
        width - box.width / 2 - 18
      )
      positions[index].y = Math.min(
        Math.max(positions[index].y, box.height / 2 + 18),
        height - box.height / 2 - 18
      )
    })
  }

  const layoutNodes = nodes.map((node, index): KcrRiskGraphLayoutNode => {
    const box = graphNodeBox(node)
    return {
      id: node.id,
      x: positions[index].x,
      y: positions[index].y,
      width: box.width,
      height: box.height,
      radius: Math.max(box.width, box.height) / 2,
      angle: 0,
      layer: graphNodeLayer(node),
      shape:
        node.kind === "company"
          ? "core"
          : node.kind === "dimension"
            ? "dimension"
            : node.kind,
    }
  })

  return { width, height, center, nodes: layoutNodes }
}

function addEditorialLayoutNode(
  layoutNodes: KcrRiskGraphLayoutNode[],
  node: KcrRiskGraphNode,
  x: number,
  y: number,
  width: number,
  height: number,
  layer: 0 | 1 | 2 | 3
) {
  layoutNodes.push({
    id: node.id,
    x,
    y,
    width,
    height,
    radius: Math.max(width, height) / 2,
    angle: 0,
    layer,
    shape:
      node.kind === "company"
        ? "core"
        : node.kind === "dimension"
          ? "dimension"
          : node.kind,
  })
}

/**
 * Places the already-selected graph as an editorial hierarchy. The layout is
 * deliberately sparse and deterministic: overview, focus and lineage each
 * have a distinct reading direction, without creating or weighting relations.
 */
export function buildKcrRiskGraphNetworkLayout(
  nodes: readonly KcrRiskGraphNode[],
  _selectedDimensionId: KcrRiskDimensionId,
  mode: KcrRiskGraphLayoutMode,
  viewMode: KcrRiskGraphViewMode,
  edges: readonly KcrRiskGraphEdge[] = []
): KcrRiskGraphLayout {
  if (viewMode === "network") {
    return buildKcrRiskGraphExplorationLayout(nodes, edges, mode)
  }
  const compact = mode === "compact"
  const width = compact ? 480 : 1060
  const dimensions = nodes.filter((node) => node.kind === "dimension")
  const indicators = nodes.filter((node) => node.kind === "indicator")
  const evidence = nodes.filter((node) => node.kind === "evidence")
  const events = nodes.filter((node) => node.kind === "event")
  const companies = nodes.filter((node) => node.kind === "company")
  const layoutNodes: KcrRiskGraphLayoutNode[] = []

  if (viewMode === "overview") {
    const height = compact ? 660 : 480
    companies.forEach((node) =>
      addEditorialLayoutNode(
        layoutNodes,
        node,
        width / 2,
        compact ? 64 : 62,
        compact ? 176 : 190,
        68,
        0
      )
    )
    const dimensionXs = distributeKcrRiskGraphPositions(
      dimensions.length,
      compact ? 116 : 116,
      compact ? 364 : 944
    )
    dimensions.forEach((node, index) =>
      addEditorialLayoutNode(
        layoutNodes,
        node,
        compact ? (index % 2 === 0 ? 116 : 364) : dimensionXs[index],
        compact ? 190 + Math.floor(index / 2) * 104 : 224,
        compact ? 176 : 146,
        62,
        1
      )
    )
    events.forEach((node, index) => {
      const relatedDimensionIndex = dimensions.findIndex((dimension) =>
        node.dimensionIds.includes(dimension.entityId as KcrRiskDimensionId)
      )
      const fallbackX = distributeKcrRiskGraphPositions(
        events.length,
        compact ? 116 : 220,
        compact ? 364 : 840
      )[index]
      addEditorialLayoutNode(
        layoutNodes,
        node,
        compact
          ? index % 2 === 0
            ? 116
            : 364
          : (dimensionXs[relatedDimensionIndex] ?? fallbackX),
        compact ? 542 + Math.floor(index / 2) * 92 : 394,
        compact ? 176 : 154,
        64,
        2
      )
    })
    return {
      width,
      height,
      center: { x: width / 2, y: height / 2 },
      nodes: layoutNodes,
    }
  }

  if (viewMode === "focus") {
    if (compact) {
      let cursorY = 60
      companies.forEach((node) =>
        addEditorialLayoutNode(layoutNodes, node, 130, cursorY, 190, 68, 0)
      )
      dimensions.forEach((node) =>
        addEditorialLayoutNode(layoutNodes, node, 354, cursorY, 190, 68, 1)
      )
      cursorY += 128
      const indicatorYs = indicators.map(
        (_, index) => cursorY + Math.floor(index / 2) * 96
      )
      indicators.forEach((node, index) =>
        addEditorialLayoutNode(
          layoutNodes,
          node,
          index % 2 === 0 ? 124 : 356,
          indicatorYs[index],
          190,
          62,
          2
        )
      )
      cursorY += Math.ceil(indicators.length / 2) * 96
      events.forEach((node, index) =>
        addEditorialLayoutNode(
          layoutNodes,
          node,
          events.length === 1 ? 240 : index % 2 === 0 ? 124 : 356,
          cursorY + Math.floor(index / 2) * 92,
          190,
          62,
          2
        )
      )
      cursorY += Math.ceil(events.length / 2) * 92
      evidence.forEach((node, index) =>
        addEditorialLayoutNode(
          layoutNodes,
          node,
          index % 2 === 0 ? 124 : 356,
          cursorY + Math.floor(index / 2) * 88,
          190,
          58,
          3
        )
      )
      const height = Math.max(
        460,
        cursorY + Math.ceil(evidence.length / 2) * 88 + 54
      )
      return {
        width,
        height,
        center: { x: width / 2, y: height / 2 },
        nodes: layoutNodes,
      }
    }

    const height = evidence.length ? 520 : 390
    companies.forEach((node) =>
      addEditorialLayoutNode(layoutNodes, node, 126, 68, 190, 68, 0)
    )
    dimensions.forEach((node) =>
      addEditorialLayoutNode(layoutNodes, node, 370, 68, 174, 68, 1)
    )
    const indicatorXs = distributeKcrRiskGraphPositions(
      indicators.length,
      130,
      events.length ? 760 : 930
    )
    indicators.forEach((node, index) =>
      addEditorialLayoutNode(
        layoutNodes,
        node,
        indicatorXs[index],
        238,
        148,
        62,
        2
      )
    )
    events.forEach((node, index) =>
      addEditorialLayoutNode(
        layoutNodes,
        node,
        930,
        238 + index * 84,
        158,
        64,
        2
      )
    )
    const evidenceXs = distributeKcrRiskGraphPositions(
      evidence.length,
      180,
      880
    )
    evidence.forEach((node, index) =>
      addEditorialLayoutNode(
        layoutNodes,
        node,
        evidenceXs[index],
        430,
        156,
        60,
        3
      )
    )
    return {
      width,
      height,
      center: { x: width / 2, y: height / 2 },
      nodes: layoutNodes,
    }
  }

  if (compact) {
    const orderedGroups = [companies, dimensions, indicators, events]
    let cursorY = 54
    orderedGroups.forEach((group, groupIndex) => {
      group.forEach((node, index) =>
        addEditorialLayoutNode(
          layoutNodes,
          node,
          group.length === 1 ? 240 : index % 2 === 0 ? 124 : 356,
          cursorY + Math.floor(index / 2) * 88,
          190,
          62,
          Math.min(groupIndex, 2) as 0 | 1 | 2
        )
      )
      cursorY += Math.max(1, Math.ceil(group.length / 2)) * 96
    })
    evidence.forEach((node, index) =>
      addEditorialLayoutNode(
        layoutNodes,
        node,
        index % 2 === 0 ? 124 : 356,
        cursorY + Math.floor(index / 2) * 88,
        190,
        58,
        3
      )
    )
    const height = cursorY + Math.max(1, Math.ceil(evidence.length / 2)) * 88
    return {
      width,
      height,
      center: { x: width / 2, y: height / 2 },
      nodes: layoutNodes,
    }
  }

  const height = 430
  const columnXs = [105, 330, 555, 790]
  ;[companies, dimensions, indicators, events].forEach((group, groupIndex) => {
    const ys = distributeKcrRiskGraphPositions(group.length, 100, 250)
    group.forEach((node, index) =>
      addEditorialLayoutNode(
        layoutNodes,
        node,
        columnXs[groupIndex],
        ys[index],
        groupIndex === 0 ? 170 : 160,
        64,
        Math.min(groupIndex, 2) as 0 | 1 | 2
      )
    )
  })
  const evidenceXs = distributeKcrRiskGraphPositions(evidence.length, 520, 950)
  evidence.forEach((node, index) =>
    addEditorialLayoutNode(
      layoutNodes,
      node,
      evidenceXs[index],
      350,
      158,
      58,
      3
    )
  )
  return {
    width,
    height,
    center: { x: width / 2, y: height / 2 },
    nodes: layoutNodes,
  }
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
  dimensionId: KcrRiskDimensionId,
  expandedNodeId?: string
): KcrRiskKnowledgeGraph {
  const includedNodeIds = new Set(
    graph.nodes
      .filter(
        (node) =>
          node.kind === "company" ||
          (node.kind === "dimension" && node.entityId === dimensionId) ||
          (node.kind !== "evidence" && node.dimensionIds.includes(dimensionId))
      )
      .map((node) => node.id)
  )

  if (expandedNodeId) {
    const expandedNode = graph.nodes.find((node) => node.id === expandedNodeId)
    if (expandedNode?.kind === "evidence") {
      includedNodeIds.add(expandedNode.id)
    } else if (
      expandedNode &&
      expandedNode.dimensionIds.includes(dimensionId)
    ) {
      graph.edges
        .filter(
          (edge) =>
            (edge.source === expandedNodeId ||
              edge.target === expandedNodeId) &&
            graph.nodes.some(
              (node) =>
                node.kind === "evidence" &&
                (node.id === edge.source || node.id === edge.target)
            )
        )
        .forEach((edge) => {
          includedNodeIds.add(edge.source)
          includedNodeIds.add(edge.target)
        })
    }
  }

  const nodes = graph.nodes.filter((node) => includedNodeIds.has(node.id))
  const nodeKindById = new Map(graph.nodes.map((node) => [node.id, node.kind]))
  const edges = graph.edges.filter((edge) => {
    if (
      !includedNodeIds.has(edge.source) ||
      !includedNodeIds.has(edge.target)
    ) {
      return false
    }
    const touchesEvidence =
      nodeKindById.get(edge.source) === "evidence" ||
      nodeKindById.get(edge.target) === "evidence"
    return (
      !touchesEvidence ||
      !expandedNodeId ||
      edge.source === expandedNodeId ||
      edge.target === expandedNodeId
    )
  })

  return {
    nodes,
    edges,
    counts: graph.counts,
  }
}

export function selectKcrRiskGraphOverview(
  graph: KcrRiskKnowledgeGraph
): KcrRiskKnowledgeGraph {
  const includedNodeIds = new Set(
    graph.nodes
      .filter(
        (node) =>
          node.kind === "company" ||
          node.kind === "dimension" ||
          node.kind === "event"
      )
      .map((node) => node.id)
  )
  const nodes = graph.nodes.filter((node) => includedNodeIds.has(node.id))
  const edges = graph.edges.filter(
    (edge) =>
      includedNodeIds.has(edge.source) && includedNodeIds.has(edge.target)
  )

  return { nodes, edges, counts: graph.counts }
}

export function selectKcrRiskGraphLineage(
  graph: KcrRiskKnowledgeGraph,
  eventId?: string
): KcrRiskKnowledgeGraph {
  const targetEvent = eventId
    ? graph.nodes.find(
        (node) => node.kind === "event" && node.entityId === eventId
      )
    : graph.nodes.find((node) => node.kind === "event")
  const includedNodeIds = new Set(
    graph.nodes
      .filter((node) => node.kind === "company" || node.id === targetEvent?.id)
      .map((node) => node.id)
  )

  graph.edges
    .filter(
      (edge) =>
        (edge.kind === "event-link" || edge.kind === "propagation") &&
        (edge.source === targetEvent?.id || edge.target === targetEvent?.id)
    )
    .forEach((edge) => {
      if (
        includedNodeIds.has(edge.source) ||
        includedNodeIds.has(edge.target)
      ) {
        includedNodeIds.add(edge.source)
        includedNodeIds.add(edge.target)
      }
    })

  graph.nodes
    .filter(
      (node) =>
        includedNodeIds.has(node.id) &&
        (node.kind === "indicator" || node.kind === "event")
    )
    .flatMap((node) => node.dimensionIds)
    .forEach((dimensionId) =>
      includedNodeIds.add(nodeId.dimension(dimensionId))
    )

  graph.edges
    .filter(
      (edge) =>
        (edge.kind === "direct" ||
          edge.kind === "inferred" ||
          edge.kind === "background") &&
        includedNodeIds.has(edge.source)
    )
    .forEach((edge) => {
      includedNodeIds.add(edge.source)
      includedNodeIds.add(edge.target)
    })

  const nodes = graph.nodes.filter((node) => includedNodeIds.has(node.id))
  const edges = graph.edges.filter(
    (edge) =>
      includedNodeIds.has(edge.source) && includedNodeIds.has(edge.target)
  )

  return { nodes, edges, counts: graph.counts }
}
