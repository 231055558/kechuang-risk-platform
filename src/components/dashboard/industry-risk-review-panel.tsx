import { useEffect, useState } from "react"
import {
  ArrowDownIcon,
  ArrowUpIcon,
  DatabaseZapIcon,
  ExternalLinkIcon,
  InfoIcon,
  RefreshCwIcon,
} from "lucide-react"

import { IndustryRiskKnowledgeGraph } from "@/components/dashboard/industry-risk-knowledge-graph"
import { GlassPanel } from "@/components/dashboard/shared"
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
  IndustryRiskAssessmentApiResponse,
  IndustryRiskCompanyDirectoryResponse,
  IndustryRiskMetricScore,
} from "@/domain/industry-risk-v1/index.ts"
import {
  fetchIndustryRiskAssessment,
  fetchIndustryRiskCompanies,
} from "@/lib/industry-risk-api"

type DirectoryState =
  | { status: "loading" }
  | { status: "success"; value: IndustryRiskCompanyDirectoryResponse }
  | { status: "error"; message: string }

type AssessmentState =
  | { status: "idle" | "loading" }
  | { status: "success"; value: IndustryRiskAssessmentApiResponse }
  | { status: "error"; message: string }

const numberFormatter = new Intl.NumberFormat("zh-CN", {
  maximumFractionDigits: 4,
})
const percentFormatter = new Intl.NumberFormat("zh-CN", {
  style: "percent",
  maximumFractionDigits: 1,
})

function scoreTone(score: number | null) {
  if (score === null) return "unknown"
  if (score >= 65) return "critical"
  if (score >= 55) return "high"
  if (score >= 45) return "medium"
  return "low"
}

function sourceForId(
  response: IndustryRiskAssessmentApiResponse,
  sourceId: string | null
) {
  return response.sources.find((source) => source.id === sourceId)
}

function metricStatusLabel(metric: IndustryRiskMetricScore) {
  if (metric.status === "scored") return "已评分"
  if (metric.status === "missing") return "本企业缺失"
  if (metric.status === "insufficient-sample") return "样本不足"
  return "暂无统一数值"
}

function metricBasisLabel(metric: IndustryRiskMetricScore) {
  if (metric.basis === "source-formula") return "原公式近似值"
  if (metric.basis === "partial-proxy") return "部分代理"
  return "待补数据"
}

