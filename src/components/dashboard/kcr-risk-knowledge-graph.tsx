import { useId, useMemo, useState, useSyncExternalStore } from "react"
import {
  AlertTriangleIcon,
  ArrowRightIcon,
  ExternalLinkIcon,
  FileCheck2Icon,
  GitBranchIcon,
  NetworkIcon,
  SearchIcon,
  TargetIcon,
} from "lucide-react"

import { LiquidGlassSurface } from "@/components/liquid"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { KcrAssessmentApiResponse } from "@/domain/kcr-v1/assessment-api.ts"
import type { KcrRiskDimensionId } from "@/domain/kcr-v1/model.ts"
import {
  buildKcrRiskKnowledgeGraph,
  buildKcrRiskGraphNetworkLayout,
  selectKcrRiskGraphDimension,
  selectKcrRiskGraphLineage,
  selectKcrRiskGraphOverview,
  type KcrRiskGraphEdge,
  type KcrRiskGraphLayoutNode,
  type KcrRiskGraphNode,
  type KcrRiskGraphNodeKind,
  type KcrRiskGraphViewMode,
} from "@/lib/kcr-risk-knowledge-graph"

type KcrRiskKnowledgeGraphProps = {
  response: KcrAssessmentApiResponse
  companyLabel: string
  onOpenDimension: (dimensionId: KcrRiskDimensionId) => void
}

const COMPACT_GRAPH_QUERY = "(max-width: 760px)"
const compactGraphListeners = new Set<() => void>()

let compactGraphMediaQuery: MediaQueryList | null = null
let removeCompactGraphListener: (() => void) | null = null

function getCompactGraphMediaQuery() {
  if (typeof window === "undefined" || !window.matchMedia) return null
  compactGraphMediaQuery ??= window.matchMedia(COMPACT_GRAPH_QUERY)
  return compactGraphMediaQuery
}

function getCompactGraphSnapshot() {
  return getCompactGraphMediaQuery()?.matches ?? false
}

function subscribeToCompactGraph(listener: () => void) {
  const mediaQuery = getCompactGraphMediaQuery()
  if (!mediaQuery) return () => undefined

  compactGraphListeners.add(listener)
  if (!removeCompactGraphListener) {
    const notify = () => compactGraphListeners.forEach((current) => current())
    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", notify)
      removeCompactGraphListener = () =>
        mediaQuery.removeEventListener("change", notify)
    } else {
      mediaQuery.addListener(notify)
      removeCompactGraphListener = () => mediaQuery.removeListener(notify)
    }
  }

  return () => {
    compactGraphListeners.delete(listener)
    if (compactGraphListeners.size === 0) {
      removeCompactGraphListener?.()
      removeCompactGraphListener = null
    }
  }
}

function useCompactGraph() {
  return useSyncExternalStore(
    subscribeToCompactGraph,
    getCompactGraphSnapshot,
    () => false
  )
}

const percentFormatter = new Intl.NumberFormat("zh-CN", {
  style: "percent",
  maximumFractionDigits: 2,
})

const nodeKindLabels: Record<KcrRiskGraphNodeKind, string> = {
  company: "评估企业",
  dimension: "风险维度",
  indicator: "评分指标",
  event: "红旗事件",
  evidence: "来源证据",
}

const sourceTierLabels: Record<
  KcrAssessmentApiResponse["evidenceCatalog"][number]["sourceTier"],
  string
> = {
  regulator: "监管来源",
  exchange: "交易所",
  "company-filing": "公司公告",
  "official-company": "公司官网",
  "commercial-api": "商业数据",
  research: "研究资料",
  media: "媒体资料",
  manual: "人工材料",
}

const dataStatusLabels = {
  complete: "数据完整",
  partial: "部分覆盖",
  missing: "数据缺失",
} as const

const graphViewLabels: Record<
  KcrRiskGraphViewMode,
  { label: string; hint: string }
> = {
  overview: {
    label: "结构总览",
    hint: "先看企业、五维与红旗；指标和证据按需展开",
  },
  focus: {
    label: "维度聚焦",
    hint: "一次展开一个风险维度，点击指标查看关联证据",
  },
  lineage: {
    label: "事件溯源",
    hint: "一次追踪一条红旗的指标、证据与传播路径",
  },
}

