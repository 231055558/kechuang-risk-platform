import {
  RISK_GRAPH_CONTRACT_VERSION,
  type RiskGraphCompanyDirectoryResponse,
  type RiskGraphEdge,
  type RiskGraphEvidenceState,
  type RiskGraphNode,
  type RiskGraphResponse,
  type RiskGraphView,
  type RiskGraphViewCoverage,
} from "../src/domain/risk-graph-v1/index.ts"
import type { IndustryRiskAssessmentApiResponse } from "../src/domain/industry-risk-v1/index.ts"
import {
  getIndustryRiskAssessment,
  listIndustryRiskCompanies,
} from "./industry-risk-service.ts"

const DEFAULT_GRAPH_API_ORIGIN = "http://127.0.0.1:8766"
const DEFAULT_REQUEST_TIMEOUT_MS = 2_000
const DEFAULT_MIN_WEIGHT = 0.5
const PILOT_SNAPSHOT_STOCK_CODES = new Set(["688256"])
const internalAttributePattern =
  /(?:review|candidate|internal|validation_issue)/i

type FetchLike = typeof fetch

interface UpstreamCompanyNode {
  id: string
  label: string
  attributes: Record<string, unknown>
}

interface UpstreamGraph {
  company_key?: unknown
  snapshot_run_id?: unknown
  nodes?: unknown
  edges?: unknown
  event_count?: unknown
  indicator_count?: unknown
}

interface RiskGraphServiceOptions {
  origin?: string
  fetchImpl?: FetchLike
  timeoutMs?: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function readFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function isSafePublicUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === "http:" || url.protocol === "https:"
  } catch {
    return false
  }
}

function publicSourceLabel(value: string) {
  try {
    const hostname = new URL(value).hostname.replace(/^www\./, "")
    const knownSources: Array<[RegExp, string]> = [
      [/(?:^|\.)sse\.com\.cn$/, "上海证券交易所"],
      [/(?:^|\.)szse\.cn$/, "深圳证券交易所"],
      [/(?:^|\.)cninfo\.com\.cn$/, "巨潮资讯"],
      [/(?:^|\.)csrc\.gov\.cn$/, "中国证监会"],
      [/(?:^|\.)court\.gov\.cn$/, "人民法院公开信息"],
      [/(?:^|\.)gov\.cn$/, "政府公开信息"],
      [/(?:^|\.)eastmoney\.com$/, "东方财富"],
    ]
    return (
      knownSources.find(([pattern]) => pattern.test(hostname))?.[1] ??
      hostname ??
      "公开来源"
    )
  } catch {
    return "公开来源"
  }
}

function cleanAttributes(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return {}
  return Object.fromEntries(
    Object.entries(value).filter(
      ([key, item]) =>
        !internalAttributePattern.test(key) &&
        (!/url$/i.test(key) ||
          typeof item !== "string" ||
          isSafePublicUrl(item))
    )
  )
}

function evidenceState(
  relationCode: string,
  attributes: Record<string, unknown>
): RiskGraphEvidenceState {
  if (
    attributes.predictive === true ||
    relationCode === "may_evolve_to" ||
    relationCode === "scenario_maps_to_indicator"
  ) {
    return "predictive"
  }
  if (
    attributes.chain_projection === true ||
    attributes.event_mapping === "事件机制推断"
  ) {
    return "inferred"
  }
  return "verified"
}

function parseUpstreamCompany(value: unknown): UpstreamCompanyNode | null {
  if (!isRecord(value) || typeof value.id !== "string") return null
  const attributes = cleanAttributes(value.attributes)
  return {
    id: value.id,
    label: typeof value.label === "string" ? value.label : value.id,
    attributes,
  }
}

function parseUpstreamNode(value: unknown): RiskGraphNode | null {
  if (!isRecord(value) || value.needs_review === true) return null
  if (
    typeof value.id !== "string" ||
    typeof value.label !== "string" ||
    typeof value.type !== "string"
  ) {
    return null
  }
  const attributes = cleanAttributes(value.attributes)
  return {
    id: value.id,
    label: value.label,
    type: value.type,
    typeLabel:
      typeof value.type_label === "string" ? value.type_label : value.type,
    confidence: readFiniteNumber(value.confidence),
    evidenceState: evidenceState("", attributes),
    attributes,
  }
}

