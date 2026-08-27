import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import cytoscape, {
  type Core,
  type ElementDefinition,
  type NodeSingular,
  type StylesheetJson,
} from "cytoscape"
import fcose from "cytoscape-fcose"
import {
  ExternalLinkIcon,
  FocusIcon,
  InfoIcon,
  Maximize2Icon,
  Minimize2Icon,
  NetworkIcon,
  RefreshCwIcon,
  ScanLineIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from "lucide-react"

import { usePrefersReducedMotion } from "@/components/motion/workflow-transition"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type {
  RiskGraphEdge,
  RiskGraphEvidenceState,
  RiskGraphNode,
  RiskGraphResponse,
  RiskGraphView,
} from "@/domain/risk-graph-v1/index.ts"
import { fetchRiskGraph } from "@/lib/risk-graph-api"
import type { CompanyDetail } from "@/types/risk"
import "@/styles/risk-propagation-graph.css"

cytoscape.use(fcose)

type GraphState =
  | { status: "loading"; requestKey: string }
  | {
      status: "success"
      requestKey: string
      graph: RiskGraphResponse
    }
  | {
      status: "error"
      requestKey: string
      message: string
    }

const viewLabels: Record<
  RiskGraphView,
  { title: string; description: string }
> = {
  "enterprise-event": {
    title: "企业自身事件",
    description: "已发生事件、公开来源与风险指标的可追溯关联",
  },
  "external-subject": {
    title: "外部主体传导",
    description: "外部企业或人员事件经已核验关系传导至目标企业",
  },
}

const evidenceLabels: Record<RiskGraphEvidenceState, string> = {
  verified: "已核验事实",
  inferred: "规则映射",
  predictive: "条件推演",
}

const sourceModeLabels: Record<
  RiskGraphResponse["availability"]["sourceMode"],
  string
> = {
  "audited-snapshot": "完整关系快照",
  "structured-event-projection": "结构化事件投影",
  none: "暂无图谱",
}

const nodeTypeLabels: Record<string, string> = {
  company: "目标企业",
  risk_event: "企业近期事件",
  external_risk_event: "外部主体事件",
  event_topic: "事件主题",
  future_risk_scenario: "条件演化",
  risk_transmission_channel: "传导机制",
  risk_indicator: "风险指标",
  risk_category: "风险领域",
  warning_score: "辅助预警",
  evidence_source: "公开来源",
  external_evidence_source: "外部事件来源",
  supplier: "供应商",
  customer: "客户",
  shareholder: "股东",
  person: "高管/核心人员",
  person_group: "人员群体",
  regulator: "监管主体",
  court: "司法主体",
  internal_factor: "内部因素",
  associated_company: "关联企业",
}

const attributeLabels: Record<string, string> = {
  event_date: "发生时间",
  event_type: "事件类型",
  subject_category: "主体类别",
  indicator_id: "指标编号",
  transmission_weight: "主体影响权重",
  panorama_weight: "主体重要性",
  impact_weight: "企业影响权重",
  probability: "条件概率",
  path_weight: "传导权重",
  risk_level: "风险等级",
  source_url: "公开来源",
  display_context: "时间/语境",
}

const detailAttributeOrder = Object.keys(attributeLabels)

function numericAttribute(node: RiskGraphNode, keys: string[]) {
  for (const key of keys) {
    const value = node.attributes[key]
    if (typeof value === "number" && Number.isFinite(value)) return value
  }
  return null
}

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value))
}

function riskColor(weight: number) {
  const value = clamp(weight)
  if (value >= 0.8) return "#dc3f45"
  if (value >= 0.65) return "#ea7048"
  if (value >= 0.5) return "#d69a32"
  return "#4d9b88"
}

