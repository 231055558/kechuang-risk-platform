import assert from "node:assert/strict"
import test from "node:test"

import {
  getIndustryRiskAssessment,
  getIndustryRiskKnowledgeGraph,
  listIndustryRiskCompanies,
} from "../server/industry-risk-service.ts"
import {
  IndustryRiskApiError,
  fetchIndustryRiskAssessment,
  fetchIndustryRiskCompanies,
  fetchIndustryRiskKnowledgeGraph,
} from "../src/lib/industry-risk-api.ts"

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  })
}

test("industry risk client validates directory and assessment responses", async () => {
  const paths: string[] = []
  const directory = await fetchIndustryRiskCompanies({
    fetch: async (input) => {
      paths.push(String(input))
      return jsonResponse(listIndustryRiskCompanies())
    },
  })
  assert.equal(directory.companies.length, 94)
  assert.equal(directory.peerGroups.length, 4)

  const assessment = await fetchIndustryRiskAssessment("star-688256", {
    fetch: async (input) => {
      paths.push(String(input))
      return jsonResponse(getIndustryRiskAssessment("star-688256"))
    },
  })
  assert.equal(assessment.company.shortName, "寒武纪")
  assert.equal(assessment.indicators.length, 22)
  assert.equal(assessment.coverage.length, 22)
  assert.equal(
    assessment.assessment.financialReportNarrativeRisk.dimensions.length,
    3
  )
  assert.deepEqual(paths, [
    "api/v1/industry-risk/companies",
    "api/v1/industry-risk/companies/star-688256/assessment",
  ])
})

test("industry graph client validates all node and edge references", async () => {
  const graph = await fetchIndustryRiskKnowledgeGraph({
    fetch: async (input) => {
      assert.equal(String(input), "api/v1/industry-risk/graph")
      return jsonResponse(getIndustryRiskKnowledgeGraph())
    },
  })
  assert.equal(graph.counts.nodes, 1289)
  assert.equal(graph.counts.edges, 3291)

  const malformed = structuredClone(graph)
  malformed.edges[0].target = "node:missing"
  await assert.rejects(
    fetchIndustryRiskKnowledgeGraph({
      fetch: async () => jsonResponse(malformed),
    }),
    (error: unknown) =>
      error instanceof IndustryRiskApiError &&
      error.code === "INDUSTRY_RISK_GRAPH_RESPONSE_INVALID"
  )
})

test("industry risk client rejects malformed success payloads", async () => {
  await assert.rejects(
    fetchIndustryRiskCompanies({
      fetch: async () => jsonResponse({ companies: [] }),
    }),
    (error: unknown) =>
      error instanceof IndustryRiskApiError &&
      error.code === "INDUSTRY_RISK_RESPONSE_INVALID"
  )
})

test("industry risk client rejects unsafe source links", async () => {
  const malformed = structuredClone(getIndustryRiskAssessment("star-688256"))
  malformed.sources[0].url = "javascript:alert(1)"
  await assert.rejects(
    fetchIndustryRiskAssessment("star-688256", {
      fetch: async () => jsonResponse(malformed),
    }),
    (error: unknown) =>
      error instanceof IndustryRiskApiError &&
      error.code === "INDUSTRY_RISK_RESPONSE_INVALID"
  )
})

test("industry risk client exposes safe API errors", async () => {
  await assert.rejects(
    fetchIndustryRiskAssessment("missing", {
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
      error instanceof IndustryRiskApiError &&
      error.status === 404 &&
      error.message === "样本中没有该企业。"
  )
})
