import {
  Building2Icon,
  DatabaseIcon,
  FileCheck2Icon,
  LineChartIcon,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import type {
  NarrativeIndustryCompany,
  NarrativeIndustryMethodologyItem,
  NarrativeIndustryObservation,
  NarrativeIndustryStatistic,
  NarrativeIndustryTrendResponse,
} from "@/domain/narrative-risk-v1"
import {
  calculateNarrativeAnnualDisplayScores,
  calculateWeightedNarrativeDisplayScore,
} from "@/domain/narrative-risk-v1/industry-display-score"

const YEARS = [2021, 2022, 2023, 2024, 2025]
const METRIC_COLORS: Record<string, string> = {
  risk_context_ambiguity: "#2563eb",
  innovation_divergence: "#ea580c",
  information_sufficiency: "#65a30d",
}

function displayValue(value: number | null, metricKey: string) {
  if (value === null) return "—"
  if (metricKey === "risk_context_ambiguity") return value.toFixed(4)
  return value.toFixed(3)
}

function path(points: Array<{ x: number; y: number }>) {
  return points
    .map(
      (point, index) =>
        `${index === 0 ? "M" : "L"}${point.x.toFixed(2)},${point.y.toFixed(2)}`
    )
    .join(" ")
}

function selectedSegments(
  observations: Map<number, NarrativeIndustryObservation>,
  x: (year: number) => number,
  y: (value: number) => number
) {
  const segments: Array<Array<{ x: number; y: number; year: number; value: number }>> = []
  let current: Array<{ x: number; y: number; year: number; value: number }> = []
  for (const year of YEARS) {
    const value = observations.get(year)?.value
    if (value === null || value === undefined) {
      if (current.length) segments.push(current)
      current = []
    } else {
      current.push({ x: x(year), y: y(value), year, value })
    }
  }
  if (current.length) segments.push(current)
  return segments
}

function IndustryRangeChart({
  metric,
  statistics,
  company,
  companyObservations,
  companies,
  allObservations,
}: {
  metric: NarrativeIndustryMethodologyItem
  statistics: NarrativeIndustryStatistic[]
  company: NarrativeIndustryCompany
  companyObservations: NarrativeIndustryObservation[]
  companies: NarrativeIndustryCompany[]
  allObservations: NarrativeIndustryObservation[]
}) {
  const width = 560
  const height = 340
  const margin = { top: 25, right: 24, bottom: 42, left: 70 }
  const innerWidth = width - margin.left - margin.right
  const innerHeight = height - margin.top - margin.bottom
  const color = METRIC_COLORS[metric.metricKey]
  const domainMinimum = statistics.find(
    (item) => item.domainMinimum !== null
  )?.domainMinimum
  const domainMaximum = statistics.find(
    (item) => item.domainMaximum !== null
  )?.domainMaximum
  const minimum = domainMinimum ?? 0
  const maximum = domainMaximum ?? 1
  const spread = maximum - minimum || Math.max(Math.abs(maximum), 1)
  const plotMinimum = minimum - spread * 0.03
  const plotMaximum = maximum + spread * 0.03
  const x = (year: number) =>
    margin.left + ((year - YEARS[0]) / (YEARS.at(-1)! - YEARS[0])) * innerWidth
  const y = (value: number) =>
    margin.top + ((plotMaximum - value) / (plotMaximum - plotMinimum)) * innerHeight
  const ticks = Array.from(
    { length: 5 },
    (_, index) => maximum - ((maximum - minimum) * index) / 4
  )
  const validStatistics = statistics.filter(
    (item) =>
      item.minimum !== null && item.maximum !== null && item.mean !== null
  )
  const upper = validStatistics.map((item) => ({
    x: x(item.year),
    y: y(item.maximum!),
  }))
  const lower = [...validStatistics]
    .reverse()
    .map((item) => ({ x: x(item.year), y: y(item.minimum!) }))
  const meanPoints = validStatistics.map((item) => ({
    x: x(item.year),
    y: y(item.mean!),
  }))
  const observationMap = new Map(
    companyObservations.map((item) => [item.year, item])
  )
  const segments = selectedSegments(observationMap, x, y)
  const annualDisplayScores = calculateNarrativeAnnualDisplayScores({
    company,
    metricKey: metric.metricKey,
    companies,
    observations: allObservations,
  })
  const annualDisplayScoreMap = new Map(
    annualDisplayScores.map((item) => [item.year, item])
  )
  const finalDisplayScore = calculateWeightedNarrativeDisplayScore(
    annualDisplayScores
  )

  return (
    <article className="nr-industry-chart">
      <header>
        <div>
          <span className="nr-eyebrow">原始指数 · 全行业年度范围</span>
          <h3>{metric.name}</h3>
          <p>{metric.formula}</p>
        </div>
        <output
          className="nr-industry-chart__final-score"
          aria-label={`${metric.name}行业排名加权风险分${
            finalDisplayScore === null ? "缺失" : finalDisplayScore.toFixed(1)
          }`}
          title="行业排名加权风险分（0—100，越高风险越大）"
        >
          {finalDisplayScore === null ? "—" : finalDisplayScore.toFixed(1)}
        </output>
      </header>

      <div className="nr-industry-chart__figure">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-labelledby={`industry-${metric.metricKey}-title industry-${metric.metricKey}-description`}
        >
          <title id={`industry-${metric.metricKey}-title`}>
            {company.companyName}{metric.name}年度行业分布
          </title>
          <desc id={`industry-${metric.metricKey}-description`}>
            行业均值、行业年度最小至最大区间，以及{company.companyName}
            的原始指数折线。
          </desc>
          {ticks.map((tick) => (
            <g key={tick}>
              <line
                x1={margin.left}
                x2={width - margin.right}
                y1={y(tick)}
                y2={y(tick)}
                className="nr-industry-gridline"
              />
              <text
                x={margin.left - 10}
                y={y(tick) + 4}
                textAnchor="end"
                className="nr-industry-axis"
              >
                {displayValue(tick, metric.metricKey)}
              </text>
            </g>
          ))}
          {YEARS.map((year) => (
            <g key={year}>
              <line
                x1={x(year)}
                x2={x(year)}
                y1={margin.top}
                y2={height - margin.bottom}
                className="nr-industry-gridline is-vertical"
              />
              <text
                x={x(year)}
                y={height - 14}
                textAnchor="middle"
                className="nr-industry-axis"
              >
                {year}
              </text>
            </g>
          ))}
          {upper.length > 1 ? (
            <path
              d={`${path(upper)} ${path(lower).replace(/^M/, "L")} Z`}
              fill={color}
              opacity="0.13"
            />
          ) : null}
          {validStatistics.map((item) => (
            <g key={item.year}>
              <line
                x1={x(item.year)}
                x2={x(item.year)}
                y1={y(item.maximum!)}
                y2={y(item.minimum!)}
                stroke={color}
                strokeWidth="1.5"
                opacity="0.72"
              />
              <line
                x1={x(item.year) - 5}
                x2={x(item.year) + 5}
                y1={y(item.maximum!)}
                y2={y(item.maximum!)}
                stroke={color}
                strokeWidth="1.5"
              />
              <line
                x1={x(item.year) - 5}
                x2={x(item.year) + 5}
                y1={y(item.minimum!)}
                y2={y(item.minimum!)}
                stroke={color}
                strokeWidth="1.5"
              />
            </g>
          ))}
          {meanPoints.length > 1 ? (
            <path
              d={path(meanPoints)}
              fill="none"
              stroke={color}
              strokeWidth="2.5"
              strokeLinejoin="round"
            />
          ) : null}
          {validStatistics.map((item) => (
            <circle
              key={`mean:${item.year}`}
              cx={x(item.year)}
              cy={y(item.mean!)}
              r="4.5"
              fill={color}
            >
              <title>
                {item.year} 行业均值：{displayValue(item.mean, metric.metricKey)}；
                范围 {displayValue(item.minimum, metric.metricKey)}–
                {displayValue(item.maximum, metric.metricKey)}；n={item.sampleSize}
              </title>
            </circle>
          ))}
          {segments.map((segment, index) =>
            segment.length > 1 ? (
              <path
                key={`selected:${index}`}
                d={path(segment)}
                fill="none"
                stroke="var(--text-strong)"
                strokeWidth="3"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ) : null
          )}
          {segments.flat().map((point) => (
            <circle
              key={`selected:${point.year}`}
              cx={point.x}
              cy={point.y}
              r="5"
              fill="var(--text-strong)"
              stroke="var(--background)"
              strokeWidth="2"
            >
              <title>
                {company.companyName} {point.year}：
                {displayValue(point.value, metric.metricKey)}
                {observationMap.get(point.year)?.details.patentProxy === true
                  ? "（专利申请代理）"
                  : ""}
              </title>
            </circle>
          ))}
        </svg>
      </div>

      <div className="nr-industry-chart__legend">
        <span><i style={{ background: color }} />行业均值</span>
        <span><i className="is-band" style={{ background: color }} />行业最小—最大区间</span>
        <span><i className="is-company" />{company.companyName}</span>
      </div>

      <p className="nr-industry-chart__domain">
        纵轴行业总范围：{displayValue(minimum, metric.metricKey)}—
        {displayValue(maximum, metric.metricKey)} · {metric.direction}
      </p>

      <details>
        <summary>查看年度展示分、原始值与行业范围</summary>
        <div className="nr-industry-chart__table-scroll">
          <table>
            <thead>
              <tr>
                <th>年份</th>
                <th>{company.companyName}</th>
                <th>年度展示分</th>
                <th>权重</th>
                <th>行业均值</th>
                <th>行业下限</th>
                <th>行业上限</th>
                <th>样本</th>
              </tr>
            </thead>
            <tbody>
              {YEARS.map((year) => {
                const statistic = statistics.find((item) => item.year === year)
                const companyObservation = observationMap.get(year)
                const annualDisplayScore = annualDisplayScoreMap.get(year)
                return (
                  <tr key={year}>
                    <th>{year}</th>
                    <td>
                      {displayValue(companyObservation?.value ?? null, metric.metricKey)}
                      {companyObservation?.details.patentProxy === true
                        ? "（代理）"
                        : ""}
                    </td>
                    <td>
                      {annualDisplayScore
                        ? annualDisplayScore.score.toFixed(1)
                        : "—"}
                    </td>
                    <td>{annualDisplayScore?.weight ?? "—"}</td>
                    <td>{displayValue(statistic?.mean ?? null, metric.metricKey)}</td>
                    <td>{displayValue(statistic?.minimum ?? null, metric.metricKey)}</td>
                    <td>{displayValue(statistic?.maximum ?? null, metric.metricKey)}</td>
                    <td>n={statistic?.sampleSize ?? 0}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </details>
    </article>
  )
}

export function NarrativeIndustryTrends({
  data,
  companyId,
}: {
  data: NarrativeIndustryTrendResponse
  companyId: string
}) {
  const selectedCompany =
    data.companies.find((item) => item.companyId === companyId) ??
    data.companies[0]
  const selectedDocuments = data.documents
    .filter((item) => item.companyId === selectedCompany.companyId)
    .sort((left, right) => left.year - right.year)

  return (
    <section className="nr-industry-workspace" aria-labelledby="nr-industry-title">
      <header className="nr-industry-heading">
        <div>
          <span className="nr-eyebrow">94家企业 · 年报原始指数</span>
          <h2 id="nr-industry-title">行业叙事风险年度分布</h2>
        </div>
        <Badge variant={data.sourceMode === "postgres" ? "secondary" : "outline"}>
          <DatabaseIcon /> 财报语料已归档
        </Badge>
      </header>

      <div className="nr-industry-company-context" aria-label="当前研究对象">
        <div className="nr-industry-company-summary">
          <Building2Icon />
          <div>
            <strong>{selectedCompany.companyName}</strong>
          </div>
        </div>
      </div>

      <div className="nr-industry-audit">
        <article><Building2Icon /><span>行业企业</span><strong>{data.audit.targetCompanyCount}</strong></article>
        <article><FileCheck2Icon /><span>已归档年报</span><strong>{data.audit.archivedReportCount}</strong></article>
        <article><LineChartIcon /><span>有效原始指数</span><strong>{data.audit.calculatedObservationCount}</strong></article>
        <article><DatabaseIcon /><span>夸大性可计算</span><strong>{data.audit.patentObservationCount}</strong></article>
      </div>

      {(data.audit.paidPatentProxyObservationCount ?? 0) > 0 ? (
        <p className="nr-industry-paid-note" role="note">
          叙事夸大性中有 {data.audit.paidPatentProxyObservationCount}
          个企业年度使用第三方境内主体发明申请代理；对应点位和年度值均单独标注，代理范围与限制可在来源中追溯。
        </p>
      ) : null}

      <div className="nr-industry-chart-grid">
        {data.methodology.map((metric) => (
          <IndustryRangeChart
            key={metric.metricKey}
            metric={metric}
            company={selectedCompany}
            companies={data.companies}
            allObservations={data.observations}
            statistics={data.industryStatistics.filter(
              (item) =>
                item.industryGroupId === selectedCompany.industryGroupId &&
                item.metricKey === metric.metricKey
            )}
            companyObservations={data.observations.filter(
              (item) =>
                item.companyId === selectedCompany.companyId &&
                item.metricKey === metric.metricKey
            )}
          />
        ))}
      </div>

      <details className="nr-industry-source-ledger">
        <summary>查看当前研究对象年报覆盖与来源</summary>
        <div>
          {selectedDocuments.map((document) => (
            <article key={document.documentId}>
              <span>{document.year}</span>
              <strong>{document.parseStatus}</strong>
              {document.officialUrl ? (
                <a href={document.officialUrl} target="_blank" rel="noreferrer">上交所原始年报</a>
              ) : (
                <small>{document.archiveStatus}</small>
              )}
            </article>
          ))}
        </div>
      </details>
    </section>
  )
}
