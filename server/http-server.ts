import { createReadStream } from "node:fs"
import { stat } from "node:fs/promises"
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http"
import { extname, resolve, sep } from "node:path"

import {
  KCR_ASSESSMENT_SCORE_API_PATH,
  KCR_COMPANY_ASSESSMENT_API_PREFIX,
} from "../src/domain/kcr-v1/assessment-api.ts"
import {
  INDUSTRY_RISK_COMPANIES_API_PATH,
  INDUSTRY_RISK_GRAPH_API_PATH,
} from "../src/domain/industry-risk-v1/assessment-api.ts"
import {
  RISK_GRAPH_COMPANIES_API_PATH,
  RISK_GRAPH_VIEWS,
  type RiskGraphView,
} from "../src/domain/risk-graph-v1/api.ts"
import {
  NARRATIVE_RISK_AUDIT_SUMMARY_API_PATH,
  NARRATIVE_RISK_ANNUAL_AUDIT_API_PATH,
  NARRATIVE_RISK_ANNUAL_METHODOLOGY_API_PATH,
  NARRATIVE_RISK_ANNUAL_TRENDS_API_PATH,
  NARRATIVE_RISK_COMPANIES_API_PATH,
  NARRATIVE_RISK_INDUSTRY_TRENDS_API_PATH,
} from "../src/domain/narrative-risk-v1/assessment-api.ts"
import type { NarrativeRiskSourceFilters } from "./narrative-risk-service.ts"

const TECHNOLOGY_SCORE_PATH = "/api/v1/technology-risk/score"
const TECHNOLOGY_BASELINE_QUANTIFY_PATH =
  "/api/v1/technology-risk/baseline-quantify"
const KCR_ASSESSMENT_SCORE_PATH = `/${KCR_ASSESSMENT_SCORE_API_PATH}`
const KCR_COMPANY_ASSESSMENT_PATH_PREFIX = `/${KCR_COMPANY_ASSESSMENT_API_PREFIX}/`
const INDUSTRY_RISK_COMPANIES_PATH = `/${INDUSTRY_RISK_COMPANIES_API_PATH}`
const INDUSTRY_RISK_COMPANY_PATH_PREFIX = `${INDUSTRY_RISK_COMPANIES_PATH}/`
const INDUSTRY_RISK_GRAPH_PATH = `/${INDUSTRY_RISK_GRAPH_API_PATH}`
const RISK_GRAPH_COMPANIES_PATH = `/${RISK_GRAPH_COMPANIES_API_PATH}`
const RISK_GRAPH_COMPANY_PATH_PREFIX = `${RISK_GRAPH_COMPANIES_PATH}/`
const NARRATIVE_RISK_COMPANIES_PATH = `/${NARRATIVE_RISK_COMPANIES_API_PATH}`
const NARRATIVE_RISK_COMPANY_PATH_PREFIX = `${NARRATIVE_RISK_COMPANIES_PATH}/`
const NARRATIVE_RISK_AUDIT_SUMMARY_PATH = `/${NARRATIVE_RISK_AUDIT_SUMMARY_API_PATH}`
const NARRATIVE_RISK_ANNUAL_TRENDS_PATH = `/${NARRATIVE_RISK_ANNUAL_TRENDS_API_PATH}`
const NARRATIVE_RISK_ANNUAL_METHODOLOGY_PATH = `/${NARRATIVE_RISK_ANNUAL_METHODOLOGY_API_PATH}`
const NARRATIVE_RISK_ANNUAL_AUDIT_PATH = `/${NARRATIVE_RISK_ANNUAL_AUDIT_API_PATH}`
const NARRATIVE_RISK_INDUSTRY_TRENDS_PATH = `/${NARRATIVE_RISK_INDUSTRY_TRENDS_API_PATH}`
const RISK_GRAPH_WORKSPACE_PATH = "/risk-graph-workspace"
const RISK_GRAPH_WORKSPACE_UPSTREAM_PATHS = new Set([
  "/",
  "/api/companies",
  "/api/event-transmission",
  "/api/fee-kbg",
  "/api/fee-transmission",
  "/api/graph",
  "/api/health",
  "/api/subject-panorama",
])
const DEFAULT_MAX_BODY_BYTES = 1024 * 1024
const DEFAULT_GRAPH_WORKSPACE_TIMEOUT_MS = 5_000

const contentTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
}

