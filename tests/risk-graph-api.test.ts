import assert from "node:assert/strict"
import test from "node:test"

import { RiskGraphService } from "../server/risk-graph-service.ts"
import {
  RiskGraphApiError,
  fetchRiskGraph,
  fetchRiskGraphCompanies,
} from "../src/lib/risk-graph-api.ts"

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  })
}

const unavailableFetch = (async () => {
  throw new Error("offline")
}) as typeof fetch

test("risk graph client validates the directory and graph references", async () => {
  const service = new RiskGraphService({ fetchImpl: unavailableFetch })
  const directoryPayload = await service.listCompanies()
  const graphPayload = await service.getGraph(
    "star-688047",
    "enterprise-event",
    0.65
  )
  const paths: string[] = []

  const directory = await fetchRiskGraphCompanies({
    fetch: async (input) => {
      paths.push(String(input))
      return jsonResponse(directoryPayload)
    },
  })
  assert.equal(directory.sampleSize, 94)

  const graph = await fetchRiskGraph("star-688047", "enterprise-event", {
    minWeight: 0.65,
    fetch: async (input) => {
      paths.push(String(input))
      return jsonResponse(graphPayload)
    },
  })
  assert.equal(graph.company.companyName, "龙芯中科")
  assert.deepEqual(paths, [
    "api/v1/risk-graphs/companies",
    "api/v1/risk-graphs/companies/star-688047/views/enterprise-event?minWeight=0.65",
  ])
})

test("risk graph client rejects dangling edge references", async () => {
  const service = new RiskGraphService({ fetchImpl: unavailableFetch })
  const malformed = await service.getGraph("star-688047", "enterprise-event")
  malformed.edges[0].target = "missing-node"

  await assert.rejects(
    fetchRiskGraph("star-688047", "enterprise-event", {
      fetch: async () => jsonResponse(malformed),
    }),
    (error: unknown) =>
      error instanceof RiskGraphApiError &&
      error.code === "RISK_GRAPH_RESPONSE_INVALID"
  )
})

test("risk graph client exposes safe API errors", async () => {
  await assert.rejects(
    fetchRiskGraph("missing", "external-subject", {
      fetch: async () =>
        jsonResponse(
          {
            error: {
              code: "INDUSTRY_RISK_COMPANY_NOT_FOUND",
              message: "样本中没有该企业。",
            },
          },
          404
        ),
    }),
    (error: unknown) =>
      error instanceof RiskGraphApiError &&
      error.status === 404 &&
      error.message === "样本中没有该企业。"
  )
})
