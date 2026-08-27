import {
  RISK_GRAPH_COMPANIES_API_PATH,
  RISK_GRAPH_CONTRACT_VERSION,
  RISK_GRAPH_VIEWS,
  getRiskGraphViewApiPath,
  type RiskGraphCompanyDirectoryResponse,
  type RiskGraphEdge,
  type RiskGraphNode,
  type RiskGraphResponse,
  type RiskGraphView,
} from "../domain/risk-graph-v1/index.ts"

interface FetchOptions {
  fetch?: typeof fetch
  signal?: AbortSignal
}

interface ApiErrorPayload {
  error?: {
    code?: unknown
    message?: unknown
  }
}

export class RiskGraphApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = "RiskGraphApiError"
    this.status = status
    this.code = code
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isNullableString(value: unknown) {
  return value === null || typeof value === "string"
}

function isNullableFiniteNumber(value: unknown) {
  return value === null || (typeof value === "number" && Number.isFinite(value))
}

function isCoverage(value: unknown) {
  return (
    isRecord(value) &&
    ["available", "unavailable", "service-unavailable"].includes(
      String(value.status)
    ) &&
    ["audited-snapshot", "structured-event-projection", "none"].includes(
      String(value.sourceMode)
    ) &&
    isNullableString(value.missingReason)
  )
}

function isNode(value: unknown): value is RiskGraphNode {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.label === "string" &&
    typeof value.type === "string" &&
    typeof value.typeLabel === "string" &&
    isNullableFiniteNumber(value.confidence) &&
    ["verified", "inferred", "predictive"].includes(
      String(value.evidenceState)
    ) &&
    isRecord(value.attributes)
  )
}

function isEdge(value: unknown): value is RiskGraphEdge {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.source === "string" &&
    typeof value.target === "string" &&
    typeof value.relation === "string" &&
    typeof value.relationCode === "string" &&
    isNullableFiniteNumber(value.confidence) &&
    ["verified", "inferred", "predictive"].includes(
      String(value.evidenceState)
    ) &&
    isRecord(value.attributes)
  )
}

export function isRiskGraphCompanyDirectoryResponse(
  value: unknown
): value is RiskGraphCompanyDirectoryResponse {
  if (
    !isRecord(value) ||
    value.contractVersion !== RISK_GRAPH_CONTRACT_VERSION ||
    typeof value.sampleSize !== "number" ||
    typeof value.availableEnterpriseEventCount !== "number" ||
    typeof value.availableExternalSubjectCount !== "number" ||
    !Array.isArray(value.companies)
  ) {
    return false
  }
  return value.companies.every((company) => {
    if (!isRecord(company) || !isRecord(company.views)) return false
    const views = company.views
    return (
      typeof company.companyId === "string" &&
      typeof company.companyName === "string" &&
      typeof company.stockCode === "string" &&
      typeof company.eventCount === "number" &&
      RISK_GRAPH_VIEWS.every((view) => isCoverage(views[view]))
    )
  })
}

export function isRiskGraphResponse(
  value: unknown
): value is RiskGraphResponse {
  if (
    !isRecord(value) ||
    value.contractVersion !== RISK_GRAPH_CONTRACT_VERSION ||
    !isRecord(value.company) ||
    typeof value.company.companyId !== "string" ||
    typeof value.company.companyName !== "string" ||
    typeof value.company.stockCode !== "string" ||
    !RISK_GRAPH_VIEWS.includes(value.view as RiskGraphView) ||
    !isCoverage(value.availability) ||
    !isNullableString(value.snapshotId) ||
    typeof value.minWeight !== "number" ||
    !Array.isArray(value.nodes) ||
    !value.nodes.every(isNode) ||
    !Array.isArray(value.edges) ||
    !value.edges.every(isEdge) ||
    !isRecord(value.summary) ||
    typeof value.summary.nodeCount !== "number" ||
    typeof value.summary.edgeCount !== "number" ||
    typeof value.summary.eventCount !== "number" ||
    typeof value.summary.indicatorCount !== "number" ||
    typeof value.summary.limitation !== "string"
  ) {
    return false
  }
  const nodeIds = new Set(value.nodes.map((node) => node.id))
  return (
    value.summary.nodeCount === value.nodes.length &&
    value.summary.edgeCount === value.edges.length &&
    value.edges.every(
      (edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target)
    )
  )
}

async function readPayload(response: Response) {
  try {
    return (await response.json()) as unknown
  } catch {
    return null
  }
}

async function requestJson(
  path: string,
  isValid: (value: unknown) => boolean,
  options: FetchOptions,
  invalidCode: string
) {
  const response = await (options.fetch ?? fetch)(path, {
    headers: { accept: "application/json" },
    signal: options.signal,
  })
  const payload = await readPayload(response)
  if (!response.ok) {
    const error = isRecord(payload) ? (payload as ApiErrorPayload).error : null
    throw new RiskGraphApiError(
      response.status,
      typeof error?.code === "string"
        ? error.code
        : "RISK_GRAPH_REQUEST_FAILED",
      typeof error?.message === "string" ? error.message : "风险图谱请求失败。"
    )
  }
  if (!isValid(payload)) {
    throw new RiskGraphApiError(
      response.status,
      invalidCode,
      "风险图谱响应不符合约定。"
    )
  }
  return payload
}

export async function fetchRiskGraphCompanies(options: FetchOptions = {}) {
  return (await requestJson(
    RISK_GRAPH_COMPANIES_API_PATH,
    isRiskGraphCompanyDirectoryResponse,
    options,
    "RISK_GRAPH_DIRECTORY_RESPONSE_INVALID"
  )) as RiskGraphCompanyDirectoryResponse
}

export async function fetchRiskGraph(
  companyId: string,
  view: RiskGraphView,
  options: FetchOptions & { minWeight?: number } = {}
) {
  const params = new URLSearchParams()
  if (options.minWeight !== undefined) {
    params.set("minWeight", String(options.minWeight))
  }
  const suffix = params.size > 0 ? `?${params}` : ""
  return (await requestJson(
    `${getRiskGraphViewApiPath(companyId, view)}${suffix}`,
    isRiskGraphResponse,
    options,
    "RISK_GRAPH_RESPONSE_INVALID"
  )) as RiskGraphResponse
}
