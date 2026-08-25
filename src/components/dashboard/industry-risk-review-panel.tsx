import { useGSAP } from "@gsap/react"
import gsap from "gsap"
import { useEffect, useMemo, useRef, useState } from "react"
import {
  ArrowDownIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  BarChart3Icon,
  CalendarDaysIcon,
  DatabaseZapIcon,
  ExternalLinkIcon,
  FileTextIcon,
  FileSearchIcon,
  GaugeIcon,
  InfoIcon,
  NewspaperIcon,
  NetworkIcon,
  RefreshCwIcon,
  ShieldCheckIcon,
} from "lucide-react"

import { IndustryRiskKnowledgeGraph } from "@/components/dashboard/industry-risk-knowledge-graph"
import { GlassPanel } from "@/components/dashboard/shared"
import {
  PRODUCTIVE_MOTION,
  Reveal,
  usePrefersReducedMotion,
} from "@/components/motion/workflow-transition"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type {
  IndustryRiskAssessmentApiResponse,
  IndustryRiskCompanyDirectoryResponse,
} from "@/domain/industry-risk-v1/index.ts"
import {
  buildIndustryRiskConclusion,
  generateIndustryRiskRecommendations,
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

function candidateScore(
  company: IndustryRiskCompanyDirectoryResponse["companies"][number],
  method: "entropy" | "critic"
) {
  return (
    company.candidateAggregates.find((item) => item.method === method)?.score ??
    null
  )
}

function scoreTone(score: number | null) {
  if (score === null) return "unknown"
  if (score >= 65) return "critical"
  if (score >= 55) return "high"
  if (score >= 45) return "medium"
  return "low"
}

function riskLevel(score: number | null) {
  if (score === null) return "待评估"
  if (score >= 65) return "高风险"
  if (score >= 55) return "较高风险"
  if (score >= 45) return "中等风险"
  return "较低风险"
}

export function IndustryRiskReviewPanel({
  companyId,
  onNavigate,
  showGraph = true,
}: {
  companyId: string
  onNavigate?: (
    view: "reports" | "realtime" | "events" | "intelligence"
  ) => void
  showGraph?: boolean
}) {
  const [directoryAttempt, setDirectoryAttempt] = useState(0)
  const [assessmentAttempt, setAssessmentAttempt] = useState(0)
  const [directory, setDirectory] = useState<DirectoryState>({
    status: "loading",
  })
  const [assessment, setAssessment] = useState<AssessmentState>({
    status: "idle",
  })

  useEffect(() => {
    const controller = new AbortController()
    void fetchIndustryRiskCompanies({ signal: controller.signal })
      .then((value) => {
        setDirectory({ status: "success", value })
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setDirectory({
          status: "error",
          message:
            error instanceof Error ? error.message : "行业样本暂时无法加载。",
        })
      })
    return () => controller.abort()
  }, [directoryAttempt])

  useEffect(() => {
    if (!companyId || directory.status !== "success") return
    const controller = new AbortController()
    void fetchIndustryRiskAssessment(companyId, {
      signal: controller.signal,
    })
      .then((value) => setAssessment({ status: "success", value }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setAssessment({
          status: "error",
          message:
            error instanceof Error ? error.message : "企业评估暂时无法加载。",
        })
      })
    return () => controller.abort()
  }, [assessmentAttempt, companyId, directory.status])

  const visibleCompanies = useMemo(() => {
    if (directory.status !== "success") return []
    const selected = directory.value.companies.find(
      (company) => company.companyId === companyId
    )
    if (!selected) return []
    return directory.value.companies.filter(
      (company) => company.benchmarkGroupId === selected.benchmarkGroupId
    )
  }, [companyId, directory])

  const rankedCompanies = useMemo(
    () =>
      [...visibleCompanies].sort(
        (left, right) =>
          (candidateScore(right, "critic") ?? -1) -
            (candidateScore(left, "critic") ?? -1) ||
          right.coveredIndicatorCount - left.coveredIndicatorCount ||
          left.stockCode.localeCompare(right.stockCode)
      ),
    [visibleCompanies]
  )

  if (directory.status === "loading") {
    return (
      <Reveal>
        <GlassPanel
          className="industry-risk-state"
          variant="floating"
          role="status"
        >
          <DatabaseZapIcon aria-hidden="true" />
          <div>
            <strong>正在读取 R01–R22 统一数据</strong>
            <p>加载四个行业数据库与最新事件、来源和覆盖矩阵。</p>
          </div>
        </GlassPanel>
      </Reveal>
    )
  }

  if (directory.status === "error") {
    return (
      <Reveal>
        <GlassPanel
          className="industry-risk-state"
          variant="floating"
          role="alert"
        >
          <InfoIcon aria-hidden="true" />
          <div>
            <strong>统一数据加载失败</strong>
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
    (company) => company.companyId === companyId
  )
  const selectedRank =
    rankedCompanies.findIndex((company) => company.companyId === companyId) + 1

  return (
    <>
      <Reveal>
        <section
          className="industry-risk-workspace"
          aria-labelledby="industry-risk-title"
        >
          <header className="industry-risk-header">
            <div>
              <span className="eyebrow">
                企业风险画像 · 数据截至 2026-08-19
              </span>
              <h2 id="industry-risk-title">
                {selectedSummary?.companyName ?? "当前企业"}风险总览
              </h2>
            </div>
            <div className="industry-risk-formula-summary">
              <Badge variant="outline">
                <ShieldCheckIcon data-icon="inline-start" />
                公开来源可追溯
              </Badge>
              <Badge variant="outline">客观指标可用即纳入</Badge>
              {showGraph ? (
                <Button variant="outline" size="sm" asChild>
                  <a href="#industry-graph-title">
                    <NetworkIcon data-icon="inline-start" />
                    查看关系图谱
                  </a>
                </Button>
              ) : null}
            </div>
          </header>

          <div className="industry-risk-scope-strip">
            <span>{selectedSummary?.benchmarkGroupLabel ?? "行业基准"}</span>
            <span>{selectedSummary?.benchmarkSampleSize ?? 0} 家同业样本</span>
            <span>当前排名 {selectedRank || "—"}</span>
            <span>{selectedSummary?.eventCount ?? 0} 条风险事件</span>
            <Badge variant="outline">毛同学数据库 · 深搜增强版</Badge>
          </div>

          <div className="industry-risk-body">
            <section className="industry-risk-assessment" aria-live="polite">
              {assessment.status === "success" ? (
                <IndustryRiskAssessmentContent
                  response={assessment.value}
                  selectedRank={selectedRank}
                  onNavigate={onNavigate}
                />
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
                    重新加载
                  </Button>
                </div>
              ) : (
                <div className="industry-risk-assessment-state" role="status">
                  <DatabaseZapIcon aria-hidden="true" />
                  <p>正在读取 {selectedSummary?.companyName ?? "当前企业"}…</p>
                </div>
              )}
            </section>
          </div>
          <details className="industry-risk-peer-reference">
            <summary>
              <BarChart3Icon aria-hidden="true" />
              查看行业参考样本（{visibleCompanies.length} 家）
            </summary>
            <ol>
              {rankedCompanies.slice(0, 12).map((company, index) => (
                <li
                  key={company.companyId}
                  data-active={company.companyId === companyId}
                >
                  <span>{index + 1}</span>
                  <strong>{company.companyName}</strong>
                  <small>{company.stockCode}</small>
                  <b>{company.totalRiskScore ?? "—"}</b>
                </li>
              ))}
            </ol>
          </details>
        </section>
      </Reveal>
      {showGraph ? (
        <IndustryRiskKnowledgeGraph
          key={companyId}
          selectedCompanyId={companyId}
        />
      ) : null}
    </>
  )
}

function IndustryRiskAssessmentContent({
  response,
  selectedRank,
  onNavigate,
}: {
  response: IndustryRiskAssessmentApiResponse
  selectedRank: number
  onNavigate?: (
    view: "reports" | "realtime" | "events" | "intelligence"
  ) => void
}) {
  const { assessment } = response
  const sourceById = new Map(
    response.sources.map((source) => [source.id, source])
  )
  const indicatorById = new Map(
    response.indicators.map((indicator) => [indicator.id, indicator])
  )
  const scoredMetrics = assessment.metrics
    .filter((metric) => metric.riskScore !== null)
    .sort((left, right) => (right.riskScore ?? 0) - (left.riskScore ?? 0))
  const missingMetrics = assessment.metrics.filter(
    (metric) => metric.kind === "weighted" && metric.riskScore === null
  )
  const priorityMetrics = scoredMetrics.slice(0, 5)
  const latestEvents = [...response.events]
    .sort((left, right) => (right.date ?? "").localeCompare(left.date ?? ""))
    .slice(0, 4)
  const coveragePercent = Math.round(assessment.weightedDataCoverage * 100)
  const conclusion = buildIndustryRiskConclusion(assessment)
  const recommendations = generateIndustryRiskRecommendations(assessment)
  const briefingRef = useRef<HTMLElement>(null)
  const prefersReducedMotion = usePrefersReducedMotion()
  const defaultDriverId = priorityMetrics[0]?.indicatorId ?? null
  const [driverSelection, setDriverSelection] = useState<{
    companyId: string
    indicatorId: string | null
  }>({ companyId: response.company.id, indicatorId: defaultDriverId })
  const activeDriverId =
    driverSelection.companyId === response.company.id
      ? driverSelection.indicatorId
      : defaultDriverId
  const benchmarkPosition =
    assessment.benchmarkSampleSize > 1 && selectedRank > 0
      ? Math.round(
          ((assessment.benchmarkSampleSize - selectedRank) /
            (assessment.benchmarkSampleSize - 1)) *
            100
        )
      : null

  useGSAP(
    () => {
      const briefing = briefingRef.current
      if (!briefing) return
      const stages = gsap.utils.toArray<HTMLElement>(
        "[data-motion-stage]",
        briefing
      )

      if (prefersReducedMotion) {
        gsap.set(stages, { clearProps: "opacity,transform,visibility" })
        return
      }

      gsap.timeline({ defaults: { overwrite: "auto" } }).fromTo(
        stages,
        { autoAlpha: 0, y: 14 },
        {
          autoAlpha: 1,
          y: 0,
          duration: PRODUCTIVE_MOTION.scene,
          ease: PRODUCTIVE_MOTION.easeEnter,
          stagger: 0.065,
          clearProps: "opacity,transform,visibility",
        }
      )
    },
    {
      scope: briefingRef,
      dependencies: [
        assessment.totalRiskScore,
        prefersReducedMotion,
        response.company.id,
      ],
      revertOnUpdate: true,
    }
  )

  return (
    <Tabs defaultValue="overview" className="industry-risk-detail-tabs">
      <TabsList aria-label="企业风险信息">
        <TabsTrigger value="overview">风险概览</TabsTrigger>
        <TabsTrigger value="narrative">
          叙事观察 {response.narrativeNewsMetric?.retrievedCount ?? 0}
        </TabsTrigger>
        <TabsTrigger value="breakdown">风险拆解</TabsTrigger>
        <TabsTrigger value="events">
          近期事件 {response.events.length}
        </TabsTrigger>
        <TabsTrigger value="method">数据与方法</TabsTrigger>
      </TabsList>

      <TabsContent value="overview">
        <section
          ref={briefingRef}
          className="risk-briefing-canvas"
          data-tone={scoreTone(assessment.totalRiskScore)}
          aria-label={`${response.company.shortName}风险简报`}
        >
          <div className="risk-briefing-primary" data-motion-stage>
            <div className="risk-briefing-status">
              <span>
                <i aria-hidden="true" />
                系统自动结论
              </span>
              <Badge variant="outline">
                {riskLevel(assessment.totalRiskScore)}
              </Badge>
            </div>

            <div className="risk-briefing-score-lockup">
              <strong>{assessment.totalRiskScore ?? "—"}</strong>
              <span>综合风险指数</span>
            </div>

            <div className="risk-briefing-rank-axis">
              <div>
                <span>同业低风险端</span>
                <span>同业高风险端</span>
              </div>
              <div className="risk-briefing-rank-track" aria-hidden="true">
                {benchmarkPosition !== null ? (
                  <i style={{ left: `${benchmarkPosition}%` }} />
                ) : null}
              </div>
              <p>
                风险排名 <b>{selectedRank || "—"}</b> /{" "}
                {assessment.benchmarkSampleSize}
                <span>{assessment.benchmarkGroupLabel}</span>
              </p>
            </div>

            <h3>{conclusion}</h3>
            <p className="risk-briefing-method">
              R05–R22 客观指标按当前可用数据自动计算，缺失项不补零；R01–R04
              仅作叙事观察，不进入总分。
            </p>
          </div>

          <div className="risk-briefing-drivers" data-motion-stage>
            <header>
              <div>
                <span>Risk drivers</span>
                <h3>当前最值得关注的风险</h3>
              </div>
              <small>风险分 / 100</small>
            </header>
            <ol>
              {priorityMetrics.map((metric, index) => (
                <li key={metric.indicatorId}>
                  <button
                    type="button"
                    data-tone={scoreTone(metric.riskScore)}
                    data-active={activeDriverId === metric.indicatorId}
                    aria-pressed={activeDriverId === metric.indicatorId}
                    onClick={() =>
                      setDriverSelection({
                        companyId: response.company.id,
                        indicatorId: metric.indicatorId,
                      })
                    }
                  >
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <div>
                      <div>
                        <b>{metric.indicatorId}</b>
                        <strong>{metric.label}</strong>
                        <em>{metric.riskScore ?? "—"}</em>
                      </div>
                      <i aria-hidden="true">
                        <span style={{ width: `${metric.riskScore ?? 0}%` }} />
                      </i>
                    </div>
                  </button>
                </li>
              ))}
            </ol>
          </div>

          <dl className="risk-briefing-vitals" data-motion-stage>
            <div>
              <dt>有效指标</dt>
              <dd>
                {assessment.weightedScoredIndicatorCount}
                <small>/18</small>
              </dd>
            </div>
            <div>
              <dt>数据覆盖</dt>
              <dd>
                {coveragePercent}
                <small>%</small>
              </dd>
            </div>
            <div>
              <dt>风险事件</dt>
              <dd>
                {response.events.length}
                <small>条</small>
              </dd>
            </div>
            <div>
              <dt>叙事样本</dt>
              <dd>
                {response.narrativeNewsMetric?.retrievedCount ?? 0}
                <small>条</small>
              </dd>
            </div>
          </dl>
        </section>

        <div className="risk-briefing-followup">
          <section className="customer-risk-section customer-risk-actions">
            <header>
              <div>
                <span className="eyebrow">风险驱动 → 应对动作</span>
                <h3>建议优先执行这三项动作</h3>
              </div>
              <Badge variant="outline">由高影响指标自动触发</Badge>
            </header>
            <div className="automatic-action-grid">
              {recommendations.map((recommendation, index) => (
                <article
                  key={recommendation.indicatorId}
                  data-priority={recommendation.priority}
                  data-active={activeDriverId === recommendation.indicatorId}
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
          </section>

          {latestEvents.length ? (
            <section className="customer-risk-section risk-briefing-evidence">
              <header>
                <div>
                  <span className="eyebrow">Evidence pulse</span>
                  <h3>最新证据</h3>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onNavigate?.("realtime")}
                >
                  全部资讯
                </Button>
              </header>
              <div className="customer-risk-event-preview">
                {latestEvents.slice(0, 3).map((event) => (
                  <article key={event.id}>
                    <CalendarDaysIcon aria-hidden="true" />
                    <div>
                      <span>
                        {event.date ?? "日期待补充"} · {event.eventType}
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
            </section>
          ) : null}
        </div>

        <section className="customer-risk-section">
          <header>
            <div>
              <span className="eyebrow">风险结构</span>
              <h3>五大风险领域</h3>
            </div>
          </header>
          <div className="customer-risk-dimension-grid">
            {assessment.dimensionScores.map((dimension) => (
              <article
                key={dimension.id}
                data-tone={scoreTone(dimension.score)}
              >
                <div>
                  <span>{dimension.label}</span>
                  <strong>{dimension.score ?? "待评估"}</strong>
                </div>
                <div
                  className="customer-risk-dimension-track"
                  aria-hidden="true"
                >
                  <span style={{ width: `${dimension.score ?? 0}%` }} />
                </div>
                <small>
                  {dimension.availableIndicatorCount}/
                  {dimension.totalIndicatorCount} 项已有有效数据
                </small>
              </article>
            ))}
          </div>
        </section>

        <section className="customer-risk-report-banner">
          <div className="customer-risk-report-icon">
            <FileTextIcon aria-hidden="true" />
          </div>
          <div>
            <span className="eyebrow">风险报告</span>
            <h3>
              {response.reportAvailability?.latestReportTitle ??
                `${response.company.shortName}企业风险摘要`}
            </h3>
            <p>
              {response.reportAvailability
                ? `数据库已收录 ${response.reportAvailability.latestPeriod ?? "最新一期"} 正式报告，可与风险结论和事件资讯交叉核验。`
                : "查看风险摘要、重点指标、事件清单和已收录公开材料。"}
            </p>
          </div>
          <Button onClick={() => onNavigate?.("reports")}>
            查看风险报告 <ArrowRightIcon data-icon="inline-end" />
          </Button>
        </section>

        <NarrativeObservationPanel response={response} maximumNews={3} />
      </TabsContent>

      <TabsContent value="narrative">
        <NarrativeObservationPanel response={response} maximumNews={12} />
      </TabsContent>

      <TabsContent value="breakdown">
        <div className="customer-risk-tab-intro">
          <div>
            <span className="eyebrow">风险拆解</span>
            <h3>只展示已具备计算依据的指标</h3>
            <p>
              缺失数据不显示为
              0，不用占位卡干扰阅读；待补充清单统一放在“数据与方法”中。
            </p>
          </div>
          <Badge variant="outline">{scoredMetrics.length} 项可比较</Badge>
        </div>
        <div className="industry-risk-dimension-grid">
          {assessment.dimensionScores.map((dimension) => (
            <article key={dimension.id} data-tone={scoreTone(dimension.score)}>
              <span>{dimension.label}</span>
              <strong>{dimension.score ?? "—"}</strong>
              <small>
                {dimension.availableIndicatorCount}/
                {dimension.totalIndicatorCount}项 · 维度权重{" "}
                {percentFormatter.format(dimension.weight)}
              </small>
            </article>
          ))}
        </div>
        <div className="industry-risk-metric-grid">
          {scoredMetrics.map((metric) => {
            const source = metric.sourceId
              ? sourceById.get(metric.sourceId)
              : undefined
            const DirectionIcon =
              metric.direction === "higher-is-riskier"
                ? ArrowUpIcon
                : ArrowDownIcon
            return (
              <article
                key={metric.indicatorId}
                data-tone={scoreTone(metric.riskScore)}
              >
                <div className="industry-risk-metric-title">
                  <Badge variant="outline">{metric.indicatorId}</Badge>
                  <DirectionIcon aria-hidden="true" />
                </div>
                <h4>{metric.label}</h4>
                <div className="industry-risk-metric-value">
                  <strong>
                    {metric.rawValue === null
                      ? "待补充"
                      : numberFormatter.format(metric.rawValue)}
                  </strong>
                  <span>{metric.unit}</span>
                </div>
                <dl>
                  <div>
                    <dt>同业风险分位</dt>
                    <dd>
                      {metric.riskPercentile === null
                        ? "待补充"
                        : percentFormatter.format(metric.riskPercentile)}
                    </dd>
                  </div>
                  <div>
                    <dt>单指标风险分</dt>
                    <dd>{metric.riskScore ?? "待补充"}</dd>
                  </div>
                </dl>
                <details>
                  <summary>公式、来源与限制</summary>
                  <p>{metric.formulaTrace}</p>
                  <p>
                    {source
                      ? `${source.institution} · ${source.title}`
                      : "来源待核验"}
                  </p>
                  <p>{metric.limitation}</p>
                </details>
              </article>
            )
          })}
        </div>
      </TabsContent>

      <TabsContent value="events">
        <div className="customer-risk-tab-intro">
          <div>
            <span className="eyebrow">风险事件</span>
            <h3>数据库已收录的企业动态</h3>
            <p>
              每条信息保留类型、日期与原始链接，便于继续核验；不把抓取文本直接当作风险结论。
            </p>
          </div>
          <Button variant="outline" onClick={() => onNavigate?.("realtime")}>
            <NewspaperIcon data-icon="inline-start" />
            浏览风险资讯
          </Button>
        </div>
        <div className="industry-risk-event-list">
          {response.events.length ? (
            response.events.map((event) => (
              <article key={event.id}>
                <div>
                  <Badge variant="outline">{event.indicatorId ?? "事件"}</Badge>
                  <span>{event.eventType}</span>
                  <time>{event.date ?? "日期待核验"}</time>
                </div>
                <h4>{event.title}</h4>
                {event.url ? (
                  <a href={event.url} target="_blank" rel="noreferrer">
                    查看原始来源 <ExternalLinkIcon aria-hidden="true" />
                  </a>
                ) : null}
              </article>
            ))
          ) : (
            <div className="industry-risk-empty">
              <FileSearchIcon aria-hidden="true" />
              <p>当前数据快照没有结构化事件。</p>
            </div>
          )}
        </div>
      </TabsContent>

      <TabsContent value="method">
        <div className="customer-risk-method-note">
          <GaugeIcon aria-hidden="true" />
          <div>
            <strong>评分方法与数据状态</strong>
            <p>
              R05–R22 的可用指标进入同业 CRITIC 风险基准；R01–R04
              当前只展示东方财富新闻与报告文本代理观测，不计算风险分位、NRI或进入总分。单项缺失不补零，其余客观指标仍可参与计算。
            </p>
          </div>
          <div>
            <Badge variant="outline">Aₛₖ = 0.5</Badge>
            <Badge variant="outline">α = 0.5 · β = 0.5</Badge>
            <Badge variant="outline">方法版本 {assessment.methodVersion}</Badge>
          </div>
        </div>

        <section className="customer-risk-audit-section">
          <header>
            <div>
              <span className="eyebrow">待补充数据</span>
              <h3>{missingMetrics.length} 项暂不参与计算</h3>
              <p>这些项目没有显示为 0，也不会拉低企业总分。</p>
            </div>
          </header>
          <div className="customer-risk-missing-list">
            {missingMetrics.map((metric) => {
              const coverage = response.coverage.find(
                (item) => item.indicatorId === metric.indicatorId
              )
              return (
                <details key={metric.indicatorId}>
                  <summary>
                    <Badge variant="outline">{metric.indicatorId}</Badge>
                    <strong>{metric.label}</strong>
                    <span>待补充</span>
                  </summary>
                  <p>{coverage?.reason || metric.limitation}</p>
                  <small>
                    建议来源：
                    {coverage?.recommendedNextSource ||
                      "后续正式披露与可信公开来源"}
                  </small>
                </details>
              )
            })}
          </div>
        </section>

        <section className="customer-risk-audit-section">
          <header>
            <div>
              <span className="eyebrow">已纳入指标</span>
              <h3>公式、来源与计算限制</h3>
            </div>
          </header>
          <div className="customer-risk-audit-metrics">
            {scoredMetrics.map((metric) => {
              const source = metric.sourceId
                ? sourceById.get(metric.sourceId)
                : undefined
              const indicator = indicatorById.get(metric.indicatorId)
              return (
                <details key={metric.indicatorId}>
                  <summary>
                    <Badge variant="outline">{metric.indicatorId}</Badge>
                    <strong>{metric.label}</strong>
                    <span>风险分 {metric.riskScore}</span>
                  </summary>
                  <p>{indicator?.definition}</p>
                  <p>{metric.formulaTrace}</p>
                  <p>
                    {source
                      ? `${source.institution} · ${source.title}`
                      : "来源待核验"}
                  </p>
                  <small>{metric.limitation}</small>
                </details>
              )
            })}
          </div>
        </section>

        {response.reportAvailability ? (
          <article className="industry-risk-report-card">
            <span>正式报告覆盖</span>
            <strong>
              {response.reportAvailability.latestPeriod ?? "最新报告"}
            </strong>
            <p>{response.reportAvailability.latestReportTitle}</p>
            {response.reportAvailability.latestReportUrl ? (
              <a
                href={response.reportAvailability.latestReportUrl}
                target="_blank"
                rel="noreferrer"
              >
                查看正式报告 <ExternalLinkIcon aria-hidden="true" />
              </a>
            ) : null}
          </article>
        ) : null}
        <div className="industry-risk-source-list">
          {response.sources.map((source) => (
            <article key={source.id}>
              <Badge variant="outline">{source.sourceType}</Badge>
              <h4>{source.title}</h4>
              <p>{source.institution}</p>
              <small>
                {source.publicationDate ?? source.accessedAt ?? "日期待核验"}
              </small>
              {source.url ? (
                <a href={source.url} target="_blank" rel="noreferrer">
                  原始来源 <ExternalLinkIcon aria-hidden="true" />
                </a>
              ) : null}
            </article>
          ))}
        </div>
        <p className="customer-risk-data-note">
          共 {response.observations.length} 条指标观测、
          {response.supplementaryObservations.length} 条补充事实、
          {response.sources.length} 条来源。原始抓取和 OCR
          文本仅用于后台核验，不在客户默认页面直接展示。
        </p>
      </TabsContent>
    </Tabs>
  )
}

function narrativeToneLabel({
  positive,
  negative,
}: IndustryRiskAssessmentApiResponse["narrativeNews"][number]) {
  if (positive && negative) return "正负词均命中"
  if (negative) return "负向词命中"
  if (positive) return "正向词命中"
  return "未命中情绪词"
}

function narrativeTone({
  positive,
  negative,
}: IndustryRiskAssessmentApiResponse["narrativeNews"][number]) {
  if (positive && negative) return "mixed"
  if (negative) return "negative"
  if (positive) return "positive"
  return "neutral"
}

function NarrativeObservationPanel({
  response,
  maximumNews,
}: {
  response: IndustryRiskAssessmentApiResponse
  maximumNews: number
}) {
  const metric = response.narrativeNewsMetric
  const news = response.narrativeNews.slice(0, maximumNews)

  if (!metric) {
    return (
      <section className="narrative-observation narrative-observation-empty">
        <NewspaperIcon aria-hidden="true" />
        <div>
          <span className="eyebrow">主观叙事观察</span>
          <h3>当前企业尚无同口径财经新闻样本</h3>
          <p>本区域保持缺失，不用其他企业数据代替，也不生成叙事风险分。</p>
        </div>
        <Badge variant="outline">不计入总分</Badge>
      </section>
    )
  }

  const signals = [
    {
      label: "正向词典命中",
      count: metric.positiveCount,
      percent: metric.positiveSharePercent,
      tone: "positive",
    },
    {
      label: "负向词典命中",
      count: metric.negativeCount,
      percent: metric.negativeSharePercent,
      tone: "negative",
    },
    {
      label: "概念关键词命中",
      count: metric.conceptCount,
      percent: metric.conceptSharePercent,
      tone: "concept",
    },
  ]

  return (
    <section
      className="narrative-observation"
      aria-labelledby="narrative-title"
    >
      <header className="narrative-observation-header">
        <div>
          <span className="eyebrow">主观叙事观察 · 东方财富财经新闻</span>
          <h3 id="narrative-title">新闻叙事和客观风险分开呈现</h3>
          <p>
            这里展示规则词典命中与原始新闻样本，帮助识别值得继续阅读的叙事；不把搜索量或词语命中直接解释为风险。
          </p>
        </div>
        <div>
          <Badge variant="outline">R01–R04 观察区</Badge>
          <Badge variant="outline">不计算 NRI · 不进入总分</Badge>
        </div>
      </header>

      <div className="narrative-observation-grid">
        <div className="narrative-signal-card">
          <div className="narrative-sample-summary">
            <article>
              <span>已抓取样本</span>
              <strong>{metric.retrievedCount}</strong>
              <small>
                {metric.truncated ? "已达到抓取上限" : "当前窗口内样本"}
              </small>
            </article>
            <article>
              <span>覆盖媒体</span>
              <strong>{metric.mediaCount}</strong>
              <small>聚合结果中的媒体名称</small>
            </article>
          </div>
          <div className="narrative-signal-bars" aria-label="叙事词典命中率">
            {signals.map((signal) => (
              <article key={signal.label} data-tone={signal.tone}>
                <div>
                  <span>{signal.label}</span>
                  <strong>{signal.percent.toFixed(1)}%</strong>
                </div>
                <div className="narrative-signal-track" aria-hidden="true">
                  <span
                    style={{ width: `${Math.min(signal.percent, 100)}%` }}
                  />
                </div>
                <small>{signal.count} 条新闻命中；类别可能重叠</small>
              </article>
            ))}
          </div>
          <p className="narrative-method-boundary">
            当前标签由固定关键词词典生成，新闻搜索存在截断、转载和行情噪声；正式情绪模型和叙事风险公式确认前，本区域只做观察与来源下钻。
          </p>
        </div>

        <div className="narrative-news-card">
          <header>
            <div>
              <NewspaperIcon aria-hidden="true" />
              <div>
                <span>最新叙事样本</span>
                <strong>可返回原始新闻逐条阅读</strong>
              </div>
            </div>
            <small>
              {metric.oldestDate ?? "起始日待补充"} —{" "}
              {metric.newestDate ?? metric.cutoffDate}
            </small>
          </header>
          {news.length ? (
            <div className="narrative-news-list">
              {news.map((item) => (
                <a
                  key={item.id}
                  href={item.url}
                  target="_blank"
                  rel="noreferrer"
                  data-tone={narrativeTone(item)}
                >
                  <div>
                    <span>{item.mediaName || "媒体待识别"}</span>
                    <time>{item.publishedAt ?? "日期待补充"}</time>
                    <Badge variant="outline">{narrativeToneLabel(item)}</Badge>
                    {item.concept ? (
                      <Badge variant="outline">概念词命中</Badge>
                    ) : null}
                  </div>
                  <strong>{item.title}</strong>
                  {item.summary ? <p>{item.summary}</p> : null}
                  <ExternalLinkIcon aria-hidden="true" />
                </a>
              ))}
            </div>
          ) : (
            <div className="industry-risk-empty">
              <FileSearchIcon aria-hidden="true" />
              <p>已有新闻汇总，但本地运行快照尚无可展示的文章样本。</p>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