export type TechnologyRiskCalculator = (
  request: unknown
) => unknown | Promise<unknown>
export type TechnologyBaselineCalculator = TechnologyRiskCalculator
export type KcrAssessmentCalculator = TechnologyRiskCalculator
export type KcrAssessmentReader = (
  companyId: string
) => unknown | Promise<unknown>
export type IndustryRiskCompanyLister = () => unknown | Promise<unknown>
export type IndustryRiskAssessmentReader = KcrAssessmentReader
export type RiskGraphCompanyLister = IndustryRiskCompanyLister
export type RiskGraphReader = (
  companyId: string,
  view: RiskGraphView,
  minWeight?: number
) => unknown | Promise<unknown>
export type NarrativeRiskCompanyLister = IndustryRiskCompanyLister
export type NarrativeRiskCompanyReader = KcrAssessmentReader
export type NarrativeRiskAuditSummaryReader = IndustryRiskCompanyLister
export type NarrativeRiskSourceLister = (
  companyKey: string,
  filters: NarrativeRiskSourceFilters
) => unknown | Promise<unknown>

export interface ProductionServerOptions {
  staticRoot: string
  calculateTechnologyRisk: TechnologyRiskCalculator
  calculateTechnologyBaseline?: TechnologyBaselineCalculator
  calculateKcrAssessment?: KcrAssessmentCalculator
  getKcrAssessment?: KcrAssessmentReader
  listIndustryRiskCompanies?: IndustryRiskCompanyLister
  getIndustryRiskAssessment?: IndustryRiskAssessmentReader
  getIndustryRiskGraph?: IndustryRiskCompanyLister
  listRiskGraphCompanies?: RiskGraphCompanyLister
  getRiskGraph?: RiskGraphReader
  listNarrativeRiskCompanies?: NarrativeRiskCompanyLister
  getNarrativeRiskCompany?: NarrativeRiskCompanyReader
  listNarrativeRiskSources?: NarrativeRiskSourceLister
  getNarrativeRiskAuditSummary?: NarrativeRiskAuditSummaryReader
  getNarrativeAnnualTrends?: NarrativeRiskAuditSummaryReader
  getNarrativeAnnualMethodology?: NarrativeRiskAuditSummaryReader
  getNarrativeAnnualAudit?: NarrativeRiskAuditSummaryReader
  getNarrativeIndustryTrends?: NarrativeRiskAuditSummaryReader
  graphWorkspaceOrigin?: string
  basePath?: string
  maxBodyBytes?: number
}

interface HttpErrorShape {
  code?: unknown
  message?: unknown
  statusCode?: unknown
}

function applySecurityHeaders(response: ServerResponse) {
  response.setHeader("x-content-type-options", "nosniff")
  response.setHeader("referrer-policy", "same-origin")
  response.setHeader("x-frame-options", "SAMEORIGIN")
}

function sendJson(
  response: ServerResponse,
  statusCode: number,
  payload: unknown,
  extraHeaders?: Record<string, string>
) {
  let body: string

  try {
    body = JSON.stringify(payload)
  } catch {
    statusCode = 500
    body = JSON.stringify({
      error: {
        code: "RESPONSE_SERIALIZATION_FAILED",
        message: "评分结果无法序列化。",
      },
    })
  }

  applySecurityHeaders(response)
  response.writeHead(statusCode, {
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body),
    "content-type": "application/json; charset=utf-8",
    ...extraHeaders,
  })
  response.end(body)
}

function sendApiError(
  response: ServerResponse,
  statusCode: number,
  code: string,
  message: string,
  extraHeaders?: Record<string, string>
) {
  sendJson(
    response,
    statusCode,
    {
      error: {
        code,
        message,
      },
    },
    extraHeaders
  )
}

function normalizeBasePath(basePath = "") {
  if (basePath === "" || basePath === "/") {
    return ""
  }

  return `/${basePath.replace(/^\/+|\/+$/g, "")}`
}

function stripBasePath(pathname: string, basePath: string) {
  if (basePath === "") {
    return pathname
  }
  if (pathname === basePath) {
    return "/"
  }
  if (pathname.startsWith(`${basePath}/`)) {
    return pathname.slice(basePath.length)
  }
  return pathname
}

function getRequestPath(request: IncomingMessage, basePath: string) {
  try {
    const url = new URL(request.url ?? "/", "http://127.0.0.1")
    return stripBasePath(url.pathname, basePath)
  } catch {
    return null
  }
}

function getRiskGraphViewRequest(pathname: string) {
  if (!pathname.startsWith(RISK_GRAPH_COMPANY_PATH_PREFIX)) return null
  const suffix = pathname.slice(RISK_GRAPH_COMPANY_PATH_PREFIX.length)
  const match = suffix.match(/^([^/]+)\/views\/([^/]+)$/)
  if (!match) return null
  try {
    const companyId = decodeURIComponent(match[1])
    const view = decodeURIComponent(match[2])
    if (!companyId || !RISK_GRAPH_VIEWS.includes(view as RiskGraphView)) {
      return null
    }
    return { companyId, view: view as RiskGraphView }
  } catch {
    return null
  }
}

