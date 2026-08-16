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
  distributeKcrRiskGraphPositions,
  selectKcrRiskGraphDimension,
  selectKcrRiskGraphLineage,
  selectKcrRiskGraphOverview,
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

test("overview keeps a legible eight-node summary while preserving full counts", () => {
  const graph = buildKcrRiskKnowledgeGraph(response, "寒武纪")
  const overview = selectKcrRiskGraphOverview(graph)

  assert.equal(overview.nodes.length, 8)
  assert.equal(overview.edges.length, 7)
  assert.deepEqual(overview.counts, graph.counts)
  assert.deepEqual(
    overview.nodes
      .filter((node) => node.kind === "dimension")
      .map((node) => node.entityId),
    ["technology", "compliance", "finance", "external", "personnel-governance"]
  )
  assert.equal(overview.nodes.filter((node) => node.kind === "event").length, 2)
  assert.equal(
    overview.nodes.filter((node) => node.kind === "indicator").length,
    0
  )
  assert.equal(
    overview.nodes.filter((node) => node.kind === "evidence").length,
    0
  )
})

test("dimension focus starts with one risk cluster and expands only selected evidence", () => {
  const graph = buildKcrRiskKnowledgeGraph(response, "寒武纪")
  const external = selectKcrRiskGraphDimension(graph, "external")

  assert.equal(external.nodes.length, 6)
  assert.equal(external.edges.length, 6)
  assert.deepEqual(
    external.nodes
      .filter((node) => node.kind === "dimension")
      .map((node) => node.entityId),
    ["external"]
  )
  assert.equal(
    external.nodes.filter((node) => node.kind === "evidence").length,
    0
  )

  const expanded = selectKcrRiskGraphDimension(
    graph,
    "external",
    "indicator:E03"
  )
  assert.equal(expanded.nodes.length, 8)
  assert.equal(expanded.edges.length, 8)
  assert.deepEqual(
    expanded.nodes
      .filter((node) => node.kind === "evidence")
      .map((node) => node.entityId),
    ["S04", "S05"]
  )
})

test("editorial and complete-network layouts stay deterministic, bounded, and collision-free", () => {
  const graph = buildKcrRiskKnowledgeGraph(response, "寒武纪")
  const viewGraphs = {
    overview: selectKcrRiskGraphOverview(graph),
    network: graph,
    focus: selectKcrRiskGraphDimension(graph, "external", "indicator:E03"),
    lineage: selectKcrRiskGraphLineage(graph, "EV001"),
  }

  for (const [viewMode, viewGraph] of Object.entries(viewGraphs)) {
    for (const mode of ["desktop", "compact"] as const) {
      const layout = buildKcrRiskGraphNetworkLayout(
        viewGraph.nodes,
        "external",
        mode,
        viewMode as keyof typeof viewGraphs,
        viewGraph.edges
      )
      assert.equal(layout.nodes.length, viewGraph.nodes.length)
      if (viewMode === "network") {
        assert.equal(layout.nodes.length, 34)
        assert.deepEqual(
          layout,
          buildKcrRiskGraphNetworkLayout(
            viewGraph.nodes,
            "external",
            mode,
            "network",
            viewGraph.edges
          )
        )
      }
      layout.nodes.forEach((node, index) => {
        const width = node.width ?? node.radius * 2
        const height = node.height ?? node.radius * 2
        assert.ok(
          node.x - width / 2 >= 0,
          `${viewMode}/${mode}: ${node.id} left`
        )
        assert.ok(
          node.x + width / 2 <= layout.width,
          `${viewMode}/${mode}: ${node.id} right`
        )
        assert.ok(
          node.y - height / 2 >= 0,
          `${viewMode}/${mode}: ${node.id} top`
        )
        assert.ok(
          node.y + height / 2 <= layout.height,
          `${viewMode}/${mode}: ${node.id} bottom`
        )

        layout.nodes.slice(index + 1).forEach((other) => {
          const otherWidth = other.width ?? other.radius * 2
          const otherHeight = other.height ?? other.radius * 2
          const separated =
            Math.abs(node.x - other.x) >= (width + otherWidth) / 2 ||
            Math.abs(node.y - other.y) >= (height + otherHeight) / 2
          assert.ok(
            separated,
            `${viewMode}/${mode}: ${node.id} overlaps ${other.id}`
          )
        })
      })
    }
  }
})

test("risk lineage isolates one red flag, its indicator, evidence, and propagation", () => {
  const graph = buildKcrRiskKnowledgeGraph(response, "寒武纪")
  const lineage = selectKcrRiskGraphLineage(graph, "EV001")

  assert.deepEqual(
    lineage.nodes
      .filter((node) => node.kind === "event")
      .map((node) => node.entityId),
    ["EV001"]
  )
  assert.deepEqual(
    lineage.nodes
      .filter((node) => node.kind === "indicator")
      .map((node) => node.entityId),
    ["E03"]
  )
  assert.equal(
    lineage.edges.filter((edge) => edge.kind === "propagation").length,
    1
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
  assert.match(component, /结构总览/)
  assert.match(component, /完整图谱/)
  assert.match(component, /维度聚焦/)
  assert.match(component, /事件溯源/)
  assert.match(component, /搜索图谱节点/)
  assert.match(component, /图中缩写速查/)
  assert.match(component, /networkNodeShortLabel/)
  assert.match(component, /点击条目可在完整图谱中定位并高亮直接关系/)
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

test("knowledge graph renders both full-network exploration and progressive detail", () => {
  const component = readFileSync(
    join(projectRoot, "src/components/dashboard/kcr-risk-knowledge-graph.tsx"),
    "utf8"
  )
  const styles = readFileSync(join(projectRoot, "src/styles/pages.css"), "utf8")

  assert.match(component, /buildKcrRiskGraphNetworkLayout/)
  assert.match(component, /roundedOrthogonalPath/)
  assert.match(component, /explorationConnectorPath/)
  assert.match(component, /kcr-risk-graph-network-controls/)
  assert.match(component, /onPointerDown=\{startNetworkPan\}/)
  assert.match(component, /onWheel=\{zoomNetwork\}/)
  assert.match(component, /kcr-risk-graph-context-switcher/)
  assert.match(component, /selectKcrRiskGraphOverview/)
  assert.doesNotMatch(component, /kcr-risk-graph-orbit/)
  assert.match(component, /<circle/)
  assert.match(component, /<polygon/)
  assert.doesNotMatch(component, /x: 100, y: 325/)
  assert.doesNotMatch(
    styles,
    /\.kcr-risk-graph-canvas\s*\{[^}]*min-width:\s*(?:[5-9]\d{2,}|[1-9]\d{3,})px/s
  )
})
