import assert from "node:assert/strict"
import test from "node:test"

import { getIndustryRiskKnowledgeGraph } from "../server/industry-risk-service.ts"
import {
  buildIndustryRiskGraphLayout,
  selectIndustryRiskGraph,
} from "../src/lib/industry-risk-graph-layout.ts"

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

test("focused radial graph layout is deterministic and bounded", () => {
  const focus = selectIndustryRiskGraph(graph, "star-688256")
  const first = buildIndustryRiskGraphLayout(focus)
  const second = buildIndustryRiskGraphLayout(focus)
  assert.deepEqual(first, second)
  assert.equal(first.nodes.length, focus.nodes.length)
  assert.equal(first.zones.length, 6)
  assert.ok(
    first.nodes.every(
      (node) =>
        node.x - node.width / 2 >= 0 &&
        node.x + node.width / 2 <= first.width &&
        node.y - node.height / 2 >= 0 &&
        node.y + node.height / 2 <= first.height
    )
  )
})

test("risk intensity changes graph area, heat zones, and company layout", () => {
  const cambricon = selectIndustryRiskGraph(graph, "star-688256")
  const highRiskPeer = selectIndustryRiskGraph(graph, "star-688213")
  const cambriconLayout = buildIndustryRiskGraphLayout(cambricon)
  const highRiskLayout = buildIndustryRiskGraphLayout(highRiskPeer)

  const lowRiskIndicator = cambriconLayout.nodes.find(
    (node) => node.id === "indicator:R05"
  )
  const highRiskIndicator = cambriconLayout.nodes.find(
    (node) => node.id === "indicator:R19"
  )
  assert.ok(lowRiskIndicator)
  assert.ok(highRiskIndicator)
  assert.ok(highRiskIndicator.width > lowRiskIndicator.width)
  assert.ok(highRiskIndicator.height > lowRiskIndicator.height)

  const cambriconTechnology = cambriconLayout.zones.find(
    (zone) => zone.id === "category:技术风险"
  )
  const peerTechnology = highRiskLayout.zones.find(
    (zone) => zone.id === "category:技术风险"
  )
  assert.equal(cambriconTechnology?.score, 31.48)
  assert.equal(peerTechnology?.score, 67.59)
  assert.ok(
    (peerTechnology?.radiusX ?? 0) > (cambriconTechnology?.radiusX ?? 0)
  )

  const cambriconR19 = cambriconLayout.nodes.find(
    (node) => node.id === "indicator:R19"
  )
  const peerR19 = highRiskLayout.nodes.find(
    (node) => node.id === "indicator:R19"
  )
  assert.notDeepEqual(
    { x: cambriconR19?.x, y: cambriconR19?.y },
    { x: peerR19?.x, y: peerR19?.y }
  )
})