function readRiskGraphMinWeight(request: IncomingMessage) {
  const url = new URL(request.url ?? "/", "http://127.0.0.1")
  const raw = url.searchParams.get("minWeight")
  if (raw === null || raw === "") return 0.5
  const value = Number(raw)
  return Number.isFinite(value) && value >= 0.35 && value <= 0.95 ? value : null
}

function getGraphWorkspaceUpstreamPath(pathname: string) {
  const upstreamPath =
    pathname === RISK_GRAPH_WORKSPACE_PATH ||
    pathname === `${RISK_GRAPH_WORKSPACE_PATH}/`
      ? "/"
      : pathname.startsWith(`${RISK_GRAPH_WORKSPACE_PATH}/`)
        ? pathname.slice(RISK_GRAPH_WORKSPACE_PATH.length)
        : null
  return upstreamPath !== null &&
    RISK_GRAPH_WORKSPACE_UPSTREAM_PATHS.has(upstreamPath)
    ? upstreamPath
    : null
}

async function handleGraphWorkspaceProxy(
  request: IncomingMessage,
  response: ServerResponse,
  upstreamPath: string,
  graphWorkspaceOrigin?: string
) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    sendApiError(
      response,
      405,
      "METHOD_NOT_ALLOWED",
      "图谱工作站仅支持只读访问。",
      { allow: "GET, HEAD" }
    )
    return
  }
  if (!graphWorkspaceOrigin) {
    sendApiError(
      response,
      503,
      "RISK_GRAPH_WORKSPACE_UNAVAILABLE",
      "风险图谱工作站尚未配置。"
    )
    return
  }

  try {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1")
    const origin = new URL(graphWorkspaceOrigin)
    if (origin.protocol !== "http:" && origin.protocol !== "https:") {
      throw new TypeError("Graph workspace origin must use HTTP or HTTPS")
    }
    const upstreamUrl = new URL(upstreamPath, origin)
    upstreamUrl.search = requestUrl.search
    const upstream = await fetch(upstreamUrl, {
      headers: { accept: request.headers.accept ?? "*/*" },
      signal: AbortSignal.timeout(DEFAULT_GRAPH_WORKSPACE_TIMEOUT_MS),
    })
    const body = Buffer.from(await upstream.arrayBuffer())
    applySecurityHeaders(response)
    response.writeHead(upstream.status, {
      "cache-control": upstream.headers.get("cache-control") ?? "no-store",
      "content-length": body.byteLength,
      "content-type":
        upstream.headers.get("content-type") ?? "application/octet-stream",
    })
    response.end(request.method === "HEAD" ? undefined : body)
  } catch (error) {
    console.error("Risk graph workspace proxy failed", error)
    sendApiError(
      response,
      502,
      "RISK_GRAPH_WORKSPACE_UNAVAILABLE",
      "风险图谱工作站暂时不可用。"
    )
  }
}

async function readJsonBody(
  request: IncomingMessage,
  maxBodyBytes: number
): Promise<
  { kind: "ok"; value: unknown } | { kind: "invalid" } | { kind: "too-large" }
> {
  const declaredLength = Number(request.headers["content-length"])
  if (Number.isFinite(declaredLength) && declaredLength > maxBodyBytes) {
    request.resume()
    return { kind: "too-large" }
  }

  const chunks: Buffer[] = []
  let receivedBytes = 0
  let tooLarge = false

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    receivedBytes += buffer.length
    if (receivedBytes > maxBodyBytes) {
      tooLarge = true
      continue
    }
    chunks.push(buffer)
  }

  if (tooLarge) {
    return { kind: "too-large" }
  }

  const source = Buffer.concat(chunks).toString("utf8")
  if (source.trim() === "") {
    return { kind: "invalid" }
  }

  try {
    return { kind: "ok", value: JSON.parse(source) as unknown }
  } catch {
    return { kind: "invalid" }
  }
}

function getPublicError(
  error: unknown,
  fallbackCode: string,
  fallbackMessage: string
) {
  if (typeof error !== "object" || error === null) {
    return null
  }

  const candidate = error as HttpErrorShape
  if (
    typeof candidate.statusCode !== "number" ||
    !Number.isInteger(candidate.statusCode) ||
    candidate.statusCode < 400 ||
    candidate.statusCode > 499
  ) {
    return null
  }

  return {
    statusCode: candidate.statusCode,
    code: typeof candidate.code === "string" ? candidate.code : fallbackCode,
    message:
      typeof candidate.message === "string"
        ? candidate.message
        : fallbackMessage,
  }
}

