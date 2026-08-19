import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { createProductionServer } from "./http-server.ts"

async function startTestServer(options?: {
  basePath?: string
  calculateTechnologyRisk?: (request: unknown) => unknown | Promise<unknown>
  calculateTechnologyBaseline?: (request: unknown) => unknown | Promise<unknown>
  calculateKcrAssessment?: (request: unknown) => unknown | Promise<unknown>
  getKcrAssessment?: (companyId: string) => unknown | Promise<unknown>
  listIndustryRiskCompanies?: () => unknown | Promise<unknown>
  getIndustryRiskAssessment?: (companyId: string) => unknown | Promise<unknown>
  getIndustryRiskGraph?: () => unknown | Promise<unknown>
  maxBodyBytes?: number
}) {
  const staticRoot = mkdtempSync(join(tmpdir(), "risk-platform-server-test-"))
  mkdirSync(join(staticRoot, "assets"), { recursive: true })
  mkdirSync(join(staticRoot, "server"), { recursive: true })
  writeFileSync(
    join(staticRoot, "index.html"),
    "<!doctype html><title>risk platform</title><main>application shell</main>"
  )
  writeFileSync(
    join(staticRoot, "assets", "app.js"),
    "export const app = true\n"
  )
  writeFileSync(
    join(staticRoot, "server", "production-server.js"),
    "do not expose server source\n"
  )

  const server = createProductionServer({
    staticRoot,
    basePath: options?.basePath,
    calculateTechnologyRisk:
      options?.calculateTechnologyRisk ??
      ((request) => ({
        modelVersion: "KTR-2026.07-v1",
        request,
        score: null,
      })),
    calculateTechnologyBaseline: options?.calculateTechnologyBaseline,
    calculateKcrAssessment: options?.calculateKcrAssessment,
    getKcrAssessment: options?.getKcrAssessment,
    listIndustryRiskCompanies: options?.listIndustryRiskCompanies,
    getIndustryRiskAssessment: options?.getIndustryRiskAssessment,
    getIndustryRiskGraph: options?.getIndustryRiskGraph,
    maxBodyBytes: options?.maxBodyBytes,
  })

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => resolve())
  })

  const address = server.address()
  assert.ok(address && typeof address !== "string")

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    async close() {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
      rmSync(staticRoot, { recursive: true, force: true })
    },
  }
}

test("technology scoring POST forwards parsed JSON and returns the engine result", async () => {
  const received: unknown[] = []
  const testServer = await startTestServer({
    calculateTechnologyRisk(request) {
      received.push(request)
      return {
        modelVersion: "KTR-2026.07-v1",
        score: 42,
        trace: ["technology score calculated"],
      }
    },
  })

  try {
    const response = await fetch(
      `${testServer.baseUrl}/api/v1/technology-risk/score`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ companyId: "company-1", indicators: {} }),
      }
    )

    assert.equal(response.status, 200)
    assert.match(
      response.headers.get("content-type") ?? "",
      /^application\/json/
    )
    assert.equal(response.headers.get("cache-control"), "no-store")
    assert.deepEqual(received, [{ companyId: "company-1", indicators: {} }])
    assert.deepEqual(await response.json(), {
      modelVersion: "KTR-2026.07-v1",
      score: 42,
      trace: ["technology score calculated"],
    })
  } finally {
    await testServer.close()
  }
})

test("technology baseline POST forwards parsed JSON and returns the engine result", async () => {
  const received: unknown[] = []
  const testServer = await startTestServer({
    calculateTechnologyBaseline(request) {
      received.push(request)
      return {
        modelVersion: "TQB-2026.07-v5",
        score: null,
        scoringStatus: "calibration-observation-only",
      }
    },
  })

  try {
    const response = await fetch(
      `${testServer.baseUrl}/api/v1/technology-risk/baseline-quantify`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ companyId: "deepseek", values: {} }),
      }
    )

    assert.equal(response.status, 200)
    assert.equal(response.headers.get("cache-control"), "no-store")
    assert.deepEqual(received, [{ companyId: "deepseek", values: {} }])
    assert.deepEqual(await response.json(), {
      modelVersion: "TQB-2026.07-v5",
      score: null,
      scoringStatus: "calibration-observation-only",
    })
  } finally {
    await testServer.close()
  }
})

