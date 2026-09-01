import { useEffect, useState } from "react"
import {
  ArrowDownIcon,
  ArrowUpIcon,
  BookOpenCheckIcon,
  DatabaseZapIcon,
  EllipsisIcon,
  ExternalLinkIcon,
  InfoIcon,
  ListCollapseIcon,
} from "lucide-react"

import { IndustryRawFormula } from "@/components/dashboard/industry-raw-formula"
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
  formatIndicatorRawValue,
  indicatorRankAssessment,
  indicatorRankFromRiskPercentile,
  indicatorUnitExplanation,
  indicatorUnitLabel,
  riskPercentileFromAscendingRank,
  selectPeerRiskContext,
} from "@/lib/indicator-analysis"
import {
  fetchIndustryRiskAssessment,
  fetchIndustryRiskCompanies,
} from "@/lib/industry-risk-api"
import { displayIndustryLabel } from "@/lib/industry-label"
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

const percentFormatter = new Intl.NumberFormat("zh-CN", {
  style: "percent",
  maximumFractionDigits: 0,
})

export function IndicatorAnalysisTab({ companyId }: { companyId: string }) {
  const [state, setState] = useState<AnalysisState>({ status: "loading" })
  const [selectedIndicatorId, setSelectedIndicatorId] = useState<string | null>(
    null
  )
  const [expandedPeerMatrixCompanyId, setExpandedPeerMatrixCompanyId] =
    useState<string | null>(null)
  const peerMatrixExpanded = expandedPeerMatrixCompanyId === companyId

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
  const peerPool = directory.companies.filter(
    (company) => company.benchmarkGroupId === selectedCompany?.benchmarkGroupId
  )
  const peerContext = selectPeerRiskContext(peerPool, companyId)
  const peerMatrixRows = peerMatrixExpanded
    ? peerContext.expandedRows
    : peerContext.collapsedRows
  const hasCollapsedPeerRows = peerContext.collapsedRows.some(
    (row) => row.kind === "gap"
  )

  return (
    <div className="indicator-analysis page-stack">
      <header className="indicator-analysis__header">
        <div>
          <h2>{response.company.shortName}指标分析</h2>
        </div>
        <div className="indicator-analysis__meta">
          <Badge variant="outline">
            {displayIndustryLabel(response.assessment.benchmarkGroupLabel)}
          </Badge>
        </div>
      </header>

      <section className="indicator-analysis__overview">
        <article className="indicator-analysis__radar">
          <header>
            <div>
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
            <h3>同业风险分位矩阵</h3>
            <p>
              按综合风险从低到高排列，第 1 名风险最低；默认保留前 4
              名、当前企业前后各 2 名和最后 4
              名，重叠区间自动合并。指标单元格显示该项同业名次与相对表现。
            </p>
          </div>
          <div className="indicator-analysis__matrix-controls">
            <HeatLegend />
            {hasCollapsedPeerRows ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setExpandedPeerMatrixCompanyId((value) =>
                    value === companyId ? null : companyId
                  )
                }
              >
                {peerMatrixExpanded ? (
                  <ListCollapseIcon aria-hidden="true" />
                ) : (
                  <EllipsisIcon aria-hidden="true" />
                )}
                {peerMatrixExpanded ? "收起中间企业" : "展开全部企业"}
              </Button>
            ) : null}
          </div>
        </header>
        <div
          className="indicator-analysis__matrix-scroll"
          role="region"
          tabIndex={0}
        >
          <table>
            <thead>
              <tr>
                <th>风险名次 / 企业</th>
                {weightedMetrics.map((metric) => (
                  <th key={metric.indicatorId}>
                    <abbr title={`${metric.indicatorId} · ${metric.label}`}>
                      {metric.indicatorId}
                    </abbr>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {peerMatrixRows.map((row) => {
                if (row.kind === "gap") {
                  return (
                    <tr
                      key={`gap-${row.fromRank}-${row.toRank}`}
                      className="indicator-analysis__matrix-gap-row"
                    >
                      <td colSpan={weightedMetrics.length + 1}>
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedPeerMatrixCompanyId(companyId)
                          }
                          aria-label={`展开第 ${row.fromRank} 至 ${row.toRank} 名企业`}
                        >
                          <EllipsisIcon aria-hidden="true" />
                          <span>
                            第 {row.fromRank}–{row.toRank} 名 · {row.count}{" "}
                            家企业
                          </span>
                        </button>
                      </td>
                    </tr>
                  )
                }
                const { company, rank } = row
                const overallPercentile = riskPercentileFromAscendingRank(
                  rank,
                  peerContext.ranked.length
                )
                return (
                  <tr
                    key={company.companyId}
                    data-active={company.companyId === companyId}
                  >
                    <th
                      scope="row"
                      data-missing={overallPercentile === null}
                      style={heatStyle(overallPercentile)}
                      title={`${company.companyName} · 综合风险第 ${rank} 名 · ${riskHeatLabel(overallPercentile)}`}
                    >
                      <span className="indicator-analysis__company-name">
                        <strong className="indicator-analysis__company-rank">
                          {rank}
                        </strong>
                        <span>{company.companyName}</span>
                        {company.companyId === companyId ? (
                          <Badge variant="outline">当前</Badge>
                        ) : null}
                      </span>
                    </th>
                    {weightedMetrics.map((metric) => {
                      const heat = company.indicatorHeat.find(
                        (item) => item.indicatorId === metric.indicatorId
                      )
                      const indicatorRank = indicatorRankFromRiskPercentile(
                        heat?.riskPercentile ?? null,
                        heat?.sampleSize ?? 0
                      )
                      const rankAssessment = indicatorRankAssessment(
                        indicatorRank,
                        heat?.sampleSize ?? 0
                      )
                      return (
                        <td
                          key={metric.indicatorId}
                          data-missing={indicatorRank === null}
                          style={heatStyle(heat?.riskPercentile ?? null)}
                          title={`${company.companyName} · ${metric.indicatorId} ${metric.label} · ${
                            indicatorRank === null
                              ? "缺失"
                              : `第 ${indicatorRank}/${heat?.sampleSize ?? 0} 名 · ${rankAssessment}`
                          }`}
                        >
                          {indicatorRank === null ? (
                            "—"
                          ) : (
                            <>
                              <span className="indicator-analysis__indicator-rank">
                                <strong>{indicatorRank}</strong>
                                <small>/{heat?.sampleSize ?? 0}</small>
                              </span>
                              <small className="indicator-analysis__rank-analysis">
                                {rankAssessment}
                              </small>
                            </>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="indicator-analysis__table-section">
        <header>
          <div>
            <h3>指标明细与同业评分</h3>
          </div>
          <Badge variant="outline">点击行查看公式与来源</Badge>
        </header>
        <div
          className="indicator-analysis__table-scroll"
          role="region"
          tabIndex={0}
        >
          <table>
            <colgroup>
              <col className="indicator-analysis__col-metric" />
              <col className="indicator-analysis__col-value" />
              <col className="indicator-analysis__col-direction" />
              <col className="indicator-analysis__col-percentile" />
              <col className="indicator-analysis__col-score" />
              <col className="indicator-analysis__col-sample" />
            </colgroup>
            <thead>
              <tr>
                <th>指标</th>
                <th>原值</th>
                <th>风险方向</th>
                <th>同业分位</th>
                <th>风险分</th>
                <th>样本</th>
              </tr>
            </thead>
            <tbody>
              {weightedMetrics.map((metric) => {
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
                      <span
                        className="indicator-analysis__raw-value"
                        data-missing={metric.rawValue === null}
                      >
                        <strong>
                          {formatIndicatorRawValue(metric.rawValue)}
                        </strong>
                        {metric.rawValue === null ? null : (
                          <small title={indicatorUnitExplanation(metric.unit)}>
                            {indicatorUnitLabel(metric.unit)}
                          </small>
                        )}
                      </span>
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
                    <td className="indicator-analysis__numeric">
                      {metric.riskScore?.toFixed(2) ?? "—"}
                    </td>
                    <td>n={metric.sampleSize}</td>
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
              <MethodBlock
                title="方法含义、计算链路与影响因素"
                icon={BookOpenCheckIcon}
              >
                <FormulaStage
                  step="第一步"
                  title="原始指标计算"
                  description="由企业披露与证据字段计算原始指标值；这里的变量决定该指标实际衡量什么。"
                >
                  <RawMetricFormula
                    formula={indicator?.rawValueFormula}
                    metric={metric}
                  />
                </FormulaStage>
                <FormulaStage
                  step="第二步"
                  title="风险分换算"
                  description="将原始值按风险方向转换为同业分位，再与行业风险锚点合成为 0–100 风险分。"
                >
                  <RiskScoreFormula metric={metric} response={response} />
                </FormulaStage>
                <div className="indicator-method-sheet__notes">
                  <strong>数据口径与限制</strong>
                  <p>{metric.limitation}</p>
                  {metric.missingReason ? <p>{metric.missingReason}</p> : null}
                </div>
                <dl>
                  <div>
                    <dt>原值</dt>
                    <dd>
                      {formatIndicatorRawValue(metric.rawValue)}
                      {metric.rawValue === null
                        ? null
                        : ` ${indicatorUnitLabel(metric.unit)}`}
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
                    <dd>{metric.riskScore?.toFixed(2) ?? "缺失"}</dd>
                  </div>
                </dl>
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

function FormulaStage({
  step,
  title,
  description,
  children,
}: {
  step: string
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <section className="indicator-method-sheet__stage">
      <header>
        <span>{step}</span>
        <div>
          <h4>{title}</h4>
          <p>{description}</p>
        </div>
      </header>
      {children}
    </section>
  )
}

function RawMetricFormula({
  formula,
  metric,
}: {
  formula?: string
  metric: IndustryRiskMetricScore
}) {
  const directionLabel =
    metric.direction === "higher-is-riskier"
      ? "原值越高，风险越高"
      : "原值越低，风险越高"
  return (
    <div className="indicator-method-sheet__raw-method">
      <IndustryRawFormula
        indicatorId={metric.indicatorId}
        rawValueFormula={formula}
      />
      <dl className="indicator-method-sheet__raw-factors">
        <div>
          <dt>当前原值</dt>
          <dd>
            {formatIndicatorRawValue(metric.rawValue)}
            {metric.rawValue === null
              ? null
              : ` ${indicatorUnitLabel(metric.unit)}`}
          </dd>
        </div>
        <div>
          <dt>风险方向</dt>
          <dd>{directionLabel}</dd>
        </div>
        <div>
          <dt>可比样本</dt>
          <dd>n={metric.sampleSize}</dd>
        </div>
      </dl>
    </div>
  )
}

function RiskScoreFormula({
  metric,
  response,
}: {
  metric: IndustryRiskMetricScore
  response: IndustryRiskAssessmentApiResponse
}) {
  const { alpha, beta, industryRisk } = response.assessment
  const percentile = metric.riskPercentile
  return (
    <div className="indicator-method-sheet__formula">
      <div
        className="indicator-method-sheet__equation"
        role="math"
        aria-label="R 下标 i 等于一百乘以 alpha 乘行业风险锚点加 beta 乘同业风险分位"
      >
        <var>
          R<sub>i</sub>
        </var>
        <span>=</span>
        <span>100</span>
        <span>×</span>
        <span>(</span>
        <var>α</var>
        <span>×</span>
        <var>H</var>
        <span>+</span>
        <var>β</var>
        <span>×</span>
        <var>
          P<sub>i</sub>
        </var>
        <span>)</span>
      </div>
      {percentile === null ? (
        <p className="indicator-method-sheet__substitution">
          当前原值或同业样本不足，因此不代入公式，也不补零。
        </p>
      ) : (
        <p className="indicator-method-sheet__substitution">
          本次代入：100 × ({alpha} × {industryRisk} + {beta} × {percentile}) ={" "}
          <strong>{metric.riskScore?.toFixed(2)}</strong>
        </p>
      )}
      <dl className="indicator-method-sheet__parameters">
        <div>
          <dt>Rᵢ</dt>
          <dd>第 i 项指标风险分，范围 0–100</dd>
        </div>
        <div>
          <dt>H</dt>
          <dd>行业风险锚点，本次为 {industryRisk}</dd>
        </div>
        <div>
          <dt>Pᵢ</dt>
          <dd>按风险方向调整后的同业风险分位</dd>
        </div>
        <div>
          <dt>α / β</dt>
          <dd>
            行业锚点与同业分位权重，本次为 {alpha} / {beta}
          </dd>
        </div>
      </dl>
    </div>
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