function graphNodeColor(node: RiskGraphNode) {
  const weight = numericAttribute(node, [
    "impact_weight",
    "path_weight",
    "transmission_weight",
    "panorama_weight",
    "probability",
  ])
  if (node.evidenceState === "predictive") return "#875ec7"
  if (node.type === "company") return "#245b92"
  if (node.type === "risk_event" || node.type === "external_risk_event") {
    return weight === null ? "#60748c" : riskColor(weight)
  }
  if (node.type === "risk_indicator") {
    return weight === null ? "#d8892c" : riskColor(weight)
  }
  if (node.type === "risk_category" || node.type === "warning_score") {
    return "#b84a59"
  }
  if (node.type.includes("evidence_source")) return "#60748c"
  if (node.type === "event_topic") return "#6a70b8"
  if (node.type === "risk_transmission_channel") return "#b86a38"
  if (
    [
      "supplier",
      "customer",
      "shareholder",
      "person",
      "person_group",
      "associated_company",
      "regulator",
      "court",
      "internal_factor",
    ].includes(node.type)
  ) {
    return weight === null ? "#3e8395" : riskColor(weight)
  }
  return "#55758a"
}

function graphNodeSize(node: RiskGraphNode) {
  if (node.type === "company") return 88
  const weight = numericAttribute(node, [
    "impact_weight",
    "path_weight",
    "transmission_weight",
    "panorama_weight",
    "probability",
  ])
  const base = node.type.includes("event") ? 48 : 42
  return Math.round(base + clamp(weight ?? 0.45) * 26)
}

function shortLabel(label: string) {
  const normalized = label.replace(/\s+/g, " ").trim()
  return normalized.length <= 18 ? normalized : `${normalized.slice(0, 17)}…`
}

function nodeLane(node: RiskGraphNode, view: RiskGraphView) {
  if (view === "external-subject") {
    if (node.type.includes("evidence_source")) return 0
    if (node.attributes.chain_role === "external_event_owner") return 1
    if (node.type === "external_risk_event") return 2
    if (node.attributes.chain_role === "entity") return 3
    if (node.type === "risk_transmission_channel") return 4
    if (node.type === "company") return 5
    if (node.type === "risk_indicator") return 6
    if (node.type === "risk_category") return 7
    return 3
  }

  if (node.type.includes("evidence_source")) return 0
  if (node.attributes.chain_role === "entity") return 1
  if (node.type === "risk_event") return 2
  if (node.type === "company") return 3
  if (node.type === "event_topic") return 3
  if (node.type === "future_risk_scenario") return 4
  if (node.type === "risk_indicator") return 5
  if (node.type === "risk_category") return 6
  if (node.type === "warning_score") return 7
  return 3
}

function semanticPositions(graph: RiskGraphResponse) {
  const lanes = new Map<number, RiskGraphNode[]>()
  for (const node of graph.nodes) {
    if (node.type === "company") continue
    const lane = nodeLane(node, graph.view)
    lanes.set(lane, [...(lanes.get(lane) ?? []), node])
  }
  const positions = new Map<string, { x: number; y: number }>()
  for (const [lane, nodes] of lanes) {
    const sorted = nodes.sort((left, right) => {
      const leftDate = String(left.attributes.event_date ?? "")
      const rightDate = String(right.attributes.event_date ?? "")
      return (
        left.type.localeCompare(right.type) ||
        leftDate.localeCompare(rightDate) ||
        left.label.localeCompare(right.label, "zh-CN")
      )
    })
    const spacing = sorted.length > 12 ? 92 : 112
    const start = -((sorted.length - 1) * spacing) / 2
    sorted.forEach((node, index) => {
      positions.set(node.id, { x: lane * 285, y: start + index * spacing })
    })
  }
  const company = graph.nodes.find((node) => node.type === "company")
  if (company) {
    const lane = nodeLane(company, graph.view)
    const sameLaneNodes = lanes.get(lane) ?? []
    const negativeCount = Math.ceil(sameLaneNodes.length / 2)
    sameLaneNodes.forEach((node, index) => {
      const offset =
        index < negativeCount
          ? -(index + 1) * 124
          : (index - negativeCount + 1) * 124
      positions.set(node.id, { x: lane * 285, y: offset })
    })
    positions.set(company.id, { x: lane * 285, y: 0 })
  }
  return positions
}

