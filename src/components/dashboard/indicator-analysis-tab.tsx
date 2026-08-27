import { useEffect, useState } from "react"
import {
  ArrowDownIcon,
  ArrowUpIcon,
  BookOpenCheckIcon,
  DatabaseZapIcon,
  ExternalLinkIcon,
  InfoIcon,
} from "lucide-react"

import { IndustryRiskRadar } from "@/components/dashboard/industry-risk-radar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import type {
  IndustryRiskAssessmentApiResponse,
  IndustryRiskCompanyDirectoryResponse,
  IndustryRiskMetricScore,
} from "@/domain/industry-risk-v1/index.ts"
import {
  fetchIndustryRiskAssessment,
  fetchIndustryRiskCompanies,
} from "@/lib/industry-risk-api"
import { riskHeatColor, riskHeatLabel } from "@/lib/risk-heat"
import "@/styles/indicator-analysis.css"

type AnalysisState =
  | { status: "loading" }
  | {
      status: "success"
      directory: IndustryRiskCompanyDirectoryResponse
      response: IndustryRiskAssessmentApiResponse
    }
  | { status: "error"; message: string }

const numberFormatter = new Intl.NumberFormat("zh-CN", {
  maximumFractionDigits: 4,
})
const percentFormatter = new Intl.NumberFormat("zh-CN", {
  style: "percent",
  maximumFractionDigits: 0,
})

