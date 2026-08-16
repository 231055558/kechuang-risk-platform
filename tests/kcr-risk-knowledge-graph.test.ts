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
  buildKcrRiskGraphNetworkLayout,
  buildKcrRiskGraphRadialLayout,
  distributeKcrRiskGraphPositions,
  selectKcrRiskGraphDimension,
  selectKcrRiskGraphLineage,
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

test("radial layout keeps the company central and expands detail nodes into outer orbits", () => {
  const graph = buildKcrRiskKnowledgeGraph(response, "寒武纪")
  const external = selectKcrRiskGraphDimension(graph, "external")
  const layout = buildKcrRiskGraphRadialLayout(
    external.nodes,
    "external",
    "desktop"
  )
  const company = layout.nodes.find((node) => node.shape === "core")
  const dimensions = layout.nodes.filter((node) => node.layer === 1)
  const detailNodes = layout.nodes.filter((node) => node.layer >= 2)

  assert.deepEqual(company, {
    id: "company:cambricon",
    x: layout.center.x,
    y: layout.center.y,
    radius: 64,
    angle: 0,
    layer: 0,
    shape: "core",
  })
  assert.equal(dimensions.length, 5)
  assert.equal(new Set(dimensions.map((node) => node.angle)).size, 5)
  assert.ok(
    detailNodes.every((node) => {
      const distance = Math.hypot(
        node.x - layout.center.x,
        node.y - layout.center.y
      )
      return distance > 190
    })
  )
})

test("compact radial layout remains inside its viewport without horizontal overflow", () => {
  const graph = buildKcrRiskKnowledgeGraph(response, "寒武纪")
  const external = selectKcrRiskGraphDimension(graph, "external")
  const layout = buildKcrRiskGraphRadialLayout(
    external.nodes,
    "external",
    "compact"
  )

  assert.deepEqual([layout.width, layout.height], [400, 450])
  layout.nodes.forEach((node) => {
    assert.ok(node.x - node.radius >= 0, `${node.id} exceeds left edge`)
    assert.ok(
      node.x + node.radius <= layout.width,
      `${node.id} exceeds right edge`
    )
    assert.ok(node.y - node.radius >= 0, `${node.id} exceeds top edge`)
    assert.ok(
      node.y + node.radius <= layout.height,
      `${node.id} exceeds bottom edge`
    )
  })
})

test("overview layout places every snapshot node in the full network", () => {
  const graph = buildKcrRiskKnowledgeGraph(response, "寒武纪")
  const layout = buildKcrRiskGraphNetworkLayout(
    graph.nodes,
    "external",
    "desktop",
    "overview"
  )

  assert.equal(layout.nodes.length, graph.nodes.length)
  assert.equal(new Set(layout.nodes.map((node) => node.id)).size, 34)
  assert.deepEqual([layout.width, layout.height], [1060, 720])
  assert.equal(layout.nodes.filter((node) => node.layer === 1).length, 5)
  assert.equal(layout.nodes.filter((node) => node.layer === 2).length, 20)

  for (const mode of ["desktop", "compact"] as const) {
    const currentLayout = buildKcrRiskGraphNetworkLayout(
      graph.nodes,
      "external",
      mode,
      "overview"
    )
    currentLayout.nodes.forEach((node, index) => {
      currentLayout.nodes.slice(index + 1).forEach((other) => {
        const gap =
          Math.hypot(node.x - other.x, node.y - other.y) -
          node.radius -
          other.radius
        assert.ok(gap >= 0, `${mode}: ${node.id} overlaps ${other.id}`)
      })
    })
  }
})

test("risk lineage keeps red flags, their indicators, evidence, and propagation", () => {
  const graph = buildKcrRiskKnowledgeGraph(response, "寒武纪")
  const lineage = selectKcrRiskGraphLineage(graph)

  assert.deepEqual(
    lineage.nodes
      .filter((node) => node.kind === "event")
      .map((node) => node.entityId),
    ["EV001", "EV002"]
  )
  assert.deepEqual(
    lineage.nodes
      .filter((node) => node.kind === "indicator")
      .map((node) => node.entityId),
    ["C03", "E03"]
  )
  assert.equal(
    lineage.edges.filter((edge) => edge.kind === "propagation").length,
    2
  )
  assert.ok(
    lineage.edges.every(
      (edge) =>
        lineage.nodes.some((node) => node.id === edge.source) &&
        lineage.nodes.some((node) => node.id === edge.target)
    )
  )
})

test("knowledge graph UI exposes node inspection and evidence semantics", () => {
  const component = readFileSync(
    join(projectRoot, "src/components/dashboard/kcr-risk-knowledge-graph.tsx"),
    "utf8"
  )
  const panel = readFileSync(
    join(projectRoot, "src/components/dashboard/kcr-v3-assessment-panel.tsx"),
    "utf8"
  )

  assert.match(component, /企业风险知识图谱/)
  assert.match(component, /全景网络/)
  assert.match(component, /维度聚焦/)
  assert.match(component, /风险脉络/)
  assert.match(component, /搜索图谱节点/)
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

test("knowledge graph renders responsive full-network and focus layouts", () => {
  const component = readFileSync(
    join(projectRoot, "src/components/dashboard/kcr-risk-knowledge-graph.tsx"),
    "utf8"
  )
  const styles = readFileSync(join(projectRoot, "src/styles/pages.css"), "utf8")

  assert.match(component, /buildKcrRiskGraphNetworkLayout/)
  assert.match(component, /kcr-risk-graph-orbit/)
  assert.match(component, /<circle/)
  assert.match(component, /<polygon/)
  assert.doesNotMatch(component, /kcr-risk-graph-dimension-filters/)
  assert.doesNotMatch(component, /x: 100, y: 325/)
  assert.doesNotMatch(
    styles,
    /\.kcr-risk-graph-canvas\s*\{[^}]*min-width:\s*(?:[5-9]\d{2,}|[1-9]\d{3,})px/s
  )
})