function edgeWeight(edge: RiskGraphEdge) {
  for (const key of ["path_weight", "influence_weight", "impact_weight"]) {
    const value = edge.attributes[key]
    if (typeof value === "number" && Number.isFinite(value)) return clamp(value)
  }
  return edge.confidence === null ? 0.55 : clamp(edge.confidence)
}

function buildElements(graph: RiskGraphResponse): ElementDefinition[] {
  const positions = semanticPositions(graph)
  return [
    ...graph.nodes.map((node) => ({
      group: "nodes" as const,
      data: {
        id: node.id,
        label: shortLabel(node.label),
        fullLabel: node.label,
        type: node.type,
        typeLabel: node.typeLabel,
        color: graphNodeColor(node),
        size: graphNodeSize(node),
        evidenceState: node.evidenceState,
      },
      position: positions.get(node.id),
    })),
    ...graph.edges.map((edge) => ({
      group: "edges" as const,
      data: {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        label: edge.relation,
        relationCode: edge.relationCode,
        color:
          edge.evidenceState === "predictive"
            ? "#875ec7"
            : edge.evidenceState === "inferred"
              ? "#c68b2c"
              : "#6d8798",
        width: 1 + edgeWeight(edge) * 2.8,
        evidenceState: edge.evidenceState,
      },
    })),
  ]
}

const graphStyles = (duration: number): StylesheetJson => [
  {
    selector: "node",
    style: {
      width: "data(size)",
      height: "data(size)",
      "background-color": "data(color)",
      "background-opacity": 0.92,
      "border-color": "#f7fbff",
      "border-width": 2,
      "border-opacity": 0.9,
      label: "data(label)",
      color: "#f8fafc",
      "font-family": "Geist Variable, ui-sans-serif, system-ui, sans-serif",
      "font-size": 10,
      "font-weight": 700,
      "min-zoomed-font-size": 7,
      "text-halign": "center",
      "text-valign": "center",
      "text-wrap": "wrap",
      "text-max-width": "104px",
      "text-outline-color": "#102233",
      "text-outline-opacity": 0.74,
      "text-outline-width": 1.6,
      "overlay-opacity": 0,
      "transition-property": "opacity, border-width, border-color",
      "transition-duration": duration,
    },
  },
  {
    selector: 'node[type = "company"]',
    style: {
      shape: "round-rectangle",
      "border-width": 5,
      "font-size": 15,
      "text-max-width": "120px",
      "underlay-color": "data(color)",
      "underlay-opacity": 0.22,
      "underlay-padding": 12,
      "z-index": 20,
    },
  },
  {
    selector: 'node[type = "risk_category"]',
    style: { shape: "round-rectangle", "font-size": 12, "z-index": 12 },
  },
  {
    selector: 'node[type *= "evidence_source"]',
    style: {
      shape: "diamond",
      "font-size": 9,
      "text-valign": "bottom",
      "text-margin-y": 12,
    },
  },
  {
    selector: 'node[type = "future_risk_scenario"]',
    style: { shape: "round-hexagon", "border-style": "dashed" },
  },
  {
    selector: 'node[evidenceState = "inferred"]',
    style: { "border-style": "dashed" },
  },
  {
    selector: 'node[evidenceState = "predictive"]',
    style: { "border-style": "dotted", "border-width": 4 },
  },
  {
    selector: "edge",
    style: {
      width: "data(width)",
      "line-color": "data(color)",
      "target-arrow-color": "data(color)",
      "target-arrow-shape": "triangle",
      "arrow-scale": 0.72,
      "curve-style": "bezier",
      opacity: 0.48,
      label: "",
      color: "#334155",
      "font-size": 9,
      "font-weight": 650,
      "text-background-color": "#f8fafc",
      "text-background-opacity": 0.9,
      "text-background-padding": "3px",
      "text-rotation": "autorotate",
      "transition-property": "opacity, width, line-color",
      "transition-duration": duration,
    },
  },
  {
    selector: 'edge[evidenceState = "inferred"]',
    style: { "line-style": "dashed" },
  },
  {
    selector: 'edge[evidenceState = "predictive"]',
    style: { "line-style": "dotted" },
  },
  {
    selector: ".is-dimmed",
    style: { opacity: 0.12, "text-opacity": 0.08 },
  },
  {
    selector: "node.is-active",
    style: {
      opacity: 1,
      "border-color": "#0b4c78",
      "border-width": 5,
      "underlay-color": "#2c8ab8",
      "underlay-opacity": 0.16,
      "underlay-padding": 9,
      "z-index": 30,
    },
  },
  {
    selector: "edge.is-active",
    style: {
      opacity: 0.96,
      width: 4,
      label: "data(label)",
      "z-index": 25,
    },
  },
]

