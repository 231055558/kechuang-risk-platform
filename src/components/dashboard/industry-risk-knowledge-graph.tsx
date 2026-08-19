import { useEffect, useMemo, useState } from "react"
import {
  AlertTriangleIcon,
  DatabaseZapIcon,
  GitBranchIcon,
  InfoIcon,
  Maximize2Icon,
  NetworkIcon,
  RefreshCwIcon,
} from "lucide-react"

import { LiquidGlassSurface } from "@/components/liquid"
import { Reveal } from "@/components/motion/workflow-transition"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
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
  sector: "行业样本",
  segment: "产业链环节",
  company: "企业",
  indicator: "风险指标",
  source: "数据来源",
  event: "风险事件",
  artifact: "材料目录元数据",
}

function shortLabel(node: IndustryRiskGraphNode) {
  if (node.kind === "indicator") return `${node.entityId} ${node.label}`
  return node.label.length > 12 ? `${node.label.slice(0, 11)}…` : node.label
}

export function IndustryRiskKnowledgeGraph({
  selectedCompanyId,
}: {
  selectedCompanyId: string
}) {
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<GraphState>({ status: "loading" })
  const [mode, setMode] = useState<"full" | "company">("company")
  const [focusedCompanyId, setFocusedCompanyId] = useState(selectedCompanyId)
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
              : "行业风险图谱暂时无法加载。",
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
            <p>正在构建行业、企业、指标、来源、事件与材料关系…</p>
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

  return (
    <IndustryRiskKnowledgeGraphContent
      graph={state.value}
      mode={mode}
      onModeChange={setMode}
      focusedCompanyId={focusedCompanyId}
      onFocusedCompanyChange={setFocusedCompanyId}
      activeNodeId={activeNodeId}
      onActiveNodeChange={setActiveNodeId}
    />
  )
}