function parseUpstreamEdge(value: unknown): RiskGraphEdge | null {
  if (!isRecord(value) || value.needs_review === true) return null
  if (
    typeof value.id !== "string" ||
    typeof value.source !== "string" ||
    typeof value.target !== "string"
  ) {
    return null
  }
  const relationCode =
    typeof value.relation_code === "string" ? value.relation_code : "related_to"
  const attributes = cleanAttributes(value.attributes)
  return {
    id: value.id,
    source: value.source,
    target: value.target,
    relation:
      typeof value.relation === "string" ? value.relation : relationCode,
    relationCode,
    confidence: readFiniteNumber(value.confidence),
    evidenceState: evidenceState(relationCode, attributes),
    attributes,
  }
}

function coverage(
  status: RiskGraphViewCoverage["status"],
  sourceMode: RiskGraphViewCoverage["sourceMode"],
  missingReason: string | null
): RiskGraphViewCoverage {
  return { status, sourceMode, missingReason }
}

function unavailableResponse(
  response: IndustryRiskAssessmentApiResponse,
  view: RiskGraphView,
  availability: RiskGraphViewCoverage,
  minWeight: number
): RiskGraphResponse {
  return {
    contractVersion: RISK_GRAPH_CONTRACT_VERSION,
    company: {
      companyId: response.company.id,
      companyName: response.company.shortName,
      stockCode: response.company.stockCode,
    },
    view,
    availability,
    snapshotId: null,
    minWeight,
    nodes: [],
    edges: [],
    summary: {
      nodeCount: 0,
      edgeCount: 0,
      eventCount: 0,
      indicatorCount: 0,
      limitation: availability.missingReason ?? "当前图谱不可用。",
    },
  }
}

function buildStructuredEventGraph(
  response: IndustryRiskAssessmentApiResponse,
  minWeight: number
): RiskGraphResponse {
  const { company, events, indicators } = response
  if (events.length === 0) {
    return unavailableResponse(
      response,
      "enterprise-event",
      coverage(
        "unavailable",
        "none",
        "当前企业暂无可追溯的结构化近期事件，未生成传导关系。"
      ),
      minWeight
    )
  }

  const companyNodeId = `company:${company.id}`
  const nodes = new Map<string, RiskGraphNode>()
  const edges = new Map<string, RiskGraphEdge>()
  nodes.set(companyNodeId, {
    id: companyNodeId,
    label: company.shortName,
    type: "company",
    typeLabel: "目标企业",
    confidence: company.confidence,
    evidenceState: "verified",
    attributes: {
      chain_role: "focal_company",
      stock_code: company.stockCode,
      full_name: company.fullName,
    },
  })

  const indicatorById = new Map(indicators.map((item) => [item.id, item]))
  const metricByIndicatorId = new Map(
    response.assessment.metrics.map((item) => [item.indicatorId, item])
  )
  for (const event of events) {
    const eventRiskScore = event.indicatorId
      ? (metricByIndicatorId.get(event.indicatorId)?.riskScore ?? null)
      : null
    const eventRiskWeight =
      eventRiskScore === null
        ? null
        : Math.max(0, Math.min(1, eventRiskScore / 100))
    const eventNodeId = `event:${event.id}`
    nodes.set(eventNodeId, {
      id: eventNodeId,
      label: event.title,
      type: "risk_event",
      typeLabel: "近期事件",
      confidence: event.confidence,
      evidenceState: "verified",
      attributes: {
        chain_role: "risk_event",
        event_date: event.date,
        event_type: event.eventType,
        source_url: event.url,
        notes: event.notes,
        ...(eventRiskWeight === null ? {} : { impact_weight: eventRiskWeight }),
      },
    })
    edges.set(`event-company:${event.id}`, {
      id: `event-company:${event.id}`,
      source: eventNodeId,
      target: companyNodeId,
      relation: "涉及目标企业",
      relationCode: "event_impacts_company",
      confidence: event.confidence,
      evidenceState: "verified",
      attributes: {
        factual_projection: true,
        ...(eventRiskWeight === null ? {} : { impact_weight: eventRiskWeight }),
      },
    })

    if (event.url) {
      const sourceNodeId = `source:${event.id}`
      nodes.set(sourceNodeId, {
        id: sourceNodeId,
        label: publicSourceLabel(event.url),
        type: "evidence_source",
        typeLabel: "证据来源",
        confidence: event.confidence,
        evidenceState: "verified",
        attributes: {
          chain_role: "evidence_source",
          source_url: event.url,
        },
      })
      edges.set(`source-event:${event.id}`, {
        id: `source-event:${event.id}`,
        source: sourceNodeId,
        target: eventNodeId,
        relation: "提供证据",
        relationCode: "supports_event",
        confidence: event.confidence,
        evidenceState: "verified",
        attributes: { factual_projection: true },
      })
    }

    if (!event.indicatorId) continue
    const indicator = indicatorById.get(event.indicatorId)
    if (!indicator) continue
    const indicatorNodeId = `indicator:${indicator.id}`
    const categoryNodeId = `category:${indicator.primaryCategory}`
    nodes.set(indicatorNodeId, {
      id: indicatorNodeId,
      label: `${indicator.id} ${indicator.label}`,
      type: "risk_indicator",
      typeLabel: "风险指标",
      confidence: event.confidence,
      evidenceState: "verified",
      attributes: {
        chain_role: "risk_indicator",
        indicator_id: indicator.id,
        ...(eventRiskWeight === null ? {} : { impact_weight: eventRiskWeight }),
      },
    })
    nodes.set(categoryNodeId, {
      id: categoryNodeId,
      label: indicator.primaryCategory,
      type: "risk_category",
      typeLabel: "风险领域",
      confidence: null,
      evidenceState: "verified",
      attributes: { chain_role: "risk_category" },
    })
    edges.set(`event-indicator:${event.id}:${indicator.id}`, {
      id: `event-indicator:${event.id}:${indicator.id}`,
      source: eventNodeId,
      target: indicatorNodeId,
      relation: "对应已标注指标",
      relationCode: "event_maps_to_indicator",
      confidence: event.confidence,
      evidenceState: "verified",
      attributes: {
        factual_projection: true,
        ...(eventRiskWeight === null ? {} : { impact_weight: eventRiskWeight }),
      },
    })
    edges.set(`indicator-category:${indicator.id}`, {
      id: `indicator-category:${indicator.id}`,
      source: indicatorNodeId,
      target: categoryNodeId,
      relation: "属于风险领域",
      relationCode: "belongs_to_risk_category",
      confidence: null,
      evidenceState: "verified",
      attributes: { schema_relation: true },
    })
  }

  const nodeList = [...nodes.values()]
  const edgeList = [...edges.values()]
  return {
    contractVersion: RISK_GRAPH_CONTRACT_VERSION,
    company: {
      companyId: company.id,
      companyName: company.shortName,
      stockCode: company.stockCode,
    },
    view: "enterprise-event",
    availability: coverage("available", "structured-event-projection", null),
    snapshotId: null,
    minWeight,
    nodes: nodeList,
    edges: edgeList,
    summary: {
      nodeCount: nodeList.length,
      edgeCount: edgeList.length,
      eventCount: events.length,
      indicatorCount: new Set(
        events.map((item) => item.indicatorId).filter(Boolean)
      ).size,
      limitation:
        "该视图仅连接已入库事件、已标注指标与公开来源，不推断事件之间的因果或未来演化。",
    },
  }
}

