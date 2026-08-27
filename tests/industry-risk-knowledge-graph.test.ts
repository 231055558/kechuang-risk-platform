import assert from "node:assert/strict"
import test from "node:test"

import { getIndustryRiskKnowledgeGraph } from "../server/industry-risk-service.ts"
import {
  buildIndustryRiskCytoscapeElements,
  riskHeatColor,
  selectIndustryRiskGraph,
  selectIndustryRiskGraphView,
  type IndustryRiskCytoscapeNodeData,
} from "../src/lib/industry-risk-graph-view.ts"

const graph = getIndustryRiskKnowledgeGraph()

test("industry graph keeps the agreed company-category-indicator-evidence structure", () => {
  assert.deepEqual(graph.counts, {
    nodes: 1388,
    edges: 3387,
    companies: 94,
    categories: 6,
    indicators: 22,
    sources: 657,
    events: 609,
  })
  const kinds = graph.edges.reduce<Record<string, number>>((counts, edge) => {
    counts[edge.kind] = (counts[edge.kind] ?? 0) + 1
    return counts
  }, {})
  assert.deepEqual(kinds, {
    hierarchy: 586,
    provenance: 2192,
    "event-link": 609,
  })
  const nodeIds = new Set(graph.nodes.map((node) => node.id))
  assert.ok(
    graph.edges.every(
      (edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target)
    )
  )
})

test("company focus is complete but contains no other enterprise", () => {
  const focus = selectIndustryRiskGraph(graph, "star-688256")
  assert.equal(focus.nodes.filter((node) => node.kind === "company").length, 1)
  assert.equal(focus.nodes.filter((node) => node.kind === "category").length, 6)
  assert.equal(
    focus.nodes.filter((node) => node.kind === "indicator").length,
    22
  )
  assert.equal(focus.nodes.filter((node) => node.kind === "source").length, 15)
  assert.equal(focus.nodes.filter((node) => node.kind === "event").length, 22)
  assert.equal(focus.nodes.length, 66)
  assert.equal(focus.edges.length, 94)
  assert.ok(
    focus.edges.every((edge) => edge.companyIds.includes("star-688256"))
  )
  assert.ok(focus.nodes.some((node) => node.id === "company:star-688256"))
  assert.equal(
    focus.nodes.find((node) => node.id === "indicator:R19")?.score,
    73.02
  )
  assert.equal(
    focus.nodes.find(
      (node) => node.id === "category:叙事风险（主观校验项，不直接计入总权重）"
    )?.score,
    null
  )
  assert.equal(
    focus.nodes.find((node) => node.id === "category:技术风险")?.score,
    41.79
  )
  assert.ok(
    focus.nodes.every(
      (node) => node.kind !== "company" || node.entityId === "star-688256"
    )
  )
})

test("graph view separates narrative observations from objective risk scores", () => {
  const focus = selectIndustryRiskGraph(graph, "star-688256")
  const narrative = selectIndustryRiskGraphView(focus, "narrative")
  const objective = selectIndustryRiskGraphView(focus, "objective")

  assert.equal(
    narrative.nodes.filter((node) => node.kind === "indicator").length,
    4
  )
  assert.deepEqual(
    narrative.nodes
      .filter((node) => node.kind === "indicator")
      .map((node) => node.entityId)
      .sort(),
    ["R01", "R02", "R03", "R04"]
  )
  assert.equal(
    narrative.nodes.filter((node) => node.kind === "category").length,
    1
  )
  assert.equal(
    objective.nodes.filter((node) => node.kind === "indicator").length,
    18
  )
  assert.equal(
    objective.nodes.filter((node) => node.kind === "category").length,
    5
  )

  const narrativeR01 = nodeData(narrative, "indicator:R01")
  assert.ok(narrativeR01)
  assert.equal(narrativeR01.score, null)
  assert.equal(narrativeR01.scoreLabel, "观察")
  assert.equal(narrativeR01.color, "#8b5cf6")
})

function nodeData(
  companyGraph: ReturnType<typeof selectIndustryRiskGraph>,
  id: string
) {
  return buildIndustryRiskCytoscapeElements(companyGraph)
    .map((element) => element.data)
    .find(
      (data): data is IndustryRiskCytoscapeNodeData =>
        "entityId" in data && data.id === id
    )
}

