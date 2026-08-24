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
  subject: "外部主体",
  evolution: "条件演化",
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
      shape: "round-rectangle",
      "background-opacity": 0.88,
      "border-color": "#fecdd3",
      label: "data(label)",
      "font-size": 9,
      "text-max-width": "106px",
      "text-valign": "center",
      "text-outline-width": 1.8,
    },
  },
  {
    selector: 'node[kind = "subject"]',
    style: {
      shape: "round-rectangle",
      "background-opacity": 0.88,
      "border-color": "#bbf7d0",
      label: "data(label)",
      "font-size": 9,
      "text-max-width": "78px",
      "text-valign": "center",
      "text-outline-width": 1.8,
    },
  },
  {
    selector: 'node[kind = "indicator"]',
    style: {
      shape: "round-rectangle",
      "background-opacity": 0.84,
      "border-color": "#bae6fd",
      "text-max-width": "92px",
      "text-outline-width": 1.8,
    },
  },
  {
    selector: 'node[kind = "evolution"]',
    style: {
      shape: "round-diamond",
      "background-opacity": 0.72,
      "border-color": "#ddd6fe",
      "border-style": "dashed",
      "text-max-width": "100px",
      "text-outline-width": 1.8,
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
    selector: 'edge[kind = "impact"]',
    style: { opacity: 0.6, "curve-style": "bezier" },
  },
  {
    selector: 'edge[kind = "evolution-link"]',
    style: { opacity: 0.55, "line-style": "dashed", "curve-style": "bezier" },
  },
  {
    selector:
      'node[kind = "source"].is-active, node[kind = "event"].is-active, node[kind = "subject"].is-active, node[kind = "evolution"].is-active',
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
      if (kind === "company") return 12_000
      if (kind === "event") return 7_500
      if (kind === "indicator" || kind === "subject") return 5_400
      return 4_200
    },
    idealEdgeLength: (edge) => {
      const kind = edge.data("kind") as "event-link" | "impact" | "subject-link" | "evolution-link"
      if (kind === "event-link") return 240
      if (kind === "impact") return 190
      return 175
    },
    edgeElasticity: (edge) =>
      edge.data("kind") === "hierarchy" ? 0.28 : 0.52,
    nestingFactor: 1,
    numIter: 2_200,
    tile: true,
    tilingPaddingVertical: 24,
    tilingPaddingHorizontal: 24,
    gravity: 0.2,
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
            <p>正在加载企业风险事件传导关系…</p>
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
  const keyEvents = graph.nodes
    .filter((node) => node.kind === "event")
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
                : `${hoveredNode.score.toFixed(1)} 基准分 · ${hoveredNode.caption}`}
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
            <strong>{activeNode.score} 基准分</strong>
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
                企业位于中心，风险事件向外传导至受影响的二级风险指标、已确认外部主体与条件演化。
                数据来源仅在节点详情中展示，避免画布成为证据毛球。
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
            <Badge variant="outline">{countKind("event")} 个风险事件</Badge>
            <Badge variant="outline">{countKind("indicator")} 个受影响指标</Badge>
            <Badge variant="outline">{countKind("subject")} 个外部主体</Badge>
            <Badge variant="outline">{countKind("evolution")} 个条件演化</Badge>
            <Badge variant="outline">{graph.edges.length} 条可追溯关系</Badge>
            <Badge variant="outline">事件传导 · 动态避让</Badge>
          </div>

          <div className="industry-graph-hotspots" aria-label="当前风险热点">
            <div className="industry-graph-hotspots-heading">
              <FlameIcon aria-hidden="true" />
              <span>关键事件</span>
              <strong>{companyNode?.score?.toFixed(1) ?? "—"}</strong>
              <small>优先展示已验证传导关系</small>
            </div>
            <ol>
              {keyEvents.map((node) => (
                <li key={node.id}>
                  <button
                    type="button"
                    onClick={() => onActiveNodeChange(node.id)}
                  >
                    <span>事件</span>
                    <b>{node.label}</b>
                    <strong>{node.tone === "critical" ? "高" : "关注"}</strong>
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
              aria-label="蓝色表示较低风险分位，黄色表示中等风险分位，红色表示较高风险分位；节点面积随风险基准分增大"
            >
              <span>较低</span>
              <i aria-hidden="true" />
              <span>较高</span>
              <b>颜色 + 面积 = 风险基准强度</b>
              <small>灰色虚线 = 暂无可比数值</small>
            </div>
            <p>
              <AlertTriangleIcon aria-hidden="true" />
              连线仅表示主库中已确认的事件关联；紫色节点是条件推演，不代表已发生。
            </p>
          </footer>
        </section>
      </LiquidGlassSurface>
    </Reveal>
  )
}
