import { useGSAP } from "@gsap/react"
import gsap from "gsap"
import { useEffect, useMemo, useRef, useState } from "react"
import {
  ArrowRightIcon,
  BinocularsIcon,
  CircleAlertIcon,
  Clock3Icon,
  FileSignatureIcon,
  DatabaseZapIcon,
  GitBranchIcon,
  LandmarkIcon,
  NetworkIcon,
  SearchCheckIcon,
  ShieldCheckIcon,
} from "lucide-react"

import { usePrefersReducedMotion } from "@/components/motion/workflow-transition"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { IndustryRiskAssessmentApiResponse } from "@/domain/industry-risk-v1/index.ts"
import { fetchIndustryRiskAssessment } from "@/lib/industry-risk-api"
import { riskHeatColor } from "@/lib/risk-heat"
import type {
  CommonPlaybookItem,
  CompanyDetail,
  EventStatus,
  OperationsSection,
  RiskEvent,
} from "@/types/risk"
import "@/styles/investor-operations.css"

type EventsTabProps = {
  detail: CompanyDetail
  events: RiskEvent[]
  section: OperationsSection
  focusEventId: string | null
  onSectionChange: (section: OperationsSection) => void
  onFocusEventHandled: () => void
  onStatusChange: (eventId: string, status: EventStatus) => void
  playbook: CommonPlaybookItem[]
}

type AssessmentState =
  | { status: "loading" }
  | { status: "success"; value: IndustryRiskAssessmentApiResponse }
  | { status: "error"; message: string }

export function EventsTab({ detail, events, section }: EventsTabProps) {
  if (section === "investment") {
    return (
      <InvestorDecisionPanel detail={detail} events={events} mode="research" />
    )
  }
  if (section === "advice") {
    return (
      <InvestorDecisionPanel detail={detail} events={events} mode="response" />
    )
  }
  return <GraphIntegrationPanel detail={detail} />
}

function GraphIntegrationPanel({ detail }: { detail: CompanyDetail }) {
  return (
    <div
      className="graph-integration page-stack"
      data-graph-contract="KCR-TEMPORAL-GRAPH-PENDING-v1"
    >
      <header className="graph-integration__header">
        <div>
          <span className="eyebrow">Risk propagation</span>
          <h2>{detail.name}风险传导</h2>
          <p>
            本页只承载团队后续提供的风险演化知识图谱。当前指标、事件和来源关系不会被前端自动解释为因果或传播路径。
          </p>
        </div>
        <Badge variant="outline">图谱接口待接入</Badge>
      </header>

      <section
        className="graph-integration__stage"
        aria-label="风险传导图谱接入区域"
      >
        <div className="graph-integration__toolbar" aria-label="图谱控制预留">
          <Button variant="outline" size="sm" disabled>
            时间范围
          </Button>
          <Button variant="outline" size="sm" disabled>
            实体层
          </Button>
          <Button variant="outline" size="sm" disabled>
            风险层
          </Button>
          <Button variant="outline" size="sm" disabled>
            全屏
          </Button>
        </div>
        <div className="graph-integration__empty">
          <div aria-hidden="true">
            <NetworkIcon />
            <span />
            <GitBranchIcon />
          </div>
          <h3>动态图谱组件将在此接入</h3>
          <p>
            接口需提供实体、关系方向、有效期、边权、置信度、来源和抽取版本；缺少这些字段时不生成关系边。
          </p>
          <dl>
            <div>
              <dt>当前页面</dt>
              <dd>布局、加载态、工具栏与全屏容器已预留</dd>
            </div>
            <div>
              <dt>待同学提供</dt>
              <dd>图谱组件、时序数据和关系语义</dd>
            </div>
            <div>
              <dt>接入边界</dt>
              <dd>不复用旧证据星型图，不伪造风险传导</dd>
            </div>
          </dl>
        </div>
      </section>
    </div>
  )
}

function InvestorDecisionPanel({
  detail,
  events,
  mode,
}: {
  detail: CompanyDetail
  events: RiskEvent[]
  mode: "research" | "response"
}) {
  const [state, setState] = useState<AssessmentState>({ status: "loading" })

  useEffect(() => {
    const controller = new AbortController()
    void fetchIndustryRiskAssessment(detail.id, { signal: controller.signal })
      .then((value) => setState({ status: "success", value }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setState({
          status: "error",
          message:
            error instanceof Error
              ? error.message
              : "投资研判数据暂时无法加载。",
        })
      })
    return () => controller.abort()
  }, [detail.id])

  if (
    state.status === "loading" ||
    (state.status === "success" && state.value.company.id !== detail.id)
  ) {
    return <DecisionState text="正在读取风险分、证据覆盖和触发条件…" />
  }
  if (state.status === "error") {
    return <DecisionState text={state.message} />
  }

  return mode === "research" ? (
    <InvestmentResearchContent
      detail={detail}
      events={events}
      response={state.value}
    />
  ) : (
    <RiskResponseContent detail={detail} response={state.value} />
  )
}

