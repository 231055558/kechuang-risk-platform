import { useEffect, useMemo, useState } from "react"
import {
  ArrowRightIcon,
  CalendarDaysIcon,
  DownloadIcon,
  ExternalLinkIcon,
  FileCheck2Icon,
  FileTextIcon,
  ListChecksIcon,
  NewspaperIcon,
  RefreshCwIcon,
  ShieldAlertIcon,
} from "lucide-react"

import { GlassPanel } from "@/components/dashboard/shared"
import { Reveal } from "@/components/motion/workflow-transition"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { IndustryRiskAssessmentApiResponse } from "@/domain/industry-risk-v1/index.ts"
import {
  buildIndustryRiskConclusion,
  generateIndustryRiskRecommendations,
} from "@/domain/industry-risk-v1/index.ts"
import { fetchIndustryRiskAssessment } from "@/lib/industry-risk-api"
import type { NavigationTarget } from "@/types/nav"
import type { CompanyDetail } from "@/types/risk"

type RiskReportsTabProps = {
  companyId: string
  detail: CompanyDetail
  onOpenExports: () => void
  onNavigate: (target: NavigationTarget) => void
}

type ReportState =
  | { status: "loading" }
  | { status: "success"; value: IndustryRiskAssessmentApiResponse }
  | { status: "error"; companyId: string; message: string }

function getRiskLevel(score: number | null) {
  if (score === null) return { label: "待评估", tone: "unknown" }
  if (score >= 65) return { label: "高风险", tone: "critical" }
  if (score >= 55) return { label: "较高风险", tone: "high" }
  if (score >= 45) return { label: "中等风险", tone: "medium" }
  return { label: "较低风险", tone: "low" }
}

function formatDate(value: string | null | undefined) {
  if (!value) return "日期待补充"
  const [year, month, day] = value.slice(0, 10).split("-")
  return year && month && day ? `${year}.${month}.${day}` : value
}

export function RiskReportsTab({
  companyId,
  detail,
  onOpenExports,
  onNavigate,
}: RiskReportsTabProps) {
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<ReportState>({ status: "loading" })

  useEffect(() => {
    const controller = new AbortController()
    void fetchIndustryRiskAssessment(companyId, { signal: controller.signal })
      .then((value) => setState({ status: "success", value }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setState({
          status: "error",
          companyId,
          message:
            error instanceof Error ? error.message : "报告数据暂时无法加载。",
        })
      })
    return () => controller.abort()
  }, [attempt, companyId])

  if (
    state.status === "loading" ||
    (state.status === "success" && state.value.company.id !== companyId) ||
    (state.status === "error" && state.companyId !== companyId)
  ) {
    return (
      <Reveal>
        <GlassPanel className="industry-risk-state" variant="floating">
          <FileTextIcon aria-hidden="true" />
          <div>
            <strong>正在生成 {detail.name} 风险报告</strong>
            <p>汇总风险评分、重点指标、事件资讯与正式披露材料。</p>
          </div>
        </GlassPanel>
      </Reveal>
    )
  }

  if (state.status === "error") {
    return (
      <Reveal>
        <GlassPanel className="industry-risk-state" variant="floating">
          <ShieldAlertIcon aria-hidden="true" />
          <div>
            <strong>报告暂时无法生成</strong>
            <p>{state.message}</p>
          </div>
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
        </GlassPanel>
      </Reveal>
    )
  }

  return (
    <RiskReportContent
      response={state.value}
      onOpenExports={onOpenExports}
      onNavigate={onNavigate}
    />
  )
}