async function handleTechnologyScore(
  request: IncomingMessage,
  response: ServerResponse,
  options: Required<
    Pick<ProductionServerOptions, "calculateTechnologyRisk" | "maxBodyBytes">
  >
) {
  if (request.method !== "POST") {
    sendApiError(
      response,
      405,
      "METHOD_NOT_ALLOWED",
      "该接口仅支持 POST 请求。",
      { allow: "POST" }
    )
    return
  }

  const body = await readJsonBody(request, options.maxBodyBytes)
  if (body.kind === "too-large") {
    sendApiError(
      response,
      413,
      "PAYLOAD_TOO_LARGE",
      `请求体不能超过 ${options.maxBodyBytes} 字节。`
    )
    return
  }
  if (body.kind === "invalid") {
    sendApiError(response, 400, "INVALID_JSON", "请求体必须是有效的 JSON。")
    return
  }

  try {
    const result = await options.calculateTechnologyRisk(body.value)
    sendJson(response, 200, result)
  } catch (error) {
    const publicError = getPublicError(
      error,
      "TECHNOLOGY_SCORE_REQUEST_INVALID",
      "技术风险评分请求无效。"
    )
    if (publicError) {
      sendApiError(
        response,
        publicError.statusCode,
        publicError.code,
        publicError.message
      )
      return
    }

    console.error("Technology risk calculation failed", error)
    sendApiError(
      response,
      500,
      "TECHNOLOGY_SCORE_FAILED",
      "技术风险评分暂时不可用。"
    )
  }
}

async function handleTechnologyBaseline(
  request: IncomingMessage,
  response: ServerResponse,
  options: {
    calculateTechnologyBaseline?: TechnologyBaselineCalculator
    maxBodyBytes: number
  }
) {
  if (request.method !== "POST") {
    sendApiError(
      response,
      405,
      "METHOD_NOT_ALLOWED",
      "该接口仅支持 POST 请求。",
      { allow: "POST" }
    )
    return
  }

  if (!options.calculateTechnologyBaseline) {
    sendApiError(
      response,
      503,
      "TECHNOLOGY_BASELINE_UNAVAILABLE",
      "技术基础量化服务尚未配置。"
    )
    return
  }

  const body = await readJsonBody(request, options.maxBodyBytes)
  if (body.kind === "too-large") {
    sendApiError(
      response,
      413,
      "PAYLOAD_TOO_LARGE",
      `请求体不能超过 ${options.maxBodyBytes} 字节。`
    )
    return
  }
  if (body.kind === "invalid") {
    sendApiError(response, 400, "INVALID_JSON", "请求体必须是有效的 JSON。")
    return
  }

  try {
    const result = await options.calculateTechnologyBaseline(body.value)
    sendJson(response, 200, result)
  } catch (error) {
    const publicError = getPublicError(
      error,
      "TECHNOLOGY_BASELINE_REQUEST_INVALID",
      "技术基础量化请求无效。"
    )
    if (publicError) {
      sendApiError(
        response,
        publicError.statusCode,
        publicError.code,
        publicError.message
      )
      return
    }

    console.error("Technology baseline quantification failed", error)
    sendApiError(
      response,
      500,
      "TECHNOLOGY_BASELINE_FAILED",
      "技术基础量化暂时不可用。"
    )
  }
}

async function handleKcrAssessmentScore(
  request: IncomingMessage,
  response: ServerResponse,
  options: {
    calculateKcrAssessment?: KcrAssessmentCalculator
    maxBodyBytes: number
  }
) {
  if (request.method !== "POST") {
    sendApiError(
      response,
      405,
      "METHOD_NOT_ALLOWED",
      "该接口仅支持 POST 请求。",
      { allow: "POST" }
    )
    return
  }

  if (!options.calculateKcrAssessment) {
    sendApiError(
      response,
      503,
      "KCR_ASSESSMENT_UNAVAILABLE",
      "KCR V3 评分服务尚未配置。"
    )
    return
  }

  const body = await readJsonBody(request, options.maxBodyBytes)
  if (body.kind === "too-large") {
    sendApiError(
      response,
      413,
      "PAYLOAD_TOO_LARGE",
      `请求体不能超过 ${options.maxBodyBytes} 字节。`
    )
    return
  }
  if (body.kind === "invalid") {
    sendApiError(response, 400, "INVALID_JSON", "请求体必须是有效的 JSON。")
    return
  }

  try {
    sendJson(response, 200, await options.calculateKcrAssessment(body.value))
  } catch (error) {
    const publicError = getPublicError(
      error,
      "KCR_ASSESSMENT_REQUEST_INVALID",
      "KCR V3 评分请求无效。"
    )
    if (publicError) {
      sendApiError(
        response,
        publicError.statusCode,
        publicError.code,
        publicError.message
      )
      return
    }

    console.error("KCR assessment calculation failed", error)
    sendApiError(
      response,
      500,
      "KCR_ASSESSMENT_FAILED",
      "KCR V3 评分暂时不可用。"
    )
  }
}

