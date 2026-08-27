import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import type { RiskGraphView } from "../src/domain/risk-graph-v1/index.ts"
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
  listRiskGraphCompanies?: () => unknown | Promise<unknown>
  getRiskGraph?: (
    companyId: string,
    view: RiskGraphView,
    minWeight?: number
  ) => unknown | Promise<unknown>
  listNarrativeRiskCompanies?: () => unknown | Promise<unknown>
  getNarrativeRiskCompany?: (companyKey: string) => unknown | Promise<unknown>
  listNarrativeRiskSources?: (
    companyKey: string,
    filters: Record<string, unknown>
  ) => unknown | Promise<unknown>
  getNarrativeRiskAuditSummary?: () => unknown | Promise<unknown>
  getNarrativeAnnualTrends?: () => unknown | Promise<unknown>
  getNarrativeAnnualMethodology?: () => unknown | Promise<unknown>
  getNarrativeAnnualAudit?: () => unknown | Promise<unknown>
  getNarrativeIndustryTrends?: () => unknown | Promise<unknown>
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
    listRiskGraphCompanies: options?.listRiskGraphCompanies,
    getRiskGraph: options?.getRiskGraph,
    listNarrativeRiskCompanies: options?.listNarrativeRiskCompanies,
    getNarrativeRiskCompany: options?.getNarrativeRiskCompany,
    listNarrativeRiskSources: options?.listNarrativeRiskSources,
    getNarrativeRiskAuditSummary: options?.getNarrativeRiskAuditSummary,
    getNarrativeAnnualTrends: options?.getNarrativeAnnualTrends,
    getNarrativeAnnualMethodology: options?.getNarrativeAnnualMethodology,
    getNarrativeAnnualAudit: options?.getNarrativeAnnualAudit,
    getNarrativeIndustryTrends: options?.getNarrativeIndustryTrends,
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

test("risk graph API exposes coverage and validates the versioned view query", async () => {
  const received: unknown[] = []
  const testServer = await startTestServer({
    listRiskGraphCompanies() {
      return {
        contractVersion: "KCR-RISK-GRAPH-2026.08-v1",
        sampleSize: 94,
        companies: [],
      }
    },
    getRiskGraph(companyId, view, minWeight) {
      received.push({ companyId, view, minWeight })
      return {
        contractVersion: "KCR-RISK-GRAPH-2026.08-v1",
        company: { companyId, companyName: "寒武纪", stockCode: "688256" },
        view,
        minWeight,
        nodes: [],
        edges: [],
      }
    },
  })

  try {
    const directory = await fetch(
      `${testServer.baseUrl}/api/v1/risk-graphs/companies`
    )
    assert.equal(directory.status, 200)
    assert.equal((await directory.json()).sampleSize, 94)

    const graph = await fetch(
      `${testServer.baseUrl}/api/v1/risk-graphs/companies/star-688256/views/external-subject?minWeight=0.7`
    )
    assert.equal(graph.status, 200)
    assert.equal((await graph.json()).view, "external-subject")
    assert.deepEqual(received, [
      {
        companyId: "star-688256",
        view: "external-subject",
        minWeight: 0.7,
      },
    ])

    const invalidWeight = await fetch(
      `${testServer.baseUrl}/api/v1/risk-graphs/companies/star-688256/views/enterprise-event?minWeight=2`
    )
    assert.equal(invalidWeight.status, 400)
    assert.equal(
      (await invalidWeight.json()).error.code,
      "RISK_GRAPH_QUERY_INVALID"
    )

    const invalidView = await fetch(
      `${testServer.baseUrl}/api/v1/risk-graphs/companies/star-688256/views/made-up`
    )
    assert.equal(invalidView.status, 404)
  } finally {
    await testServer.close()
  }
})