function IndustryRiskKnowledgeGraphContent({
  graph,
  mode,
  onModeChange,
  focusedCompanyId,
  onFocusedCompanyChange,
  activeNodeId,
  onActiveNodeChange,
}: {
  graph: IndustryRiskKnowledgeGraph
  mode: "full" | "company"
  onModeChange: (mode: "full" | "company") => void
  focusedCompanyId: string
  onFocusedCompanyChange: (companyId: string) => void
  activeNodeId: string | null
  onActiveNodeChange: (nodeId: string | null) => void
}) {
  const visibleGraph = useMemo(
    () =>
      selectIndustryRiskGraph(
        graph,
        mode === "company" ? focusedCompanyId : null
      ),
    [focusedCompanyId, graph, mode]
  )
  const layout = useMemo(
    () => buildIndustryRiskGraphLayout(visibleGraph),
    [visibleGraph]
  )
  const positions = new Map(layout.nodes.map((node) => [node.id, node]))
  const activeNode = visibleGraph.nodes.find((node) => node.id === activeNodeId)
  const activeEdges = activeNode
    ? visibleGraph.edges.filter(
        (edge) => edge.source === activeNode.id || edge.target === activeNode.id
      )
    : []
  const adjacentIds = new Set(
    activeEdges.flatMap((edge) => [edge.source, edge.target])
  )
  const companyNodes = graph.nodes.filter((node) => node.kind === "company")

  return (
    <Reveal>
      <LiquidGlassSurface
        variant="card"
        className="industry-graph-glass"
        padding="0"
      >
        <section
          className="industry-graph"
          data-mode={mode}
          aria-labelledby="industry-graph-title"
        >
          <header className="industry-graph-header">
            <div>
              <span className="eyebrow">行业证据全景 · 关系均可追溯</span>
              <h2 id="industry-graph-title">完整行业风险知识图谱</h2>
              <p>{graph.scopeNote}</p>
            </div>
            <div className="industry-graph-mode-controls">
              <Button
                variant={mode === "full" ? "default" : "outline"}
                onClick={() => {
                  onModeChange("full")
                  onActiveNodeChange(null)
                }}
              >
                <Maximize2Icon data-icon="inline-start" />
                完整网络
              </Button>
              <Button
                variant={mode === "company" ? "default" : "outline"}
                onClick={() => {
                  onModeChange("company")
                  onActiveNodeChange(null)
                }}
              >
                <GitBranchIcon data-icon="inline-start" />
                企业聚焦
              </Button>
            </div>
          </header>

          <div className="industry-graph-summary">
            <Badge variant="outline">{graph.counts.nodes} 个节点</Badge>
            <Badge variant="outline">{graph.counts.edges} 条关系</Badge>
            <Badge variant="outline">
              {graph.counts.scoredCompanies} 家行业样本 +{" "}
              {graph.counts.evidenceOnlyCompanies} 家证据企业
            </Badge>
            <Badge variant="outline">{graph.counts.events} 个风险事件</Badge>
            <Badge variant="outline">
              {graph.counts.artifacts} 份材料目录元数据
            </Badge>
            <Badge variant="outline">
              当前视图 {visibleGraph.nodes.length} 个节点 ·{" "}
              {visibleGraph.edges.length} 条关系
            </Badge>
            {mode === "company" ? (
              <Select
                value={focusedCompanyId}
                onValueChange={(value) => {
                  onFocusedCompanyChange(value)
                  onActiveNodeChange(null)
                }}
              >
                <SelectTrigger aria-label="选择图谱聚焦企业">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper" align="end">
                  <SelectGroup>
                    {companyNodes.map((company) => (
                      <SelectItem key={company.id} value={company.entityId}>
                        {company.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            ) : null}
          </div>

          <div className="industry-graph-content">
            <div
              className="industry-graph-canvas"
              role="group"
              aria-label="可交互行业关系图"
            >
              <svg
                viewBox={`0 0 ${layout.width} ${layout.height}`}
                role="img"
                aria-label={`${visibleGraph.nodes.length} 个节点、${visibleGraph.edges.length} 条关系的行业风险知识图谱`}
              >
                <g className="industry-graph-edges">
                  {visibleGraph.edges.map((edge) => {
                    const source = positions.get(edge.source)
                    const target = positions.get(edge.target)
                    if (!source || !target) return null
                    const active = activeEdges.some(
                      (item) => item.id === edge.id
                    )
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
                  {visibleGraph.nodes.map((node) => {
                    const position = positions.get(node.id)
                    if (!position) return null
                    const selected = node.id === activeNodeId
                    const dimmed = Boolean(
                      activeNode && !adjacentIds.has(node.id)
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
                              rx={node.kind === "sector" ? 18 : 10}
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
                  <Badge variant="outline">
                    {nodeKindLabels[activeNode.kind]}
                  </Badge>
                  <h3>{activeNode.label}</h3>
                  <p>{activeNode.caption}</p>
                  {activeNode.score !== null ? (
                    <strong>{activeNode.score} 候选分</strong>
                  ) : null}
                  <div>
                    <span>直接关系 {activeEdges.length} 条</span>
                    <span>关联企业 {activeNode.companyIds.length} 家</span>
                  </div>
                  <ul>
                    {activeEdges.slice(0, 8).map((edge) => (
                      <li key={edge.id}>
                        <b>{edge.label}</b>
                        <span>{edge.detail}</span>
                      </li>
                    ))}
                  </ul>
                  {activeEdges.length > 8 ? (
                    <small>
                      另有 {activeEdges.length - 8}{" "}
                      条关系，切换企业聚焦可继续查看。
                    </small>
                  ) : null}
                </>
              ) : (
                <div className="industry-graph-inspector-empty">
                  <NetworkIcon aria-hidden="true" />
                  <h3>点击任意节点</h3>
                  <p>
                    查看完整名称、材料含义、候选分和相邻关系；图中不使用 T…、S…
                    等不可读缩写。
                  </p>
                </div>
              )}
            </aside>
          </div>

          <footer className="industry-graph-legend">
            {Object.entries(nodeKindLabels).map(([kind, label]) => (
              <span key={kind} data-kind={kind}>
                {label}
              </span>
            ))}
            <p>
              <AlertTriangleIcon aria-hidden="true" />
              材料节点只表示团队持有相应类别文件，尚未把其内容纳入评分。
            </p>
          </footer>
        </section>
      </LiquidGlassSurface>
    </Reveal>
  )
}