function getKcrCompanyId(pathname: string) {
  if (
    !pathname.startsWith(KCR_COMPANY_ASSESSMENT_PATH_PREFIX) ||
    !pathname.endsWith("/assessment")
  ) {
    return null
  }

  const encodedCompanyId = pathname.slice(
    KCR_COMPANY_ASSESSMENT_PATH_PREFIX.length,
    -"/assessment".length
  )
  if (!encodedCompanyId || encodedCompanyId.includes("/")) return null

  try {
    return decodeURIComponent(encodedCompanyId)
  } catch {
    return null
  }
}

async function handleKcrCompanyAssessment(
  request: IncomingMessage,
  response: ServerResponse,
  companyId: string,
  getKcrAssessment?: KcrAssessmentReader
) {
  if (request.method !== "GET") {
    sendApiError(
      response,
      405,
      "METHOD_NOT_ALLOWED",
      "该接口仅支持 GET 请求。",
      { allow: "GET" }
    )
    return
  }

  if (!getKcrAssessment) {
    sendApiError(
      response,
      503,
      "KCR_ASSESSMENT_UNAVAILABLE",
      "KCR V3 评估快照服务尚未配置。"
    )
    return
  }

  try {
    sendJson(response, 200, await getKcrAssessment(companyId))
  } catch (error) {
    const publicError = getPublicError(
      error,
      "KCR_ASSESSMENT_REQUEST_INVALID",
      "KCR V3 评估查询无效。"
    )
    if (publicError) {
      sendApiError(
        response,
        publicError.statusCode,
        publicError.code,
        publicError.message
      )
      return
    }

    console.error("KCR assessment retrieval failed", error)
    sendApiError(
      response,
      500,
      "KCR_ASSESSMENT_FAILED",
      "KCR V3 评估快照暂时不可用。"
    )
  }
}

function getIndustryRiskCompanyId(pathname: string) {
  if (
    !pathname.startsWith(INDUSTRY_RISK_COMPANY_PATH_PREFIX) ||
    !pathname.endsWith("/assessment")
  ) {
    return null
  }

  const encodedCompanyId = pathname.slice(
    INDUSTRY_RISK_COMPANY_PATH_PREFIX.length,
    -"/assessment".length
  )
  if (!encodedCompanyId || encodedCompanyId.includes("/")) return null

  try {
    return decodeURIComponent(encodedCompanyId)
  } catch {
    return null
  }
}

async function handleIndustryRiskCompanyDirectory(
  request: IncomingMessage,
  response: ServerResponse,
  listCompanies?: IndustryRiskCompanyLister
) {
  if (request.method !== "GET") {
    sendApiError(
      response,
      405,
      "METHOD_NOT_ALLOWED",
      "该接口仅支持 GET 请求。",
      { allow: "GET" }
    )
    return
  }
  if (!listCompanies) {
    sendApiError(
      response,
      503,
      "INDUSTRY_RISK_UNAVAILABLE",
      "行业风险样本服务尚未配置。"
    )
    return
  }
  try {
    sendJson(response, 200, await listCompanies())
  } catch (error) {
    console.error("Industry risk company directory failed", error)
    sendApiError(
      response,
      500,
      "INDUSTRY_RISK_FAILED",
      "行业风险样本暂时不可用。"
    )
  }
}

async function handleIndustryRiskAssessment(
  request: IncomingMessage,
  response: ServerResponse,
  companyId: string,
  getAssessment?: IndustryRiskAssessmentReader
) {
  if (request.method !== "GET") {
    sendApiError(
      response,
      405,
      "METHOD_NOT_ALLOWED",
      "该接口仅支持 GET 请求。",
      { allow: "GET" }
    )
    return
  }
  if (!getAssessment) {
    sendApiError(
      response,
      503,
      "INDUSTRY_RISK_UNAVAILABLE",
      "行业风险评估服务尚未配置。"
    )
    return
  }
  try {
    sendJson(response, 200, await getAssessment(companyId))
  } catch (error) {
    const publicError = getPublicError(
      error,
      "INDUSTRY_RISK_REQUEST_INVALID",
      "行业风险评估查询无效。"
    )
    if (publicError) {
      sendApiError(
        response,
        publicError.statusCode,
        publicError.code,
        publicError.message
      )
      return
    }
    console.error("Industry risk assessment retrieval failed", error)
    sendApiError(
      response,
      500,
      "INDUSTRY_RISK_FAILED",
      "行业风险评估暂时不可用。"
    )
  }
}

