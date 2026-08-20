import { useEffect, useMemo, useState } from "react"
import {
  AlertTriangleIcon,
  DatabaseZapIcon,
  InfoIcon,
  NetworkIcon,
  RefreshCwIcon,
} from "lucide-react"

import { LiquidGlassSurface } from "@/components/liquid"
import { Reveal } from "@/components/motion/workflow-transition"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type {
  IndustryRiskGraphNode,
  IndustryRiskGraphNodeKind,
  IndustryRiskKnowledgeGraph,
} from "@/domain/industry-risk-v1/index.ts"
import { fetchIndustryRiskKnowledgeGraph } from "@/lib/industry-risk-api"
import {
  buildIndustryRiskGraphLayout,
  selectIndustryRiskGraph,
} from "@/lib/industry-risk-graph-layout"

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

function shortLabel(node: IndustryRiskGraphNode) {
  if (node.kind === "indicator") {
    const label = node.label.length > 9 ? `${node.label.slice(0, 9)}…` : node.label
    return `${node.entityId} ${label}`
  }
  return node.label.length > 12 ? `${node.label.slice(0, 11)}…` : node.label
}

export function IndustryRiskKnowledgeGraph({
  selectedCompanyId,
}: {
  selectedCompanyId: string
}) {
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<GraphState>({ status: "loading" })
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null)

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

  const graph = selectIndustryRiskGraph(state.value, selectedCompanyId)
  const company = graph.nodes.find((node) => node.kind === "company")
  return (
    <IndustryRiskKnowledgeGraphContent
      graph={graph}
      companyName={company?.label ?? "所选企业"}
      activeNodeId={activeNodeId}
      onActiveNodeChange={setActiveNodeId}
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
  const layout = useMemo(() => buildIndustryRiskGraphLayout(graph), [graph])
  const positions = new Map(layout.nodes.map((node) => [node.id, node]))
  const activeNode = graph.nodes.find((node) => node.id === activeNodeId)
  const activeEdges = activeNode
    ? graph.edges.filter(
        (edge) => edge.source === activeNode.id || edge.target === activeNode.id
      )
    : []
  const adjacentIds = new Set(
    activeEdges.flatMap((edge) => [edge.source, edge.target])
  )
  const countKind = (kind: IndustryRiskGraphNodeKind) =>
    graph.nodes.filter((node) => node.kind === kind).length

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
              <span className="eyebrow">单企业完整图谱 · 关系均可追溯</span>
              <h2 id="industry-graph-title">{companyName}企业风险知识图谱</h2>
              <p>{graph.scopeNote}</p>
            </div>
          </header>

          <div className="industry-graph-summary">
            <Badge variant="outline">{countKind("category")} 个风险维度</Badge>
            <Badge variant="outline">{countKind("indicator")} 项统一指标</Badge>
            <Badge variant="outline">{countKind("source")} 个数据来源</Badge>
            <Badge variant="outline">{countKind("event")} 个风险事件</Badge>
            <Badge variant="outline">{graph.edges.length} 条可追溯关系</Badge>
          </div>

          <div className="industry-graph-content">
            <div
              className="industry-graph-canvas"
              role="group"
              aria-label={`${companyName}企业风险关系图`}
            >
              <svg
                viewBox={`0 0 ${layout.width} ${layout.height}`}
                role="img"
                aria-label={`${graph.nodes.length} 个节点、${graph.edges.length} 条关系的企业风险知识图谱`}
              >
                <g className="industry-graph-edges">
                  {graph.edges.map((edge) => {
                    const source = positions.get(edge.source)
                    const target = positions.get(edge.target)
                    if (!source || !target) return null
                    const active = activeEdges.some((item) => item.id === edge.id)
                    return (
                      <line
                        key={edge.id}
                        x1={source.x}
                        y1={source.y}
                        x2={target.x}
                        y2={target.y}
                        data-kind={edge.kind}
                        data-active={active}
                        data-dimmed={Boolean(activeNode && !active)}
                      >
                        <title>{`${edge.label}：${edge.detail}`}</title>
                      </line>
                    )
                  })}
                </g>
                <g className="industry-graph-nodes">
                  {graph.nodes.map((node) => {
                    const position = positions.get(node.id)
                    if (!position) return null
                    const selected = node.id === activeNodeId
                    const dimmed = Boolean(
                      activeNode && node.id !== activeNode.id && !adjacentIds.has(node.id)
                    )
                    return (
                      <g
                        key={node.id}
                        className="industry-graph-node"
                        data-kind={node.kind}
                        data-tone={node.tone}
                        data-selected={selected}
                        data-dimmed={dimmed}
                        transform={`translate(${position.x} ${position.y})`}
                        role="button"
                        tabIndex={0}
                        aria-label={`${nodeKindLabels[node.kind]}：${node.label}，${node.caption}`}
                        onClick={() =>
                          onActiveNodeChange(selected ? null : node.id)
                        }
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault()
                            onActiveNodeChange(selected ? null : node.id)
                          }
                        }}
                      >
                        <title>{`${nodeKindLabels[node.kind]}：${node.label}；${node.caption}`}</title>
                        {position.shape === "dot" ? (
                          <circle r={position.width / 2} />
                        ) : (
                          <>
                            <rect
                              x={-position.width / 2}
                              y={-position.height / 2}
                              width={position.width}
                              height={position.height}
                              rx={node.kind === "company" ? 18 : 10}
                            />
                            <text textAnchor="middle" dominantBaseline="middle">
                              {shortLabel(node)}
                            </text>
                          </>
                        )}
                      </g>
                    )
                  })}
                </g>
              </svg>
            </div>

            <aside className="industry-graph-inspector" aria-live="polite">
              {activeNode ? (
                <>
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
                </>
              ) : (
                <div className="industry-graph-inspector-empty">
                  <NetworkIcon aria-hidden="true" />
                  <h3>点击任意节点</h3>
                  <p>查看完整名称、指标含义、候选分和直接证据关系。</p>
                </div>
              )}
            </aside>
          </div>

          <footer className="industry-graph-legend">
            {Object.entries(nodeKindLabels).map(([kind, label]) => (
              <span key={kind} data-kind={kind}>{label}</span>
            ))}
            <p>
              <AlertTriangleIcon aria-hidden="true" />
              连线只表示指标分类、数据来源或事件证据，不代表已证明的因果关系。
            </p>
          </footer>
        </section>
      </LiquidGlassSurface>
    </Reveal>
  )
}