function safeSourceUrl(node: RiskGraphNode) {
  const value = node.attributes.source_url
  if (typeof value !== "string") return null
  try {
    const url = new URL(value)
    return url.protocol === "http:" || url.protocol === "https:" ? value : null
  } catch {
    return null
  }
}

function formatAttribute(key: string, value: unknown) {
  if (typeof value === "number") {
    if (key.includes("weight") || key === "probability") return value.toFixed(3)
    return value.toLocaleString("zh-CN", { maximumFractionDigits: 3 })
  }
  return String(value)
}

export function RiskPropagationGraph({ detail }: { detail: CompanyDetail }) {
  const [view, setView] = useState<RiskGraphView>("enterprise-event")
  const [minWeight, setMinWeight] = useState(0.5)
  const [attempt, setAttempt] = useState(0)
  const requestKey = `${detail.id}:${view}:${minWeight}:${attempt}`
  const [state, setState] = useState<GraphState>({
    status: "loading",
    requestKey,
  })

  useEffect(() => {
    const controller = new AbortController()
    void fetchRiskGraph(detail.id, view, {
      minWeight,
      signal: controller.signal,
    })
      .then((graph) => {
        if (
          controller.signal.aborted ||
          graph.company.companyId !== detail.id
        ) {
          return
        }
        setState({
          status: "success",
          requestKey,
          graph,
        })
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setState({
          status: "error",
          requestKey,
          message:
            error instanceof Error ? error.message : "风险图谱暂时无法加载。",
        })
      })
    return () => controller.abort()
  }, [detail.id, minWeight, requestKey, view])

  const isCurrent = state.requestKey === requestKey
  const graph = state.status === "success" && isCurrent ? state.graph : null

  return (
    <div
      className="risk-propagation page-stack"
      data-graph-contract="KCR-RISK-GRAPH-2026.08-v1"
    >
      <header className="risk-propagation__header">
        <div>
          <span className="eyebrow">Risk propagation</span>
          <h2>{detail.name}风险传导</h2>
          <p>
            双图谱严格区分企业自身已发生事件与外部主体风险传导；虚线规则映射和条件推演不表示事实已经发生。
          </p>
        </div>
        <div className="risk-propagation__coverage">
          <Badge variant="outline">
            {graph
              ? sourceModeLabels[graph.availability.sourceMode]
              : "正在读取图谱"}
          </Badge>
          {graph?.snapshotId ? <span>快照 {graph.snapshotId}</span> : null}
        </div>
      </header>

      <div className="risk-propagation__view-switch" role="tablist">
        {(Object.keys(viewLabels) as RiskGraphView[]).map((option) => (
          <button
            key={option}
            type="button"
            role="tab"
            aria-selected={view === option}
            data-active={view === option}
            onClick={() => setView(option)}
          >
            <strong>{viewLabels[option].title}</strong>
            <span>{viewLabels[option].description}</span>
          </button>
        ))}
      </div>

      {!isCurrent || state.status === "loading" ? (
        <GraphStatePanel
          icon={<NetworkIcon />}
          text="正在读取关系快照并构建图谱…"
        />
      ) : state.status === "error" ? (
        <GraphStatePanel
          icon={<InfoIcon />}
          text={state.message}
          action={
            <Button
              variant="outline"
              onClick={() => setAttempt((value) => value + 1)}
            >
              <RefreshCwIcon data-icon="inline-start" />
              重新加载
            </Button>
          }
        />
      ) : graph?.availability.status !== "available" ? (
        <GraphStatePanel
          icon={<ScanLineIcon />}
          text={graph?.availability.missingReason ?? "当前企业暂无可展示图谱。"}
          detail="页面不会复用其他企业的关系或生成无证据的传导边。"
        />
      ) : graph ? (
        <RiskGraphCanvas
          graph={graph}
          minWeight={minWeight}
          onMinWeightChange={setMinWeight}
        />
      ) : null}
    </div>
  )
}