test("Cytoscape view uses a complete semantic radial graph without dropping relations", () => {
  const focus = selectIndustryRiskGraph(graph, "star-688256")
  const elements = buildIndustryRiskCytoscapeElements(focus)
  const nodeElements = elements.filter(
    (
      element
    ): element is Extract<
      (typeof elements)[number],
      { position: { x: number; y: number } }
    > => "position" in element
  )
  const nodes = nodeElements.map((element) => element.data)
  const edges = elements
    .map((element) => element.data)
    .filter((data) => "source" in data)

  assert.equal(nodes.length, 66)
  assert.equal(edges.length, 94)
  assert.equal(nodes.filter((node) => node.kind === "category").length, 6)
  assert.ok(
    nodeElements.every(
      (element) =>
        Number.isFinite(element.position.x) &&
        Number.isFinite(element.position.y)
    )
  )
  assert.deepEqual(
    nodeElements.find((element) => element.data.kind === "company")?.position,
    { x: 0, y: 0 }
  )
  assert.ok(
    focus.edges
      .filter(
        (edge) =>
          edge.kind === "hierarchy" && edge.source.startsWith("category:")
      )
      .every((edge) =>
        edges.some(
          (candidate) =>
            candidate.source === edge.source && candidate.target === edge.target
        )
      )
  )
  assert.ok(
    nodes
      .filter((node) => node.kind === "source")
      .every(
        (node) =>
          !node.label.startsWith("source-") && !node.label.startsWith("S-")
      )
  )
})

test("risk data controls Cytoscape node area and continuous heat color", () => {
  const cambricon = selectIndustryRiskGraph(graph, "star-688256")
  const peer = selectIndustryRiskGraph(graph, "star-688213")
  const lowRiskIndicator = nodeData(cambricon, "indicator:R05")
  const highRiskIndicator = nodeData(cambricon, "indicator:R19")
  const milestoneIndicator = nodeData(cambricon, "indicator:R08")
  const peerR19 = nodeData(peer, "indicator:R19")

  assert.ok(lowRiskIndicator)
  assert.ok(highRiskIndicator)
  assert.ok(milestoneIndicator)
  assert.ok(peerR19)
  assert.ok(highRiskIndicator.size > lowRiskIndicator.size)
  assert.notEqual(highRiskIndicator.color, lowRiskIndicator.color)
  assert.equal(milestoneIndicator.scored, true)
  assert.equal(milestoneIndicator.score, 35.32)
  assert.notEqual(milestoneIndicator.color, "#64748b")
  assert.ok(milestoneIndicator.size > 44)
  assert.equal(highRiskIndicator.width, highRiskIndicator.size)
  assert.equal(highRiskIndicator.height, highRiskIndicator.size)
  assert.notEqual(highRiskIndicator.size, peerR19.size)
  assert.notEqual(highRiskIndicator.color, peerR19.color)

  assert.equal(riskHeatColor(null), "#64748b")
  assert.equal(riskHeatColor(0), "#4575b4")
  assert.equal(riskHeatColor(50), "#e2b84b")
  assert.equal(riskHeatColor(100), "#bd3447")
})

test("every Cytoscape relationship resolves to a visible node", () => {
  const focus = selectIndustryRiskGraph(graph, "star-688256")
  const elements = buildIndustryRiskCytoscapeElements(focus)
  const nodes = new Set(
    elements
      .map((element) => element.data)
      .filter((data) => "entityId" in data)
      .map((data) => data.id)
  )
  const edges = elements
    .map((element) => element.data)
    .filter(
      (
        data
      ): data is Extract<
        (typeof elements)[number]["data"],
        { source: string }
      > => "source" in data
    )
  assert.ok(
    edges.every((edge) => nodes.has(edge.source) && nodes.has(edge.target))
  )
})

test("all 94 companies produce distinct risk-driven visual signatures", () => {
  const signatures = graph.nodes
    .filter((node) => node.kind === "company")
    .map((company) => {
      const focus = selectIndustryRiskGraph(graph, company.entityId)
      return buildIndustryRiskCytoscapeElements(focus)
        .map((element) => element.data)
        .filter(
          (data): data is IndustryRiskCytoscapeNodeData =>
            "entityId" in data && data.kind === "indicator"
        )
        .map((indicator) =>
          indicator.score === null
            ? `${indicator.entityId}:missing`
            : `${indicator.entityId}:${indicator.size}:${indicator.color}`
        )
        .join("|")
    })

  assert.equal(signatures.length, 94)
  assert.equal(new Set(signatures).size, 94)
})