async function handleRiskGraphCompanyDirectory(
  request: IncomingMessage,
  response: ServerResponse,
  listCompanies?: RiskGraphCompanyLister
) {
  if (request.method !== "GET") {
    sendApiError(
      response,
      405,
      "METHOD_NOT_ALLOWED",
      "该接口仅支持 GET 请求。",
      { allow: "GET" }
    )
    return
  }
  if (!listCompanies) {
    sendApiError(
      response,
      503,
      "RISK_GRAPH_UNAVAILABLE",
      "风险图谱服务尚未配置。"
    )
    return
  }
  try {
    sendJson(response, 200, await listCompanies())
  } catch (error) {
    console.error("Risk graph company directory failed", error)
    sendApiError(
      response,
      500,
      "RISK_GRAPH_FAILED",
      "风险图谱覆盖信息暂时不可用。"
    )
  }
}

async function handleRiskGraph(
  request: IncomingMessage,
  response: ServerResponse,
  companyId: string,
  view: RiskGraphView,
  getGraph?: RiskGraphReader
) {
  if (request.method !== "GET") {
    sendApiError(
      response,
      405,
      "METHOD_NOT_ALLOWED",
      "该接口仅支持 GET 请求。",
      { allow: "GET" }
    )
    return
  }
  if (!getGraph) {
    sendApiError(
      response,
      503,
      "RISK_GRAPH_UNAVAILABLE",
      "风险图谱服务尚未配置。"
    )
    return
  }
  const minWeight = readRiskGraphMinWeight(request)
  if (minWeight === null) {
    sendApiError(
      response,
      400,
      "RISK_GRAPH_QUERY_INVALID",
      "minWeight 必须是 0.35 到 0.95 之间的数字。"
    )
    return
  }
  try {
    sendJson(response, 200, await getGraph(companyId, view, minWeight))
  } catch (error) {
    const publicError = getPublicError(
      error,
      "RISK_GRAPH_QUERY_INVALID",
      "风险图谱查询无效。"
    )
    if (publicError) {
      sendApiError(
        response,
        publicError.statusCode,
        publicError.code,
        publicError.message
      )
      return
    }
    console.error("Risk graph retrieval failed", error)
    sendApiError(response, 500, "RISK_GRAPH_FAILED", "风险图谱暂时不可用。")
  }
}

function getNarrativeRiskCompanyRoute(pathname: string) {
  if (!pathname.startsWith(NARRATIVE_RISK_COMPANY_PATH_PREFIX)) return null
  const suffix = pathname.slice(NARRATIVE_RISK_COMPANY_PATH_PREFIX.length)
  const parts = suffix.split("/")
  if (!parts[0] || parts.length > 2) return null
  if (parts.length === 2 && parts[1] !== "sources") return null
  try {
    return {
      companyKey: decodeURIComponent(parts[0]),
      kind:
        parts[1] === "sources" ? ("sources" as const) : ("company" as const),
    }
  } catch {
    return null
  }
}

function getNarrativeSourceFilters(request: IncomingMessage) {
  const url = new URL(request.url ?? "/", "http://127.0.0.1")
  const nullable = (name: string) => {
    const value = url.searchParams.get(name)?.trim()
    return value ? value : null
  }
  return {
    scopeId: nullable("scopeId"),
    channel: nullable("channel"),
    validationStatus: nullable("validationStatus"),
    page: Number(url.searchParams.get("page") ?? "1"),
    pageSize: Number(url.searchParams.get("pageSize") ?? "20"),
  } satisfies NarrativeRiskSourceFilters
}

async function handleNarrativeRiskRead(
  request: IncomingMessage,
  response: ServerResponse,
  reader: (() => unknown | Promise<unknown>) | undefined,
  unavailableMessage: string
) {
  if (request.method !== "GET") {
    sendApiError(
      response,
      405,
      "METHOD_NOT_ALLOWED",
      "该接口仅支持 GET 请求。",
      {
        allow: "GET",
      }
    )
    return
  }
  if (!reader) {
    sendApiError(
      response,
      503,
      "NARRATIVE_RISK_UNAVAILABLE",
      unavailableMessage
    )
    return
  }
  try {
    sendJson(response, 200, await reader())
  } catch (error) {
    const publicError = getPublicError(
      error,
      "NARRATIVE_RISK_REQUEST_INVALID",
      "叙事风险查询无效。"
    )
    if (publicError) {
      sendApiError(
        response,
        publicError.statusCode,
        publicError.code,
        publicError.message
      )
      return
    }
    console.error("Narrative risk retrieval failed", error)
    sendApiError(
      response,
      500,
      "NARRATIVE_RISK_FAILED",
      "叙事风险数据暂时不可用。"
    )
  }
}