function GraphStatePanel({
  icon,
  text,
  detail,
  action,
}: {
  icon: ReactNode
  text: string
  detail?: string
  action?: ReactNode
}) {
  return (
    <section className="risk-propagation__state" role="status">
      <span aria-hidden="true">{icon}</span>
      <strong>{text}</strong>
      {detail ? <p>{detail}</p> : null}
      {action}
    </section>
  )
}

function RiskGraphCanvas({
  graph,
  minWeight,
  onMinWeightChange,
}: {
  graph: RiskGraphResponse
  minWeight: number
  onMinWeightChange: (value: number) => void
}) {
  const canvasRef = useRef<HTMLDivElement>(null)
  const cyRef = useRef<Core | null>(null)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [isImmersive, setIsImmersive] = useState(false)
  const [engineError, setEngineError] = useState<string | null>(null)
  const prefersReducedMotion = usePrefersReducedMotion()
  const elements = useMemo(() => buildElements(graph), [graph])
  const selectedNode = graph.nodes.find((node) => node.id === selectedNodeId)
  const selectedEdges = selectedNode
    ? graph.edges.filter(
        (edge) =>
          edge.source === selectedNode.id || edge.target === selectedNode.id
      )
    : []

  useEffect(() => {
    const container = canvasRef.current
    if (!container) return
    let disposed = false
    let cy: Core | null = null
    try {
      cy = cytoscape({
        container,
        elements,
        style: graphStyles(prefersReducedMotion ? 0 : 160),
        layout: {
          name: "preset",
          fit: true,
          padding: 70,
          animate: !prefersReducedMotion,
          animationDuration: prefersReducedMotion ? 0 : 480,
          animationEasing: "ease-out-cubic",
        },
        minZoom: 0.2,
        maxZoom: 3.8,
        boxSelectionEnabled: false,
        selectionType: "single",
      })
      cyRef.current = cy
      queueMicrotask(() => {
        if (!disposed) setEngineError(null)
      })
      cy.on("tap", "node", (event) => {
        setSelectedNodeId((event.target as NodeSingular).id())
      })
      cy.on("tap", (event) => {
        if (event.target === cy) setSelectedNodeId(null)
      })
      cy.on("dbltap", "node", (event) => {
        const node = event.target as NodeSingular
        cy?.animate({
          fit: { eles: node.closedNeighborhood(), padding: 100 },
          duration: prefersReducedMotion ? 0 : 240,
        })
      })
      const observer = new ResizeObserver(() => cy?.resize())
      observer.observe(container)
      return () => {
        disposed = true
        observer.disconnect()
        cy?.destroy()
        if (cyRef.current === cy) cyRef.current = null
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "图谱引擎初始化失败。"
      queueMicrotask(() => {
        if (!disposed) setEngineError(message)
      })
      cy?.destroy()
      cyRef.current = null
    }
  }, [elements, prefersReducedMotion])

  useEffect(() => {
    const cy = cyRef.current
    if (!cy || cy.destroyed()) return
    cy.batch(() => {
      cy.elements().removeClass("is-active is-dimmed")
      if (!selectedNodeId) return
      const selected = cy.getElementById(selectedNodeId)
      if (!selected.length) return
      const related = selected.closedNeighborhood()
      related.addClass("is-active")
      cy.elements().difference(related).addClass("is-dimmed")
    })
  }, [selectedNodeId])

  useEffect(() => {
    const cy = cyRef.current
    const frame = requestAnimationFrame(() => {
      cy?.resize()
      cy?.fit(cy.elements(), 70)
    })
    if (!isImmersive) return () => cancelAnimationFrame(frame)
    const previousOverflow = document.body.style.overflow
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsImmersive(false)
    }
    document.body.style.overflow = "hidden"
    window.addEventListener("keydown", close)
    return () => {
      cancelAnimationFrame(frame)
      document.body.style.overflow = previousOverflow
      window.removeEventListener("keydown", close)
    }
  }, [isImmersive])

  const animateFit = () => {
    const cy = cyRef.current
    cy?.animate({
      fit: { eles: cy.elements(), padding: 70 },
      duration: prefersReducedMotion ? 0 : 220,
    })
  }

  const zoomBy = (factor: number) => {
    const cy = cyRef.current
    if (!cy) return
    cy.animate({
      zoom: cy.zoom() * factor,
      duration: prefersReducedMotion ? 0 : 150,
    })
  }

  const optimizeLayout = () => {
    const cy = cyRef.current
    if (!cy) return
    setSelectedNodeId(null)
    cy.layout({
      name: "fcose",
      quality: "default",
      animate: !prefersReducedMotion,
      animationDuration: prefersReducedMotion ? 0 : 520,
      randomize: false,
      fit: true,
      padding: 70,
      nodeRepulsion: () => 7_500,
      idealEdgeLength: () => 130,
      edgeElasticity: () => 0.35,
      nestingFactor: 0.9,
      gravity: 0.18,
      numIter: 1_800,
      tile: true,
    } as cytoscape.LayoutOptions).run()
  }

  return (
    <section
      className="risk-propagation__workspace"
      data-immersive={isImmersive}
      aria-label={`${graph.company.companyName}${viewLabels[graph.view].title}图谱`}
    >
      <div className="risk-propagation__toolbar">
        <div className="risk-propagation__summary">
          <strong>{graph.summary.nodeCount}</strong> 节点
          <span>/</span>
          <strong>{graph.summary.edgeCount}</strong> 关系
          <span>/</span>
          <strong>{graph.summary.eventCount}</strong> 事件
        </div>
        {graph.availability.sourceMode === "audited-snapshot" ? (
          <div
            className="risk-propagation__threshold"
            aria-label="关系权重阈值"
          >
            <span>权重阈值</span>
            {[0.35, 0.5, 0.65].map((value) => (
              <button
                key={value}
                type="button"
                data-active={minWeight === value}
                onClick={() => onMinWeightChange(value)}
              >
                {value.toFixed(2)}
              </button>
            ))}
          </div>
        ) : null}
        <div className="risk-propagation__tools" aria-label="图谱视图控制">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="缩小"
            onClick={() => zoomBy(0.82)}
          >
            <ZoomOutIcon />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="放大"
            onClick={() => zoomBy(1.2)}
          >
            <ZoomInIcon />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="适应画布"
            onClick={animateFit}
          >
            <FocusIcon />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="关系力导布局"
            onClick={optimizeLayout}
          >
            <ScanLineIcon />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={isImmersive ? "退出沉浸查看" : "沉浸查看"}
            onClick={() => setIsImmersive((value) => !value)}
          >
            {isImmersive ? <Minimize2Icon /> : <Maximize2Icon />}
          </Button>
        </div>
      </div>

      <div className="risk-propagation__canvas-shell">
        <div
          ref={canvasRef}
          className="risk-propagation__canvas"
          role="application"
          aria-label={`${graph.company.companyName}风险传导图：${graph.summary.nodeCount} 个节点、${graph.summary.edgeCount} 条关系`}
        />
        {engineError ? (
          <div className="risk-propagation__engine-error" role="alert">
            <InfoIcon />
            {engineError}
          </div>
        ) : null}
        <div className="risk-propagation__lane-labels" aria-hidden="true">
          {(graph.view === "enterprise-event"
            ? [
                "公开来源",
                "风险主体",
                "已发生事件",
                "主题/企业",
                "条件演化",
                "风险指标",
                "风险领域",
              ]
            : [
                "公开来源",
                "事件主体",
                "外部事件",
                "关联主体",
                "传导机制",
                "目标企业",
                "风险指标",
                "风险领域",
              ]
          ).map((label) => (
            <span key={label}>{label}</span>
          ))}
        </div>
        <div className="risk-propagation__legend" aria-label="图谱图例">
          <span>
            <i data-kind="event" />
            事件风险强度
          </span>
          <span>
            <i data-kind="entity" />
            关联主体
          </span>
          <span>
            <i data-kind="indicator" />
            风险指标
          </span>
          <span>
            <i data-kind="verified" />
            实线：已核验
          </span>
          <span>
            <i data-kind="predictive" />
            虚线：规则/推演
          </span>
        </div>
        <p className="risk-propagation__hint">
          拖拽节点 · 滚轮缩放 · 单击查看证据 · 双击聚焦关系
        </p>

        {selectedNode ? (
          <GraphInspector
            node={selectedNode}
            edges={selectedEdges}
            graph={graph}
            onClose={() => setSelectedNodeId(null)}
          />
        ) : null}
      </div>

      <footer className="risk-propagation__limitation">
        <InfoIcon aria-hidden="true" />
        <span>{graph.summary.limitation}</span>
      </footer>
    </section>
  )
}