function InvestmentResearchContent({
  detail,
  events,
  response,
}: {
  detail: CompanyDetail
  events: RiskEvent[]
  response: IndustryRiskAssessmentApiResponse
}) {
  const investment = detail.investmentView
  const rootRef = useRef<HTMLDivElement>(null)
  const prefersReducedMotion = usePrefersReducedMotion()
  const topMetrics = useMemo(
    () =>
      response.assessment.metrics
        .filter(
          (metric) => metric.kind === "weighted" && metric.riskScore !== null
        )
        .sort((left, right) => (right.riskScore ?? 0) - (left.riskScore ?? 0))
        .slice(0, 5),
    [response.assessment.metrics]
  )
  const motionKey = `${response.company.id}:${response.assessment.methodVersion}:investment`

  useGSAP(
    () => {
      const root = rootRef.current
      if (!root) return
      const bars = root.querySelectorAll<HTMLElement>("[data-investor-bar]")
      if (prefersReducedMotion) {
        gsap.set(bars, { clearProps: "transform" })
        return
      }
      gsap.fromTo(
        bars,
        { scaleX: 0, transformOrigin: "left center" },
        {
          scaleX: 1,
          duration: 0.72,
          stagger: 0.075,
          ease: "power3.out",
          clearProps: "transform",
        }
      )
    },
    {
      scope: rootRef,
      dependencies: [motionKey, prefersReducedMotion],
      revertOnUpdate: true,
    }
  )

  return (
    <div
      ref={rootRef}
      className="investor-decision page-stack"
      data-motion-key={motionKey}
    >
      <header className="investor-decision__header">
        <div>
          <span className="eyebrow">Investment risk review</span>
          <h2>{response.company.shortName}投资研判</h2>
          <p>
            依据风险位置、证据充分度和触发条件组织研究判断；不输出未经金融组确认的买入、卖出或收益预测。
          </p>
        </div>
        <Badge variant="outline">风险研究辅助</Badge>
      </header>

      <section className="investor-decision__dashboard">
        <article className="investor-decision__score">
          <span>综合风险指数</span>
          <strong>{response.assessment.totalRiskScore ?? "—"}</strong>
          <p>
            {investment?.summary ??
              "当前风险结论需结合原始来源和正式披露核对。"}
          </p>
          <div>
            <span
              style={{ width: `${response.assessment.totalRiskScore ?? 0}%` }}
              data-investor-bar
            />
          </div>
        </article>

        <article className="investor-decision__coverage">
          <div
            style={
              {
                "--coverage": `${Math.round(response.assessment.weightedDataCoverage * 100)}%`,
              } as React.CSSProperties
            }
          >
            <strong>
              {Math.round(response.assessment.weightedDataCoverage * 100)}%
            </strong>
            <span>指标覆盖</span>
          </div>
          <dl>
            <div>
              <dt>已评分</dt>
              <dd>{response.assessment.weightedScoredIndicatorCount}/18</dd>
            </div>
            <div>
              <dt>近期事件</dt>
              <dd>{events.length}</dd>
            </div>
            <div>
              <dt>同业样本</dt>
              <dd>{response.assessment.benchmarkSampleSize}</dd>
            </div>
          </dl>
        </article>

        <article className="investor-decision__drivers">
          <header>
            <span>主要风险驱动</span>
            <small>同业分位着色</small>
          </header>
          <ol>
            {topMetrics.map((metric) => (
              <li
                key={metric.indicatorId}
                style={
                  {
                    "--driver-color": riskHeatColor(metric.riskPercentile),
                  } as React.CSSProperties
                }
              >
                <div>
                  <span>{metric.indicatorId}</span>
                  <strong>{metric.label}</strong>
                  <b>{metric.riskScore}</b>
                </div>
                <i>
                  <span
                    data-investor-bar
                    style={{ width: `${metric.riskScore ?? 0}%` }}
                  />
                </i>
              </li>
            ))}
          </ol>
        </article>
      </section>

      <section className="investor-decision__constraints">
        <DecisionList
          icon={SearchCheckIcon}
          title="投资前核验"
          items={[
            ...(investment?.preInvestmentChecks ?? []),
            ...(investment?.dueDiligenceFocus ?? []),
          ]}
        />
        <DecisionList
          icon={LandmarkIcon}
          title="估值与决策约束"
          items={investment?.valuationConstraints ?? []}
        />
        <DecisionList
          icon={BinocularsIcon}
          title="持有期监测"
          items={investment?.postInvestmentMonitoring ?? []}
        />
        <DecisionList
          icon={CircleAlertIcon}
          title="重新评估触发"
          items={investment?.stopLossTriggers ?? []}
          danger
        />
      </section>

      <BoundaryNote />
    </div>
  )
}