function isPrivateStaticPath(pathname: string) {
  const segments = pathname.split("/").filter(Boolean)
  return (
    segments[0] === "server" ||
    segments.some((segment) => segment.startsWith("."))
  )
}

function resolveStaticPath(staticRoot: string, pathname: string) {
  let decodedPath: string
  try {
    decodedPath = decodeURIComponent(pathname)
  } catch {
    return null
  }

  if (decodedPath.includes("\0") || isPrivateStaticPath(decodedPath)) {
    return null
  }

  const candidate = resolve(staticRoot, `.${decodedPath}`)
  if (
    candidate !== staticRoot &&
    !candidate.startsWith(`${staticRoot}${sep}`)
  ) {
    return null
  }
  return candidate
}

function sendStaticNotFound(response: ServerResponse) {
  const body = "Not Found\n"
  applySecurityHeaders(response)
  response.writeHead(404, {
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body),
    "content-type": "text/plain; charset=utf-8",
  })
  response.end(body)
}

async function sendFile(
  request: IncomingMessage,
  response: ServerResponse,
  filePath: string
) {
  const fileStats = await stat(filePath)
  if (!fileStats.isFile()) {
    return false
  }

  const cacheControl = filePath.includes(`${sep}assets${sep}`)
    ? "public, max-age=31536000, immutable"
    : "no-cache"
  applySecurityHeaders(response)
  response.writeHead(200, {
    "cache-control": cacheControl,
    "content-length": fileStats.size,
    "content-type":
      contentTypes[extname(filePath).toLowerCase()] ??
      "application/octet-stream",
  })

  if (request.method === "HEAD") {
    response.end()
    return true
  }

  createReadStream(filePath).pipe(response)
  return true
}

async function handleStaticRequest(
  request: IncomingMessage,
  response: ServerResponse,
  staticRoot: string,
  pathname: string
) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    const body = "Method Not Allowed\n"
    applySecurityHeaders(response)
    response.writeHead(405, {
      allow: "GET, HEAD",
      "cache-control": "no-store",
      "content-length": Buffer.byteLength(body),
      "content-type": "text/plain; charset=utf-8",
    })
    response.end(body)
    return
  }

  const requestPath = pathname === "/" ? "/index.html" : pathname
  const filePath = resolveStaticPath(staticRoot, requestPath)
  if (!filePath) {
    sendStaticNotFound(response)
    return
  }

  try {
    if (await sendFile(request, response, filePath)) {
      return
    }
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? error.code
        : null
    if (code !== "ENOENT" && code !== "ENOTDIR") {
      throw error
    }
  }

  if (extname(pathname) !== "") {
    sendStaticNotFound(response)
    return
  }

  try {
    await sendFile(request, response, resolve(staticRoot, "index.html"))
  } catch {
    sendStaticNotFound(response)
  }
}