export function IndicatorAnalysisTab({ companyId }: { companyId: string }) {
  const [state, setState] = useState<AnalysisState>({ status: "loading" })
  const [selectedIndicatorId, setSelectedIndicatorId] = useState<string | null>(
    null
  )

  useEffect(() => {
    const controller = new AbortController()
    void Promise.all([
      fetchIndustryRiskCompanies({ signal: controller.signal }),
      fetchIndustryRiskAssessment(companyId, { signal: controller.signal }),
    ])
      .then(([directory, response]) => {
        if (response.company.id !== companyId) return
        setState({ status: "success", directory, response })
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setState({
          status: "error",
          message:
            error instanceof Error ? error.message : "指标分析暂时无法加载。",
        })
      })
    return () => controller.abort()
  }, [companyId])

  if (
    state.status === "loading" ||
    (state.status === "success" && state.response.company.id !== companyId)
  ) {
    return (
      <AnalysisStatePanel
        icon={DatabaseZapIcon}
        text="正在装载指标与同业热力…"
      />
    )
  }
  if (state.status === "error") {
    return <AnalysisStatePanel icon={InfoIcon} text={state.message} />
  }

  const { directory, response } = state
  const weightedMetrics = response.assessment.metrics.filter(
    (metric) => metric.kind === "weighted"
  )
  const selectedMetric = weightedMetrics.find(
    (metric) => metric.indicatorId === selectedIndicatorId
  )
  const selectedCompany = directory.companies.find(
    (company) => company.companyId === companyId
  )
  const peers = directory.companies
    .filter(
      (company) =>
        company.benchmarkGroupId === selectedCompany?.benchmarkGroupId
    )
    .sort((left, right) => {
      if (left.companyId === companyId) return -1
      if (right.companyId === companyId) return 1
      return (right.totalRiskScore ?? -1) - (left.totalRiskScore ?? -1)
    })
    .slice(0, 12)

  return (
    <div className="indicator-analysis page-stack">
      <header className="indicator-analysis__header">
        <div>
          <span className="eyebrow">Objective indicator analytics</span>
          <h2>{response.company.shortName}指标分析</h2>
          <p>
            R05–R22
            客观指标按统一同业口径呈现。颜色只编码同业风险分位，数值仍显示真实原值和风险分；缺失保持空值。
          </p>
        </div>
        <div className="indicator-analysis__meta">
          <Badge variant="outline">
            {response.assessment.benchmarkGroupLabel}
          </Badge>
          <span>方法 {response.assessment.methodVersion}</span>
          <span>截至 {response.provenance.sourceDate}</span>
        </div>
      </header>

      <section className="indicator-analysis__overview">
        <article className="indicator-analysis__radar">
          <header>
            <div>
              <span className="eyebrow">Risk structure</span>
              <h3>五域客观风险雷达</h3>
            </div>
            <Badge variant="outline">
              {response.assessment.weightedScoredIndicatorCount}/18 可评分
            </Badge>
          </header>
          <IndustryRiskRadar dimensions={response.assessment.dimensionScores} />
        </article>

        <article className="indicator-analysis__heat-strip">
          <header>
            <div>
              <span className="eyebrow">Peer percentile heat</span>
              <h3>本企业指标热力</h3>
            </div>
            <HeatLegend />
          </header>
          <div className="indicator-analysis__heat-grid">
            {weightedMetrics.map((metric) => (
              <button
                key={metric.indicatorId}
                type="button"
                data-missing={metric.riskPercentile === null}
                style={heatStyle(metric.riskPercentile)}
                onClick={() => setSelectedIndicatorId(metric.indicatorId)}
                aria-label={`${metric.indicatorId} ${metric.label}：${riskHeatLabel(metric.riskPercentile)}`}
              >
                <span>{metric.indicatorId}</span>
                <strong>
                  {metric.riskPercentile === null
                    ? "—"
                    : percentFormatter.format(metric.riskPercentile)}
                </strong>
                <small>{metric.label}</small>
              </button>
            ))}
          </div>
        </article>
      </section>

      <section className="indicator-analysis__peer-matrix">
        <header>
          <div>
            <span className="eyebrow">Cross-company view</span>
            <h3>同业风险分位矩阵</h3>
            <p>固定 0–100 色标，不按单个企业重新拉伸；灰色斜纹表示缺失。</p>
          </div>
          <HeatLegend />
        </header>
        <div
          className="indicator-analysis__matrix-scroll"
          role="region"
          tabIndex={0}
        >
          <table>
            <thead>
              <tr>
                <th>企业</th>
                {weightedMetrics.map((metric) => (
                  <th key={metric.indicatorId}>{metric.indicatorId}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {peers.map((company) => (
                <tr
                  key={company.companyId}
                  data-active={company.companyId === companyId}
                >
                  <th scope="row">
                    <strong>{company.companyName}</strong>
                    <small>{company.stockCode}</small>
                  </th>
                  {weightedMetrics.map((metric) => {
                    const heat = company.indicatorHeat.find(
                      (item) => item.indicatorId === metric.indicatorId
                    )
                    return (
                      <td
                        key={metric.indicatorId}
                        data-missing={heat?.riskPercentile == null}
                        style={heatStyle(heat?.riskPercentile ?? null)}
                        title={`${company.companyName} · ${metric.indicatorId} · ${
                          heat?.riskPercentile == null
                            ? "缺失"
                            : percentFormatter.format(heat.riskPercentile)
                        } · n=${heat?.sampleSize ?? 0}`}
                      >
                        {heat?.riskPercentile == null
                          ? "—"
                          : Math.round(heat.riskPercentile * 100)}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="indicator-analysis__table-section">
        <header>
          <div>
            <span className="eyebrow">Metric ledger</span>
            <h3>指标明细、样本与观测序列</h3>
          </div>
          <Badge variant="outline">点击行查看公式与来源</Badge>
        </header>
        <div
          className="indicator-analysis__table-scroll"
          role="region"
          tabIndex={0}
        >
          <table>
            <thead>
              <tr>
                <th>指标</th>
                <th>原值</th>
                <th>风险方向</th>
                <th>同业分位</th>
                <th>风险分</th>
                <th>样本</th>
                <th>已披露观测</th>
              </tr>
            </thead>
            <tbody>
              {weightedMetrics.map((metric) => {
                const isR17LowRiskFloor =
                  metric.metricName ===
                  "no_identified_external_supplier_floor"
                const observations = response.observations
                  .filter(
                    (observation) =>
                      observation.indicatorId === metric.indicatorId &&
                      typeof observation.numericValue === "number"
                  )
                  .sort((left, right) =>
                    (left.asOfDate ?? left.periodEnd ?? "").localeCompare(
                      right.asOfDate ?? right.periodEnd ?? ""
                    )
                  )
                const DirectionIcon =
                  metric.direction === "higher-is-riskier"
                    ? ArrowUpIcon
                    : ArrowDownIcon
                return (
                  <tr
                    key={metric.indicatorId}
                    data-missing={metric.riskScore === null}
                    onClick={() => setSelectedIndicatorId(metric.indicatorId)}
                  >
                    <th scope="row">
                      <button type="button">
                        <Badge variant="outline">{metric.indicatorId}</Badge>
                        <span>{metric.label}</span>
                      </button>
                    </th>
                    <td>
                      {metric.rawValue === null
                        ? "缺失"
                        : `${numberFormatter.format(metric.rawValue)} ${metric.unit}`}
                    </td>
                    <td>
                      <DirectionIcon aria-hidden="true" />
                      {metric.direction === "higher-is-riskier"
                        ? "值越高风险越高"
                        : "值越低风险越高"}
                    </td>
                    <td>
                      <span
                        className="indicator-analysis__heat-pill"
                        data-missing={metric.riskPercentile === null}
                        style={heatStyle(metric.riskPercentile)}
                      >
                        {metric.riskPercentile === null
                          ? "—"
                          : percentFormatter.format(metric.riskPercentile)}
                      </span>
                    </td>
                    <td>{metric.riskScore ?? "—"}</td>
                    <td>
                      {isR17LowRiskFloor
                        ? "保底规则"
                        : `n=${metric.sampleSize}`}
                    </td>
                    <td>
                      {isR17LowRiskFloor ? (
                        <span>明确零值</span>
                      ) : (
                        <ObservationDots
                          values={observations.map(
                            (item) => item.numericValue!
                          )}
                        />
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      <MetricMethodSheet
        metric={selectedMetric ?? null}
        response={response}
        onOpenChange={(open) => {
          if (!open) setSelectedIndicatorId(null)
        }}
      />
    </div>
  )
}

function MetricMethodSheet({
  metric,
  response,
  onOpenChange,
}: {
  metric: IndustryRiskMetricScore | null
  response: IndustryRiskAssessmentApiResponse
  onOpenChange: (open: boolean) => void
}) {
  const indicator = response.indicators.find(
    (item) => item.id === metric?.indicatorId
  )
  const observations = response.observations.filter(
    (item) => item.indicatorId === metric?.indicatorId
  )
  const isR17LowRiskFloor =
    metric?.metricName === "no_identified_external_supplier_floor"
  const sourceIds = new Set(metric?.sourceIds ?? [])
  observations.forEach((item) => {
    sourceIds.add(item.sourceId)
    item.sourceIds?.forEach((sourceId) => sourceIds.add(sourceId))
  })
  const sources = response.sources.filter((source) => sourceIds.has(source.id))

  return (
    <Sheet open={Boolean(metric)} onOpenChange={onOpenChange}>
      <SheetContent
        size="signal"
        className="method-sheet indicator-method-sheet"
      >
        {metric ? (
          <>
            <SheetHeader>
              <div className="signal-drawer-badges">
                <Badge variant="outline">{metric.indicatorId}</Badge>
                <Badge variant="outline">
                  {isR17LowRiskFloor
                    ? "明确零值保底"
                    : `n=${metric.sampleSize}`}
                </Badge>
                <Badge variant="outline">
                  {riskHeatLabel(metric.riskPercentile)}
                </Badge>
              </div>
              <SheetTitle>{metric.label}</SheetTitle>
              <SheetDescription>{indicator?.definition}</SheetDescription>
            </SheetHeader>
            <div className="sheet-scroll-content indicator-method-sheet__content">
              <MethodBlock title="本次计算" icon={BookOpenCheckIcon}>
                <p>{metric.formulaTrace}</p>
                <dl>
                  <div>
                    <dt>原值</dt>
                    <dd>
                      {metric.rawValue === null
                        ? "缺失"
                        : `${numberFormatter.format(metric.rawValue)} ${metric.unit}`}
                    </dd>
                  </div>
                  <div>
                    <dt>同业风险分位</dt>
                    <dd>
                      {metric.riskPercentile === null
                        ? "缺失"
                        : percentFormatter.format(metric.riskPercentile)}
                    </dd>
                  </div>
                  <div>
                    <dt>单指标风险分</dt>
                    <dd>{metric.riskScore ?? "缺失"}</dd>
                  </div>
                </dl>
              </MethodBlock>
              <MethodBlock title="方法含义" icon={InfoIcon}>
                <p>{indicator?.rawValueFormula}</p>
                <p>{metric.limitation}</p>
                {metric.missingReason ? <p>{metric.missingReason}</p> : null}
              </MethodBlock>
              <MethodBlock
                title={`原始观测（${observations.length}）`}
                icon={DatabaseZapIcon}
              >
                {observations.length ? (
                  <ol>
                    {observations.map((observation) => (
                      <li key={observation.id}>
                        <strong>{observation.metricName}</strong>
                        <span>
                          {observation.numericValue ??
                            observation.textValue ??
                            "缺失"}{" "}
                          {observation.unit}
                        </span>
                        <small>
                          {observation.periodStart ?? ""}–
                          {observation.periodEnd ??
                            observation.asOfDate ??
                            "期间待补"}
                        </small>
                      </li>
                    ))}
                  </ol>
                ) : isR17LowRiskFloor ? (
                  <p>
                    本项由已披露的供应商采购暴露零值触发，代理原值为0；完整判定依据见“本次计算”和“证据来源”。
                  </p>
                ) : (
                  <p>当前没有可展示观测；不会以 0 代替。</p>
                )}
              </MethodBlock>
              <MethodBlock
                title={`证据来源（${sources.length}）`}
                icon={ExternalLinkIcon}
              >
                {sources.length ? (
                  <ol>
                    {sources.map((source) => (
                      <li key={source.id}>
                        <strong>{source.title}</strong>
                        <span>{source.institution}</span>
                        {source.url ? (
                          <Button variant="link" size="sm" asChild>
                            <a
                              href={source.url}
                              target="_blank"
                              rel="noreferrer"
                            >
                              打开原始来源{" "}
                              <ExternalLinkIcon data-icon="inline-end" />
                            </a>
                          </Button>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p>当前指标来源尚未进入对外展示清单。</p>
                )}
              </MethodBlock>
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}

function MethodBlock({
  title,
  icon: Icon,
  children,
}: {
  title: string
  icon: typeof InfoIcon
  children: React.ReactNode
}) {
  return (
    <section>
      <h3>
        <Icon aria-hidden="true" /> {title}
      </h3>
      {children}
    </section>
  )
}

function ObservationDots({ values }: { values: number[] }) {
  const visible = values.slice(-6)
  if (!visible.length)
    return <span className="indicator-analysis__no-trend">无</span>
  const minimum = Math.min(...visible)
  const maximum = Math.max(...visible)
  const range = maximum - minimum || 1
  return (
    <svg
      viewBox="0 0 112 28"
      role="img"
      aria-label={`${visible.length} 个已披露观测点`}
    >
      {visible.map((value, index) => (
        <circle
          key={`${index}-${value}`}
          cx={
            visible.length === 1 ? 56 : 7 + (index / (visible.length - 1)) * 98
          }
          cy={21 - ((value - minimum) / range) * 14}
          r="3.2"
        />
      ))}
    </svg>
  )
}

function HeatLegend() {
  return (
    <div className="risk-heat-legend" aria-label="同业风险分位图例">
      <span>低</span>
      <i aria-hidden="true" />
      <span>高</span>
    </div>
  )
}

function AnalysisStatePanel({
  icon: Icon,
  text,
}: {
  icon: typeof InfoIcon
  text: string
}) {
  return (
    <div className="industry-risk-state" role="status">
      <Icon aria-hidden="true" />
      <p>{text}</p>
    </div>
  )
}

function heatStyle(percentile: number | null) {
  return {
    "--risk-heat-color": riskHeatColor(percentile),
  } as React.CSSProperties
}