type GraphPoint = { x: number; y: number }

function nodeWidth(node: KcrRiskGraphLayoutNode) {
  return node.width ?? node.radius * 2
}

function nodeHeight(node: KcrRiskGraphLayoutNode) {
  return node.height ?? node.radius * 2
}

function roundedOrthogonalPath(points: readonly GraphPoint[], radius = 8) {
  if (points.length < 2) return ""
  let path = `M ${points[0].x} ${points[0].y}`

  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1]
    const current = points[index]
    const next = points[index + 1]
    const incomingLength = Math.hypot(
      current.x - previous.x,
      current.y - previous.y
    )
    const outgoingLength = Math.hypot(next.x - current.x, next.y - current.y)
    const bend = Math.min(radius, incomingLength / 2, outgoingLength / 2)
    const incomingX = (current.x - previous.x) / (incomingLength || 1)
    const incomingY = (current.y - previous.y) / (incomingLength || 1)
    const outgoingX = (next.x - current.x) / (outgoingLength || 1)
    const outgoingY = (next.y - current.y) / (outgoingLength || 1)
    const before = {
      x: current.x - incomingX * bend,
      y: current.y - incomingY * bend,
    }
    const after = {
      x: current.x + outgoingX * bend,
      y: current.y + outgoingY * bend,
    }
    path += ` L ${before.x} ${before.y} Q ${current.x} ${current.y} ${after.x} ${after.y}`
  }

  const last = points.at(-1)!
  return `${path} L ${last.x} ${last.y}`
}

function orthogonalConnectorPoints(
  source: KcrRiskGraphLayoutNode,
  target: KcrRiskGraphLayoutNode,
  edge: KcrRiskGraphEdge,
  canvasWidth: number
) {
  const sourceWidth = nodeWidth(source)
  const sourceHeight = nodeHeight(source)
  const targetWidth = nodeWidth(target)
  const targetHeight = nodeHeight(target)

  if (edge.kind === "propagation") {
    const rightLane = source.x >= canvasWidth / 2
    const laneX = rightLane ? canvasWidth - 24 : 24
    const sourcePoint = {
      x: source.x + (rightLane ? sourceWidth / 2 : -sourceWidth / 2),
      y: source.y,
    }
    const targetPoint = {
      x: target.x + (rightLane ? targetWidth * 0.26 : -targetWidth * 0.26),
      y: target.y - targetHeight / 2,
    }
    const topLaneY = 16
    return [
      sourcePoint,
      { x: laneX, y: sourcePoint.y },
      { x: laneX, y: topLaneY },
      { x: targetPoint.x, y: topLaneY },
      targetPoint,
    ]
  }

  if (Math.abs(target.y - source.y) < 24) {
    const rightward = target.x >= source.x
    const sourcePoint = {
      x: source.x + (rightward ? sourceWidth / 2 : -sourceWidth / 2),
      y: source.y,
    }
    const targetPoint = {
      x: target.x + (rightward ? -targetWidth / 2 : targetWidth / 2),
      y: target.y,
    }
    const midpointX = (sourcePoint.x + targetPoint.x) / 2
    return [
      sourcePoint,
      { x: midpointX, y: sourcePoint.y },
      { x: midpointX, y: targetPoint.y },
      targetPoint,
    ]
  }

  const downward = target.y >= source.y
  const sourcePoint = {
    x: source.x,
    y: source.y + (downward ? sourceHeight / 2 : -sourceHeight / 2),
  }
  const targetPoint = {
    x: target.x,
    y: target.y + (downward ? -targetHeight / 2 : targetHeight / 2),
  }
  const midpointY = (sourcePoint.y + targetPoint.y) / 2
  return [
    sourcePoint,
    { x: sourcePoint.x, y: midpointY },
    { x: targetPoint.x, y: midpointY },
    targetPoint,
  ]
}

function dimensionShortLabel(label: string) {
  return label.replace(/风险$/, "")
}

