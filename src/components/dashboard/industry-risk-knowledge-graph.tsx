import cytoscape, {
  type Core,
  type ElementDefinition,
  type NodeSingular,
  type StylesheetJson,
} from "cytoscape"
import fcose from "cytoscape-fcose"
import { useGSAP } from "@gsap/react"
import gsap from "gsap"
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
  NewspaperIcon,
  RefreshCwIcon,
  XIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from "lucide-react"

import { LiquidGlassSurface } from "@/components/liquid"
import {
  PRODUCTIVE_MOTION,
  Reveal,
  usePrefersReducedMotion,
} from "@/components/motion/workflow-transition"
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
  selectIndustryRiskGraphView,
  type IndustryRiskGraphView,
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

const graphStyles = (transitionDuration: number): StylesheetJson => [
  {
    selector: "node",
    style: {
      width: "data(width)",
      height: "data(height)",
      shape: "ellipse",
      "background-color": "data(color)",
      "background-opacity": 0.96,
      "border-color": "#ffffff",
      "border-opacity": 0.9,
      "border-width": 2.5,
      label: "data(label)",
      color: "#f8fafc",
      "font-family": "Geist Variable, ui-sans-serif, system-ui, sans-serif",
      "font-size": "data(fontSize)",
      "font-weight": 700,
      "min-zoomed-font-size": 4,
      "text-halign": "center",
      "text-valign": "center",
      "text-wrap": "wrap",
      "text-max-width": "108px",
      "text-outline-color": "#0f172a",
      "text-outline-opacity": 0.72,
      "text-outline-width": 1.8,
      "overlay-opacity": 0,
      "transition-property": "opacity, border-width, border-color",
      "transition-duration": transitionDuration,
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
      "underlay-opacity": 0.14,
      "underlay-padding": 10,
      "z-index": 20,
    },
  },
  {
    selector: 'node[kind = "category"]',
    style: {
      shape: "round-rectangle",
      "background-color": "data(color)",
      "background-opacity": 0.96,
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
      "text-outline-width": 2,
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
      shape: "round-rectangle",
      "background-opacity": 0.94,
      "border-color": "#7dd3fc",
      "border-width": 1.5,
      label: "data(label)",
      "font-size": 10,
      "text-max-width": "88px",
      "text-valign": "center",
      "text-margin-y": 0,
    },
  },
  {
    selector: 'node[kind = "event"]',
    style: {
      shape: "round-rectangle",
      "background-opacity": 0.94,
      "border-color": "#fed7aa",
      "border-width": 1.5,
      label: "data(label)",
      "font-size": 10,
      "text-max-width": "94px",
      "text-valign": "center",
      "text-margin-y": 0,
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
      "transition-duration": transitionDuration,
      "transition-timing-function": "ease-out",
    },
  },
  {
    selector: 'edge[kind = "hierarchy"]',
    style: {
      opacity: 0.56,
      width: 2.2,
      "line-color": "#64748b",
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
    selector: 'node[kind = "source"].is-active, node[kind = "event"].is-active',
    style: {
      label: "data(label)",
    },
  },
  {
    selector: ".is-dimmed",
    style: {
      opacity: 0.1,
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
      color: "#1f2937",
      "font-size": 9,
      "font-weight": 700,
      "text-background-color": "#ffffff",
      "text-background-opacity": 0.94,
      "text-background-padding": "3px",
      "text-rotation": "autorotate",
      "text-margin-y": -7,
    },
  },
]

function layoutOptions(
  animate: boolean,
  companyNodeId: string,
  animationDuration: number
): cytoscapeFcose.FcoseLayoutOptions {
  return {
    name: "fcose",
    quality: "default",
    randomize: false,
    animate,
    animationDuration: animate ? animationDuration : 0,
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
      const kind = edge.data("kind") as
        "hierarchy" | "provenance" | "event-link"
      if (kind === "hierarchy") return 148
      if (kind === "provenance") return 92
      return 82
    },
    edgeElasticity: (edge) => (edge.data("kind") === "hierarchy" ? 0.28 : 0.52),
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
    fixedNodeConstraint: [{ nodeId: companyNodeId, position: { x: 0, y: 0 } }],
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
  const inspectorRef = useRef<HTMLElement>(null)
  const cytoscapeRef = useRef<Core | null>(null)
  const [engineError, setEngineError] = useState<string | null>(null)
  const [isImmersive, setIsImmersive] = useState(false)
  const [graphView, setGraphView] = useState<IndustryRiskGraphView>("focus")
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null)
  const prefersReducedMotion = usePrefersReducedMotion()
  const motionDuration = useCallback(
    (seconds: number) => (prefersReducedMotion ? 0 : seconds * 1000),
    [prefersReducedMotion]
  )
  const visibleGraph = useMemo(
    () => selectIndustryRiskGraphView(graph, graphView),
    [graph, graphView]
  )
  const elements = useMemo(
    () =>
      buildIndustryRiskCytoscapeElements(
        visibleGraph
      ) as unknown as ElementDefinition[],
    [visibleGraph]
  )
  const activeNode = visibleGraph.nodes.find((node) => node.id === activeNodeId)
  const hoveredNode = visibleGraph.nodes.find(
    (node) => node.id === hoveredNodeId
  )
  const companyNode = visibleGraph.nodes.find((node) => node.kind === "company")
  const companyNodeId = companyNode?.id ?? ""
  const topRiskIndicators = visibleGraph.nodes
    .filter((node) => node.kind === "indicator" && node.score !== null)
    .sort((left, right) => (right.score ?? 0) - (left.score ?? 0))
    .slice(0, 5)
  const narrativeIndicators = visibleGraph.nodes.filter(
    (node) =>
      node.kind === "indicator" &&
      ["R01", "R02", "R03", "R04"].includes(node.entityId)
  )
  const activeEdges = activeNode
    ? visibleGraph.edges.filter(
        (edge) => edge.source === activeNode.id || edge.target === activeNode.id
      )
    : []
  const countKind = (kind: IndustryRiskGraphNodeKind) =>
    visibleGraph.nodes.filter((node) => node.kind === kind).length

  useGSAP(
    () => {
      const inspector = inspectorRef.current
      if (!inspector) return

      if (prefersReducedMotion) {
        gsap.set(inspector, { clearProps: "opacity,transform" })
        return
      }

      gsap.fromTo(
        inspector,
        { autoAlpha: 0, x: 12 },
        {
          autoAlpha: 1,
          x: 0,
          duration: PRODUCTIVE_MOTION.state,
          ease: PRODUCTIVE_MOTION.easeEnter,
          clearProps: "opacity,transform,visibility",
          overwrite: "auto",
        }
      )
    },
    {
      scope: inspectorRef,
      dependencies: [activeNodeId, prefersReducedMotion],
      revertOnUpdate: true,
    }
  )

  useEffect(() => {
    if (
      activeNodeId &&
      !visibleGraph.nodes.some((node) => node.id === activeNodeId)
    ) {
      onActiveNodeChange(null)
    }
  }, [activeNodeId, onActiveNodeChange, visibleGraph.nodes])

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
        style: graphStyles(motionDuration(PRODUCTIVE_MOTION.fast)),
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
        cy?.animate({
          fit: { eles: focus, padding: 80 },
          duration: motionDuration(PRODUCTIVE_MOTION.state),
        })
      })
      cy.on("mouseover", "node", (event) => {
        const node = event.target as NodeSingular
        setHoveredNodeId(node.id())
      })
      cy.on("mouseout", "node", () => setHoveredNodeId(null))
      let resizeFrame = 0
      const resizeObserver = new ResizeObserver(() => {
        cancelAnimationFrame(resizeFrame)
        resizeFrame = requestAnimationFrame(() => {
          cy?.resize()
          if (cy && !cy.destroyed()) cy.fit(cy.elements(), 44)
        })
      })
      resizeObserver.observe(container)

      return () => {
        disposed = true
        cancelAnimationFrame(resizeFrame)
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
  }, [elements, isImmersive, motionDuration, onActiveNodeChange])

  useEffect(() => {
    const cy = cytoscapeRef.current
    if (!cy || cy.destroyed()) return
    cy.batch(() => {
      cy.elements().removeClass("is-active is-dimmed")
      if (!activeNodeId) return
      const node = cy.getElementById(activeNodeId)
      if (!node.length) return
      const categoryNodes = node.neighborhood('node[kind = "category"]')
      const companyNodes = categoryNodes.neighborhood('node[kind = "company"]')
      const evidenceNodes = node.neighborhood(
        'node[kind = "source"], node[kind = "event"]'
      )
      const pathNodes = node
        .union(categoryNodes)
        .union(companyNodes)
        .union(evidenceNodes)
      const related = pathNodes.union(pathNodes.edgesWith(pathNodes))
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
    cy.animate({
      fit: { eles: cy.elements(), padding: 44 },
      duration: motionDuration(PRODUCTIVE_MOTION.state),
    })
  }, [motionDuration])

  const zoomBy = useCallback(
    (factor: number) => {
      const cy = cytoscapeRef.current
      if (!cy) return
      cy.animate({
        zoom: cy.zoom() * factor,
        duration: motionDuration(PRODUCTIVE_MOTION.fast),
      })
    },
    [motionDuration]
  )

  const rerunLayout = () => {
    const cy = cytoscapeRef.current
    if (!cy || !companyNodeId) return
    onActiveNodeChange(null)
    const layout = cy.layout(
      layoutOptions(
        !prefersReducedMotion,
        companyNodeId,
        motionDuration(PRODUCTIVE_MOTION.graph)
      )
    )
    layout.one("layoutstop", () => {
      cy.animate({
        fit: { eles: cy.elements(), padding: 44 },
        duration: motionDuration(PRODUCTIVE_MOTION.state),
      })
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
          aria-label={`${companyName}企业风险关系图：${visibleGraph.nodes.length} 个节点、${visibleGraph.edges.length} 条关系`}
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
        <aside
          ref={inspectorRef}
          className="industry-graph-inspector"
          aria-live="polite"
        >
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
      ) : (
        <aside className="industry-graph-inspector industry-graph-inspector-empty">
          <Badge variant="outline">研判上下文</Badge>
          <h3>{companyName}风险证据链</h3>
          <p>
            默认展示前五项客观风险及其直接来源和事件。选择左侧风险或画布节点，可突出一条完整关系链。
          </p>
          <strong>{companyNode?.score?.toFixed(1) ?? "—"} 基准分</strong>
          <dl>
            <div>
              <dt>当前视图</dt>
              <dd>{visibleGraph.nodes.length} 节点</dd>
            </div>
            <div>
              <dt>可追溯关系</dt>
              <dd>{visibleGraph.edges.length} 条</dd>
            </div>
            <div>
              <dt>证据来源</dt>
              <dd>{countKind("source")} 个</dd>
            </div>
            <div>
              <dt>风险事件</dt>
              <dd>{countKind("event")} 条</dd>
            </div>
          </dl>
          <div className="industry-graph-reading-path">
            <span>推荐阅读路径</span>
            <b>来源 / 事件</b>
            <i aria-hidden="true">→</i>
            <b>风险指标</b>
            <i aria-hidden="true">→</i>
            <b>风险领域</b>
            <i aria-hidden="true">→</i>
            <b>企业</b>
          </div>
        </aside>
      )}
    </div>
  )

  return (
    <Reveal>
      <div className="industry-graph-glass">
        <section
          className="industry-graph"
          aria-labelledby="industry-graph-title"
        >
          <header className="industry-graph-header">
            <div>
              <span className="eyebrow">单企业风险关系 · 来源可追溯</span>
              <h2 id="industry-graph-title">{companyName}企业风险知识图谱</h2>
              <p>
                {graphView === "focus"
                  ? "默认聚焦当前企业前五项风险及其直接来源和事件；沿“证据 → 指标 → 风险领域 → 企业”阅读。"
                  : graphView === "narrative"
                    ? "叙事观察区单独呈现 R01–R04、财经新闻来源和代理观测；紫色只表示叙事类别，不代表风险高低。"
                    : graphView === "objective"
                      ? "客观风险区呈现 R05–R22、风险事件和来源；节点面积与热力颜色共同表达同业风险强度。"
                      : "完整图谱保留主观叙事与客观风险两类关系；可切换分区降低交叉线干扰，单击节点追溯来源和事件。"}
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
                优化布局
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

          <div className="industry-graph-stage" data-view={graphView}>
            <aside className="industry-graph-stage-rail">
              <div className="industry-graph-stage-rail-heading">
                <span>Graph lens</span>
                <strong>关系视角</strong>
              </div>
              <div
                className="industry-graph-view-switch"
                aria-label="知识图谱分区"
              >
                {(
                  [
                    ["focus", "重点路径", "Top 5 · 直接证据链"],
                    ["all", "完整图谱", "主客观关系全览"],
                    ["objective", "客观风险", "R05–R22 · 计分"],
                    ["narrative", "叙事观察", "R01–R04 · 不计分"],
                  ] as const
                ).map(([value, label, description]) => (
                  <button
                    key={value}
                    type="button"
                    data-active={graphView === value}
                    aria-pressed={graphView === value}
                    onClick={() => setGraphView(value)}
                  >
                    <strong>{label}</strong>
                    <span>{description}</span>
                  </button>
                ))}
              </div>

              <div className="industry-graph-summary">
                <Badge variant="outline">
                  {countKind("category")} 个风险维度
                </Badge>
                <Badge variant="outline">
                  {countKind("indicator")} 项统一指标
                </Badge>
                <Badge variant="outline">
                  {countKind("source")} 个数据来源
                </Badge>
                <Badge variant="outline">{countKind("event")} 个风险事件</Badge>
                <Badge variant="outline">
                  {visibleGraph.edges.length} 条可追溯关系
                </Badge>
              </div>

              <div
                className="industry-graph-hotspots"
                aria-label={
                  graphView === "narrative" ? "叙事观察指标" : "当前风险热点"
                }
              >
                <div className="industry-graph-hotspots-heading">
                  {graphView === "narrative" ? (
                    <NewspaperIcon aria-hidden="true" />
                  ) : (
                    <FlameIcon aria-hidden="true" />
                  )}
                  <span>
                    {graphView === "narrative" ? "叙事观察" : "风险热点"}
                  </span>
                  <strong>
                    {graphView === "narrative"
                      ? narrativeIndicators.length
                      : (companyNode?.score?.toFixed(1) ?? "—")}
                  </strong>
                  <small>
                    {graphView === "narrative"
                      ? "项非评分指标"
                      : "企业 CRITIC 基准"}
                  </small>
                </div>
                <ol>
                  {(graphView === "narrative"
                    ? narrativeIndicators
                    : topRiskIndicators
                  ).map((node) => (
                    <li key={node.id}>
                      <button
                        type="button"
                        data-active={activeNodeId === node.id}
                        onClick={() => onActiveNodeChange(node.id)}
                      >
                        <span>{node.entityId}</span>
                        <b>{node.label}</b>
                        <strong>
                          {graphView === "narrative"
                            ? "观察"
                            : node.score?.toFixed(0)}
                        </strong>
                      </button>
                    </li>
                  ))}
                </ol>
              </div>
            </aside>

            {isImmersive
              ? createPortal(graphContent, document.body)
              : graphContent}
          </div>

          <footer className="industry-graph-legend">
            {Object.entries(nodeKindLabels).map(([kind, label]) => (
              <span key={kind} data-kind={kind}>
                {label}
              </span>
            ))}
            {graphView === "narrative" ? (
              <div className="industry-graph-narrative-legend">
                <i aria-hidden="true" />
                <b>紫色 = 叙事观察项</b>
                <small>不表示风险高低，不进入综合风险指数</small>
              </div>
            ) : (
              <div
                className="industry-graph-heat-legend"
                aria-label="蓝色表示当前企业内部较低优先级，黄色表示中等优先级，红色表示较高优先级；节点面积随当前企业内部风险排序增大"
              >
                <span>较低</span>
                <i aria-hidden="true" />
                <span>较高</span>
                <b>颜色 + 面积 = 当前企业内部风险优先级</b>
                <small>灰色虚线 = 暂无可比数值</small>
              </div>
            )}
            <p>
              <AlertTriangleIcon aria-hidden="true" />
              连线表示指标归属、来源或事件证据，不宣称因果关系。
            </p>
          </footer>
        </section>
      </div>
    </Reveal>
  )
}
