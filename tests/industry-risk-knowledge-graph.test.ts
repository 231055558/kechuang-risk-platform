import assert from "node:assert/strict"
import test from "node:test"

import { getIndustryRiskKnowledgeGraph } from "../server/industry-risk-service.ts"
import {
  buildIndustryRiskGraphLayout,
  selectIndustryRiskGraph,
} from "../src/lib/industry-risk-graph-layout.ts"

const graph = getIndustryRiskKnowledgeGraph()

test("industry graph preserves every source dataset relationship class", () => {
  assert.deepEqual(graph.counts, {
    nodes: 209,
    edges: 526,
    scoredCompanies: 10,
    evidenceOnlyCompanies: 6,
    indicators: 22,
    events: 48,
    artifacts: 84,
  })
  const kinds = graph.edges.reduce<Record<string, number>>((counts, edge) => {
    counts[edge.kind] = (counts[edge.kind] ?? 0) + 1
    return counts
  }, {})
  assert.deepEqual(kinds, {
    hierarchy: 17,
    coverage: 220,
    provenance: 109,
    "event-link": 96,
    material: 84,
  })
  const nodeIds = new Set(graph.nodes.map((node) => node.id))
  assert.ok(
    graph.edges.every(
      (edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target)
    )
  )
})

test("company focus keeps only relations belonging to the selected company", () => {
  const focus = selectIndustryRiskGraph(graph, "star-688256")
  assert.ok(focus.nodes.length < graph.nodes.length)
  assert.ok(focus.edges.length < graph.edges.length)
  assert.ok(
    focus.edges.every((edge) => edge.companyIds.includes("star-688256"))
  )
  assert.ok(focus.nodes.some((node) => node.id === "company:star-688256"))
  assert.ok(focus.nodes.some((node) => node.kind === "artifact"))
})

test("complete and focused graph layouts are deterministic and bounded", () => {
  for (const candidate of [
    graph,
    selectIndustryRiskGraph(graph, "star-688256"),
  ]) {
    const first = buildIndustryRiskGraphLayout(candidate)
    const second = buildIndustryRiskGraphLayout(candidate)
    assert.deepEqual(first, second)
    assert.equal(first.nodes.length, candidate.nodes.length)
    assert.ok(
      first.nodes.every(
        (node) =>
          node.x >= 0 &&
          node.x <= first.width &&
          node.y >= 0 &&
          node.y <= first.height
      )
    )
  }
})