export function createProductionServer(
  options: ProductionServerOptions
): Server {
  const staticRoot = resolve(options.staticRoot)
  const basePath = normalizeBasePath(options.basePath)
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES

  if (!Number.isSafeInteger(maxBodyBytes) || maxBodyBytes <= 0) {
    throw new TypeError("maxBodyBytes must be a positive safe integer")
  }

  return createServer(async (request, response) => {
    try {
      const pathname = getRequestPath(request, basePath)
      if (pathname === null) {
        sendApiError(response, 400, "INVALID_URL", "请求 URL 无效。")
        return
      }

      if (pathname === TECHNOLOGY_SCORE_PATH) {
        await handleTechnologyScore(request, response, {
          calculateTechnologyRisk: options.calculateTechnologyRisk,
          maxBodyBytes,
        })
        return
      }

      if (pathname === TECHNOLOGY_BASELINE_QUANTIFY_PATH) {
        await handleTechnologyBaseline(request, response, {
          calculateTechnologyBaseline: options.calculateTechnologyBaseline,
          maxBodyBytes,
        })
        return
      }

      if (pathname === KCR_ASSESSMENT_SCORE_PATH) {
        await handleKcrAssessmentScore(request, response, {
          calculateKcrAssessment: options.calculateKcrAssessment,
          maxBodyBytes,
        })
        return
      }

      if (pathname === INDUSTRY_RISK_COMPANIES_PATH) {
        await handleIndustryRiskCompanyDirectory(
          request,
          response,
          options.listIndustryRiskCompanies
        )
        return
      }

      if (pathname === INDUSTRY_RISK_GRAPH_PATH) {
        await handleIndustryRiskCompanyDirectory(
          request,
          response,
          options.getIndustryRiskGraph
        )
        return
      }

      if (pathname === RISK_GRAPH_COMPANIES_PATH) {
        await handleRiskGraphCompanyDirectory(
          request,
          response,
          options.listRiskGraphCompanies
        )
        return
      }

      if (
        pathname === RISK_GRAPH_WORKSPACE_PATH ||
        pathname.startsWith(`${RISK_GRAPH_WORKSPACE_PATH}/`)
      ) {
        const upstreamPath = getGraphWorkspaceUpstreamPath(pathname)
        if (upstreamPath === null) {
          sendStaticNotFound(response)
          return
        }
        await handleGraphWorkspaceProxy(
          request,
          response,
          upstreamPath,
          options.graphWorkspaceOrigin
        )
        return
      }

      if (pathname === NARRATIVE_RISK_COMPANIES_PATH) {
        await handleNarrativeRiskRead(
          request,
          response,
          options.listNarrativeRiskCompanies,
          "叙事风险企业目录尚未配置。"
        )
        return
      }

      const riskGraphRequest = getRiskGraphViewRequest(pathname)
      if (riskGraphRequest !== null) {
        await handleRiskGraph(
          request,
          response,
          riskGraphRequest.companyId,
          riskGraphRequest.view,
          options.getRiskGraph
        )
        return
      }

      if (pathname === NARRATIVE_RISK_AUDIT_SUMMARY_PATH) {
        await handleNarrativeRiskRead(
          request,
          response,
          options.getNarrativeRiskAuditSummary,
          "叙事风险审计摘要尚未配置。"
        )
        return
      }

      if (pathname === NARRATIVE_RISK_ANNUAL_TRENDS_PATH) {
        await handleNarrativeRiskRead(
          request,
          response,
          options.getNarrativeAnnualTrends,
          "叙事风险年度趋势尚未配置。"
        )
        return
      }

      if (pathname === NARRATIVE_RISK_ANNUAL_METHODOLOGY_PATH) {
        await handleNarrativeRiskRead(
          request,
          response,
          options.getNarrativeAnnualMethodology,
          "叙事风险年度方法说明尚未配置。"
        )
        return
      }

      if (pathname === NARRATIVE_RISK_ANNUAL_AUDIT_PATH) {
        await handleNarrativeRiskRead(
          request,
          response,
          options.getNarrativeAnnualAudit,
          "叙事风险年度审计尚未配置。"
        )
        return
      }

      if (pathname === NARRATIVE_RISK_INDUSTRY_TRENDS_PATH) {
        await handleNarrativeRiskRead(
          request,
          response,
          options.getNarrativeIndustryTrends,
          "行业叙事风险年度分布尚未配置。"
        )
        return
      }

      const narrativeRiskRoute = getNarrativeRiskCompanyRoute(pathname)
      if (narrativeRiskRoute?.kind === "sources") {
        await handleNarrativeRiskRead(
          request,
          response,
          options.listNarrativeRiskSources
            ? () =>
                options.listNarrativeRiskSources!(
                  narrativeRiskRoute.companyKey,
                  getNarrativeSourceFilters(request)
                )
            : undefined,
          "叙事风险来源台账尚未配置。"
        )
        return
      }
      if (narrativeRiskRoute?.kind === "company") {
        await handleNarrativeRiskRead(
          request,
          response,
          options.getNarrativeRiskCompany
            ? () =>
                options.getNarrativeRiskCompany!(narrativeRiskRoute.companyKey)
            : undefined,
          "叙事风险企业详情尚未配置。"
        )
        return
      }

      const industryRiskCompanyId = getIndustryRiskCompanyId(pathname)
      if (industryRiskCompanyId !== null) {
        await handleIndustryRiskAssessment(
          request,
          response,
          industryRiskCompanyId,
          options.getIndustryRiskAssessment
        )
        return
      }

      const kcrCompanyId = getKcrCompanyId(pathname)
      if (kcrCompanyId !== null) {
        await handleKcrCompanyAssessment(
          request,
          response,
          kcrCompanyId,
          options.getKcrAssessment
        )
        return
      }

      if (pathname.startsWith("/api/")) {
        sendApiError(response, 404, "API_NOT_FOUND", "未找到该 API。")
        return
      }

      await handleStaticRequest(request, response, staticRoot, pathname)
    } catch (error) {
      console.error("Production HTTP server failed", error)
      if (!response.headersSent) {
        sendApiError(
          response,
          500,
          "INTERNAL_SERVER_ERROR",
          "服务器暂时不可用。"
        )
      } else {
        response.destroy()
      }
    }
  })
}
