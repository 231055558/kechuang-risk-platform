import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import goldenInput from "../src/data/mvp/cambricon-scoring-input-v3.json" with { type: "json" }
import { createKcrAssessmentApiResponse } from "../src/domain/kcr-v1/assessment-api.ts"
import {
  calculateKcrAssessment,
  type KcrAssessmentRequest,
} from "../src/domain/kcr-v1/scoring-engine.ts"
import {
  buildKcrRiskKnowledgeGraph,
  distributeKcrRiskGraphPositions,
  selectKcrRiskGraphDimension,
} from "../src/lib/kcr-risk-knowledge-graph.ts"

const projectRoot = dirname(
  fileURLToPath(new URL("../package.json", import.meta.url))
)

const response = createKcrAssessmentApiResponse(
  calculateKcrAssessment(goldenInput),
  "team-workbook",
  (goldenInput as KcrAssessmentRequest).evidenceCatalog
)

test("risk graph preserves every workbook-backed entity and relation", () => {
  const graph = buildKcrRiskKnowledgeGraph(response, "寒武纪")

  assert.equal(graph.nodes.length, 34)
  assert.equal(graph.edges.length, 52)
  assert.deepEqual(graph.counts, {
    nodes: 34,
    edges: 52,
    directEvidence: 17,
    inferredEvidence: 4,
    backgroundEvidence: 1,
    propagationPaths: 2,
  })

  const nodeIds = new Set(graph.nodes.map((node) => node.id))
  graph.edges.forEach((edge) => {
    assert.ok(nodeIds.has(edge.source), `missing graph source ${edge.source}`)
    assert.ok(nodeIds.has(edge.target), `missing graph target ${edge.target}`)
  })
})

test("risk graph does not promote non-red-flag noise into an event node", () => {
  const graph = buildKcrRiskKnowledgeGraph(response, "寒武纪")
  const eventIds = graph.nodes
    .filter((node) => node.kind === "event")
    .map((node) => node.entityId)

  assert.deepEqual(eventIds, ["EV001", "EV002"])
  assert.ok(!graph.edges.some((edge) => edge.id.includes("PATH-SHAREHOLDER")))
})

test("graph layout returns no phantom position for an empty node group", () => {
  assert.deepEqual(distributeKcrRiskGraphPositions(0, 100, 500), [])
  assert.deepEqual(distributeKcrRiskGraphPositions(1, 100, 500), [300])
  assert.deepEqual(
    distributeKcrRiskGraphPositions(3, 100, 500),
    [100, 300, 500]
  )
})

test("dimension focus keeps the company, all five dimensions, and only related detail nodes", () => {
  const graph = buildKcrRiskKnowledgeGraph(response, "寒武纪")
  const external = selectKcrRiskGraphDimension(graph, "external")

  assert.equal(external.nodes.length, 13)
  assert.equal(external.edges.length, 17)
  assert.deepEqual(
    external.nodes
      .filter((node) => node.kind === "indicator")
      .map((node) => node.entityId),
    ["E01", "E02", "E03"]
  )
  assert.deepEqual(
    external.nodes
      .filter((node) => node.kind === "event")
      .map((node) => node.entityId),
    ["EV001"]
  )
})

test("knowledge graph UI exposes filters, node inspection and evidence semantics", () => {
  const component = readFileSync(
    join(projectRoot, "src/components/dashboard/kcr-risk-knowledge-graph.tsx"),
    "utf8"
  )
  const panel = readFileSync(
    join(projectRoot, "src/components/dashboard/kcr-v3-assessment-panel.tsx"),
    "utf8"
  )

  assert.match(component, /轻量风险知识图谱/)
  assert.match(component, /直接证据/)
  assert.match(component, /推断证据/)
  assert.match(component, /背景核验/)
  assert.match(component, /风险传播/)
  assert.match(component, /role="button"/)
  assert.match(component, /查看完整指标与证据链/)
  assert.match(component, /不新增评分结论/)
  assert.match(panel, /<KcrRiskKnowledgeGraph/)
  assert.doesNotMatch(panel, /关系传播将在后续任务节点接入/)
})
