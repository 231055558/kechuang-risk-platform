import { useId, useMemo, useState, useSyncExternalStore } from "react"
import {
  AlertTriangleIcon,
  ArrowRightIcon,
  ExternalLinkIcon,
  FileCheck2Icon,
  NetworkIcon,
} from "lucide-react"

import { LiquidGlassSurface } from "@/components/liquid"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { KcrAssessmentApiResponse } from "@/domain/kcr-v1/assessment-api.ts"
import type { KcrRiskDimensionId } from "@/domain/kcr-v1/model.ts"
import {
  buildKcrRiskKnowledgeGraph,
  buildKcrRiskGraphRadialLayout,
  selectKcrRiskGraphDimension,
  type KcrRiskGraphEdge,
  type KcrRiskGraphLayoutNode,
  type KcrRiskGraphNode,
  type KcrRiskGraphNodeKind,
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

function getEdgeEndpoints(
  source: KcrRiskGraphLayoutNode,
  target: KcrRiskGraphLayoutNode
) {
  const dx = target.x - source.x
  const dy = target.y - source.y
  const distance = Math.hypot(dx, dy) || 1
  const unitX = dx / distance
  const unitY = dy / distance

  return {
    x1: source.x + unitX * source.radius,
    y1: source.y + unitY * source.radius,
    x2: target.x - unitX * target.radius,
    y2: target.y - unitY * target.radius,
  }
}

function hexagonPoints(node: KcrRiskGraphLayoutNode) {
  return Array.from({ length: 6 }, (_, index) => {
    const angle = -Math.PI / 2 + (index * Math.PI) / 3
    return `${node.x + Math.cos(angle) * node.radius},${
      node.y + Math.sin(angle) * node.radius
    }`
  }).join(" ")
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
            红旗与传播路径独立展示，不改写 35.6 分客观基线。
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
  const [selectedNodeId, setSelectedNodeId] = useState(
    `dimension:${highestRiskDimension}`
  )
  const visibleGraph = useMemo(
    () => selectKcrRiskGraphDimension(graph, selectedDimensionId),
    [graph, selectedDimensionId]
  )
  const layout = useMemo(
    () =>
      buildKcrRiskGraphRadialLayout(
        visibleGraph.nodes,
        selectedDimensionId,
        compact ? "compact" : "desktop"
      ),
    [compact, selectedDimensionId, visibleGraph.nodes]
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
  const titleId = useId()
  const descriptionId = useId()
  const markerId = `${useId().replaceAll(":", "")}-graph-arrow`
  const glowId = `${useId().replaceAll(":", "")}-graph-glow`

  function selectNode(node: KcrRiskGraphNode) {
    setSelectedNodeId(node.id)
    if (node.kind === "dimension") {
      setSelectedDimensionId(node.entityId as KcrRiskDimensionId)
    }
  }

  function renderEdge(edge: KcrRiskGraphEdge) {
    const source = positions.get(edge.source)
    const target = positions.get(edge.target)
    if (!source || !target) return null
    const points = getEdgeEndpoints(source, target)
    const active =
      edge.source === selectedNodeId || edge.target === selectedNodeId
    const midpointX = (points.x1 + points.x2) / 2
    const midpointY = (points.y1 + points.y2) / 2
    const curve =
      edge.kind === "structure" ? 0 : edge.kind === "propagation" ? 46 : 12
    const dx = points.x2 - points.x1
    const dy = points.y2 - points.y1
    const distance = Math.hypot(dx, dy) || 1
    const controlX = midpointX - (dy / distance) * curve
    const controlY = midpointY + (dx / distance) * curve

    return (
      <path
        key={edge.id}
        d={`M ${points.x1} ${points.y1} Q ${controlX} ${controlY} ${points.x2} ${points.y2}`}
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
    if (layoutNode.shape === "event") {
      return <polygon points={hexagonPoints(layoutNode)} />
    }
    if (layoutNode.shape === "evidence") {
      const side = layoutNode.radius * 1.45
      return (
        <rect
          x={layoutNode.x - side / 2}
          y={layoutNode.y - side / 2}
          width={side}
          height={side}
          rx="7"
          transform={`rotate(45 ${layoutNode.x} ${layoutNode.y})`}
        />
      )
    }
    return <circle cx={layoutNode.x} cy={layoutNode.y} r={layoutNode.radius} />
  }

  return (
    <LiquidGlassSurface
      variant="card"
      refractive
      className="kcr-risk-graph-glass"
      padding="0"
    >
      <section className="kcr-risk-graph" aria-labelledby={titleId}>
        <header className="kcr-risk-graph-header">
          <div>
            <span>
              <NetworkIcon aria-hidden="true" />
              企业—风险—指标—证据关系网络
            </span>
            <h3 id={titleId}>轻量风险知识图谱</h3>
            <p id={descriptionId}>
              企业位于网络中心，五个风险簇环绕展开；点击维度切换局部关系，点击指标、红旗或证据查看审计依据。
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

        <div className="kcr-risk-graph-stage">
          <div className="kcr-risk-graph-stage-label">
            <span>当前展开</span>
            <strong>{selectedDimension?.label}</strong>
            <small>点击五维节点切换风险簇</small>
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
              <filter id={glowId} x="-80%" y="-80%" width="260%" height="260%">
                <feGaussianBlur stdDeviation={compact ? "5" : "8"} />
              </filter>
            </defs>

            <ellipse
              className="kcr-risk-graph-orbit"
              cx={layout.center.x}
              cy={layout.center.y}
              rx={compact ? 112 : 205}
              ry={compact ? 95 : 155}
              aria-hidden="true"
            />
            <ellipse
              className="kcr-risk-graph-orbit kcr-risk-graph-orbit-outer"
              cx={layout.center.x}
              cy={layout.center.y}
              rx={compact ? 178 : 386}
              ry={compact ? 170 : 282}
              aria-hidden="true"
            />

            {positions.get(`dimension:${selectedDimensionId}`) ? (
              <circle
                className="kcr-risk-graph-focus-halo"
                cx={positions.get(`dimension:${selectedDimensionId}`)?.x}
                cy={positions.get(`dimension:${selectedDimensionId}`)?.y}
                r={compact ? 54 : 65}
                filter={`url(#${glowId})`}
                aria-hidden="true"
              />
            ) : null}

            <g aria-hidden="true">{visibleGraph.edges.map(renderEdge)}</g>

            <g>
              {visibleGraph.nodes.map((node) => {
                const layoutNode = positions.get(node.id)
                if (!layoutNode) return null
                const active = node.id === selectedNodeId
                const selectedDimensionNode =
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
                    <circle
                      className="kcr-risk-graph-hit-target"
                      cx={layoutNode.x}
                      cy={layoutNode.y}
                      r={Math.max(layoutNode.radius, compact ? 32 : 36)}
                      aria-hidden="true"
                    />
                    {renderNodeShape(layoutNode)}
                    <text x={layoutNode.x} y={layoutNode.y} textAnchor="middle">
                      {node.kind === "company" ? (
                        <>
                          <tspan x={layoutNode.x} dy="-0.35em">
                            {node.label}
                          </tspan>
                          <tspan
                            className="kcr-risk-graph-node-score"
                            x={layoutNode.x}
                            dy="1.55em"
                          >
                            {node.score ?? "—"} · {assessment.riskLevelLabel}
                            风险
                          </tspan>
                        </>
                      ) : node.kind === "dimension" ? (
                        <>
                          <tspan x={layoutNode.x} dy="-0.45em">
                            {dimensionShortLabel(node.label)}
                          </tspan>
                          <tspan
                            className="kcr-risk-graph-node-score"
                            x={layoutNode.x}
                            dy="1.45em"
                          >
                            {node.score ?? "—"}
                          </tspan>
                        </>
                      ) : node.kind === "indicator" ? (
                        <>
                          <tspan x={layoutNode.x} dy="-0.35em">
                            {node.entityId}
                          </tspan>
                          <tspan
                            className="kcr-risk-graph-node-score"
                            x={layoutNode.x}
                            dy="1.4em"
                          >
                            {node.score ?? "—"} 分
                          </tspan>
                        </>
                      ) : node.kind === "event" ? (
                        <>
                          <tspan x={layoutNode.x} dy="-0.35em">
                            {node.caption.split(" · ")[0]}
                          </tspan>
                          <tspan
                            className="kcr-risk-graph-node-score"
                            x={layoutNode.x}
                            dy="1.4em"
                          >
                            红旗
                          </tspan>
                        </>
                      ) : (
                        <>
                          <tspan x={layoutNode.x} dy="-0.35em">
                            {node.entityId}
                          </tspan>
                          <tspan
                            className="kcr-risk-graph-node-score"
                            x={layoutNode.x}
                            dy="1.4em"
                          >
                            证据
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
            关系类型沿用工作簿记录；图谱不把推断或传播路径改写为事实。
          </p>
        </footer>
      </section>
    </LiquidGlassSurface>
  )
}
