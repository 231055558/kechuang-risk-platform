import { useEffect, useMemo, useState } from "react"
import {
  ActivityIcon,
  Building2Icon,
  ChartNoAxesCombinedIcon,
  DatabaseZapIcon,
  GaugeIcon,
  LandmarkIcon,
  SearchCheckIcon,
  ShieldCheckIcon,
  SlidersHorizontalIcon,
  TargetIcon,
  UserRoundIcon,
} from "lucide-react"

import { RiskPropagationGraph } from "@/components/dashboard/risk-propagation-graph"
import { Badge } from "@/components/ui/badge"
import type {
  IndustryRiskAssessmentApiResponse,
  IndustryRiskCompanyDirectoryResponse,
} from "@/domain/industry-risk-v1/index.ts"
import {
  fetchIndustryRiskAssessment,
  fetchIndustryRiskCompanies,
} from "@/lib/industry-risk-api"
import {
  buildInvestorRiskSignals,
  buildInvestmentPerspective,
  calculateInvestorPeerPosition,
  deriveInvestorResearchReadiness,
  type InvestmentPerspectiveId,
  type InvestorRiskSignal,
} from "@/lib/investor-decision"
import { buildEnterpriseRiskActions } from "@/lib/enterprise-risk-actions"
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
  | {
      status: "success"
      response: IndustryRiskAssessmentApiResponse
      directory: IndustryRiskCompanyDirectoryResponse
    }
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
  return <RiskPropagationGraph detail={detail} />
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
    void Promise.all([
      fetchIndustryRiskAssessment(detail.id, { signal: controller.signal }),
      fetchIndustryRiskCompanies({ signal: controller.signal }),
    ])
      .then(([response, directory]) =>
        setState({ status: "success", response, directory })
      )
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
    (state.status === "success" && state.response.company.id !== detail.id)
  ) {
    return <DecisionState text="正在读取风险分、证据覆盖和触发条件…" />
  }
  if (state.status === "error") {
    return <DecisionState text={state.message} />
  }

  return mode === "research" ? (
    <InvestmentResearchContent
      events={events}
      response={state.response}
      directory={state.directory}
    />
  ) : (
    <RiskResponseContent
      response={state.response}
      directory={state.directory}
    />
  )
}

function scoreText(value: number | null) {
  return value === null ? "—" : value.toFixed(2)
}

