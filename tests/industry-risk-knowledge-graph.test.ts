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
    nodes: 1289,
    edges: 3291,
    companies: 94,
    categories: 6,
    indicators: 22,
    sources: 558,
    events: 609,
  })
  const kinds = graph.edges.reduce<Record<string, number>>((counts, edge) => {
    counts[edge.kind] = (counts[edge.kind] ?? 0) + 1
    return counts
  }, {})
  assert.deepEqual(kinds, {
    hierarchy: 586,
    provenance: 2096,
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
  assert.equal(focus.nodes.filter((node) => node.kind === "indicator").length, 22)
  assert.equal(focus.nodes.filter((node) => node.kind === "source").length, 13)
  assert.equal(focus.nodes.filter((node) => node.kind === "event").length, 22)
  assert.equal(focus.nodes.length, 64)
  assert.equal(focus.edges.length, 92)
  assert.ok(
    focus.edges.every((edge) => edge.companyIds.includes("star-688256"))
  )
  assert.ok(focus.nodes.some((node) => node.id === "company:star-688256"))
  assert.equal(
    focus.nodes.find((node) => node.id === "indicator:R19")?.score,
    73.02
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
  assert.ok(
    first.nodes.every(
      (node) =>
        node.x >= 0 &&
        node.x <= first.width &&
        node.y >= 0 &&
        node.y <= first.height
    )
  )
})
