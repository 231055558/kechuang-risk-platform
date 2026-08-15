import assert from "node:assert/strict"
import test from "node:test"

import goldenInput from "../src/data/mvp/cambricon-scoring-input-v3.json" with { type: "json" }
import { createKcrAssessmentApiResponse } from "../src/domain/kcr-v1/assessment-api.ts"
import {
  calculateKcrAssessment,
  type KcrAssessmentRequest,
} from "../src/domain/kcr-v1/scoring-engine.ts"
import {
  fetchKcrCompanyAssessment,
  KcrAssessmentApiError,
} from "../src/lib/kcr-assessment-api.ts"

const validResponse = createKcrAssessmentApiResponse(
  calculateKcrAssessment(goldenInput),
  "team-workbook",
  (goldenInput as KcrAssessmentRequest).evidenceCatalog
)

test("KCR assessment client requests the selected company using a relative URL", async () => {
  const calls: Array<{ input: string; init?: RequestInit }> = []
  const result = await fetchKcrCompanyAssessment("cambricon", {
    fetch: async (input, init) => {
      calls.push({ input: String(input), init })
      return new Response(JSON.stringify(validResponse), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    },
  })

  assert.equal(calls.length, 1)
  assert.equal(calls[0].input, "api/v1/kcr/companies/cambricon/assessment")
  assert.equal(calls[0].init?.method, "GET")
  assert.equal(result.assessment.baselineScore, 35.6)
  assert.equal(result.assessment.indicatorResults.length, 18)
  assert.equal(result.evidenceCatalog.length, 8)
  assert.equal(result.evidenceCatalog[0].id, "S01")
  assert.equal(result.provenance.assessmentInputSource, "team-workbook")
})

test("KCR assessment client exposes safe API errors", async () => {
  await assert.rejects(
    () =>
      fetchKcrCompanyAssessment("unknown", {
        fetch: async () =>
          new Response(
            JSON.stringify({
              error: {
                code: "KCR_COMPANY_ASSESSMENT_NOT_FOUND",
                message: "该企业暂无 KCR V3 评估快照。",
              },
            }),
            { status: 404 }
          ),
      }),
    (error: unknown) => {
      assert.ok(error instanceof KcrAssessmentApiError)
      assert.equal(error.status, 404)
      assert.equal(error.code, "KCR_COMPANY_ASSESSMENT_NOT_FOUND")
      assert.equal(error.message, "该企业暂无 KCR V3 评估快照。")
      return true
    }
  )
})

test("KCR assessment client rejects malformed success payloads", async () => {
  await assert.rejects(
    () =>
      fetchKcrCompanyAssessment("cambricon", {
        fetch: async () =>
          new Response(
            JSON.stringify({ assessment: { baselineScore: 35.6 } }),
            {
              status: 200,
            }
          ),
      }),
    (error: unknown) => {
      assert.ok(error instanceof KcrAssessmentApiError)
      assert.equal(error.code, "KCR_ASSESSMENT_RESPONSE_INVALID")
      return true
    }
  )
})

test("KCR assessment client rejects unsafe evidence links", async () => {
  const unsafeResponse = structuredClone(validResponse)
  unsafeResponse.evidenceCatalog[0].sourceUrl = "javascript:alert(1)"

  await assert.rejects(
    () =>
      fetchKcrCompanyAssessment("cambricon", {
        fetch: async () =>
          new Response(JSON.stringify(unsafeResponse), { status: 200 }),
      }),
    (error: unknown) => {
      assert.ok(error instanceof KcrAssessmentApiError)
      assert.equal(error.code, "KCR_ASSESSMENT_RESPONSE_INVALID")
      return true
    }
  )
})

test("KCR assessment client rejects inferred evidence without its basis", async () => {
  const unsupportedResponse = structuredClone(validResponse)
  unsupportedResponse.assessment.indicatorResults[0].evidence[0].inferenceBasis =
    null

  await assert.rejects(
    () =>
      fetchKcrCompanyAssessment("cambricon", {
        fetch: async () =>
          new Response(JSON.stringify(unsupportedResponse), { status: 200 }),
      }),
    (error: unknown) => {
      assert.ok(error instanceof KcrAssessmentApiError)
      assert.equal(error.code, "KCR_ASSESSMENT_RESPONSE_INVALID")
      return true
    }
  )
})