test("KCR company assessment GET returns the requested V3 snapshot", async () => {
  const received: string[] = []
  const testServer = await startTestServer({
    getKcrAssessment(companyId) {
      received.push(companyId)
      return {
        assessment: {
          companyId,
          modelVersion: "KCR-SCORE-2026.08-v3",
          baselineScore: 35.6,
        },
        provenance: { methodStatus: "candidate-for-team-review" },
      }
    },
  })

  try {
    const response = await fetch(
      `${testServer.baseUrl}/api/v1/kcr/companies/cambricon/assessment`
    )

    assert.equal(response.status, 200)
    assert.equal(response.headers.get("cache-control"), "no-store")
    assert.deepEqual(received, ["cambricon"])
    assert.deepEqual(await response.json(), {
      assessment: {
        companyId: "cambricon",
        modelVersion: "KCR-SCORE-2026.08-v3",
        baselineScore: 35.6,
      },
      provenance: { methodStatus: "candidate-for-team-review" },
    })
  } finally {
    await testServer.close()
  }
})

test("KCR assessment POST forwards JSON to the V3 calculator", async () => {
  const received: unknown[] = []
  const testServer = await startTestServer({
    calculateKcrAssessment(request) {
      received.push(request)
      return {
        assessment: {
          modelVersion: "KCR-SCORE-2026.08-v3",
          baselineScore: 41.25,
        },
        provenance: { assessmentInputSource: "api-request" },
      }
    },
  })

  try {
    const payload = { companyId: "company-1", indicators: [] }
    const response = await fetch(
      `${testServer.baseUrl}/api/v1/kcr/assessments/score`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      }
    )

    assert.equal(response.status, 200)
    assert.deepEqual(received, [payload])
    assert.deepEqual(await response.json(), {
      assessment: {
        modelVersion: "KCR-SCORE-2026.08-v3",
        baselineScore: 41.25,
      },
      provenance: { assessmentInputSource: "api-request" },
    })
  } finally {
    await testServer.close()
  }
})

test("industry risk GET endpoints expose the directory and selected assessment", async () => {
  const received: string[] = []
  const testServer = await startTestServer({
    listIndustryRiskCompanies() {
      return {
        methodVersion: "IRAWC-MISSING-AWARE-2026.08-v3",
        companies: [{ companyId: "star-688256", companyName: "寒武纪" }],
      }
    },
    getIndustryRiskAssessment(companyId) {
      received.push(companyId)
      return {
        assessment: { companyId, metrics: [{ indicatorId: "R07" }] },
      }
    },
    getIndustryRiskGraph() {
      return {
        schemaVersion: "KCR-INDUSTRY-GRAPH-2026.08-v2",
        nodes: [{ id: "company:star-688256", kind: "company" }],
        edges: [],
      }
    },
  })

  try {
    const directory = await fetch(
      `${testServer.baseUrl}/api/v1/industry-risk/companies`
    )
    assert.equal(directory.status, 200)
    assert.equal(directory.headers.get("cache-control"), "no-store")
    assert.deepEqual(await directory.json(), {
      methodVersion: "IRAWC-MISSING-AWARE-2026.08-v3",
      companies: [{ companyId: "star-688256", companyName: "寒武纪" }],
    })

    const assessment = await fetch(
      `${testServer.baseUrl}/api/v1/industry-risk/companies/star-688256/assessment`
    )
    assert.equal(assessment.status, 200)
    assert.deepEqual(received, ["star-688256"])
    assert.deepEqual(await assessment.json(), {
      assessment: {
        companyId: "star-688256",
        metrics: [{ indicatorId: "R07" }],
      },
    })

    const graph = await fetch(
      `${testServer.baseUrl}/api/v1/industry-risk/graph`
    )
    assert.equal(graph.status, 200)
    assert.deepEqual(await graph.json(), {
      schemaVersion: "KCR-INDUSTRY-GRAPH-2026.08-v2",
      nodes: [{ id: "company:star-688256", kind: "company" }],
      edges: [],
    })
  } finally {
    await testServer.close()
  }
})

