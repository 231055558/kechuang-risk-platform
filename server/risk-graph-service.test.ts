import assert from "node:assert/strict"
import test from "node:test"

import { RISK_GRAPH_CONTRACT_VERSION } from "../src/domain/risk-graph-v1/index.ts"
import { RiskGraphService } from "./risk-graph-service.ts"

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  })
}

const unavailableFetch = (async () => {
  throw new Error("graph service offline")
}) as typeof fetch

test("risk graph directory exposes honest coverage for all 94 companies", async () => {
  const service = new RiskGraphService({ fetchImpl: unavailableFetch })
  const directory = await service.listCompanies()

  assert.equal(directory.contractVersion, RISK_GRAPH_CONTRACT_VERSION)
  assert.equal(directory.sampleSize, 94)
  assert.equal(directory.companies.length, 94)
  assert.equal(directory.availableEnterpriseEventCount, 77)
  assert.equal(directory.availableExternalSubjectCount, 0)

  const cambricon = directory.companies.find(
    (company) => company.stockCode === "688256"
  )
  assert.equal(cambricon?.views["enterprise-event"].status, "available")
  assert.equal(
    cambricon?.views["enterprise-event"].sourceMode,
    "structured-event-projection"
  )
  assert.equal(
    cambricon?.views["external-subject"].status,
    "service-unavailable"
  )

  const noEvents = directory.companies.find(
    (company) => company.companyId === "star-688802"
  )
  assert.equal(noEvents?.views["enterprise-event"].status, "unavailable")
  assert.match(
    noEvents?.views["enterprise-event"].missingReason ?? "",
    /暂无可追溯/
  )
})

test("enterprise event fallback projects facts without inventing causal edges", async () => {
  const service = new RiskGraphService({ fetchImpl: unavailableFetch })
  const graph = await service.getGraph("star-688047", "enterprise-event", 0.5)

  assert.equal(graph.company.companyName, "龙芯中科")
  assert.equal(graph.availability.status, "available")
  assert.equal(graph.availability.sourceMode, "structured-event-projection")
  assert.equal(graph.summary.eventCount, 13)
  assert.ok(graph.nodes.some((node) => node.type === "risk_event"))
  assert.ok(graph.nodes.some((node) => node.type === "risk_indicator"))
  assert.ok(
    graph.nodes.some(
      (node) =>
        node.type === "risk_event" &&
        typeof node.attributes.impact_weight === "number" &&
        node.attributes.impact_weight >= 0 &&
        node.attributes.impact_weight <= 1
    )
  )
  assert.ok(
    graph.edges.every((edge) =>
      [
        "event_impacts_company",
        "supports_event",
        "event_maps_to_indicator",
        "belongs_to_risk_category",
      ].includes(edge.relationCode)
    )
  )
  assert.ok(graph.edges.every((edge) => edge.evidenceState === "verified"))
  assert.match(graph.summary.limitation, /不推断事件之间的因果/)
})

test("audited snapshot is preferred and internal review candidates are removed", async () => {
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input)
    if (url.endsWith("/api/companies")) {
      return jsonResponse({
        companies: [
          {
            id: "node:cambricon",
            label: "中科寒武纪科技股份有限公司",
            attributes: { stock_code: "688256", fee_kbg: true },
          },
          {
            id: "node:semidrive",
            label: "北京芯驰半导体科技股份有限公司",
            attributes: {
              stock_code: "PRIVATE-SEMIDRIVE",
              fee_kbg: true,
            },
          },
        ],
      })
    }
    if (url.includes("/api/fee-transmission?")) {
      return jsonResponse({
        snapshot_run_id: "snapshot-v1",
        event_count: 1,
        indicator_count: 1,
        nodes: [
          {
            id: "company",
            label: "寒武纪",
            type: "company",
            type_label: "企业",
            confidence: 0.98,
            needs_review: false,
            attributes: { stock_code: "688256" },
          },
          {
            id: "event",
            label: "已核验事件",
            type: "risk_event",
            type_label: "风险事件",
            confidence: 0.9,
            needs_review: false,
            attributes: {},
          },
          {
            id: "candidate",
            label: "内部候选关系",
            type: "counterparty",
            type_label: "关联主体",
            confidence: 0.4,
            needs_review: true,
            attributes: { review_reason: "待内部处理" },
          },
        ],
        edges: [
          {
            id: "event-company",
            source: "event",
            target: "company",
            relation: "影响企业",
            relation_code: "event_impacts_company",
            confidence: 0.9,
            needs_review: false,
            attributes: {},
          },
          {
            id: "candidate-company",
            source: "candidate",
            target: "company",
            relation: "候选关联",
            relation_code: "associated_with",
            confidence: 0.4,
            needs_review: true,
            attributes: {},
          },
        ],
      })
    }
    return jsonResponse({ error: "not found" }, 404)
  }) as typeof fetch

  const service = new RiskGraphService({ fetchImpl })
  const directory = await service.listCompanies()
  assert.equal(directory.availableExternalSubjectCount, 1)
  assert.equal(directory.sampleSize, 94)
  assert.equal(
    directory.companies.some(
      (company) => company.stockCode === "PRIVATE-SEMIDRIVE"
    ),
    false
  )

  const graph = await service.getGraph("star-688256", "enterprise-event", 0.5)
  assert.equal(graph.availability.sourceMode, "audited-snapshot")
  assert.equal(graph.snapshotId, "snapshot-v1")
  assert.deepEqual(
    graph.nodes.map((node) => node.id),
    ["company", "event"]
  )
  assert.deepEqual(
    graph.edges.map((edge) => edge.id),
    ["event-company"]
  )
  assert.ok(
    graph.nodes.every(
      (node) => !Object.keys(node.attributes).some((key) => /review/i.test(key))
    )
  )
})

test("external subject view stays empty when relationship evidence is absent", async () => {
  const service = new RiskGraphService({ fetchImpl: unavailableFetch })
  const graph = await service.getGraph("star-688047", "external-subject", 0.5)

  assert.equal(graph.availability.status, "unavailable")
  assert.equal(graph.nodes.length, 0)
  assert.equal(graph.edges.length, 0)
  assert.match(graph.availability.missingReason ?? "", /关联主体/)
})
