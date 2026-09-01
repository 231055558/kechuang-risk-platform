import assert from "node:assert/strict"
import test from "node:test"

import {
  getIndustryRiskAssessment,
  getIndustryRiskKnowledgeGraph,
  listIndustryRiskCompanies,
} from "../server/industry-risk-service.ts"
import {
  IndustryRiskApiError,
  fetchIndustryRiskAiGuidance,
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
  assert.equal(graph.counts.nodes, 1428)
  assert.equal(graph.counts.edges, 3427)

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

test("industry risk client posts the AI perspective and validates grounded evidence", async () => {
  let requestInit: RequestInit | undefined
  const response = await fetchIndustryRiskAiGuidance(
    "star-688256",
    "enterprise-response",
    {
      fetch: async (input, init) => {
        assert.equal(
          String(input),
          "api/v1/industry-risk/companies/star-688256/ai-guidance"
        )
        requestInit = init
        return jsonResponse({
          contractVersion: "KCR-INVESTOR-RISK-2026.08-v1",
          guidanceVersion: "KCR-AI-GUIDANCE-2026.09-v1",
          assessmentMethodVersion: "IRAWC-CRITIC-2026.08-v3",
          company: {
            id: "star-688256",
            shortName: "寒武纪",
            stockCode: "688256",
          },
          perspective: "enterprise-response",
          provider: "deepseek",
          model: "test-model",
          generatedAt: "2026-09-01T08:00:00.000Z",
          sourceDate: "2026-08-26",
          summary:
            "当前应先核验高分位外部约束，再将影响落实到具体产品和供应链整改证据。",
          recommendations: [
            {
              title: "核验出口限制影响",
              rationale: "该指标处于较高同业风险分位，需要进一步核对。",
              action: "建立产品、供应商和受限主体的逐项映射并形成验证记录。",
              verification: "所有判断均能够回到正式来源并对应具体产品范围。",
              evidence: [
                {
                  indicatorId: "R19",
                  label: "出口管制与制裁暴露度",
                  status: "scored",
                  riskScore: 73.02,
                  riskPercentile: 0.9603,
                  sourceCount: 2,
                  missingReason: null,
                },
              ],
            },
          ],
          limitations: ["AI内容不修改风险分、同业分位或缺失状态。"],
        })
      },
    }
  )

  assert.equal(requestInit?.method, "POST")
  assert.deepEqual(JSON.parse(String(requestInit?.body)), {
    perspective: "enterprise-response",
  })
  assert.equal(response.recommendations[0].evidence[0].indicatorId, "R19")
  assert.equal(response.provider, "deepseek")

  const malformed = structuredClone(response)
  malformed.recommendations[0].evidence[0].riskPercentile = null
  await assert.rejects(
    fetchIndustryRiskAiGuidance("star-688256", "enterprise-response", {
      fetch: async () => jsonResponse(malformed),
    }),
    (error: unknown) =>
      error instanceof IndustryRiskApiError &&
      error.code === "AI_GUIDANCE_RESPONSE_INVALID"
  )
})