export class RiskGraphService {
  private readonly origin: string
  private readonly fetchImpl: FetchLike
  private readonly timeoutMs: number

  constructor(options: RiskGraphServiceOptions = {}) {
    this.origin = (options.origin ?? DEFAULT_GRAPH_API_ORIGIN).replace(
      /\/+$/,
      ""
    )
    this.fetchImpl = options.fetchImpl ?? fetch
    this.timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
  }

  private async request(path: string): Promise<unknown> {
    const response = await this.fetchImpl(`${this.origin}${path}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(this.timeoutMs),
    })
    if (!response.ok)
      throw new Error(`graph upstream returned ${response.status}`)
    return response.json()
  }

  private async upstreamCompanies(): Promise<UpstreamCompanyNode[]> {
    const payload = await this.request("/api/companies")
    if (!isRecord(payload) || !Array.isArray(payload.companies)) return []
    return payload.companies
      .map(parseUpstreamCompany)
      .filter((item): item is UpstreamCompanyNode => item !== null)
  }

  private async findUpstreamCompany(stockCode: string) {
    const companies = await this.upstreamCompanies()
    return (
      companies.find(
        (item) =>
          item.attributes.stock_code === stockCode &&
          item.attributes.fee_kbg === true
      ) ?? null
    )
  }

  async listCompanies(): Promise<RiskGraphCompanyDirectoryResponse> {
    const directory = listIndustryRiskCompanies()
    let upstreamCodes = new Set<string>()
    let upstreamReachable = true
    try {
      upstreamCodes = new Set(
        (await this.upstreamCompanies())
          .filter((item) => item.attributes.fee_kbg === true)
          .map((item) => item.attributes.stock_code)
          .filter((value): value is string => typeof value === "string")
      )
    } catch {
      upstreamReachable = false
    }

    const companies = directory.companies.map((company) => {
      const hasEventProjection = company.eventCount > 0
      const hasSnapshot = upstreamCodes.has(company.stockCode)
      const expectedSnapshot = PILOT_SNAPSHOT_STOCK_CODES.has(company.stockCode)
      return {
        companyId: company.companyId,
        companyName: company.companyName,
        stockCode: company.stockCode,
        eventCount: company.eventCount,
        views: {
          "enterprise-event": hasSnapshot
            ? coverage("available", "audited-snapshot", null)
            : hasEventProjection
              ? coverage("available", "structured-event-projection", null)
              : coverage(
                  "unavailable",
                  "none",
                  "当前企业暂无可追溯的结构化近期事件。"
                ),
          "external-subject": hasSnapshot
            ? coverage("available", "audited-snapshot", null)
            : expectedSnapshot && !upstreamReachable
              ? coverage(
                  "service-unavailable",
                  "none",
                  "完整关系快照已存在，但图谱服务当前未启动。"
                )
              : coverage(
                  "unavailable",
                  "none",
                  "当前企业尚缺关联主体、外部事件和关系证据快照。"
                ),
        },
      }
    })

    return {
      contractVersion: RISK_GRAPH_CONTRACT_VERSION,
      sampleSize: companies.length,
      availableEnterpriseEventCount: companies.filter(
        (item) => item.views["enterprise-event"].status === "available"
      ).length,
      availableExternalSubjectCount: companies.filter(
        (item) => item.views["external-subject"].status === "available"
      ).length,
      companies,
    }
  }

  async getGraph(
    companyId: string,
    view: RiskGraphView,
    minWeight = DEFAULT_MIN_WEIGHT
  ): Promise<RiskGraphResponse> {
    const assessment = getIndustryRiskAssessment(companyId)
    let upstreamCompany: UpstreamCompanyNode | null = null
    let upstreamReachable = true
    try {
      upstreamCompany = await this.findUpstreamCompany(
        assessment.company.stockCode
      )
    } catch {
      upstreamReachable = false
    }

    if (upstreamCompany) {
      try {
        const endpoint =
          view === "enterprise-event"
            ? "/api/fee-transmission"
            : "/api/subject-panorama"
        const params = new URLSearchParams({
          company_key: upstreamCompany.id,
          limit: "500",
          min_weight: String(minWeight),
        })
        const payload = (await this.request(
          `${endpoint}?${params}`
        )) as UpstreamGraph
        const nodes = Array.isArray(payload.nodes)
          ? payload.nodes
              .map(parseUpstreamNode)
              .filter((item): item is RiskGraphNode => item !== null)
          : []
        const nodeIds = new Set(nodes.map((node) => node.id))
        const edges = Array.isArray(payload.edges)
          ? payload.edges
              .map(parseUpstreamEdge)
              .filter(
                (item): item is RiskGraphEdge =>
                  item !== null &&
                  nodeIds.has(item.source) &&
                  nodeIds.has(item.target)
              )
          : []
        return {
          contractVersion: RISK_GRAPH_CONTRACT_VERSION,
          company: {
            companyId: assessment.company.id,
            companyName: assessment.company.shortName,
            stockCode: assessment.company.stockCode,
          },
          view,
          availability: coverage("available", "audited-snapshot", null),
          snapshotId:
            typeof payload.snapshot_run_id === "string"
              ? payload.snapshot_run_id
              : null,
          minWeight,
          nodes,
          edges,
          summary: {
            nodeCount: nodes.length,
            edgeCount: edges.length,
            eventCount: readFiniteNumber(payload.event_count) ?? 0,
            indicatorCount: readFiniteNumber(payload.indicator_count) ?? 0,
            limitation:
              "图中已发生事实、规则映射和条件推演分别标记；条件推演不表示事件已经发生。",
          },
        }
      } catch {
        upstreamReachable = false
      }
    }

    if (view === "enterprise-event") {
      return buildStructuredEventGraph(assessment, minWeight)
    }

    return unavailableResponse(
      assessment,
      view,
      coverage(
        PILOT_SNAPSHOT_STOCK_CODES.has(assessment.company.stockCode) &&
          !upstreamReachable
          ? "service-unavailable"
          : "unavailable",
        "none",
        PILOT_SNAPSHOT_STOCK_CODES.has(assessment.company.stockCode) &&
          !upstreamReachable
          ? "完整关系快照已存在，但图谱服务当前未启动。"
          : "当前企业尚缺关联主体、外部事件和关系证据快照。"
      ),
      minWeight
    )
  }
}

const defaultRiskGraphService = new RiskGraphService({
  origin: process.env.GRAPH_API_ORIGIN,
})

export const listRiskGraphCompanies = () =>
  defaultRiskGraphService.listCompanies()

export const getRiskGraph = (
  companyId: string,
  view: RiskGraphView,
  minWeight?: number
) => defaultRiskGraphService.getGraph(companyId, view, minWeight)