export function IndustryRiskReviewPanel() {
  const [directoryAttempt, setDirectoryAttempt] = useState(0)
  const [assessmentAttempt, setAssessmentAttempt] = useState(0)
  const [directory, setDirectory] = useState<DirectoryState>({ status: "loading" })
  const [assessment, setAssessment] = useState<AssessmentState>({ status: "idle" })
  const [selectedCompanyId, setSelectedCompanyId] = useState("star-688256")

  useEffect(() => {
    const controller = new AbortController()
    void fetchIndustryRiskCompanies({ signal: controller.signal })
      .then((value) => {
        setDirectory({ status: "success", value })
        setSelectedCompanyId((current) =>
          value.companies.some((item) => item.companyId === current)
            ? current
            : (value.companies[0]?.companyId ?? "")
        )
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setDirectory({
          status: "error",
          message: error instanceof Error ? error.message : "行业样本暂时无法加载。",
        })
      })
    return () => controller.abort()
  }, [directoryAttempt])

  useEffect(() => {
    if (!selectedCompanyId || directory.status !== "success") return
    const controller = new AbortController()
    void fetchIndustryRiskAssessment(selectedCompanyId, {
      signal: controller.signal,
    })
      .then((value) => setAssessment({ status: "success", value }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setAssessment({
          status: "error",
          message: error instanceof Error ? error.message : "企业评估暂时无法加载。",
        })
      })
    return () => controller.abort()
  }, [assessmentAttempt, directory.status, selectedCompanyId])

  if (directory.status === "loading") {
    return (
      <Reveal>
        <GlassPanel className="industry-risk-state" variant="floating" role="status">
          <DatabaseZapIcon aria-hidden="true" />
          <div>
            <strong>正在读取行业样本</strong>
            <p>加载毛同学提供的 R01–R22 深搜增强数据。</p>
          </div>
        </GlassPanel>
      </Reveal>
    )
  }

  if (directory.status === "error") {
    return (
      <Reveal>
        <GlassPanel className="industry-risk-state" variant="floating" role="alert">
          <InfoIcon aria-hidden="true" />
          <div>
            <strong>行业样本加载失败</strong>
            <p>{directory.message}</p>
          </div>
          <Button
            variant="outline"
            onClick={() => {
              setDirectory({ status: "loading" })
              setDirectoryAttempt((value) => value + 1)
            }}
          >
            <RefreshCwIcon data-icon="inline-start" />
            重新加载
          </Button>
        </GlassPanel>
      </Reveal>
    )
  }

  const selectedSummary = directory.value.companies.find(
    (company) => company.companyId === selectedCompanyId
  )
  const selectCompany = (companyId: string) => {
    setAssessment({ status: "loading" })
    setSelectedCompanyId(companyId)
  }

  return (
    <>
      <Reveal>
        <GlassPanel
          className="industry-risk-workspace"
          surfaceClassName="industry-risk-workspace-glass"
          variant="floating"
          aria-labelledby="industry-risk-title"
        >
          <header className="industry-risk-header">
            <div>
              <span className="eyebrow">R01–R22 · 团队统一指标</span>
              <h2 id="industry-risk-title">
                {directory.value.sampleSize} 家数字芯片设计企业风险研判
              </h2>
              <p>
                R01–R04 为叙事校验，不直接计权；R05–R22 共
                {directory.value.numericIndicatorCount} 项全部进入候选范围，目前
                {directory.value.candidateMetricCount} 项已有可比数值。企业缺失项跳过，不补零。
              </p>
            </div>
            <div className="industry-risk-company-control">
              <label id="industry-company-label">查看企业</label>
              <Select value={selectedCompanyId} onValueChange={selectCompany}>
                <SelectTrigger aria-labelledby="industry-company-label">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper" align="end">
                  <SelectGroup>
                    {directory.value.companies.map((company) => (
                      <SelectItem key={company.companyId} value={company.companyId}>
                        {company.companyName} · {company.stockCode}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
          </header>

          <div className="industry-risk-scope-strip">
            <span>{directory.value.sectorLabel}</span>
            <span>{directory.value.sampleSize} 家同业样本</span>
            <span>22 项团队统一指标</span>
            <span>{directory.value.candidateAggregateCompanyCount} 家可生成候选分</span>
            <span>{directory.value.reportingPeriod}</span>
            <Badge variant="outline">缺失容忍 · 非正式评级</Badge>
          </div>

          <section className="industry-risk-assessment" aria-live="polite">
            {assessment.status === "success" ? (
              <IndustryRiskAssessmentContent response={assessment.value} />
            ) : assessment.status === "error" ? (
              <div className="industry-risk-assessment-state" role="alert">
                <InfoIcon aria-hidden="true" />
                <p>{assessment.message}</p>
                <Button
                  variant="outline"
                  onClick={() => {
                    setAssessment({ status: "loading" })
                    setAssessmentAttempt((value) => value + 1)
                  }}
                >
                  重新计算
                </Button>
              </div>
            ) : (
              <div className="industry-risk-assessment-state" role="status">
                <DatabaseZapIcon aria-hidden="true" />
                <p>正在计算 {selectedSummary?.companyName ?? "所选企业"} 的同业位置…</p>
              </div>
            )}
          </section>
        </GlassPanel>
      </Reveal>
      <IndustryRiskKnowledgeGraph
        key={selectedCompanyId}
        selectedCompanyId={selectedCompanyId}
      />
    </>
  )
}

function IndustryRiskAssessmentContent({
  response,
}: {
  response: IndustryRiskAssessmentApiResponse
}) {
  const { assessment, company } = response
  const aggregate = assessment.candidateAggregate
  const deepEvents = [...response.deepSearchEvents].sort((left, right) =>
    (right.eventDate ?? "").localeCompare(left.eventDate ?? "")
  )

  return (
    <>
      <div className="industry-risk-company-summary">
        <div>
          <span>{company.chainSegment}</span>
          <h3>{company.shortName}</h3>
          <p>{company.fullName}</p>
        </div>
        <div className="industry-risk-candidate-scores">
          <article data-tone={scoreTone(aggregate.score)}>
            <span>全指标候选基线</span>
            <strong>{aggregate.score ?? "—"}</strong>
            <small>
              使用 {aggregate.availableIndicatorCount}/{aggregate.totalIndicatorCount} 项
            </small>
          </article>
        </div>
      </div>

      <div className="industry-risk-method-brief">
        <strong>当前算法</strong>
        <span>
          每项按现有企业样本计算风险分位，再对该企业实际拥有的指标等权平均；覆盖率
          {percentFormatter.format(aggregate.coverageRate)}。缺失项不补零、不插值、不进入分母。
        </span>
      </div>

      <div className="industry-risk-metric-grid">
        {assessment.metrics.map((metric) => {
          const source = sourceForId(response, metric.sourceId)
          const DirectionIcon =
            metric.direction === "higher-is-riskier" ? ArrowUpIcon : ArrowDownIcon
          return (
            <article key={metric.indicatorId} data-tone={scoreTone(metric.riskScore)}>
              <div className="industry-risk-metric-title">
                <Badge variant="outline">{metric.indicatorId}</Badge>
                <Badge variant="outline">{metricBasisLabel(metric)}</Badge>
                <DirectionIcon aria-hidden="true" />
              </div>
              <h4>{metric.label}</h4>
              <div className="industry-risk-metric-value">
                <strong>
                  {metric.rawValue === null ? "—" : numberFormatter.format(metric.rawValue)}
                </strong>
                <span>{metric.unit}</span>
              </div>
              <dl>
                <div>
                  <dt>状态</dt>
                  <dd>{metricStatusLabel(metric)}</dd>
                </div>
                <div>
                  <dt>同业风险分位</dt>
                  <dd>
                    {metric.riskPercentile === null
                      ? "—"
                      : percentFormatter.format(metric.riskPercentile)}
                  </dd>
                </div>
                <div>
                  <dt>指标候选分</dt>
                  <dd>{metric.riskScore ?? "—"}</dd>
                </div>
                <div>
                  <dt>可比样本</dt>
                  <dd>{metric.sampleSize} 家</dd>
                </div>
              </dl>
              <details>
                <summary>公式、来源与限制</summary>
                <p>{metric.formulaTrace}</p>
                <p>
                  观测时点：{metric.asOfDate ?? "待补"} · 数据覆盖：{metric.coverageStatus}
                </p>
                {source ? (
                  source.url ? (
                    <a href={source.url} target="_blank" rel="noreferrer">
                      {source.institution} · {source.title}
                      <ExternalLinkIcon aria-hidden="true" />
                    </a>
                  ) : (
                    <p>{source.institution} · {source.title}</p>
                  )
                ) : (
                  <p>当前没有数值来源。</p>
                )}
                <p>{metric.limitation}</p>
              </details>
            </article>
          )
        })}
      </div>

      <div className="industry-risk-context-grid">
        <article className="industry-risk-report-card">
          <div className="industry-risk-section-heading">
            <div>
              <DatabaseZapIcon aria-hidden="true" />
              <h3>正式报告可得性</h3>
            </div>
            <Badge variant="outline">
              {response.reportAvailability?.latestPeriod ?? "待核验"}
            </Badge>
          </div>
          {response.reportAvailability ? (
            <>
              <strong>{response.reportAvailability.latestReportTitle}</strong>
              <p>
                {response.reportAvailability.latestReportDate ?? "日期待核验"} · 2025 年报
                {response.reportAvailability.annual2025Status}
              </p>
              <small>{response.reportAvailability.notes}</small>
              {response.reportAvailability.latestReportUrl ? (
                <a
                  href={response.reportAvailability.latestReportUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  查看官方报告
                  <ExternalLinkIcon aria-hidden="true" />
                </a>
              ) : null}
            </>
          ) : (
            <p>当前企业没有报告可得性记录。</p>
          )}
        </article>

        <section
          className="industry-risk-supplementary-card"
          aria-labelledby="industry-risk-events-title"
        >
          <div className="industry-risk-section-heading">
            <div>
              <InfoIcon aria-hidden="true" />
              <h3 id="industry-risk-events-title">上交所深搜事件</h3>
            </div>
            <Badge variant="outline">{deepEvents.length} 条</Badge>
          </div>
          {deepEvents.length > 0 ? (
            <ul>
              {deepEvents.map((event) => (
                <li key={event.id}>
                  <div>
                    <span>
                      {event.relatedIndicatorId ?? "企业事件"} · {event.eventDate ?? "日期待核验"}
                    </span>
                    <strong>{event.eventType}</strong>
                  </div>
                  {event.url ? (
                    <a href={event.url} target="_blank" rel="noreferrer">
                      {event.title}
                      <ExternalLinkIcon aria-hidden="true" />
                    </a>
                  ) : (
                    <small>{event.title}</small>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p>本轮深搜没有登记该企业的官方事件；这不等于确认无风险事件。</p>
          )}
        </section>
      </div>

      <footer className="industry-risk-method-note">
        <InfoIcon aria-hidden="true" />
        <p>
          <strong>{assessment.methodVersion}</strong>
          <span>
            当前只使用毛同学 R01–R22 指标体系与深搜数据。代理值、缺失值和正式来源均显式标注；候选分用于 MVP 比较，不是正式评级结论。
          </span>
        </p>
      </footer>
    </>
  )
}
