import { useEffect, useMemo, useState } from "react"
import {
  ArrowDownIcon,
  ArrowUpIcon,
  BarChart3Icon,
  DatabaseZapIcon,
  ExternalLinkIcon,
  FileSearchIcon,
  InfoIcon,
  RefreshCwIcon,
} from "lucide-react"

import { GlassPanel } from "@/components/dashboard/shared"
import { Reveal } from "@/components/motion/workflow-transition"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type {
  IndustryRiskAssessmentApiResponse,
  IndustryRiskCompanyDirectoryResponse,
  IndustryRiskObservation,
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

function latestObservation(observations: IndustryRiskObservation[]) {
  return [...observations].sort((left, right) =>
    (
      right.asOfDate ??
      right.periodEnd ??
      right.periodStart ??
      ""
    ).localeCompare(left.asOfDate ?? left.periodEnd ?? left.periodStart ?? "")
  )[0]
}

function observationValue(observation: IndustryRiskObservation | undefined) {
  if (!observation) return "—"
  if (observation.numericValue !== null) {
    return `${numberFormatter.format(observation.numericValue)}${observation.unit ? ` ${observation.unit}` : ""}`
  }
  return observation.textValue || observation.status || "—"
}

function coverageTone(status: string) {
  if (status === "已覆盖") return "low"
  if (status.startsWith("部分覆盖")) return "medium"
  return "unknown"
}

export function IndustryRiskReviewPanel({ companyId }: { companyId: string }) {
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
    <Reveal>
      <GlassPanel
        className="industry-risk-workspace"
        surfaceClassName="industry-risk-workspace-glass"
        variant="floating"
        aria-labelledby="industry-risk-title"
      >
        <header className="industry-risk-header">
          <div>
            <span className="eyebrow">最新公式 · R01–R22 同业基准</span>
            <h2 id="industry-risk-title">
              {selectedSummary?.companyName ?? "当前企业"}风险基准
            </h2>
            <p>
              当前企业是主视图；行业样本只用于风险分位、CRITIC权重和排名参考，单项缺失不阻断其余指标与总分。
            </p>
          </div>
          <div className="industry-risk-formula-summary">
            <Badge variant="outline">Aₛₖ = 0.5</Badge>
            <Badge variant="outline">α = 0.5 · β = 0.5</Badge>
            <Badge variant="outline">两级 CRITIC</Badge>
          </div>
        </header>

        <div className="industry-risk-scope-strip">
          <span>{selectedSummary?.benchmarkGroupLabel ?? "行业基准"}</span>
          <span>{selectedSummary?.benchmarkSampleSize ?? 0} 家同业样本</span>
          <span>当前排名 {selectedRank || "—"}</span>
          <span>R01–R04 仅形成 NRI</span>
          <Badge variant="outline">数据截至 2026-08-19</Badge>
        </div>

        <div className="industry-risk-body">
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
              <li key={company.companyId} data-active={company.companyId === companyId}>
                <span>{index + 1}</span>
                <strong>{company.companyName}</strong>
                <small>{company.stockCode}</small>
                <b>{company.totalRiskScore ?? "—"}</b>
              </li>
            ))}
          </ol>
        </details>
      </GlassPanel>
    </Reveal>
  )
}