function signedText(value: number | null) {
  if (value === null) return "—"
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}`
}

function InvestmentResearchContent({
  events,
  response,
  directory,
}: {
  events: RiskEvent[]
  response: IndustryRiskAssessmentApiResponse
  directory: IndustryRiskCompanyDirectoryResponse
}) {
  const [perspective, setPerspective] =
    useState<InvestmentPerspectiveId>("institution")
  const signals = useMemo(
    () => buildInvestorRiskSignals(response.assessment),
    [response.assessment]
  )
  const topSignals = signals.slice(0, 4)
  const peerPosition = useMemo(
    () => calculateInvestorPeerPosition(directory, response.company.id),
    [directory, response.company.id]
  )
  const readiness = useMemo(
    () => deriveInvestorResearchReadiness(response.assessment),
    [response.assessment]
  )
  const perspectiveContent = useMemo(
    () => buildInvestmentPerspective(response.assessment, perspective),
    [perspective, response.assessment]
  )
  const coveragePercent = Math.round(
    response.assessment.weightedDataCoverage * 100
  )
  const combinedExecutionSteps = perspectiveContent.executionSteps.map(
    (step, index) => ({
      ...step,
      decisionQuestion:
        perspectiveContent.requiredChecks[index] ??
        `综合前述证据，最终回答“${perspectiveContent.question}”。`,
      operatingConstraint:
        perspectiveContent.operatingConstraints[index] ??
        "只有前述材料、产出物和验证结果形成闭环后，才可形成最终结论。",
    })
  )

  return (
    <div className="investor-decision page-stack">
      <header className="investor-decision__header">
        <div>
          <h2>{response.company.shortName}投资研判</h2>
          <p>
            从风险位置、主要驱动、数据置信度和压力条件形成研究结论；不输出未经确认的买入、卖出或收益预测。
          </p>
        </div>
        <div className="investor-decision__header-status">
          <span>研究状态</span>
          <Badge variant="outline" data-readiness={readiness.key}>
            {readiness.label}
          </Badge>
        </div>
      </header>

      <section
        className="investor-decision__compact-overview"
        aria-label="共同风险基线"
      >
        <article>
          <GaugeIcon aria-hidden="true" />
          <span>综合风险</span>
          <strong>{scoreText(response.assessment.totalRiskScore)}</strong>
          <small>
            {peerPosition.riskPercentile === null
              ? "分位待补充"
              : `行业 P${peerPosition.riskPercentile} · 排名 ${peerPosition.rank}/${peerPosition.sampleSize}`}
          </small>
        </article>
        <article>
          <ChartNoAxesCombinedIcon aria-hidden="true" />
          <span>同业参照</span>
          <strong>{signedText(peerPosition.deltaFromMean)}</strong>
          <small>
            相对均值 · 低风险四分位 {scoreText(peerPosition.lowerRiskQuartile)}
          </small>
        </article>
        <article>
          <TargetIcon aria-hidden="true" />
          <span>证据覆盖</span>
          <strong>{coveragePercent}%</strong>
          <small>
            {response.assessment.weightedScoredIndicatorCount}/18 项已评分 ·{" "}
            {events.length} 条近期事件
          </small>
        </article>
        <article>
          <SlidersHorizontalIcon aria-hidden="true" />
          <span>首要风险</span>
          <strong>{topSignals[0]?.indicatorId ?? "—"}</strong>
          <small>
            {topSignals[0]
              ? `${topSignals[0].label} · 同业 P${Math.round(topSignals[0].riskPercentile * 100)}`
              : "暂无可排序风险驱动"}
          </small>
        </article>
      </section>

      <section className="investor-perspective">
        <nav
          className="investor-perspective__selector"
          aria-label="选择研判视角"
        >
          {(
            [
              {
                id: "institution",
                label: "投资机构 · 决策",
                question: "是否具备投委会条件",
                icon: LandmarkIcon,
              },
              {
                id: "individual",
                label: "个人投资者 · 持仓",
                question: "风险是否超出承受能力",
                icon: UserRoundIcon,
              },
              {
                id: "bank",
                label: "银行 · 授信",
                question: "是否具备授信审查条件",
                icon: Building2Icon,
              },
            ] as const
          ).map((item) => {
            const Icon = item.icon
            return (
              <button
                key={item.id}
                type="button"
                data-active={perspective === item.id}
                onClick={() => setPerspective(item.id)}
              >
                <Icon aria-hidden="true" />
                <span>{item.label}</span>
                <small>{item.question}</small>
              </button>
            )
          })}
        </nav>

        <article className="investor-perspective__content">
          <header>
            <div>
              <span className="eyebrow">{perspectiveContent.question}</span>
              <h3>{perspectiveContent.headline}</h3>
              <p>{perspectiveContent.summary}</p>
            </div>
            <Badge variant="outline">{perspectiveContent.label}</Badge>
          </header>

          <dl className="investor-perspective__facts">
            {perspectiveContent.facts.map((fact) => (
              <div key={fact.label}>
                <dt>{fact.label}</dt>
                <dd>{fact.value}</dd>
                <small>{fact.detail}</small>
              </div>
            ))}
          </dl>

          <section className="investor-perspective__execution">
            <header>
              <div>
                <h4>研判执行方案</h4>
              </div>
              <p>每一步同时回答研判问题、操作边界和证据要求。</p>
            </header>
            <div>
              {combinedExecutionSteps.map((step, index) => (
                <article key={step.title}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <h5>{step.title}</h5>
                  <div className="investor-perspective__guidance">
                    <div>
                      <SearchCheckIcon aria-hidden="true" />
                      <strong>必须回答</strong>
                      <p>{step.decisionQuestion}</p>
                    </div>
                    <div>
                      <SlidersHorizontalIcon aria-hidden="true" />
                      <strong>操作边界</strong>
                      <p>{step.operatingConstraint}</p>
                    </div>
                  </div>
                  <p className="investor-perspective__action-copy">
                    <strong>执行动作</strong>
                    {step.action}
                  </p>
                  <dl>
                    <div>
                      <dt>所需材料</dt>
                      <dd>{step.requiredMaterial}</dd>
                    </div>
                    <div>
                      <dt>产出物</dt>
                      <dd>{step.deliverable}</dd>
                    </div>
                    <div>
                      <dt>验证方式</dt>
                      <dd>{step.verification}</dd>
                    </div>
                  </dl>
                </article>
              ))}
            </div>
          </section>
        </article>
      </section>

      <BoundaryNote sourceDate={response.provenance.sourceDate} />
    </div>
  )
}

function RiskResponseContent({
  response,
  directory,
}: {
  response: IndustryRiskAssessmentApiResponse
  directory: IndustryRiskCompanyDirectoryResponse
}) {
  const signals = buildInvestorRiskSignals(response.assessment)
  const topSignals = signals.slice(0, 5)
  const enterpriseActions = buildEnterpriseRiskActions(response.assessment, 18)
  const triggeredCount = signals.filter(
    (signal) => signal.status === "triggered"
  ).length
  const watchCount = signals.filter(
    (signal) => signal.status === "watch"
  ).length
  const peerPosition = calculateInvestorPeerPosition(
    directory,
    response.company.id
  )
  const coveragePercent = Math.round(
    response.assessment.weightedDataCoverage * 100
  )
  const missingCount = 18 - response.assessment.weightedScoredIndicatorCount
  const stages = [
    {
      id: "01",
      horizon: "0–3个月" as const,
      title: "立即整改",
      description: "先关闭处罚、诉讼、出口限制和现金流等已暴露风险。",
    },
    {
      id: "02",
      horizon: "3–12个月" as const,
      title: "中期整改",
      description: "把供应链、研发、融资和人员风险纳入稳定运营机制。",
    },
    {
      id: "03",
      horizon: "12个月以上" as const,
      title: "长期复评",
      description: "通过治理、控制权和长期能力建设验证风险是否持续下降。",
    },
  ]
  const displayedActionCount = stages.reduce(
    (total, stage) =>
      total +
      Math.min(
        5,
        enterpriseActions.filter((action) => action.horizon === stage.horizon)
          .length
      ),
    0
  )

  return (
    <div className="risk-response page-stack">
      <header className="investor-decision__header">
        <div>
          <h2>{response.company.shortName}风险应对</h2>
          <p>
            将高风险指标转化为企业内部可执行的整改动作，并明确产出物、验证标准和实施阶段。
          </p>
        </div>
        <Badge variant="outline">企业风险消减建议</Badge>
      </header>

      <section className="risk-response__summary" aria-label="风险监测摘要">
        <article>
          <GaugeIcon aria-hidden="true" />
          <span>当前风险</span>
          <strong>{scoreText(response.assessment.totalRiskScore)}</strong>
          <small>
            {peerPosition.riskPercentile === null
              ? "同业分位待补充"
              : `同业 P${peerPosition.riskPercentile}`}
          </small>
        </article>
        <article data-tone={triggeredCount > 0 ? "danger" : "normal"}>
          <ActivityIcon aria-hidden="true" />
          <span>预警信号</span>
          <strong>{triggeredCount}</strong>
          <small>{watchCount} 项临界观察</small>
        </article>
        <article>
          <TargetIcon aria-hidden="true" />
          <span>数据覆盖</span>
          <strong>{coveragePercent}%</strong>
          <small>{missingCount} 项客观指标缺失</small>
        </article>
        <article>
          <SlidersHorizontalIcon aria-hidden="true" />
          <span>整改建议</span>
          <strong>{displayedActionCount}</strong>
          <small>本页优先展示 · 均由指标触发</small>
        </article>
      </section>

      <section className="risk-response__signals">
        <header>
          <div>
            <h3>关键风险信号</h3>
          </div>
          <p>P75 以上标记为已触发，P60–P75 为临界观察。</p>
        </header>
        {topSignals.length ? (
          <div
            className="risk-response__signal-table-wrap"
            role="region"
            tabIndex={0}
          >
            <table>
              <thead>
                <tr>
                  <th>风险信号</th>
                  <th>监测状态</th>
                  <th>风险分</th>
                  <th>同业分位</th>
                  <th>触发口径与证据</th>
                </tr>
              </thead>
              <tbody>
                {topSignals.map((signal) => (
                  <tr key={signal.indicatorId}>
                    <th scope="row">
                      <span>{signal.indicatorId}</span>
                      <strong>{signal.label}</strong>
                    </th>
                    <td>
                      <RiskSignalStatusBadge signal={signal} />
                    </td>
                    <td>{signal.riskScore.toFixed(2)}</td>
                    <td>P{Math.round(signal.riskPercentile * 100)}</td>
                    <td>
                      {signal.thresholdLabel} · n={signal.sampleSize} ·{" "}
                      {signal.sourceCount}
                      条评分来源
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="risk-response__empty">当前没有可监测的正式风险分位。</p>
        )}
      </section>

      <section className="risk-response__timeline risk-response__action-plan">
        {stages.map((stage) => {
          const actions = enterpriseActions.filter(
            (action) => action.horizon === stage.horizon
          )
          return (
            <article key={stage.id}>
              <header>
                <span>{stage.id}</span>
                <div>
                  <small>{stage.horizon}</small>
                  <h3>{stage.title}</h3>
                  <p>{stage.description}</p>
                </div>
              </header>
              {actions.length ? (
                <div className="risk-response__action-list">
                  {actions.slice(0, 5).map((action) => (
                    <section key={action.indicatorId}>
                      <header>
                        <span>{action.indicatorId}</span>
                        <small>
                          同业 P{Math.round(action.riskPercentile * 100)}
                        </small>
                      </header>
                      <h4>{action.title}</h4>
                      <p>{action.action}</p>
                      <dl>
                        <div>
                          <dt>产出物</dt>
                          <dd>{action.deliverable}</dd>
                        </div>
                        <div>
                          <dt>验证标准</dt>
                          <dd>{action.validation}</dd>
                        </div>
                      </dl>
                    </section>
                  ))}
                </div>
              ) : (
                <p className="risk-response__empty">
                  当前高风险指标未生成该阶段建议。
                </p>
              )}
            </article>
          )
        })}
      </section>

      <BoundaryNote sourceDate={response.provenance.sourceDate} enterprise />
    </div>
  )
}

function RiskSignalStatusBadge({ signal }: { signal: InvestorRiskSignal }) {
  return (
    <Badge variant="outline" data-signal-status={signal.status}>
      {signal.statusLabel}
    </Badge>
  )
}

function BoundaryNote({
  sourceDate,
  enterprise = false,
}: {
  sourceDate: string
  enterprise?: boolean
}) {
  return (
    <section className="investor-decision__boundary">
      <ShieldCheckIcon aria-hidden="true" />
      <div>
        <strong>使用边界</strong>
        <p>
          {enterprise
            ? `数据截至 ${sourceDate}。本页建议由公开信息和现有风险指标生成，供企业风险自查和整改设计参考；不构成监管认定、合规鉴证、信用评级或审计意见。`
            : `数据截至 ${sourceDate}。本页从不同使用者角度组织同一风险证据，不构成证券投资建议、收益承诺、授信审批或监管认定。`}
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