test("industry risk API returns safe 404 and method errors", async () => {
  const testServer = await startTestServer({
    listIndustryRiskCompanies: () => ({ companies: [] }),
    getIndustryRiskAssessment(companyId) {
      throw Object.assign(new Error(`企业 ${companyId} 不在当前行业样本中。`), {
        code: "INDUSTRY_RISK_COMPANY_NOT_FOUND",
        statusCode: 404,
      })
    },
  })

  try {
    const missing = await fetch(
      `${testServer.baseUrl}/api/v1/industry-risk/companies/unknown/assessment`
    )
    assert.equal(missing.status, 404)
    assert.deepEqual(await missing.json(), {
      error: {
        code: "INDUSTRY_RISK_COMPANY_NOT_FOUND",
        message: "企业 unknown 不在当前行业样本中。",
      },
    })

    const wrongMethod = await fetch(
      `${testServer.baseUrl}/api/v1/industry-risk/companies`,
      { method: "POST" }
    )
    assert.equal(wrongMethod.status, 405)
    assert.equal(wrongMethod.headers.get("allow"), "GET")
  } finally {
    await testServer.close()
  }
})

test("KCR API exposes safe 404 and 422 errors without SPA fallback", async () => {
  const testServer = await startTestServer({
    getKcrAssessment(companyId) {
      throw Object.assign(new Error(`企业 ${companyId} 暂无评估。`), {
        code: "KCR_COMPANY_ASSESSMENT_NOT_FOUND",
        statusCode: 404,
      })
    },
    calculateKcrAssessment() {
      throw Object.assign(new Error("指标权重不正确。"), {
        code: "KCR_ASSESSMENT_REQUEST_INVALID",
        statusCode: 422,
      })
    },
  })

  try {
    const missing = await fetch(
      `${testServer.baseUrl}/api/v1/kcr/companies/unknown/assessment`
    )
    assert.equal(missing.status, 404)
    assert.deepEqual(await missing.json(), {
      error: {
        code: "KCR_COMPANY_ASSESSMENT_NOT_FOUND",
        message: "企业 unknown 暂无评估。",
      },
    })

    const invalid = await fetch(
      `${testServer.baseUrl}/api/v1/kcr/assessments/score`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }
    )
    assert.equal(invalid.status, 422)
    assert.deepEqual(await invalid.json(), {
      error: {
        code: "KCR_ASSESSMENT_REQUEST_INVALID",
        message: "指标权重不正确。",
      },
    })
  } finally {
    await testServer.close()
  }
})

test("technology scoring API returns JSON 400 for malformed or empty JSON", async () => {
  const testServer = await startTestServer()

  try {
    for (const body of ["", '{"companyId":']) {
      const response = await fetch(
        `${testServer.baseUrl}/api/v1/technology-risk/score`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
        }
      )

      assert.equal(response.status, 400)
      assert.match(
        response.headers.get("content-type") ?? "",
        /^application\/json/
      )
      assert.doesNotMatch(await response.text(), /application shell/)
    }
  } finally {
    await testServer.close()
  }
})

test("technology scoring API rejects oversized bodies with JSON 413", async () => {
  const testServer = await startTestServer({ maxBodyBytes: 32 })

  try {
    const response = await fetch(
      `${testServer.baseUrl}/api/v1/technology-risk/score`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ value: "x".repeat(64) }),
      }
    )

    assert.equal(response.status, 413)
    assert.match(
      response.headers.get("content-type") ?? "",
      /^application\/json/
    )
    assert.doesNotMatch(await response.text(), /application shell/)
  } finally {
    await testServer.close()
  }
})

test("technology scoring API exposes intentional engine validation errors", async () => {
  const testServer = await startTestServer({
    calculateTechnologyRisk() {
      throw Object.assign(new Error("缺少必要的技术指标。"), {
        code: "TECHNOLOGY_INPUT_REQUIRED",
        statusCode: 422,
      })
    },
  })

  try {
    const response = await fetch(
      `${testServer.baseUrl}/api/v1/technology-risk/score`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }
    )

    assert.equal(response.status, 422)
    assert.deepEqual(await response.json(), {
      error: {
        code: "TECHNOLOGY_INPUT_REQUIRED",
        message: "缺少必要的技术指标。",
      },
    })
  } finally {
    await testServer.close()
  }
})