function IndustryRiskAssessmentContent({
  response,
}: {
  response: IndustryRiskAssessmentApiResponse
}) {
  const { assessment } = response
  const sourceById = new Map(
    response.sources.map((source) => [source.id, source])
  )
  const observationsByIndicator = new Map(
    response.indicators.map((indicator) => [
      indicator.id,
      response.observations.filter((item) => item.indicatorId === indicator.id),
    ])
  )

  return (
    <Tabs defaultValue="indicators" className="industry-risk-detail-tabs">
      <TabsList aria-label="R01到R22企业数据">
        <TabsTrigger value="indicators">22项指标</TabsTrigger>
        <TabsTrigger value="scoring">风险分基准</TabsTrigger>
        <TabsTrigger value="events">事件 {response.events.length}</TabsTrigger>
        <TabsTrigger value="evidence">
          来源 {response.sources.length}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="indicators">
        <CompanySummary response={response} />
        <div className="industry-risk-indicator-grid">
          {response.indicators.map((indicator) => {
            const coverage = response.coverage.find(
              (item) => item.indicatorId === indicator.id
            )
            const observations = observationsByIndicator.get(indicator.id) ?? []
            const latest = latestObservation(observations)
            const source = latest ? sourceById.get(latest.sourceId) : undefined
            return (
              <article
                key={indicator.id}
                data-tone={coverageTone(coverage?.status ?? "")}
              >
                <div className="industry-risk-metric-title">
                  <Badge variant="outline">{indicator.id}</Badge>
                  <span>{coverage?.status ?? "NA"}</span>
                </div>
                <h4>{indicator.label}</h4>
                <strong className="industry-risk-observation-value">
                  {observationValue(latest)}
                </strong>
                <small>
                  {latest?.asOfDate ??
                    latest?.periodEnd ??
                    latest?.periodStart ??
                    "暂无观测日期"}
                  {observations.length
                    ? ` · ${observations.length} 条观测`
                    : ""}
                </small>
                <details>
                  <summary>口径、来源与缺口</summary>
                  <p>{indicator.definition}</p>
                  <p>{indicator.rawValueFormula}</p>
                  <p>{coverage?.reason || "暂无覆盖说明"}</p>
                  <p>
                    {source
                      ? `${source.institution} · ${source.title}`
                      : "来源待补"}
                  </p>
                </details>
              </article>
            )
          })}
        </div>
      </TabsContent>

      <TabsContent value="scoring">
        <CompanySummary response={response} />
        <div className="industry-risk-current-score">
          <article data-tone={scoreTone(assessment.totalRiskScore)}>
            <span>当前企业 CRITIC 基准分</span>
            <strong>{assessment.totalRiskScore ?? "—"}</strong>
            <small>
              现有 {assessment.weightedScoredIndicatorCount}/18 项加权指标 ·
              缺失不补零
            </small>
          </article>
          <article data-tone={scoreTone(assessment.narrativeIndex.score)}>
            <span>NRI 叙事风险指数</span>
            <strong>{assessment.narrativeIndex.score ?? "—"}</strong>
            <small>
              {assessment.narrativeIndex.availableIndicatorCount}/4 项 ·
              不进入总分
            </small>
          </article>
          <article>
            <span>行业参考</span>
            <strong>{assessment.benchmarkSampleSize}</strong>
            <small>{assessment.benchmarkGroupLabel}</small>
          </article>
        </div>
        <div className="industry-risk-candidate-scores">
          {assessment.candidateAggregates.map((aggregate) => (
            <article
              key={aggregate.method}
              data-tone={scoreTone(aggregate.score)}
            >
              <span>
                {aggregate.method === "critic" ? "CRITIC 总分" : "熵权稳健性对照"}
              </span>
              <strong>{aggregate.score ?? "—"}</strong>
              <small>{aggregate.note}</small>
            </article>
          ))}
        </div>
        <div className="industry-risk-dimension-grid">
          {assessment.dimensionScores.map((dimension) => (
            <article key={dimension.id} data-tone={scoreTone(dimension.score)}>
              <span>{dimension.label}</span>
              <strong>{dimension.score ?? "—"}</strong>
              <small>
                {dimension.availableIndicatorCount}/{dimension.totalIndicatorCount}
                项 · 维度权重 {percentFormatter.format(dimension.weight)}
              </small>
            </article>
          ))}
        </div>
        <div className="industry-risk-metric-grid">
          {assessment.metrics.map((metric) => {
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
                      ? "—"
                      : numberFormatter.format(metric.rawValue)}
                  </strong>
                  <span>{metric.unit}</span>
                </div>
                <dl>
                  <div>
                    <dt>同业风险分位</dt>
                    <dd>
                      {metric.riskPercentile === null
                        ? "—"
                        : percentFormatter.format(metric.riskPercentile)}
                    </dd>
                  </div>
                  <div>
                    <dt>单指标风险分</dt>
                    <dd>{metric.riskScore ?? "—"}</dd>
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
        <CompanySummary response={response} />
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
                <p>{event.notes}</p>
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

      <TabsContent value="evidence">
        <CompanySummary response={response} />
        {response.reportAvailability ? (
          <article className="industry-risk-report-card">
            <span>正式报告覆盖</span>
            <strong>
              {response.reportAvailability.latestPeriod ?? "最新报告"}
            </strong>
            <p>{response.reportAvailability.latestReportTitle}</p>
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
      </TabsContent>
    </Tabs>
  )
}

function CompanySummary({
  response,
}: {
  response: IndustryRiskAssessmentApiResponse
}) {
  const covered = response.coverage.filter(
    (item) => !item.status.startsWith("NA")
  ).length
  return (
    <div className="industry-risk-company-summary">
      <div>
        <span>{response.assessment.sectorLabel}</span>
        <h3>{response.company.shortName}</h3>
        <p>{response.company.fullName}</p>
      </div>
      <dl className="industry-risk-company-stats">
        <div>
          <dt>指标覆盖</dt>
          <dd>{covered}/22</dd>
        </div>
        <div>
          <dt>主观测</dt>
          <dd>{response.observations.length}</dd>
        </div>
        <div>
          <dt>补充事实</dt>
          <dd>{response.supplementaryObservations.length}</dd>
        </div>
        <div>
          <dt>事件</dt>
          <dd>{response.events.length}</dd>
        </div>
        <div>
          <dt>CRITIC基准分</dt>
          <dd>{response.assessment.totalRiskScore ?? "—"}</dd>
        </div>
      </dl>
    </div>
  )
}