test("narrative risk GET endpoints expose directory, detail, sources, and audit summary", async () => {
  const received: Array<{
    companyKey: string
    filters?: Record<string, unknown>
  }> = []
  const envelope = {
    schemaVersion: "KCR-NARRATIVE-RISK-2026.08-v1",
    dataVersion: "narrative-test-v1",
    asOfDate: "2026-08-26",
    sourceMode: "postgres",
  }
  const testServer = await startTestServer({
    listNarrativeRiskCompanies: () => ({
      ...envelope,
      scopes: [],
      companies: [{ companyKey: "cambricon", shortName: "寒武纪" }],
      counts: { uniqueCompanies: 7, scopeCompanyRecords: 8 },
    }),
    getNarrativeRiskCompany(companyKey) {
      received.push({ companyKey })
      return { ...envelope, company: { companyKey }, metrics: [] }
    },
    listNarrativeRiskSources(companyKey, filters) {
      received.push({ companyKey, filters })
      return { ...envelope, companyKey, filters, page: 2, items: [] }
    },
    getNarrativeRiskAuditSummary: () => ({
      ...envelope,
      counts: { linkedUniqueSources: 83, pendingReview: 3 },
    }),
  })

  try {
    const directory = await fetch(
      `${testServer.baseUrl}/api/v1/narrative-risk/companies`
    )
    assert.equal(directory.status, 200)
    assert.equal((await directory.json()).counts.scopeCompanyRecords, 8)

    const detail = await fetch(
      `${testServer.baseUrl}/api/v1/narrative-risk/companies/cambricon`
    )
    assert.equal(detail.status, 200)

    const sources = await fetch(
      `${testServer.baseUrl}/api/v1/narrative-risk/companies/cambricon/sources?scopeId=r01-r04-audit-20260826&channel=%E6%AD%A3%E5%BC%8F%E6%8A%A5%E5%91%8A&page=2&pageSize=12`
    )
    assert.equal(sources.status, 200)

    const audit = await fetch(
      `${testServer.baseUrl}/api/v1/narrative-risk/audit-summary`
    )
    assert.equal(audit.status, 200)
    assert.equal((await audit.json()).counts.linkedUniqueSources, 83)
    assert.deepEqual(received, [
      { companyKey: "cambricon" },
      {
        companyKey: "cambricon",
        filters: {
          scopeId: "r01-r04-audit-20260826",
          channel: "正式报告",
          validationStatus: null,
          page: 2,
          pageSize: 12,
        },
      },
    ])
  } finally {
    await testServer.close()
  }
})

test("revised annual narrative endpoints expose trends, Chinese methodology, and audit", async () => {
  const envelope = {
    schemaVersion: "KCR-NARRATIVE-RISK-2026.08-v1",
    dataVersion: "narrative-method-revised-2026-08-27-v2",
    asOfDate: "2026-08-27",
    sourceMode: "postgres",
  }
  const testServer = await startTestServer({
    getNarrativeAnnualTrends: () => ({
      ...envelope,
      methodVersion: envelope.dataVersion,
      companies: [{ companyKey: "cambricon", companyName: "寒武纪" }],
      observations: [{ companyKey: "cambricon", year: 2025, value: 1 }],
    }),
    getNarrativeAnnualMethodology: () => ({
      ...envelope,
      methodVersion: { methodVersion: envelope.dataVersion },
      methodology: [{ name: "信息总量充分性", formula: "有效词数除以一万" }],
    }),
    getNarrativeAnnualAudit: () => ({
      ...envelope,
      methodVersion: envelope.dataVersion,
      documents: Array.from({ length: 21 }, (_, index) => ({
        documentId: index,
      })),
      audit: { archivedReportCount: 21 },
    }),
    getNarrativeIndustryTrends: () => ({
      ...envelope,
      dataVersion: "narrative-industry-raw-2026-08-27-v1",
      companies: Array.from({ length: 94 }, (_, index) => ({
        companyId: `company-${index}`,
      })),
      industryGroups: [],
      methodology: [
        { name: "信息模糊性" },
        { name: "叙事夸大性" },
        { name: "风险披露充分性" },
      ],
      documents: Array.from({ length: 470 }, (_, index) => ({
        documentId: index,
      })),
      observations: [],
      industryStatistics: [],
      audit: { archivedReportCount: 379 },
    }),
  })

  try {
    const trends = await fetch(
      `${testServer.baseUrl}/api/v1/narrative-risk/annual-trends`
    )
    const methodology = await fetch(
      `${testServer.baseUrl}/api/v1/narrative-risk/annual-trends/methodology`
    )
    const audit = await fetch(
      `${testServer.baseUrl}/api/v1/narrative-risk/annual-trends/audit`
    )
    const industry = await fetch(
      `${testServer.baseUrl}/api/v1/narrative-risk/industry-trends`
    )
    assert.equal(trends.status, 200)
    assert.equal(methodology.status, 200)
    assert.equal(audit.status, 200)
    assert.equal(industry.status, 200)
    assert.equal((await trends.json()).companies[0].companyName, "寒武纪")
    assert.equal(
      (await methodology.json()).methodology[0].name,
      "信息总量充分性"
    )
    assert.equal((await audit.json()).documents.length, 21)
    assert.equal((await industry.json()).companies.length, 94)
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