function KcrGraphNodeInspector({
  node,
  response,
  onOpenDimension,
}: {
  node: KcrRiskGraphNode
  response: KcrAssessmentApiResponse
  onOpenDimension: (dimensionId: KcrRiskDimensionId) => void
}) {
  const { assessment, evidenceCatalog } = response
  const dimension = assessment.dimensions.find(
    (item) => item.dimensionId === node.entityId
  )
  const indicator = assessment.indicatorResults.find(
    (item) => item.id === node.entityId
  )
  const redFlag = assessment.redFlags.find(
    (item) => item.eventId === node.entityId
  )
  const evidence = evidenceCatalog.find((item) => item.id === node.entityId)
  const propagationPath = redFlag
    ? assessment.propagationPaths.find(
        (path) => path.eventId === redFlag.eventId && path.included
      )
    : undefined
  let description =
    "当前图谱完全由本次 KCR V3 评分响应构建；关系网络本身不新增评分结论。"
  let metrics: Array<{ label: string; value: string }> = [
    { label: "客观基线", value: `${assessment.baselineScore ?? "—"} 分` },
    {
      label: "证据覆盖",
      value: percentFormatter.format(assessment.evidenceCoverage),
    },
    { label: "评分指标", value: `${assessment.indicatorResults.length} 项` },
    { label: "红旗事件", value: `${assessment.redFlags.length} 项` },
  ]
  let actionDimensionId: KcrRiskDimensionId | null = null
  let actionLabel = ""

  if (dimension) {
    description = dimension.formulaTrace
    metrics = [
      { label: "维度分", value: `${dimension.score ?? "—"} 分` },
      { label: "风险等级", value: `${dimension.riskLevelLabel}风险` },
      { label: "指标数量", value: `${dimension.indicatorIds.length} 项` },
      {
        label: "证据覆盖",
        value: percentFormatter.format(dimension.evidenceCoverage),
      },
    ]
    actionDimensionId = dimension.dimensionId
    actionLabel = "查看完整指标与证据链"
  }

  if (indicator) {
    description = indicator.rationale
    metrics = [
      { label: "指标风险分", value: `${indicator.riskScore ?? "—"}` },
      { label: "固定权重", value: `${indicator.weight}` },
      { label: "数据状态", value: dataStatusLabels[indicator.dataStatus] },
      {
        label: "证据置信度",
        value: percentFormatter.format(indicator.evidenceConfidence),
      },
    ]
    actionDimensionId = indicator.dimensionId
    actionLabel = "查看评分公式与原始来源"
  }

  if (redFlag) {
    description = redFlag.summary
    metrics = [
      { label: "处置优先级", value: redFlag.priority },
      { label: "关联指标", value: redFlag.sourceIndicatorIds.join("、") },
      { label: "来源证据", value: `${redFlag.evidenceIds.length} 条` },
      {
        label: "传播风险",
        value: `${propagationPath?.propagatedRisk ?? "未纳入"}`,
      },
    ]
  }

  if (evidence) {
    description = evidence.locator
    metrics = [
      { label: "来源类型", value: sourceTierLabels[evidence.sourceTier] },
      { label: "来源机构", value: evidence.sourceName },
      { label: "发布日期", value: evidence.publishedAt ?? "未记录" },
      { label: "引用维度", value: `${node.dimensionIds.length} 个` },
    ]
  }

  return (
    <aside
      className="kcr-risk-graph-inspector"
      data-kind={node.kind}
      aria-live="polite"
    >
      <div className="kcr-risk-graph-inspector-copy">
        <div className="kcr-risk-graph-inspector-heading">
          <span>{nodeKindLabels[node.kind]}</span>
          <Badge variant="outline">{node.entityId}</Badge>
        </div>
        <h4>{node.label}</h4>
        <p>{description}</p>
        {redFlag ? (
          <p className="kcr-risk-graph-audit-note">
            <AlertTriangleIcon aria-hidden="true" />
            红旗与传播路径独立展示，不改写 {assessment.baselineScore ??
              "—"}{" "}
            分客观基线。
          </p>
        ) : null}
      </div>

      <dl>
        {metrics.map((metric) => (
          <div key={metric.label}>
            <dt>{metric.label}</dt>
            <dd>{metric.value}</dd>
          </div>
        ))}
      </dl>

      {actionDimensionId ? (
        <Button
          variant="outline"
          onClick={() => onOpenDimension(actionDimensionId)}
        >
          {actionLabel}
          <ArrowRightIcon data-icon="inline-end" />
        </Button>
      ) : evidence?.sourceUrl ? (
        <Button asChild variant="outline">
          <a
            href={evidence.sourceUrl}
            target="_blank"
            rel="noreferrer noopener"
          >
            打开原始来源
            <ExternalLinkIcon data-icon="inline-end" />
          </a>
        </Button>
      ) : null}
    </aside>
  )
}

