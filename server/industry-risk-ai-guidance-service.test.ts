import assert from "node:assert/strict"
import test from "node:test"

import {
  createIndustryRiskAiGuidanceService,
  IndustryRiskAiGuidanceError,
} from "./industry-risk-ai-guidance-service.ts"

function openAiTextResponse(text: string) {
  return new Response(
    JSON.stringify({
      output: [
        {
          type: "message",
          content: [
            {
              type: "output_text",
              text,
            },
          ],
        },
      ],
    }),
    { status: 200, headers: { "content-type": "application/json" } }
  )
}

function openAiResponse(output: unknown) {
  return openAiTextResponse(JSON.stringify(output))
}

const validModelOutput = {
  summary:
    "当前综合位置不能替代单项风险核验，应优先检查高分位外部约束及其对经营兑现的影响。",
  recommendations: [
    {
      title: "核验出口限制影响边界",
      rationale:
        "R19处于同业高风险分位，需要把主体命中与具体产品、供应链和收入影响区分开。",
      action:
        "取得产品、受限工具和关键供应商映射，分别记录已确认影响、待验证事项和已有替代方案。",
      verification:
        "每项影响均可回到正式来源，并能对应到具体产品、供应商或收入范围。",
      indicatorIds: ["R19"],
    },
  ],
}

test("AI guidance sends only the constrained evidence packet and reattaches authoritative evidence", async () => {
  let requestBody: Record<string, unknown> | null = null
  let authorization = ""
  let requestUrl = ""
  const generate = createIndustryRiskAiGuidanceService({
    apiKey: "test-key",
    model: "test-model",
    baseUrl: "https://proxy.example.test/openai",
    responsesPath: "/v1/responses",
    reasoningEffort: "xhigh",
    verbosity: "low",
    fetch: async (input, init) => {
      requestUrl = String(input)
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>
      authorization = new Headers(init?.headers).get("authorization") ?? ""
      return openAiResponse(validModelOutput)
    },
  })

  const response = await generate("star-688256", "institution")
  const serializedRequest = JSON.stringify(requestBody)

  assert.equal(requestUrl, "https://proxy.example.test/openai/v1/responses")
  assert.equal(authorization, "Bearer test-key")
  assert.equal(requestBody?.store, false)
  assert.deepEqual(requestBody?.reasoning, { effort: "xhigh" })
  assert.equal((requestBody?.text as { verbosity?: string }).verbosity, "low")
  assert.equal(
    (requestBody?.text as { format?: { type?: string } }).format?.type,
    "json_schema"
  )
  assert.match(serializedRequest, /R19/)
  assert.match(serializedRequest, /recentStructuredEvents/)
  assert.doesNotMatch(
    serializedRequest,
    /narrativeNews|financialReportNarrativeRisk|knowledgeGraph|riskGraph/
  )
  assert.equal(response.guidanceVersion, "KCR-AI-GUIDANCE-2026.09-v1")
  assert.equal(response.company.id, "star-688256")
  assert.equal(response.recommendations[0].evidence[0].indicatorId, "R19")
  assert.equal(response.recommendations[0].evidence[0].riskScore, 73.02)
  assert.equal(response.recommendations[0].evidence[0].riskPercentile, 0.9603)
  assert.ok(response.recommendations[0].evidence[0].sourceCount > 0)
  assert.doesNotMatch(
    JSON.stringify(response),
    /owner|dueDate|taskStatus|pendingAction|responsibleDepartment/
  )
})

test("AI guidance rejects model output that escapes indicator and product boundaries", async () => {
  const generateUnknownIndicator = createIndustryRiskAiGuidanceService({
    apiKey: "test-key",
    model: "test-model",
    fetch: async () =>
      openAiResponse({
        ...validModelOutput,
        recommendations: [
          { ...validModelOutput.recommendations[0], indicatorIds: ["R99"] },
        ],
      }),
  })
  await assert.rejects(
    generateUnknownIndicator("star-688256", "institution"),
    (error: unknown) =>
      error instanceof IndustryRiskAiGuidanceError &&
      error.code === "AI_GUIDANCE_RESPONSE_INVALID" &&
      error.statusCode === 502
  )

  const generateTradeInstruction = createIndustryRiskAiGuidanceService({
    apiKey: "test-key",
    model: "test-model",
    fetch: async () =>
      openAiResponse({
        ...validModelOutput,
        recommendations: [
          {
            ...validModelOutput.recommendations[0],
            action:
              "在完成以上核验以后建议立即买入，并持续检查后续公开证据变化。",
          },
        ],
      }),
  })
  await assert.rejects(
    generateTradeInstruction("star-688256", "institution"),
    (error: unknown) =>
      error instanceof IndustryRiskAiGuidanceError &&
      error.code === "AI_GUIDANCE_RESPONSE_INVALID"
  )
})

test("AI guidance is optional and fails closed when server credentials are absent", async () => {
  const generate = createIndustryRiskAiGuidanceService({
    apiKey: "",
    model: "",
  })
  await assert.rejects(
    generate("star-688256", "enterprise-response"),
    (error: unknown) =>
      error instanceof IndustryRiskAiGuidanceError &&
      error.code === "AI_GUIDANCE_UNAVAILABLE" &&
      error.statusCode === 503
  )
})

test("AI guidance uses DeepSeek Responses defaults without reusing OpenAI configuration", async () => {
  let requestUrl = ""
  let requestBody: Record<string, unknown> | null = null
  const generate = createIndustryRiskAiGuidanceService({
    provider: "deepseek",
    apiKey: "deepseek-test-key",
    fetch: async (input, init) => {
      requestUrl = String(input)
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>
      return openAiResponse(validModelOutput)
    },
  })

  const response = await generate("star-688256", "institution")

  assert.equal(requestUrl, "https://api.deepseek.com/responses")
  assert.equal(requestBody?.model, "deepseek-v4-flash")
  assert.deepEqual(requestBody?.reasoning, { effort: "high" })
  assert.equal(response.provider, "deepseek")
  assert.equal(response.model, "deepseek-v4-flash")
})

test("AI guidance retries one malformed structured output before returning grounded advice", async () => {
  let calls = 0
  const generate = createIndustryRiskAiGuidanceService({
    provider: "deepseek",
    apiKey: "deepseek-test-key",
    fetch: async () => {
      calls += 1
      return calls === 1
        ? openAiTextResponse("not-json")
        : openAiResponse(validModelOutput)
    },
  })

  const response = await generate("star-688256", "institution")

  assert.equal(calls, 2)
  assert.equal(response.provider, "deepseek")
  assert.equal(response.recommendations[0].evidence[0].indicatorId, "R19")
})

test("AI guidance refuses to send credentials to a non-local plain HTTP provider", async () => {
  const generate = createIndustryRiskAiGuidanceService({
    apiKey: "test-key",
    model: "gpt-5.6-sol",
    baseUrl: "http://provider.example.test",
    responsesPath: "/v1/responses",
    fetch: async () => {
      assert.fail("insecure provider must be rejected before fetch")
    },
  })

  await assert.rejects(
    generate("star-688256", "institution"),
    (error: unknown) =>
      error instanceof IndustryRiskAiGuidanceError &&
      error.code === "AI_GUIDANCE_CONFIGURATION_INVALID" &&
      error.statusCode === 503
  )
})
