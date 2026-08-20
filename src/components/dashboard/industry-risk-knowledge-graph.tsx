import cytoscape, {
  type Core,
  type ElementDefinition,
  type NodeSingular,
  type StylesheetJson,
} from "cytoscape"
import fcose from "cytoscape-fcose"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import {
  AlertTriangleIcon,
  DatabaseZapIcon,
  FlameIcon,
  FocusIcon,
  InfoIcon,
  Maximize2Icon,
  Minimize2Icon,
  RefreshCwIcon,
  XIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from "lucide-react"

import { LiquidGlassSurface } from "@/components/liquid"
import { Reveal } from "@/components/motion/workflow-transition"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type {
  IndustryRiskGraphNodeKind,
  IndustryRiskKnowledgeGraph,
} from "@/domain/industry-risk-v1/index.ts"
import { fetchIndustryRiskKnowledgeGraph } from "@/lib/industry-risk-api"
import {
  buildIndustryRiskCytoscapeElements,
  selectIndustryRiskGraph,
} from "@/lib/industry-risk-graph-view"

cytoscape.use(fcose)

type GraphState =
  | { status: "loading" }
  | { status: "success"; value: IndustryRiskKnowledgeGraph }
  | { status: "error"; message: string }

const nodeKindLabels: Record<IndustryRiskGraphNodeKind, string> = {
  company: "企业",
  category: "风险维度",
  indicator: "R01–R22 指标",
  source: "数据来源",
  event: "风险事件",
}

const graphStyles: StylesheetJson = [
  {
    selector: "node",
    style: {
      width: "data(width)",
      height: "data(height)",
      shape: "ellipse",
      "background-color": "data(color)",
      "background-opacity": 0.9,
      "border-color": "#f8fafc",
      "border-opacity": 0.58,
      "border-width": 2,
      label: "data(label)",
      color: "#f8fafc",
      "font-family": "Geist Variable, ui-sans-serif, system-ui, sans-serif",
      "font-size": "data(fontSize)",
      "font-weight": 700,
      "min-zoomed-font-size": 7,
      "text-halign": "center",
      "text-valign": "center",
      "text-wrap": "wrap",
      "text-max-width": "78px",
      "text-outline-color": "#0f172a",
      "text-outline-opacity": 0.76,
      "text-outline-width": 2.2,
      "overlay-opacity": 0,
      "transition-property": "opacity, border-width, border-color",
      "transition-duration": 180,
      "transition-timing-function": "ease-out",
    },
  },
  {
    selector: 'node[kind = "company"]',
    style: {
      "border-color": "#ffffff",
      "border-width": 6,
      "font-size": 16,
      "text-max-width": "112px",
      "text-outline-width": 3.2,
      "underlay-color": "data(color)",
      "underlay-opacity": 0.3,
      "underlay-padding": 12,
      "z-index": 20,
    },
  },
  {
    selector: 'node[kind = "category"]',
    style: {
      shape: "round-rectangle",
      "background-color": "data(color)",
      "background-opacity": 0.9,
      "border-color": "#f8fafc",
      "border-opacity": 0.72,
      "border-style": "solid",
      "border-width": 3,
      color: "#f8fafc",
      "font-size": 13,
      "font-weight": 700,
      "text-halign": "center",
      "text-valign": "center",
      "text-max-width": "116px",
      "text-outline-width": 2.6,
      "z-index": 14,
    },
  },
  {
    selector: 'node[kind = "indicator"][!scored]',
    style: {
      "background-opacity": 0.42,
      "border-color": "#94a3b8",
      "border-style": "dashed",
      color: "#cbd5e1",
    },
  },
  {
    selector: 'node[kind = "indicator"][score >= 70]',
    style: {
      "border-color": "#fff7ed",
      "border-width": 4,
      "underlay-color": "data(color)",
      "underlay-opacity": 0.24,
      "underlay-padding": 8,
      "z-index": 16,
    },
  },
  {
    selector: 'node[kind = "source"]',
    style: {
      shape: "diamond",
      "background-opacity": 0.8,
      "border-color": "#bae6fd",
      label: "",
      "font-size": 9,
      "text-max-width": "68px",
      "text-valign": "bottom",
      "text-margin-y": 12,
    },
  },
  {
    selector: 'node[kind = "event"]',
    style: {
      shape: "round-hexagon",
      "background-opacity": 0.88,
      "border-color": "#fecdd3",
      label: "",
      "font-size": 9,
      "text-max-width": "68px",
      "text-valign": "bottom",
      "text-margin-y": 12,
    },
  },
  {
    selector: "edge",
    style: {
      width: "data(width)",
      "line-color": "data(color)",
      "target-arrow-color": "data(color)",
      "target-arrow-shape": "none",
      "curve-style": "straight",
      opacity: 0.28,
      "overlay-opacity": 0,
      "transition-property": "opacity, width, line-color",
      "transition-duration": 180,
      "transition-timing-function": "ease-out",
    },
  },
  {
    selector: 'edge[kind = "hierarchy"]',
    style: {
      opacity: 0.56,
      width: 2.2,
      "line-color": "#818cf8",
    },
  },
  {
    selector: 'edge[kind = "provenance"]',
    style: {
      opacity: 0.2,
      "line-style": "dotted",
      "curve-style": "bezier",
    },
  },
  {
    selector: 'edge[kind = "event-link"]',
    style: {
      opacity: 0.42,
      "line-style": "dashed",
      "curve-style": "bezier",
    },
  },
  {
    selector:
      'node[kind = "source"].is-active, node[kind = "event"].is-active',
    style: {
      label: "data(label)",
    },
  },
  {
    selector: ".is-dimmed",
    style: {
      opacity: 0.07,
    },
  },
  {
    selector: "node.is-active",
    style: {
      "border-color": "#ffffff",
      "border-width": 6,
      "background-opacity": 1,
      "z-index": 30,
    },
  },
  {
    selector: "edge.is-active",
    style: {
      width: 3.4,
      opacity: 0.96,
      label: "data(label)",
      color: "#f8fafc",
      "font-size": 9,
      "font-weight": 700,
      "text-background-color": "#0f172a",
      "text-background-opacity": 0.88,
      "text-background-padding": "3px",
      "text-rotation": "autorotate",
      "text-margin-y": -7,
    },
  },
]

function layoutOptions(
  animate: boolean,
  companyNodeId: string
): cytoscapeFcose.FcoseLayoutOptions {
  return {
    name: "fcose",
    quality: "default",
    randomize: false,
    animate,
    animationDuration: animate ? 720 : 0,
    animationEasing: "ease-out",
    fit: true,
    padding: 44,
    nodeDimensionsIncludeLabels: true,
    uniformNodeDimensions: false,
    nodeRepulsion: (node) => {
      const kind = node.data("kind") as IndustryRiskGraphNodeKind
      if (kind === "company") return 8_000
      if (kind === "category") return 6_000
      if (kind === "indicator") return 4_800
      return 2_800
    },
    idealEdgeLength: (edge) => {
      const kind = edge.data("kind") as "hierarchy" | "provenance" | "event-link"
      if (kind === "hierarchy") return 148
      if (kind === "provenance") return 92
      return 82
    },
    edgeElasticity: (edge) =>
      edge.data("kind") === "hierarchy" ? 0.28 : 0.52,
    nestingFactor: 1,
    numIter: 1_600,
    tile: true,
    tilingPaddingVertical: 24,
    tilingPaddingHorizontal: 24,
    gravity: 0.38,
    gravityRangeCompound: 1.5,
    gravityCompound: 0.8,
    gravityRange: 3.2,
    initialEnergyOnIncremental: 0.5,
    fixedNodeConstraint: [
      { nodeId: companyNodeId, position: { x: 0, y: 0 } },
    ],
  }
}

export function IndustryRiskKnowledgeGraph({
  selectedCompanyId,
}: {
  selectedCompanyId: string
}) {
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<GraphState>({ status: "loading" })
  const [selection, setSelection] = useState<{
    companyId: string
    nodeId: string | null
  }>({ companyId: selectedCompanyId, nodeId: null })
  const activeNodeId =
    selection.companyId === selectedCompanyId ? selection.nodeId : null
  const handleActiveNodeChange = useCallback(
    (nodeId: string | null) =>
      setSelection({ companyId: selectedCompanyId, nodeId }),
    [selectedCompanyId]
  )
  const selectedGraph = useMemo(
    () =>
      state.status === "success"
        ? selectIndustryRiskGraph(state.value, selectedCompanyId)
        : null,
    [selectedCompanyId, state]
  )

  useEffect(() => {
    const controller = new AbortController()
    void fetchIndustryRiskKnowledgeGraph({ signal: controller.signal })
      .then((value) => setState({ status: "success", value }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setState({
          status: "error",
          message:
            error instanceof Error
              ? error.message
              : "企业风险图谱暂时无法加载。",
        })
      })
    return () => controller.abort()
  }, [attempt])

  if (state.status === "loading") {
    return (
      <Reveal>
        <LiquidGlassSurface
          variant="card"
          className="industry-graph-state-glass"
          padding="0"
        >
          <div className="industry-graph-state" role="status">
            <DatabaseZapIcon aria-hidden="true" />
            <p>正在构建企业、风险维度、指标、来源与事件关系…</p>
          </div>
        </LiquidGlassSurface>
      </Reveal>
    )
  }

  if (state.status === "error") {
    return (
      <Reveal>
        <LiquidGlassSurface
          variant="card"
          className="industry-graph-state-glass"
          padding="0"
        >
          <div className="industry-graph-state" role="alert">
            <InfoIcon aria-hidden="true" />
            <p>{state.message}</p>
            <Button
              variant="outline"
              onClick={() => {
                setState({ status: "loading" })
                setAttempt((value) => value + 1)
              }}
            >
              <RefreshCwIcon data-icon="inline-start" />
              重新加载
            </Button>
          </div>
        </LiquidGlassSurface>
      </Reveal>
    )
  }

  if (!selectedGraph) return null
  const graph = selectedGraph
  const company = graph.nodes.find((node) => node.kind === "company")
  return (
    <IndustryRiskKnowledgeGraphContent
      graph={graph}
      companyName={company?.label ?? "所选企业"}
      activeNodeId={activeNodeId}
      onActiveNodeChange={handleActiveNodeChange}
    />
  )
}

function IndustryRiskKnowledgeGraphContent({
  graph,
  companyName,
  activeNodeId,
  onActiveNodeChange,
}: {
  graph: IndustryRiskKnowledgeGraph
  companyName: string
  activeNodeId: string | null
  onActiveNodeChange: (nodeId: string | null) => void
}) {
  const canvasRef = useRef<HTMLDivElement>(null)
  const cytoscapeRef = useRef<Core | null>(null)
  const [engineError, setEngineError] = useState<string | null>(null)
  const [isImmersive, setIsImmersive] = useState(false)
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null)
  const elements = useMemo(
    () =>
      buildIndustryRiskCytoscapeElements(graph) as unknown as ElementDefinition[],
    [graph]
  )
  const activeNode = graph.nodes.find((node) => node.id === activeNodeId)
  const hoveredNode = graph.nodes.find((node) => node.id === hoveredNodeId)
  const companyNode = graph.nodes.find((node) => node.kind === "company")
  const companyNodeId = companyNode?.id ?? ""
  const topRiskIndicators = graph.nodes
    .filter(
      (node) => node.kind === "indicator" && node.score !== null
    )
    .sort((left, right) => (right.score ?? 0) - (left.score ?? 0))
    .slice(0, 5)
  const activeEdges = activeNode
    ? graph.edges.filter(
        (edge) => edge.source === activeNode.id || edge.target === activeNode.id
      )
    : []
  const countKind = (kind: IndustryRiskGraphNodeKind) =>
    graph.nodes.filter((node) => node.kind === kind).length

  useEffect(() => {
    const container = canvasRef.current
    if (!container) return
    let disposed = false
    queueMicrotask(() => {
      if (!disposed) setEngineError(null)
    })

    let cy: Core | null = null
    try {
      cy = cytoscape({
        container,
        elements,
        style: graphStyles,
        layout: { name: "preset", fit: true, padding: 44, animate: false },
        minZoom: 0.28,
        maxZoom: 3.4,
        boxSelectionEnabled: false,
        selectionType: "single",
      })
      cytoscapeRef.current = cy

      cy.on("tap", "node", (event) => {
        const node = event.target as NodeSingular
        onActiveNodeChange(node.id())
      })
      cy.on("tap", (event) => {
        if (event.target === cy) onActiveNodeChange(null)
      })
      cy.on("dbltap", "node", (event) => {
        const node = event.target as NodeSingular
        const focus = node
          .closedNeighborhood()
          .union(node.parents())
          .union(node.children())
        cy?.animate({ fit: { eles: focus, padding: 80 }, duration: 380 })
      })
      cy.on("mouseover", "node", (event) => {
        const node = event.target as NodeSingular
        setHoveredNodeId(node.id())
      })
      cy.on("mouseout", "node", () => setHoveredNodeId(null))
      const resizeObserver = new ResizeObserver(() => {
        cy?.resize()
      })
      resizeObserver.observe(container)

      return () => {
        disposed = true
        resizeObserver.disconnect()
        cy?.destroy()
        if (cytoscapeRef.current === cy) cytoscapeRef.current = null
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "专业图谱引擎初始化失败。"
      queueMicrotask(() => {
        if (!disposed) setEngineError(message)
      })
      cy?.destroy()
      cytoscapeRef.current = null
    }
  }, [elements, isImmersive, onActiveNodeChange])

  useEffect(() => {
    const cy = cytoscapeRef.current
    if (!cy || cy.destroyed()) return
    cy.batch(() => {
      cy.elements().removeClass("is-active is-dimmed")
      if (!activeNodeId) return
      const node = cy.getElementById(activeNodeId)
      if (!node.length) return
      const related = node
        .closedNeighborhood()
        .union(node.parents())
        .union(node.children())
        .union(node.children().connectedEdges())
      related.addClass("is-active")
      cy.elements().difference(related).addClass("is-dimmed")
    })
  }, [activeNodeId, elements])

  useEffect(() => {
    const cy = cytoscapeRef.current
    const frame = requestAnimationFrame(() => {
      cy?.resize()
      if (cy && !cy.destroyed()) cy.fit(cy.elements(), 44)
    })
    const settleTimer = window.setTimeout(() => {
      cy?.resize()
      if (cy && !cy.destroyed()) cy.fit(cy.elements(), 44)
    }, 180)
    if (!isImmersive) {
      return () => {
        cancelAnimationFrame(frame)
        window.clearTimeout(settleTimer)
      }
    }

    const previousOverflow = document.body.style.overflow
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsImmersive(false)
    }
    document.body.style.overflow = "hidden"
    window.addEventListener("keydown", closeOnEscape)
    return () => {
      cancelAnimationFrame(frame)
      window.clearTimeout(settleTimer)
      document.body.style.overflow = previousOverflow
      window.removeEventListener("keydown", closeOnEscape)
    }
  }, [isImmersive])

  const fitGraph = useCallback(() => {
    const cy = cytoscapeRef.current
    if (!cy) return
    cy.animate({ fit: { eles: cy.elements(), padding: 44 }, duration: 320 })
  }, [])

  const zoomBy = useCallback((factor: number) => {
    const cy = cytoscapeRef.current
    if (!cy) return
    cy.animate({ zoom: cy.zoom() * factor, duration: 220 })
  }, [])

  const rerunLayout = () => {
    const cy = cytoscapeRef.current
    if (!cy || !companyNodeId) return
    onActiveNodeChange(null)
    const layout = cy.layout(layoutOptions(true, companyNodeId))
    layout.one("layoutstop", () => {
      cy.animate({ fit: { eles: cy.elements(), padding: 44 }, duration: 280 })
    })
    layout.run()
  }

  const graphContent = (
    <div className="industry-graph-content" data-immersive={isImmersive}>
      {isImmersive ? (
        <Button
          variant="outline"
          size="sm"
          className="industry-graph-immersive-exit"
          onClick={() => setIsImmersive(false)}
        >
          <Minimize2Icon data-icon="inline-start" />
          退出沉浸
        </Button>
      ) : null}
      <div className="industry-graph-canvas-shell">
        <div
          ref={canvasRef}
          className="industry-graph-cytoscape"
          role="application"
          aria-label={`${companyName}企业风险关系图：${graph.nodes.length} 个节点、${graph.edges.length} 条关系`}
        />
        {engineError ? (
          <div className="industry-graph-engine-error" role="alert">
            <InfoIcon aria-hidden="true" />
            <span>{engineError}</span>
          </div>
        ) : null}
        <div className="industry-graph-canvas-hint">
          拖拽节点 · 滚轮缩放 · 单击下钻 · 双击聚焦
        </div>
        {hoveredNode && !activeNode ? (
          <div className="industry-graph-hover-card" role="status">
            <span>{nodeKindLabels[hoveredNode.kind]}</span>
            <strong>{hoveredNode.label}</strong>
            <small>
              {hoveredNode.score === null
                ? hoveredNode.caption
                : `${hoveredNode.score.toFixed(1)} 候选分 · ${hoveredNode.caption}`}
            </small>
          </div>
        ) : null}
      </div>

      {activeNode ? (
        <aside className="industry-graph-inspector" aria-live="polite">
          <button
            type="button"
            className="industry-graph-inspector-close"
            aria-label="关闭节点详情"
            onClick={() => onActiveNodeChange(null)}
          >
            <XIcon aria-hidden="true" />
          </button>
          <Badge variant="outline">{nodeKindLabels[activeNode.kind]}</Badge>
          <h3>{activeNode.label}</h3>
          <p>{activeNode.caption}</p>
          {activeNode.score !== null ? (
            <strong>{activeNode.score} 候选分</strong>
          ) : null}
          <div>
            <span>直接关系 {activeEdges.length} 条</span>
          </div>
          <ul>
            {activeEdges.slice(0, 12).map((edge) => (
              <li key={edge.id}>
                <b>{edge.label}</b>
                <span>{edge.detail}</span>
              </li>
            ))}
          </ul>
          {activeEdges.length > 12 ? (
            <small>另有 {activeEdges.length - 12} 条直接关系。</small>
          ) : null}
        </aside>
      ) : null}
    </div>
  )

  return (
    <Reveal>
      <LiquidGlassSurface
        variant="card"
        className="industry-graph-glass"
        padding="0"
      >
        <section className="industry-graph" aria-labelledby="industry-graph-title">
          <header className="industry-graph-header">
            <div>
              <span className="eyebrow">单企业语义径向图 · Cytoscape + fCoSE</span>
              <h2 id="industry-graph-title">{companyName}企业风险知识图谱</h2>
              <p>
                企业位于中心，风险维度构成内环，R01–R22 指标和证据向外展开；
                节点面积与颜色共同表达风险强度，单击可追溯来源和事件。
              </p>
            </div>
            <div className="industry-graph-toolbar" aria-label="图谱视图控制">
              <Button variant="outline" size="sm" onClick={() => zoomBy(1.22)}>
                <ZoomInIcon data-icon="inline-start" />
                放大
              </Button>
              <Button variant="outline" size="sm" onClick={() => zoomBy(0.82)}>
                <ZoomOutIcon data-icon="inline-start" />
                缩小
              </Button>
              <Button variant="outline" size="sm" onClick={fitGraph}>
                <FocusIcon data-icon="inline-start" />
                适应画布
              </Button>
              <Button variant="outline" size="sm" onClick={rerunLayout}>
                <RefreshCwIcon data-icon="inline-start" />
                力导优化
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsImmersive(true)}
              >
                <Maximize2Icon data-icon="inline-start" />
                沉浸查看
              </Button>
            </div>
          </header>

          <div className="industry-graph-summary">
            <Badge variant="outline">{countKind("category")} 个风险维度</Badge>
            <Badge variant="outline">{countKind("indicator")} 项统一指标</Badge>
            <Badge variant="outline">{countKind("source")} 个数据来源</Badge>
            <Badge variant="outline">{countKind("event")} 个风险事件</Badge>
            <Badge variant="outline">{graph.edges.length} 条可追溯关系</Badge>
            <Badge variant="outline">语义径向 · 动态避让</Badge>
          </div>

          <div className="industry-graph-hotspots" aria-label="当前风险热点">
            <div className="industry-graph-hotspots-heading">
              <FlameIcon aria-hidden="true" />
              <span>风险热点</span>
              <strong>{companyNode?.score?.toFixed(1) ?? "—"}</strong>
              <small>企业候选基线</small>
            </div>
            <ol>
              {topRiskIndicators.map((node) => (
                <li key={node.id}>
                  <button
                    type="button"
                    onClick={() => onActiveNodeChange(node.id)}
                  >
                    <span>{node.entityId}</span>
                    <b>{node.label}</b>
                    <strong>{node.score?.toFixed(0)}</strong>
                  </button>
                </li>
              ))}
            </ol>
          </div>

          {isImmersive ? createPortal(graphContent, document.body) : graphContent}

          <footer className="industry-graph-legend">
            {Object.entries(nodeKindLabels).map(([kind, label]) => (
              <span key={kind} data-kind={kind}>{label}</span>
            ))}
            <div
              className="industry-graph-heat-legend"
              aria-label="蓝色表示较低风险分位，黄色表示中等风险分位，红色表示较高风险分位；节点面积随候选风险分增大"
            >
              <span>较低</span>
              <i aria-hidden="true" />
              <span>较高</span>
              <b>颜色 + 面积 = 候选风险强度</b>
              <small>灰色虚线 = 暂无可比数值</small>
            </div>
            <p>
              <AlertTriangleIcon aria-hidden="true" />
              连线表示指标归属、来源或事件证据，不宣称因果关系。
            </p>
          </footer>
        </section>
      </LiquidGlassSurface>
    </Reveal>
  )
}