function RiskResponseContent({
  detail,
  response,
}: {
  detail: CompanyDetail
  response: IndustryRiskAssessmentApiResponse
}) {
  const investment = detail.investmentView
  const stages = [
    {
      id: "01",
      icon: SearchCheckIcon,
      title: "投资前核验",
      description:
        "在决策前补齐关键事实和原始材料，避免以缺失值形成虚假确定性。",
      items: [
        ...(investment?.preInvestmentChecks ?? []),
        ...(investment?.dueDiligenceFocus ?? []),
      ],
    },
    {
      id: "02",
      icon: FileSignatureIcon,
      title: "合同与交易保护",
      description: "把关键风险转化为交割前提、信息权利、陈述保证或分阶段安排。",
      items: investment?.valuationConstraints ?? [],
    },
    {
      id: "03",
      icon: Clock3Icon,
      title: "持有期监测",
      description: "围绕高风险指标、正式披露和事件变化设置连续观察点。",
      items: investment?.postInvestmentMonitoring ?? [],
    },
    {
      id: "04",
      icon: CircleAlertIcon,
      title: "重新评估与退出条件",
      description: "触发条件出现时重新核验风险承受边界，并评估降低敞口或退出。",
      items: investment?.stopLossTriggers ?? [],
    },
  ]

  return (
    <div className="risk-response page-stack">
      <header className="investor-decision__header">
        <div>
          <span className="eyebrow">Investor risk response</span>
          <h2>{response.company.shortName}风险应对</h2>
          <p>
            以投资者可执行的核验、保护、监测和重新评估为主线；不包含企业内部责任部门、截止日期或工单状态。
          </p>
        </div>
        <Badge variant="outline">全生命周期风险控制</Badge>
      </header>

      <section className="risk-response__timeline">
        {stages.map((stage) => {
          const Icon = stage.icon
          return (
            <article key={stage.id}>
              <header>
                <span>{stage.id}</span>
                <Icon aria-hidden="true" />
                <div>
                  <h3>{stage.title}</h3>
                  <p>{stage.description}</p>
                </div>
              </header>
              {stage.items.length ? (
                <ol>
                  {stage.items.map((item) => (
                    <li key={item}>
                      <ArrowRightIcon aria-hidden="true" />
                      {item}
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="risk-response__empty">
                  当前没有已确认的阶段性条件。
                </p>
              )}
            </article>
          )
        })}
      </section>

      <BoundaryNote />
    </div>
  )
}

function DecisionList({
  icon: Icon,
  title,
  items,
  danger = false,
}: {
  icon: typeof SearchCheckIcon
  title: string
  items: string[]
  danger?: boolean
}) {
  return (
    <article data-danger={danger}>
      <header>
        <Icon aria-hidden="true" />
        <h3>{title}</h3>
        <Badge variant="outline">{items.length}</Badge>
      </header>
      {items.length ? (
        <ol>
          {items.slice(0, 6).map((item, index) => (
            <li key={item}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <p>{item}</p>
            </li>
          ))}
        </ol>
      ) : (
        <p>当前暂无已确认条件。</p>
      )}
    </article>
  )
}

function BoundaryNote() {
  return (
    <section className="investor-decision__boundary">
      <ShieldCheckIcon aria-hidden="true" />
      <div>
        <strong>使用边界</strong>
        <p>
          本页基于公开信息和当前评分方法形成风险研究辅助，不构成证券投资建议、收益承诺或监管认定。
        </p>
      </div>
    </section>
  )
}

function DecisionState({ text }: { text: string }) {
  return (
    <div className="industry-risk-state" role="status">
      <DatabaseZapIcon aria-hidden="true" />
      <p>{text}</p>
    </div>
  )
}
