import assert from "node:assert/strict"
import test from "node:test"

import { getIndustryRiskKnowledgeGraph } from "../server/industry-risk-service.ts"
import {
  buildIndustryRiskCytoscapeElements,
  riskHeatColor,
  selectIndustryRiskGraph,
  type IndustryRiskCytoscapeNodeData,
} from "../src/lib/industry-risk-graph-view.ts"

const graph = getIndustryRiskKnowledgeGraph()

test("industry graph keeps the agreed company-category-indicator-evidence structure", () => {
  assert.deepEqual(graph.counts, {
    nodes: 416,
    edges: 1_257,
    companies: 37,
    categories: 6,
    indicators: 22,
    sources: 180,
    events: 171,
  })
  const kinds = graph.edges.reduce<Record<string, number>>((counts, edge) => {
    counts[edge.kind] = (counts[edge.kind] ?? 0) + 1
    return counts
  }, {})
  assert.deepEqual(kinds, {
    hierarchy: 244,
    provenance: 842,
    "event-link": 171,
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
  assert.equal(focus.nodes.filter((node) => node.kind === "indicator").length, 22)
  assert.equal(focus.nodes.filter((node) => node.kind === "source").length, 8)
  assert.equal(focus.nodes.filter((node) => node.kind === "event").length, 22)
  assert.equal(focus.nodes.length, 59)
  assert.equal(focus.edges.length, 81)
  assert.ok(
    focus.edges.every((edge) => edge.companyIds.includes("star-688256"))
  )
  assert.ok(focus.nodes.some((node) => node.id === "company:star-688256"))
  assert.equal(
    focus.nodes.find((node) => node.id === "indicator:R19")?.score,
    93.06
  )
  assert.equal(
    focus.nodes.find((node) => node.id === "category:叙事风险（主观校验项，不直接计入总权重）")
      ?.score,
    null
  )
  assert.equal(
    focus.nodes.find((node) => node.id === "category:技术风险")?.score,
    31.48
  )
  assert.ok(
    focus.nodes.every(
      (node) => node.kind !== "company" || node.entityId === "star-688256"
    )
  )
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

test("Cytoscape view uses compound risk groups without dropping relations", () => {
  const focus = selectIndustryRiskGraph(graph, "star-688256")
  const elements = buildIndustryRiskCytoscapeElements(focus)
  const nodes = elements
    .map((element) => element.data)
    .filter(
      (data): data is IndustryRiskCytoscapeNodeData => "entityId" in data
    )
  const edges = elements
    .map((element) => element.data)
    .filter((data) => "source" in data)

  assert.equal(nodes.length, 59)
  assert.equal(edges.length, 59)
  assert.equal(nodes.filter((node) => node.kind === "category").length, 6)
  assert.ok(
    nodes
      .filter((node) => node.kind === "indicator")
      .every(
        (node) =>
          node.parent?.startsWith("category:") &&
          nodes.some((candidate) => candidate.id === node.parent)
      )
  )
  assert.ok(
    focus.edges
      .filter(
        (edge) =>
          edge.kind === "hierarchy" && edge.source.startsWith("category:")
      )
      .every((edge) => nodeData(focus, edge.target)?.parent === edge.source)
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
  const missingIndicator = nodeData(cambricon, "indicator:R09")
  const peerR19 = nodeData(peer, "indicator:R19")

  assert.ok(lowRiskIndicator)
  assert.ok(highRiskIndicator)
  assert.ok(missingIndicator)
  assert.ok(peerR19)
  assert.ok(highRiskIndicator.size > lowRiskIndicator.size)
  assert.notEqual(highRiskIndicator.color, lowRiskIndicator.color)
  assert.equal(missingIndicator.scored, false)
  assert.equal(missingIndicator.color, "#64748b")
  assert.equal(missingIndicator.size, 34)
  assert.notEqual(highRiskIndicator.size, peerR19.size)
  assert.notEqual(highRiskIndicator.color, peerR19.color)

  assert.equal(riskHeatColor(null), "#64748b")
  assert.equal(riskHeatColor(0), "#22d3ee")
  assert.equal(riskHeatColor(50), "#facc15")
  assert.equal(riskHeatColor(100), "#ef4444")
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
      (data): data is Extract<
        (typeof elements)[number]["data"],
        { source: string }
      > => "source" in data
    )
  assert.ok(
    edges.every((edge) => nodes.has(edge.source) && nodes.has(edge.target))
  )
})

test("all 37 companies produce distinct risk-driven visual signatures", () => {
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

  assert.equal(signatures.length, 37)
  assert.equal(new Set(signatures).size, 37)
})