function GraphInspector({
  node,
  edges,
  graph,
  onClose,
}: {
  node: RiskGraphNode
  edges: RiskGraphEdge[]
  graph: RiskGraphResponse
  onClose: () => void
}) {
  const sourceUrl = safeSourceUrl(node)
  const nodeById = new Map(graph.nodes.map((item) => [item.id, item]))
  const attributes = detailAttributeOrder
    .map((key) => [key, node.attributes[key]] as const)
    .filter(
      ([, value]) => value !== null && value !== undefined && value !== ""
    )

  return (
    <aside className="risk-propagation__inspector" aria-live="polite">
      <button type="button" aria-label="关闭节点详情" onClick={onClose}>
        ×
      </button>
      <div>
        <Badge variant="outline">
          {nodeTypeLabels[node.type] ?? node.typeLabel}
        </Badge>
        <Badge variant="outline">{evidenceLabels[node.evidenceState]}</Badge>
      </div>
      <h3>{node.label}</h3>
      {node.confidence !== null ? (
        <p>证据置信度 {(node.confidence * 100).toFixed(0)}%</p>
      ) : null}
      {attributes.length > 0 ? (
        <dl>
          {attributes.map(([key, value]) => (
            <div key={key}>
              <dt>{attributeLabels[key]}</dt>
              <dd>
                {key === "source_url" && sourceUrl ? (
                  <a href={sourceUrl} target="_blank" rel="noreferrer">
                    查看公开证据 <ExternalLinkIcon />
                  </a>
                ) : (
                  formatAttribute(key, value)
                )}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {edges.length > 0 ? (
        <section>
          <strong>直接关系</strong>
          <ul>
            {edges.slice(0, 8).map((edge) => {
              const peerId = edge.source === node.id ? edge.target : edge.source
              return (
                <li key={edge.id}>
                  <span>{edge.relation}</span>
                  <b>{nodeById.get(peerId)?.label ?? peerId}</b>
                </li>
              )
            })}
          </ul>
        </section>
      ) : null}
    </aside>
  )
}