function RiskReportContent({
  response,
  onOpenExports,
  onNavigate,
}: {
  response: IndustryRiskAssessmentApiResponse
  onOpenExports: () => void
  onNavigate: (target: NavigationTarget) => void
}) {
  const { assessment } = response
  const riskLevel = getRiskLevel(assessment.totalRiskScore)
  const scoredMetrics = useMemo(
    () =>
      response.assessment.metrics
        .filter((metric) => metric.riskScore !== null)
        .sort((left, right) => (right.riskScore ?? 0) - (left.riskScore ?? 0)),
    [response.assessment.metrics]
  )
  const topMetrics = scoredMetrics.slice(0, 5)
  const conclusion = buildIndustryRiskConclusion(assessment)
  const recommendations = generateIndustryRiskRecommendations(assessment)
  const recentEvents = [...response.events]
    .sort((left, right) => (right.date ?? "").localeCompare(left.date ?? ""))
    .slice(0, 4)
  const officialSources = response.sources
    .filter(
      (source) =>
        Boolean(source.url) &&
        /报告|公告|交易所|披露|年报|半年报|季报/.test(
          `${source.sourceType}${source.institution}${source.title}`
        )
    )
    .slice(0, 6)

  return (
    <div className="page-stack customer-report-page">
      <Reveal>
        <GlassPanel
          className="risk-report-hero"
          surfaceClassName="risk-report-hero-glass"
          variant="floating"
        >
          <div className="risk-report-hero-copy">
            <span className="eyebrow">
              企业风险报告 · 数据截至{" "}
              {formatDate(response.provenance.sourceDate)}
            </span>
            <h2>{response.company.shortName}风险报告中心</h2>
            <p>{conclusion}</p>
            <div className="risk-report-hero-actions">
              <Button onClick={onOpenExports}>
                <DownloadIcon data-icon="inline-start" />
                导出客户版报告
              </Button>
              <Button
                variant="outline"
                onClick={() => onNavigate({ view: "overview" })}
              >
                返回风险总览
              </Button>
            </div>
          </div>
          <article
            className="risk-report-score-card"
            data-tone={riskLevel.tone}
          >
            <span>综合风险指数</span>
            <strong>{assessment.totalRiskScore ?? "待评估"}</strong>
            <Badge variant="outline">{riskLevel.label}</Badge>
            <small>
              {assessment.weightedScoredIndicatorCount}/18 项风险指标已纳入 ·
              同业样本 {assessment.benchmarkSampleSize} 家
            </small>
          </article>
        </GlassPanel>
      </Reveal>

      <Reveal>
        <section className="risk-report-product-grid" aria-label="风险报告产品">
          <article>
            <FileCheck2Icon aria-hidden="true" />
            <div>
              <span>客户报告</span>
              <h3>企业综合风险摘要</h3>
              <p>包含风险结论、重点领域、事件摘要、数据口径及使用声明。</p>
            </div>
            <Button variant="outline" onClick={onOpenExports}>
              生成报告 <ArrowRightIcon data-icon="inline-end" />
            </Button>
          </article>
          <article>
            <ListChecksIcon aria-hidden="true" />
            <div>
              <span>风险台账</span>
              <h3>事件清单与处置</h3>
              <p>查看已识别事件、原始来源、核验状态与建议动作。</p>
            </div>
            <Button
              variant="outline"
              onClick={() =>
                onNavigate({ view: "events", operationsSection: "events" })
              }
            >
              查看事件 <ArrowRightIcon data-icon="inline-end" />
            </Button>
          </article>
          <article>
            <NewspaperIcon aria-hidden="true" />
            <div>
              <span>持续跟踪</span>
              <h3>风险资讯</h3>
              <p>浏览数据库收录的公告、报告、监管和媒体信息。</p>
            </div>
            <Button
              variant="outline"
              onClick={() => onNavigate({ view: "realtime" })}
            >
              浏览资讯 <ArrowRightIcon data-icon="inline-end" />
            </Button>
          </article>
        </section>
      </Reveal>

      <Reveal>
        <GlassPanel
          className="risk-report-section risk-report-advice"
          variant="floating"
        >
          <header>
            <div>
              <span className="eyebrow">系统建议</span>
              <h3>本期建议优先执行的动作</h3>
            </div>
            <Badge variant="outline">由高影响指标自动触发</Badge>
          </header>
          <div className="automatic-action-grid">
            {recommendations.map((recommendation, index) => (
              <article
                key={recommendation.indicatorId}
                data-priority={recommendation.priority}
              >
                <div className="automatic-action-index">
                  {String(index + 1).padStart(2, "0")}
                </div>
                <div className="automatic-action-main">
                  <div>
                    <Badge variant="outline">{recommendation.priority}</Badge>
                    <span>{recommendation.trigger}</span>
                  </div>
                  <h4>{recommendation.title}</h4>
                  <p>{recommendation.action}</p>
                </div>
                <ArrowRightIcon aria-hidden="true" />
              </article>
            ))}
          </div>
        </GlassPanel>
      </Reveal>

      <div className="risk-report-content-grid">
        <Reveal>
          <GlassPanel className="risk-report-section" variant="floating">
            <header>
              <div>
                <span className="eyebrow">本期重点</span>
                <h3>优先关注的风险指标</h3>
              </div>
              <Badge variant="outline">按影响程度排序</Badge>
            </header>
            {topMetrics.length ? (
              <ol className="risk-report-priority-list">
                {topMetrics.map((metric, index) => (
                  <li
                    key={metric.indicatorId}
                    data-tone={getRiskLevel(metric.riskScore).tone}
                  >
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <div>
                      <strong>{metric.label}</strong>
                      <small>
                        {metric.indicatorId} · {metric.unit || "统一口径"}
                      </small>
                    </div>
                    <b>{metric.riskScore}</b>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="customer-risk-empty-copy">
                当前暂无可计算指标，已保留数据补充入口。
              </p>
            )}
          </GlassPanel>
        </Reveal>

        <Reveal>
          <GlassPanel className="risk-report-section" variant="floating">
            <header>
              <div>
                <span className="eyebrow">最新动态</span>
                <h3>近期风险事件</h3>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onNavigate({ view: "realtime" })}
              >
                查看全部
              </Button>
            </header>
            {recentEvents.length ? (
              <div className="risk-report-event-list">
                {recentEvents.map((event) => (
                  <article key={event.id}>
                    <CalendarDaysIcon aria-hidden="true" />
                    <div>
                      <span>
                        {formatDate(event.date)} · {event.eventType}
                      </span>
                      <strong>{event.title}</strong>
                    </div>
                    {event.url ? (
                      <a
                        href={event.url}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`查看${event.title}原始来源`}
                      >
                        <ExternalLinkIcon aria-hidden="true" />
                      </a>
                    ) : null}
                  </article>
                ))}
              </div>
            ) : (
              <p className="customer-risk-empty-copy">
                本期未收录结构化风险事件。
              </p>
            )}
          </GlassPanel>
        </Reveal>
      </div>

      <Reveal>
        <GlassPanel
          className="risk-report-section risk-report-materials"
          variant="floating"
        >
          <header>
            <div>
              <span className="eyebrow">可追溯材料</span>
              <h3>数据库已收录的报告与正式来源</h3>
            </div>
            <Badge variant="outline">{response.sources.length} 条来源</Badge>
          </header>

          {response.reportAvailability ? (
            <article className="risk-report-featured-material">
              <FileTextIcon aria-hidden="true" />
              <div>
                <span>
                  {response.reportAvailability.latestPeriod ?? "最新正式报告"}
                </span>
                <h4>
                  {response.reportAvailability.latestReportTitle ??
                    "企业正式披露报告"}
                </h4>
                <small>
                  {formatDate(response.reportAvailability.latestReportDate)}
                </small>
              </div>
              {response.reportAvailability.latestReportUrl ? (
                <Button asChild variant="outline">
                  <a
                    href={response.reportAvailability.latestReportUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    阅读原文 <ExternalLinkIcon data-icon="inline-end" />
                  </a>
                </Button>
              ) : (
                <Badge variant="outline">链接待补充</Badge>
              )}
            </article>
          ) : null}

          <div className="risk-report-source-grid">
            {officialSources.map((source) => (
              <a
                key={source.id}
                href={source.url ?? undefined}
                target="_blank"
                rel="noreferrer"
              >
                <span>{source.sourceType}</span>
                <strong>{source.title}</strong>
                <small>
                  {source.institution} ·{" "}
                  {formatDate(source.publicationDate ?? source.accessedAt)}
                </small>
                <ExternalLinkIcon aria-hidden="true" />
              </a>
            ))}
          </div>
          <p className="risk-report-disclaimer">
            本页基于数据库已收录公开材料和统一风险规则自动生成；系统建议用于风险应对和行动排序，不输出买卖或收益预测。缺失项目不会显示为
            0，也不会影响其他已具备数据的指标计算。
          </p>
        </GlassPanel>
      </Reveal>
    </div>
  )
}