export function KcrRiskKnowledgeGraph({
  response,
  companyLabel,
  onOpenDimension,
}: KcrRiskKnowledgeGraphProps) {
  const { assessment } = response
  const compact = useCompactGraph()
  const highestRiskDimension = useMemo(
    () =>
      assessment.dimensions.reduce((highest, dimension) =>
        (dimension.score ?? -1) > (highest.score ?? -1) ? dimension : highest
      ).dimensionId,
    [assessment.dimensions]
  )
  const graph = useMemo(
    () => buildKcrRiskKnowledgeGraph(response, companyLabel),
    [companyLabel, response]
  )
  const [selectedDimensionId, setSelectedDimensionId] =
    useState<KcrRiskDimensionId>(highestRiskDimension)
  const [viewMode, setViewMode] = useState<KcrRiskGraphViewMode>("overview")
  const [selectedNodeId, setSelectedNodeId] = useState(
    `company:${assessment.companyId}`
  )
  const [selectedEventId, setSelectedEventId] = useState(
    assessment.redFlags[0]?.eventId ?? ""
  )
  const [searchQuery, setSearchQuery] = useState("")
  const visibleGraph = useMemo(
    () =>
      viewMode === "overview"
        ? selectKcrRiskGraphOverview(graph)
        : viewMode === "lineage"
          ? selectKcrRiskGraphLineage(graph, selectedEventId)
          : selectKcrRiskGraphDimension(
              graph,
              selectedDimensionId,
              selectedNodeId
            ),
    [graph, selectedDimensionId, selectedEventId, selectedNodeId, viewMode]
  )
  const layout = useMemo(
    () =>
      buildKcrRiskGraphNetworkLayout(
        visibleGraph.nodes,
        selectedDimensionId,
        compact ? "compact" : "desktop",
        viewMode
      ),
    [compact, selectedDimensionId, viewMode, visibleGraph.nodes]
  )
  const positions = useMemo(
    () => new Map(layout.nodes.map((node) => [node.id, node])),
    [layout.nodes]
  )
  const selectedNode =
    graph.nodes.find((node) => node.id === selectedNodeId) ?? graph.nodes[0]
  const selectedDimension = assessment.dimensions.find(
    (dimension) => dimension.dimensionId === selectedDimensionId
  )
  const normalizedSearchQuery = searchQuery.trim().toLocaleLowerCase("zh-CN")
  const searchResults = normalizedSearchQuery
    ? graph.nodes
        .filter(
          (node) =>
            node.label
              .toLocaleLowerCase("zh-CN")
              .includes(normalizedSearchQuery) ||
            node.entityId
              .toLocaleLowerCase("zh-CN")
              .includes(normalizedSearchQuery)
        )
        .slice(0, 6)
    : []
  const titleId = useId()
  const descriptionId = useId()
  const markerId = `${useId().replaceAll(":", "")}-graph-arrow`

  function selectNode(node: KcrRiskGraphNode) {
    setSelectedNodeId(node.id)
    if (node.kind === "dimension") {
      setSelectedDimensionId(node.entityId as KcrRiskDimensionId)
      setViewMode("focus")
    } else if (node.kind === "event") {
      setSelectedEventId(node.entityId)
      if (viewMode === "overview") setViewMode("lineage")
    } else if (node.kind === "company") {
      setViewMode("overview")
    }
  }

  function changeViewMode(nextViewMode: KcrRiskGraphViewMode) {
    setViewMode(nextViewMode)
    setSearchQuery("")
    if (nextViewMode === "overview") {
      setSelectedNodeId(`company:${assessment.companyId}`)
    } else if (nextViewMode === "focus") {
      setSelectedNodeId(`dimension:${selectedDimensionId}`)
    } else {
      const firstEvent = graph.nodes.find((node) => node.kind === "event")
      if (firstEvent) setSelectedEventId(firstEvent.entityId)
      setSelectedNodeId(firstEvent?.id ?? `company:${assessment.companyId}`)
    }
  }

  function selectSearchResult(node: KcrRiskGraphNode) {
    const dimensionId =
      node.kind === "dimension"
        ? (node.entityId as KcrRiskDimensionId)
        : node.dimensionIds[0]
    if (dimensionId) setSelectedDimensionId(dimensionId)
    if (node.kind === "company") {
      setViewMode("overview")
    } else if (node.kind === "event") {
      setSelectedEventId(node.entityId)
      setViewMode("lineage")
    } else if (dimensionId) {
      setViewMode("focus")
    }
    setSelectedNodeId(node.id)
    setSearchQuery("")
  }

  function renderEdge(edge: KcrRiskGraphEdge) {
    const source = positions.get(edge.source)
    const target = positions.get(edge.target)
    if (!source || !target) return null
    const active =
      edge.source === selectedNodeId || edge.target === selectedNodeId
    const points = orthogonalConnectorPoints(source, target, edge, layout.width)

    return (
      <path
        key={edge.id}
        d={roundedOrthogonalPath(points)}
        className="kcr-risk-graph-edge"
        data-kind={edge.kind}
        data-active={active || undefined}
        markerEnd={`url(#${markerId})`}
      >
        <title>
          {edge.label}
          {edge.detail ? `：${edge.detail}` : ""}
        </title>
      </path>
    )
  }

  function renderNodeShape(layoutNode: KcrRiskGraphLayoutNode) {
    const width = nodeWidth(layoutNode)
    const height = nodeHeight(layoutNode)
    return (
      <rect
        x={layoutNode.x - width / 2}
        y={layoutNode.y - height / 2}
        width={width}
        height={height}
        rx="7"
      />
    )
  }

  return (
    <LiquidGlassSurface
      variant="card"
      refractive={false}
      className="kcr-risk-graph-glass"
      padding="0"
    >
      <section
        id="kcr-risk-knowledge-graph"
        className="kcr-risk-graph"
        aria-labelledby={titleId}
      >
        <header className="kcr-risk-graph-header">
          <div>
            <span>
              <NetworkIcon aria-hidden="true" />
              单一评估时点 · 数据截止 {assessment.dataCutoff}
            </span>
            <h3 id={titleId}>企业风险知识图谱</h3>
            <p id={descriptionId}>
              先读企业—五维—红旗的结构总览，再按维度展开
              {assessment.indicatorResults.length}
              项指标，或按事件追踪证据与传播路径。
            </p>
          </div>
          <div className="kcr-risk-graph-counts" aria-label="完整图谱统计">
            <span>
              <strong>{graph.counts.nodes}</strong> 节点
            </span>
            <span>
              <strong>{graph.counts.edges}</strong> 关系
            </span>
          </div>
        </header>

        <div className="kcr-risk-graph-toolbar">
          <div className="kcr-risk-graph-view-switcher" aria-label="图谱视图">
            {(Object.keys(graphViewLabels) as KcrRiskGraphViewMode[]).map(
              (mode) => (
                <Button
                  key={mode}
                  type="button"
                  variant={viewMode === mode ? "default" : "outline"}
                  aria-pressed={viewMode === mode}
                  title={graphViewLabels[mode].hint}
                  onClick={() => changeViewMode(mode)}
                >
                  {mode === "overview" ? (
                    <NetworkIcon aria-hidden="true" />
                  ) : mode === "focus" ? (
                    <TargetIcon aria-hidden="true" />
                  ) : (
                    <GitBranchIcon aria-hidden="true" />
                  )}
                  {graphViewLabels[mode].label}
                </Button>
              )
            )}
          </div>

          <div className="kcr-risk-graph-search">
            <SearchIcon aria-hidden="true" />
            <Input
              value={searchQuery}
              aria-label="搜索图谱节点"
              placeholder="搜索节点名称或编号"
              onChange={(event) => setSearchQuery(event.target.value)}
            />
            {searchResults.length ? (
              <div className="kcr-risk-graph-search-results" role="listbox">
                {searchResults.map((node) => (
                  <button
                    key={node.id}
                    type="button"
                    role="option"
                    aria-selected={node.id === selectedNodeId}
                    onClick={() => selectSearchResult(node)}
                  >
                    <span>{node.label}</span>
                    <small>
                      {nodeKindLabels[node.kind]} · {node.entityId}
                    </small>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        {viewMode !== "overview" ? (
          <div
            className="kcr-risk-graph-context-switcher"
            aria-label={viewMode === "focus" ? "选择风险维度" : "选择红旗事件"}
          >
            <span>{viewMode === "focus" ? "当前维度" : "当前红旗"}</span>
            <div>
              {viewMode === "focus"
                ? assessment.dimensions.map((dimension) => (
                    <button
                      key={dimension.dimensionId}
                      type="button"
                      aria-pressed={
                        dimension.dimensionId === selectedDimensionId
                      }
                      onClick={() => {
                        setSelectedDimensionId(dimension.dimensionId)
                        setSelectedNodeId(`dimension:${dimension.dimensionId}`)
                      }}
                    >
                      {dimensionShortLabel(dimension.label)}
                      <small>{dimension.score ?? "—"}</small>
                    </button>
                  ))
                : assessment.redFlags.map((redFlag) => (
                    <button
                      key={redFlag.eventId}
                      type="button"
                      aria-pressed={redFlag.eventId === selectedEventId}
                      onClick={() => {
                        setSelectedEventId(redFlag.eventId)
                        setSelectedNodeId(`event:${redFlag.eventId}`)
                      }}
                    >
                      {redFlag.eventId}
                      <small>{redFlag.priority}</small>
                    </button>
                  ))}
            </div>
          </div>
        ) : null}

        <div className="kcr-risk-graph-stage">
          <div className="kcr-risk-graph-stage-label">
            <span>{graphViewLabels[viewMode].label}</span>
            <strong>
              {viewMode === "focus"
                ? selectedDimension?.label
                : viewMode === "lineage"
                  ? `${selectedEventId} 单事件链路`
                  : `${visibleGraph.nodes.length} 节点 · ${visibleGraph.edges.length} 关系`}
            </strong>
            <small>{graphViewLabels[viewMode].hint}</small>
          </div>

          <svg
            className="kcr-risk-graph-canvas"
            viewBox={`0 0 ${layout.width} ${layout.height}`}
            role="img"
            aria-labelledby={`${titleId} ${descriptionId}`}
            preserveAspectRatio="xMidYMid meet"
          >
            <defs>
              <marker
                id={markerId}
                markerWidth="7"
                markerHeight="7"
                refX="6"
                refY="3.5"
                orient="auto"
                markerUnits="strokeWidth"
              >
                <path d="M 0 0 L 7 3.5 L 0 7 z" fill="context-stroke" />
              </marker>
            </defs>

            <g aria-hidden="true">{visibleGraph.edges.map(renderEdge)}</g>

            <g>
              {visibleGraph.nodes.map((node) => {
                const layoutNode = positions.get(node.id)
                if (!layoutNode) return null
                const active = node.id === selectedNodeId
                const selectedDimensionNode =
                  viewMode === "focus" &&
                  node.kind === "dimension" &&
                  node.entityId === selectedDimensionId

                return (
                  <g
                    key={node.id}
                    className="kcr-risk-graph-node"
                    data-kind={node.kind}
                    data-tone={node.tone}
                    data-active={active || undefined}
                    data-selected-dimension={selectedDimensionNode || undefined}
                    role="button"
                    tabIndex={0}
                    aria-label={`查看${nodeKindLabels[node.kind]}：${node.label}`}
                    aria-pressed={active}
                    onClick={() => selectNode(node)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault()
                        selectNode(node)
                      }
                    }}
                  >
                    <rect
                      className="kcr-risk-graph-hit-target"
                      x={layoutNode.x - nodeWidth(layoutNode) / 2 - 4}
                      y={layoutNode.y - nodeHeight(layoutNode) / 2 - 4}
                      width={nodeWidth(layoutNode) + 8}
                      height={nodeHeight(layoutNode) + 8}
                      aria-hidden="true"
                    />
                    {renderNodeShape(layoutNode)}
                    <text x={layoutNode.x} y={layoutNode.y} textAnchor="middle">
                      {node.kind === "company" ? (
                        <>
                          <tspan
                            className="kcr-risk-graph-node-caption"
                            x={layoutNode.x}
                            dy="-0.8em"
                          >
                            评估企业
                          </tspan>
                          <tspan x={layoutNode.x} dy="1.35em">
                            {node.label}
                          </tspan>
                          <tspan
                            className="kcr-risk-graph-node-score"
                            x={layoutNode.x}
                            dy="1.35em"
                          >
                            {node.score ?? "—"} · {assessment.riskLevelLabel}
                            风险
                          </tspan>
                        </>
                      ) : node.kind === "dimension" ? (
                        <>
                          <tspan
                            className="kcr-risk-graph-node-caption"
                            x={layoutNode.x}
                            dy="-0.7em"
                          >
                            风险维度
                          </tspan>
                          <tspan x={layoutNode.x} dy="1.35em">
                            {dimensionShortLabel(node.label)}
                          </tspan>
                          <tspan
                            className="kcr-risk-graph-node-score"
                            x={layoutNode.x}
                            dy="1.35em"
                          >
                            {node.score ?? "—"}
                          </tspan>
                        </>
                      ) : node.kind === "indicator" ? (
                        <>
                          <tspan
                            className="kcr-risk-graph-node-caption"
                            x={layoutNode.x}
                            dy="-0.55em"
                          >
                            评分指标
                          </tspan>
                          <tspan x={layoutNode.x} dy="1.4em">
                            {node.entityId}
                          </tspan>
                          <tspan
                            className="kcr-risk-graph-node-score"
                            x={layoutNode.x}
                            dy="1.35em"
                          >
                            {node.score ?? "—"} 分
                          </tspan>
                        </>
                      ) : node.kind === "event" ? (
                        <>
                          <tspan
                            className="kcr-risk-graph-node-caption"
                            x={layoutNode.x}
                            dy="-0.55em"
                          >
                            红旗事件
                          </tspan>
                          <tspan x={layoutNode.x} dy="1.4em">
                            {node.entityId}
                          </tspan>
                          <tspan
                            className="kcr-risk-graph-node-score"
                            x={layoutNode.x}
                            dy="1.35em"
                          >
                            {node.caption.split(" · ")[0]}
                          </tspan>
                        </>
                      ) : (
                        <>
                          <tspan
                            className="kcr-risk-graph-node-caption"
                            x={layoutNode.x}
                            dy="-0.55em"
                          >
                            来源证据
                          </tspan>
                          <tspan x={layoutNode.x} dy="1.4em">
                            {node.entityId}
                          </tspan>
                          <tspan
                            className="kcr-risk-graph-node-score"
                            x={layoutNode.x}
                            dy="1.35em"
                          >
                            {node.caption.split(" · ")[0]}
                          </tspan>
                        </>
                      )}
                    </text>
                  </g>
                )
              })}
            </g>
          </svg>
        </div>

        <KcrGraphNodeInspector
          node={selectedNode}
          response={response}
          onOpenDimension={onOpenDimension}
        />

        <footer className="kcr-risk-graph-footer">
          <div className="kcr-risk-graph-legend" aria-label="关系图例">
            <span data-kind="direct">直接证据</span>
            <span data-kind="inferred">推断证据</span>
            <span data-kind="background">背景核验</span>
            <span data-kind="event-link">事件关联</span>
            <span data-kind="propagation">风险传播</span>
          </div>
          <p>
            <FileCheck2Icon aria-hidden="true" />
            本图只重组本次 KCR V3
            响应；关系类型沿用工作簿记录，不把推断或传播路径改写为事实。
          </p>
        </footer>
      </section>
    </LiquidGlassSurface>
  )
}