test("technology scoring API hides unexpected engine failures", async () => {
  const originalConsoleError = console.error
  const loggedErrors: unknown[][] = []
  console.error = (...args: unknown[]) => {
    loggedErrors.push(args)
  }

  const testServer = await startTestServer({
    calculateTechnologyRisk() {
      throw new Error("private engine detail")
    },
  })

  try {
    const response = await fetch(
      `${testServer.baseUrl}/api/v1/technology-risk/score`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }
    )

    assert.equal(response.status, 500)
    const responseBody = await response.text()
    assert.doesNotMatch(responseBody, /private engine detail/)
    assert.deepEqual(JSON.parse(responseBody), {
      error: {
        code: "TECHNOLOGY_SCORE_FAILED",
        message: "技术风险评分暂时不可用。",
      },
    })
    assert.equal(loggedErrors.length, 1)
  } finally {
    console.error = originalConsoleError
    await testServer.close()
  }
})

test("API 404 and 405 responses never fall through to index.html", async () => {
  const testServer = await startTestServer()

  try {
    const wrongMethod = await fetch(
      `${testServer.baseUrl}/api/v1/technology-risk/score`
    )
    assert.equal(wrongMethod.status, 405)
    assert.equal(wrongMethod.headers.get("allow"), "POST")
    assert.doesNotMatch(await wrongMethod.text(), /application shell/)

    const unknownApi = await fetch(`${testServer.baseUrl}/api/v1/unknown`)
    assert.equal(unknownApi.status, 404)
    assert.doesNotMatch(await unknownApi.text(), /application shell/)
  } finally {
    await testServer.close()
  }
})

test("static server supports SPA fallback without exposing server artifacts", async () => {
  const testServer = await startTestServer()

  try {
    const asset = await fetch(`${testServer.baseUrl}/assets/app.js`)
    assert.equal(asset.status, 200)
    assert.match(asset.headers.get("content-type") ?? "", /javascript/)
    assert.equal(await asset.text(), "export const app = true\n")

    const spaRoute = await fetch(`${testServer.baseUrl}/enterprise/company-1`)
    assert.equal(spaRoute.status, 200)
    assert.match(await spaRoute.text(), /application shell/)

    const serverArtifact = await fetch(
      `${testServer.baseUrl}/server/production-server.js`
    )
    assert.equal(serverArtifact.status, 404)
    assert.doesNotMatch(await serverArtifact.text(), /do not expose/)

    const missingAsset = await fetch(`${testServer.baseUrl}/assets/missing.js`)
    assert.equal(missingAsset.status, 404)
    assert.doesNotMatch(await missingAsset.text(), /application shell/)
  } finally {
    await testServer.close()
  }
})

test("base path serves the application, assets, and API without exposing server artifacts", async () => {
  const received: unknown[] = []
  const testServer = await startTestServer({
    basePath: "/risk-demo",
    calculateTechnologyRisk(request) {
      received.push(request)
      return {
        modelVersion: "KTR-2026.07-v1",
        score: 42,
      }
    },
  })

  try {
    const shell = await fetch(`${testServer.baseUrl}/risk-demo/`)
    assert.equal(shell.status, 200)
    assert.match(await shell.text(), /application shell/)

    const asset = await fetch(`${testServer.baseUrl}/risk-demo/assets/app.js`)
    assert.equal(asset.status, 200)
    assert.equal(await asset.text(), "export const app = true\n")

    const api = await fetch(
      `${testServer.baseUrl}/risk-demo/api/v1/technology-risk/score`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ companyId: "company-1" }),
      }
    )
    assert.equal(api.status, 200)
    assert.deepEqual(received, [{ companyId: "company-1" }])

    const serverArtifact = await fetch(
      `${testServer.baseUrl}/risk-demo/server/production-server.js`
    )
    assert.equal(serverArtifact.status, 404)
    assert.doesNotMatch(await serverArtifact.text(), /do not expose/)
  } finally {
    await testServer.close()
  }
})
