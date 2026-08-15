import { useId, useMemo, useState } from "react"
import {
  AlertTriangleIcon,
  ArrowRightIcon,
  ExternalLinkIcon,
  FileCheck2Icon,
} from "lucide-react"

import { LiquidGlassSurface } from "@/components/liquid"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { KcrAssessmentApiResponse } from "@/domain/kcr-v1/assessment-api.ts"
import type { KcrRiskDimensionId } from "@/domain/kcr-v1/model.ts"
import {
  buildKcrRiskKnowledgeGraph,
  distributeKcrRiskGraphPositions,
  selectKcrRiskGraphDimension,
  type KcrRiskGraphEdge,
  type KcrRiskGraphNode,
  type KcrRiskGraphNodeKind,
} from "@/lib/kcr-risk-knowledge-graph"

type KcrRiskKnowledgeGraphProps = {
  response: KcrAssessmentApiResponse
  companyLabel: string
  onOpenDimension: (dimensionId: KcrRiskDimensionId) => void
}

type GraphPosition = {
  x: number
  y: number
  width: number
  height: number
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

function buildGraphPositions(nodes: KcrRiskGraphNode[]) {
  const positions = new Map<string, GraphPosition>()
  const dimensions = nodes.filter((node) => node.kind === "dimension")
  const indicators = nodes.filter((node) => node.kind === "indicator")
  const evidence = nodes.filter((node) => node.kind === "evidence")
  const events = nodes.filter((node) => node.kind === "event")

  nodes
    .filter((node) => node.kind === "company")
    .forEach((node) =>
      positions.set(node.id, { x: 100, y: 325, width: 150, height: 76 })
    )
  distributeKcrRiskGraphPositions(dimensions.length, 82, 568).forEach(
    (y, index) =>
      positions.set(dimensions[index].id, {
        x: 310,
        y,
        width: 154,
        height: 62,
      })
  )
  distributeKcrRiskGraphPositions(indicators.length, 105, 535).forEach(
    (y, index) =>
      positions.set(indicators[index].id, {
        x: 570,
        y,
        width: 182,
        height: 60,
      })
  )
  distributeKcrRiskGraphPositions(evidence.length, 100, 540).forEach(
    (y, index) =>
      positions.set(evidence[index].id, {
        x: 920,
        y,
        width: 190,
        height: 60,
      })
  )
  distributeKcrRiskGraphPositions(events.length, 615, 615).forEach((y, index) =>
    positions.set(events[index].id, {
      x: 685 + index * 205,
      y,
      width: 190,
      height: 66,
    })
  )

  return positions
}

function edgeEndpoints(source: GraphPosition, target: GraphPosition) {
  const dx = target.x - source.x
  const dy = target.y - source.y
  const sourceScale =
    1 /
    Math.max(
      Math.abs(dx) / (source.width / 2),
      Math.abs(dy) / (source.height / 2)
    )
  const targetScale =
    1 /
    Math.max(
      Math.abs(dx) / (target.width / 2),
      Math.abs(dy) / (target.height / 2)
    )

  return {
    x1: source.x + dx * sourceScale,
    y1: source.y + dy * sourceScale,
    x2: target.x - dx * targetScale,
    y2: target.y - dy * targetScale,
  }
}

function graphLabelLines(label: string, maxCharacters: number) {
  if (label.length <= maxCharacters) return [label]
  const first = label.slice(0, maxCharacters)
  const remaining = label.slice(maxCharacters)
  const second =
    remaining.length > maxCharacters
      ? `${remaining.slice(0, maxCharacters - 1)}…`
      : remaining
  return [first, second]
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

  return (
    <aside className="kcr-risk-graph-inspector" aria-live="polite">
      <div className="kcr-risk-graph-inspector-heading">
        <span>{nodeKindLabels[node.kind]}</span>
        <Badge variant="outline">{node.entityId}</Badge>
      </div>
      <h4>{node.label}</h4>

      {node.kind === "company" ? (
        <>
          <p>
            当前图谱完全由本次 KCR V3
            评分响应构建，节点和关系均可回到指标或来源；不会把关系传播追加到客观基线。
          </p>
          <dl>
            <div>
              <dt>客观基线</dt>
              <dd>{assessment.baselineScore ?? "—"} 分</dd>
            </div>
            <div>
              <dt>证据覆盖</dt>
              <dd>{percentFormatter.format(assessment.evidenceCoverage)}</dd>
            </div>
            <div>
              <dt>评分指标</dt>
              <dd>{assessment.indicatorResults.length} 项</dd>
            </div>
            <div>
              <dt>红旗事件</dt>
              <dd>{assessment.redFlags.length} 项</dd>
            </div>
          </dl>
        </>
      ) : null}

      {dimension ? (
        <>
          <p>{dimension.formulaTrace}</p>
          <dl>
            <div>
              <dt>维度分</dt>
              <dd>{dimension.score ?? "—"} 分</dd>
            </div>
            <div>
              <dt>风险等级</dt>
              <dd>{dimension.riskLevelLabel}风险</dd>
            </div>
            <div>
              <dt>指标数量</dt>
              <dd>{dimension.indicatorIds.length} 项</dd>
            </div>
            <div>
              <dt>证据覆盖</dt>
              <dd>{percentFormatter.format(dimension.evidenceCoverage)}</dd>
            </div>
          </dl>
          <Button
            variant="outline"
            onClick={() => onOpenDimension(dimension.dimensionId)}
          >
            查看完整指标与证据链
            <ArrowRightIcon data-icon="inline-end" />
          </Button>
        </>
      ) : null}

      {indicator ? (
        <>
          <p>{indicator.rationale}</p>
          <dl>
            <div>
              <dt>指标风险分</dt>
              <dd>{indicator.riskScore ?? "—"}</dd>
            </div>
            <div>
              <dt>固定权重</dt>
              <dd>{indicator.weight}</dd>
            </div>
            <div>
              <dt>数据状态</dt>
              <dd>{dataStatusLabels[indicator.dataStatus]}</dd>
            </div>
            <div>
              <dt>证据置信度</dt>
              <dd>{percentFormatter.format(indicator.evidenceConfidence)}</dd>
            </div>
          </dl>
          <Button
            variant="outline"
            onClick={() => onOpenDimension(indicator.dimensionId)}
          >
            查看评分公式与原始来源
            <ArrowRightIcon data-icon="inline-end" />
          </Button>
        </>
      ) : null}

      {redFlag ? (
        <>
          <p>{redFlag.summary}</p>
          <dl>
            <div>
              <dt>处置优先级</dt>
              <dd>{redFlag.priority}</dd>
            </div>
            <div>
              <dt>关联指标</dt>
              <dd>{redFlag.sourceIndicatorIds.join("、")}</dd>
            </div>
            <div>
              <dt>来源证据</dt>
              <dd>{redFlag.evidenceIds.length} 条</dd>
            </div>
            <div>
              <dt>传播风险</dt>
              <dd>{propagationPath?.propagatedRisk ?? "未纳入"}</dd>
            </div>
          </dl>
          <p className="kcr-risk-graph-audit-note">
            <AlertTriangleIcon aria-hidden="true" />
            红旗与传播路径独立展示，不改写 35.6 分客观基线。
          </p>
        </>
      ) : null}

      {evidence ? (
        <>
          <p>{evidence.locator}</p>
          <dl>
            <div>
              <dt>来源类型</dt>
              <dd>{sourceTierLabels[evidence.sourceTier]}</dd>
            </div>
            <div>
              <dt>来源机构</dt>
              <dd>{evidence.sourceName}</dd>
            </div>
            <div>
              <dt>发布日期</dt>
              <dd>{evidence.publishedAt ?? "未记录"}</dd>
            </div>
            <div>
              <dt>引用维度</dt>
              <dd>{node.dimensionIds.length} 个</dd>
            </div>
          </dl>
          {evidence.sourceUrl ? (
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
        </>
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
    `company:${assessment.companyId}`
  )
  const visibleGraph = useMemo(
    () => selectKcrRiskGraphDimension(graph, selectedDimensionId),
    [graph, selectedDimensionId]
  )
  const positions = useMemo(
    () => buildGraphPositions(visibleGraph.nodes),
    [visibleGraph.nodes]
  )
  const selectedNode =
    graph.nodes.find((node) => node.id === selectedNodeId) ?? graph.nodes[0]
  const titleId = useId()
  const descriptionId = useId()
  const markerId = `${useId().replaceAll(":", "")}-graph-arrow`

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
    const points = edgeEndpoints(source, target)
    const active =
      edge.source === selectedNodeId || edge.target === selectedNodeId
    const path =
      edge.kind === "propagation"
        ? `M ${points.x1} ${points.y1} C ${points.x1 - 180} 670, ${points.x2 + 180} 670, ${points.x2} ${points.y2}`
        : `M ${points.x1} ${points.y1} L ${points.x2} ${points.y2}`

    return (
      <path
        key={edge.id}
        d={path}
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
            <span>第 8 步 · 可追溯关系网络</span>
            <h3 id={titleId}>轻量风险知识图谱</h3>
            <p id={descriptionId}>
              从企业沿风险维度下钻到指标、红旗事件和来源证据；点击任一节点查看它在评分链中的依据。
            </p>
          </div>
          <div className="kcr-risk-graph-counts" aria-label="完整图谱统计">
            <strong>{graph.counts.nodes}</strong>
            <span>节点</span>
            <strong>{graph.counts.edges}</strong>
            <span>关系</span>
          </div>
        </header>

        <div
          className="kcr-risk-graph-dimension-filters"
          role="group"
          aria-label="选择图谱风险维度"
        >
          {assessment.dimensions.map((dimension) => (
            <button
              key={dimension.dimensionId}
              type="button"
              aria-pressed={dimension.dimensionId === selectedDimensionId}
              onClick={() => {
                setSelectedDimensionId(dimension.dimensionId)
                setSelectedNodeId(`dimension:${dimension.dimensionId}`)
              }}
            >
              <span>{dimension.label}</span>
              <strong>{dimension.score ?? "—"}</strong>
            </button>
          ))}
        </div>

        <div className="kcr-risk-graph-workspace">
          <div className="kcr-risk-graph-canvas-scroll">
            <svg
              className="kcr-risk-graph-canvas"
              viewBox="0 0 1040 680"
              role="img"
              aria-labelledby={`${titleId} ${descriptionId}`}
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
                  const position = positions.get(node.id)
                  if (!position) return null
                  const labelLines = graphLabelLines(
                    node.label,
                    node.kind === "evidence" || node.kind === "indicator"
                      ? 12
                      : 10
                  )
                  const active = node.id === selectedNodeId
                  const focusedDimension =
                    node.dimensionIds.includes(selectedDimensionId)

                  return (
                    <g
                      key={node.id}
                      className="kcr-risk-graph-node"
                      data-kind={node.kind}
                      data-active={active || undefined}
                      data-focused={focusedDimension || undefined}
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
                        x={position.x - position.width / 2}
                        y={position.y - position.height / 2}
                        width={position.width}
                        height={position.height}
                        rx={node.kind === "company" ? 22 : 14}
                      />
                      <text x={position.x} y={position.y} textAnchor="middle">
                        {labelLines.map((line, index) => (
                          <tspan
                            key={line}
                            x={position.x}
                            dy={
                              index === 0
                                ? labelLines.length === 1
                                  ? "0"
                                  : "-0.5em"
                                : "1.25em"
                            }
                          >
                            {line}
                          </tspan>
                        ))}
                        <tspan
                          className="kcr-risk-graph-node-caption"
                          x={position.x}
                          dy="1.55em"
                        >
                          {node.caption}
                        </tspan>
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
        </div>

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
            实线、虚线和点线严格沿用工作簿证据类型；关系图本身不新增评分结论。
          </p>
        </footer>
      </section>
    </LiquidGlassSurface>
  )
}
