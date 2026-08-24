import { existsSync } from "node:fs"
import { resolve } from "node:path"
import { DatabaseSync } from "node:sqlite"

import type {
  IndustryRiskCompanyAssessment,
  IndustryRiskDataset,
  IndustryRiskGraphEdge,
  IndustryRiskGraphNode,
  IndustryRiskKnowledgeGraph,
} from "../src/domain/industry-risk-v1/index.ts"

type SqlValue = string | number | null
type SqlRow = Record<string, SqlValue>

const EVENT_TYPES = new Set([
  "compliance_event",
  "sanctions_event",
  "personnel_mobility",
  "major_technical_event",
  "financing_event",
  "asset_impairment_event",
  "personnel_risk_event",
])
const SUBJECT_TYPES = new Set([
  "regulator",
  "court",
  "person",
  "associated_company",
  "arbitration_body",
])

function stringValue(value: SqlValue) {
  return value === null ? "" : String(value)
}

function parseJson(value: SqlValue): Record<string, unknown> {
  try {
    const candidate = JSON.parse(stringValue(value)) as unknown
    return candidate && typeof candidate === "object" && !Array.isArray(candidate)
      ? (candidate as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

function strings(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : []
}

function numberValue(value: SqlValue) {
  return typeof value === "number" ? value : Number(value) || 0
}

function tone(confidence: number): IndustryRiskGraphNode["tone"] {
  if (confidence >= 0.94) return "critical"
  if (confidence >= 0.86) return "high"
  if (confidence >= 0.7) return "medium"
  return "low"
}

function title(value: string, max = 22) {
  const normalized = value.replace(/\s+/g, " ").trim()
  return normalized.length > max ? `${normalized.slice(0, max)}…` : normalized
}

function relationLabel(value: string) {
  const labels: Record<string, string> = {
    occurs: "发生风险事件",
    inquired_by: "受到问询",
    penalized_by: "受到监管关注",
    restricted_by: "受到限制",
    litigates_in: "涉及争议",
    related_to: "影响指标",
  }
  return labels[value] ?? value
}

function evolutionFor(indicatorIds: readonly string[], eventLabel: string) {
  if (indicatorIds.some((id) => id === "R17" || id === "R19")) {
    return "条件推演：供应链受限或替代成本上升"
  }
  if (indicatorIds.some((id) => id === "R10" || id === "R11" || id === "R15")) {
    return "条件推演：监管持续关注与融资审核压力"
  }
  if (indicatorIds.some((id) => id === "R06" || id === "R08" || id === "R22")) {
    return "条件推演：核心团队稳定性与研发兑现压力"
  }
  if (/诉讼|仲裁|争议/.test(eventLabel)) {
    return "条件推演：争议处置与人才稳定性压力"
  }
  return null
}

interface RawNode {
  key: string
  type: string
  name: string
  attributes: Record<string, unknown>
  confidence: number
  needsReview: boolean
}

interface RawEdge {
  key: string
  source: string
  target: string
  relation: string
  attributes: Record<string, unknown>
  confidence: number
  needsReview: boolean
}

/**
 * Projects the crawler's validated graph snapshot into a deliberately small
 * event-transmission view.  Evidence stays in the edge detail rather than
 * becoming a dense visual node.  No company/subject relationship is inferred.
 */
export function buildRiskTransmissionGraph(
  databasePath: string,
  dataset: IndustryRiskDataset,
  assessments: readonly IndustryRiskCompanyAssessment[]
): IndustryRiskKnowledgeGraph {
  const absolutePath = resolve(databasePath)
  if (!existsSync(absolutePath)) throw new Error(`主数据库不存在：${absolutePath}`)
  const database = new DatabaseSync(absolutePath, { readOnly: true })
  try {
    const run = database.prepare(
      `SELECT run_id FROM knowledge_graph_runs
       WHERE status = 'completed' AND company_id IS NULL
       ORDER BY finished_at DESC LIMIT 1`
    ).get() as SqlRow | undefined
    if (!run?.run_id) throw new Error("主数据库尚未生成全量知识图谱快照。")
    const runId = stringValue(run.run_id)
    const rawNodes = database.prepare(
      `SELECT n.node_key, n.node_type, n.canonical_name, n.attributes_json,
              n.confidence, n.needs_review
       FROM knowledge_graph_snapshot_nodes s
       JOIN knowledge_graph_nodes n ON n.node_key = s.node_key
       WHERE s.run_id = ?`
    ).all(runId) as SqlRow[]
    const rawEdges = database.prepare(
      `SELECT e.edge_key, e.subject_key, e.object_key, e.relation_type,
              e.attributes_json, e.confidence, e.needs_review
       FROM knowledge_graph_snapshot_edges s
       JOIN knowledge_graph_edges e ON e.edge_key = s.edge_key
       WHERE s.run_id = ?`
    ).all(runId) as SqlRow[]
    const nodes = new Map<string, RawNode>(rawNodes.map((row) => {
      const item: RawNode = {
        key: stringValue(row.node_key), type: stringValue(row.node_type),
        name: stringValue(row.canonical_name), attributes: parseJson(row.attributes_json),
        confidence: numberValue(row.confidence), needsReview: numberValue(row.needs_review) === 1,
      }
      return [item.key, item]
    }))
    const edges: RawEdge[] = rawEdges.map((row) => ({
      key: stringValue(row.edge_key), source: stringValue(row.subject_key),
      target: stringValue(row.object_key), relation: stringValue(row.relation_type),
      attributes: parseJson(row.attributes_json), confidence: numberValue(row.confidence),
      needsReview: numberValue(row.needs_review) === 1,
    }))
    const assessmentByCompany = new Map(assessments.map((item) => [item.companyId, item]))
    const outputNodes: IndustryRiskGraphNode[] = []
    const outputEdges: IndustryRiskGraphEdge[] = []
    const nodeIds = new Set<string>()
    const addNode = (node: IndustryRiskGraphNode) => {
      if (!nodeIds.has(node.id)) { nodeIds.add(node.id); outputNodes.push(node) }
    }
    const addEdge = (edge: IndustryRiskGraphEdge) => {
      if (!outputEdges.some((item) => item.id === edge.id)) outputEdges.push(edge)
    }
    const addGraphNode = (raw: RawNode, kind: IndustryRiskGraphNode["kind"], companyId: string, caption: string) => {
      const id = `${kind}:${raw.key}`
      addNode({ id, entityId: raw.key, kind, label: title(raw.name), caption,
        score: null, scoresByCompany: {}, tone: tone(raw.confidence), companyIds: [companyId] })
      return id
    }

    for (const company of dataset.companies) {
      const rawCompany = [...nodes.values()].find((node) =>
        node.type === "company" && String(node.attributes.stock_code ?? "") === company.stockCode
      )
      if (!rawCompany) continue
      const companyId = company.id
      const assessment = assessmentByCompany.get(companyId)
      const companyGraphId = `company:${rawCompany.key}`
      addNode({ id: companyGraphId, entityId: companyId, kind: "company", label: company.shortName,
        caption: `${company.stockCode} · 风险事件传导视图`,
        score: assessment?.totalRiskScore ?? null,
        scoresByCompany: assessment?.totalRiskScore === null || assessment?.totalRiskScore === undefined ? {} : { [companyId]: assessment.totalRiskScore },
        tone: tone(company.confidence / 100), companyIds: [companyId] })

      const companyEdges = edges.filter((edge) => edge.source === rawCompany.key || edge.target === rawCompany.key)
      const eventCandidates = companyEdges.flatMap((edge) => {
        const otherKey = edge.source === rawCompany.key ? edge.target : edge.source
        const raw = nodes.get(otherKey)
        if (!raw || !EVENT_TYPES.has(raw.type)) return []
        const attrs = { ...raw.attributes, ...edge.attributes }
        const eventIds = strings(attrs.event_ids)
        const hasEventIdentity = Boolean(attrs.event_id) || eventIds.length > 0 || Boolean(attrs.event_date)
        return hasEventIdentity ? [{ raw, edge, attrs }] : []
      })
      const subjectsByEvent = new Map<string, RawEdge[]>()
      for (const edge of edges) {
        const source = nodes.get(edge.source); const target = nodes.get(edge.target)
        if (source && target && (EVENT_TYPES.has(source.type) || EVENT_TYPES.has(target.type)) &&
            (SUBJECT_TYPES.has(source.type) || SUBJECT_TYPES.has(target.type))) {
          const eventKey = EVENT_TYPES.has(source.type) ? source.key : target.key
          subjectsByEvent.set(eventKey, [...(subjectsByEvent.get(eventKey) ?? []), edge])
        }
      }
      const selectedEvents = eventCandidates
        .sort((a, b) => Number(Boolean(subjectsByEvent.get(b.raw.key)?.length)) - Number(Boolean(subjectsByEvent.get(a.raw.key)?.length)) || b.raw.confidence - a.raw.confidence || String(b.attrs.event_date ?? "").localeCompare(String(a.attrs.event_date ?? "")))
        .slice(0, 16)
      for (const { raw: event, edge: companyEdge, attrs } of selectedEvents) {
        const eventDate = typeof attrs.event_date === "string" ? attrs.event_date : "日期待核验"
        const eventId = addGraphNode(event, "event", companyId, `${event.type} · ${eventDate} · ${event.needsReview ? "需复核" : "已验证"}`)
        addEdge({ id: `transmission:${companyEdge.key}`, source: companyGraphId, target: eventId,
          kind: "event-link", label: relationLabel(companyEdge.relation),
          detail: `置信度 ${(companyEdge.confidence * 100).toFixed(0)}%${companyEdge.needsReview ? "；含待复核辅助证据" : "；已验证关系"}`,
          companyIds: [companyId] })
        const indicatorEdges = edges.filter((edge) =>
          edge.relation === "related_to" && (edge.source === event.key || edge.target === event.key)
        )
        const indicatorIds = new Set(strings(attrs.indicator_ids))
        for (const indicatorEdge of indicatorEdges) {
          const otherKey = indicatorEdge.source === event.key ? indicatorEdge.target : indicatorEdge.source
          const rawIndicator = nodes.get(otherKey)
          if (!rawIndicator) continue
          const indicatorId = typeof indicatorEdge.attributes.indicator_id === "string" ? indicatorEdge.attributes.indicator_id : ""
          if (indicatorId) indicatorIds.add(indicatorId)
          const id = addGraphNode(rawIndicator, "indicator", companyId, `${indicatorId || "关联指标"} · 由该事件影响`)
          addEdge({ id: `impact:${indicatorEdge.key}`, source: eventId, target: id, kind: "impact", label: "影响指标",
            detail: String(indicatorEdge.attributes.event_mapping ?? "已验证事件—指标关联"), companyIds: [companyId] })
        }
        for (const subjectEdge of subjectsByEvent.get(event.key) ?? []) {
          const subjectKey = subjectEdge.source === event.key ? subjectEdge.target : subjectEdge.source
          const subject = nodes.get(subjectKey)
          if (!subject) continue
          const id = addGraphNode(subject, "subject", companyId, `${subject.type} · 已确认外部关系`)
          addEdge({ id: `subject:${subjectEdge.key}`, source: id, target: eventId, kind: "subject-link", label: relationLabel(subjectEdge.relation),
            detail: `${String(subjectEdge.attributes.source_title ?? "已验证外部证据")} · ${String(subjectEdge.attributes.event_date ?? "日期待核验")}`,
            companyIds: [companyId] })
        }
        const evolution = evolutionFor([...indicatorIds], event.name)
        if (evolution) {
          const id = `evolution:${event.key}`
          addNode({ id, entityId: event.key, kind: "evolution", label: evolution.replace("条件推演：", ""),
            caption: "条件推演，不代表已发生；基于事件关联的风险指标主题。", score: null,
            scoresByCompany: {}, tone: "medium", companyIds: [companyId] })
          addEdge({ id: `evolution:${event.key}`, source: eventId, target: id, kind: "evolution-link", label: "可能演化",
            detail: "规则推演：需结合后续正式披露与外部证据持续验证。", companyIds: [companyId] })
        }
      }
    }
    return { schemaVersion: "KCR-RISK-TRANSMISSION-GRAPH-2026.08-v1", nodes: outputNodes, edges: outputEdges,
      counts: { nodes: outputNodes.length, edges: outputEdges.length,
        companies: outputNodes.filter((node) => node.kind === "company").length,
        categories: 0, indicators: outputNodes.filter((node) => node.kind === "indicator").length,
        sources: 0, events: outputNodes.filter((node) => node.kind === "event").length },
      scopeNote: "风险事件传导视图：只展示主库快照中的企业—事件、事件—指标及已确认外部主体关系；条件演化仅为规则推演，不代表事实。" }
  } finally { database.close() }
}
