import { useMemo, useState } from "react"
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  DatabaseIcon,
  ExternalLinkIcon,
  FileCheck2Icon,
  LineChartIcon,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import type {
  NarrativeAnnualAuditResponse,
  NarrativeAnnualCompany,
  NarrativeAnnualMethodologyItem,
  NarrativeAnnualMethodologyResponse,
  NarrativeAnnualObservation,
  NarrativeAnnualTrendResponse,
} from "@/domain/narrative-risk-v1"
import { cn } from "@/lib/utils"

const YEARS = [2021, 2022, 2023, 2024, 2025]
const COMPANY_COLORS = ["#2563eb", "#e11d48", "#059669", "#d97706", "#7c3aed"]

type TrendMode = "年度值" | "年度演变率"

interface NarrativeAnnualTrendsProps {
  trends: NarrativeAnnualTrendResponse
  methodology: NarrativeAnnualMethodologyResponse
  audit: NarrativeAnnualAuditResponse
}

function displayNumber(value: number | null, unit: string, mode: TrendMode) {
  if (value === null) return "—"
  if (mode === "年度演变率") {
    return `${(value * 100).toFixed(Math.abs(value) >= 1 ? 1 : 2)}%`
  }
  if (unit === "比例" || unit === "指数") {
    return value.toFixed(4)
  }
  if (unit === "万有效词" || unit === "对数值") {
    return value.toFixed(3)
  }
  return value.toFixed(2)
}

function observationValue(
  observation: NarrativeAnnualObservation | undefined,
  mode: TrendMode
) {
  if (!observation) return null
  return mode === "年度值" ? observation.value : observation.changeRate
}

function buildPath(points: Array<{ x: number; y: number }>) {
  return points
    .map(
      (point, index) =>
        `${index === 0 ? "M" : "L"}${point.x.toFixed(2)},${point.y.toFixed(2)}`
    )
    .join(" ")
}

function metricMissingGroups(
  observations: NarrativeAnnualObservation[],
  companies: NarrativeAnnualCompany[],
  mode: TrendMode
) {
  const labels = new Map(
    companies.map((company) => [company.companyKey, company.companyName])
  )
  const groups = new Map<string, string[]>()
  for (const observation of observations) {
    const company = companies.find(
      (item) => item.companyKey === observation.companyKey
    )
    if (!company?.includedYears.includes(observation.year)) continue
    const value = observationValue(observation, mode)
    if (value !== null) continue
    const reason =
      mode === "年度演变率" && observation.value !== null
        ? "首个可计算年度没有上一年度同口径值"
        : (observation.missingReason ?? "当前年度不满足计算条件")
    const entries = groups.get(reason) ?? []
    entries.push(
      `${labels.get(observation.companyKey) ?? observation.companyKey}${observation.year}`
    )
    groups.set(reason, entries)
  }
  return [...groups.entries()]
}

function TrendChart({
  metric,
  observations,
  companies,
  mode,
}: {
  metric: NarrativeAnnualMethodologyItem
  observations: NarrativeAnnualObservation[]
  companies: NarrativeAnnualCompany[]
  mode: TrendMode
}) {
  const width = 760
  const height = 270
  const margin = { top: 22, right: 18, bottom: 36, left: 64 }
  const innerWidth = width - margin.left - margin.right
  const innerHeight = height - margin.top - margin.bottom
  const observationMap = new Map(
    observations.map((item) => [`${item.companyKey}:${item.year}`, item])
  )
  const values = observations
    .map((item) => observationValue(item, mode))
    .filter(
      (value): value is number => value !== null && Number.isFinite(value)
    )
  const rawMinimum = values.length ? Math.min(...values) : 0
  const rawMaximum = values.length ? Math.max(...values) : 1
  const range = rawMaximum - rawMinimum || Math.max(Math.abs(rawMaximum), 1)
  const minimum = rawMinimum - range * 0.08
  const maximum = rawMaximum + range * 0.08
  const x = (year: number) =>
    margin.left + ((year - YEARS[0]) / (YEARS.at(-1)! - YEARS[0])) * innerWidth
  const y = (value: number) =>
    margin.top + ((maximum - value) / (maximum - minimum)) * innerHeight
  const ticks = Array.from(
    { length: 5 },
    (_, index) => maximum - ((maximum - minimum) * index) / 4
  )
  const missingGroups = metricMissingGroups(observations, companies, mode)

  const series = companies.map((company, companyIndex) => {
    const segments: Array<
      Array<{ x: number; y: number; year: number; value: number }>
    > = []
    let current: Array<{ x: number; y: number; year: number; value: number }> =
      []
    for (const year of YEARS) {
      if (!company.includedYears.includes(year)) {
        if (current.length) segments.push(current)
        current = []
        continue
      }
      const observation = observationMap.get(`${company.companyKey}:${year}`)
      const value = observationValue(observation, mode)
      if (value === null) {
        if (current.length) segments.push(current)
        current = []
      } else {
        current.push({ x: x(year), y: y(value), year, value })
      }
    }
    if (current.length) segments.push(current)
    return {
      company,
      color: COMPANY_COLORS[companyIndex % COMPANY_COLORS.length],
      segments,
    }
  })

  return (
    <article className="nr-trend-card">
      <div className="nr-trend-card__head">
        <div>
          <span className="nr-eyebrow">{metric.category}</span>
          <h3>{metric.name}</h3>
          <p>{metric.formula}</p>
        </div>
        <Badge variant="outline">{metric.methodStatus}</Badge>
      </div>

      {values.length ? (
        <div className="nr-trend-figure">
          <svg
            viewBox={`0 0 ${width} ${height}`}
            role="img"
            aria-labelledby={`trend-${metric.metricKey}-title trend-${metric.metricKey}-description`}
          >
            <title id={`trend-${metric.metricKey}-title`}>
              {metric.name}
              {mode}折线图
            </title>
            <desc id={`trend-${metric.metricKey}-description`}>
              展示所选企业2021年至2025年的{metric.name}
              {mode}；缺失值以断点表示。
            </desc>
            {ticks.map((tick) => (
              <g key={tick}>
                <line
                  x1={margin.left}
                  x2={width - margin.right}
                  y1={y(tick)}
                  y2={y(tick)}
                  className="nr-trend-gridline"
                />
                <text
                  x={margin.left - 9}
                  y={y(tick) + 4}
                  textAnchor="end"
                  className="nr-trend-axis-label"
                >
                  {displayNumber(tick, metric.unit, mode)}
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
                  className="nr-trend-gridline is-vertical"
                />
                <text
                  x={x(year)}
                  y={height - 12}
                  textAnchor="middle"
                  className="nr-trend-axis-label"
                >
                  {year}
                </text>
              </g>
            ))}
            {series.flatMap(({ company, color, segments }) =>
              segments.flatMap((segment, segmentIndex) => [
                segment.length > 1 ? (
                  <path
                    key={`${company.companyKey}:path:${segmentIndex}`}
                    d={buildPath(segment)}
                    fill="none"
                    stroke={color}
                    strokeWidth="2.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                ) : null,
                ...segment.map((point) => (
                  <circle
                    key={`${company.companyKey}:${point.year}`}
                    cx={point.x}
                    cy={point.y}
                    r="4"
                    fill={color}
                    stroke="white"
                    strokeWidth="1.5"
                  >
                    <title>
                      {company.companyName} {point.year}：
                      {displayNumber(point.value, metric.unit, mode)}
                    </title>
                  </circle>
                )),
              ])
            )}
          </svg>
        </div>
      ) : (
        <div className="nr-trend-empty">
          <AlertTriangleIcon />
          当前严格口径下没有可绘制值，图表保留为空而不是补零。
        </div>
      )}

      <div className="nr-trend-legend" aria-label="企业图例">
        {companies.map((company, index) => (
          <span key={company.companyKey}>
            <i
              style={{
                backgroundColor: COMPANY_COLORS[index % COMPANY_COLORS.length],
              }}
            />
            {company.companyName}
          </span>
        ))}
      </div>

      {missingGroups.length ? (
        <div className="nr-trend-missing" role="note">
          <strong>断点说明</strong>
          {missingGroups.map(([reason, entries]) => (
            <p key={reason}>
              {entries.join("、")}：{reason}
            </p>
          ))}
        </div>
      ) : null}

      <details className="nr-trend-table-wrap">
        <summary>查看{metric.name}对应数据表</summary>
        <div className="nr-trend-table-scroll">
          <table>
            <caption>
              {metric.name}
              {mode}，缺失项不按零处理
            </caption>
            <thead>
              <tr>
                <th scope="col">企业</th>
                {YEARS.map((year) => (
                  <th key={year} scope="col">
                    {year}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {companies.map((company) => (
                <tr key={company.companyKey}>
                  <th scope="row">{company.companyName}</th>
                  {YEARS.map((year) => {
                    if (!company.includedYears.includes(year)) {
                      return <td key={year}>不适用</td>
                    }
                    const observation = observationMap.get(
                      `${company.companyKey}:${year}`
                    )
                    const value = observationValue(observation, mode)
                    return (
                      <td
                        key={year}
                        title={
                          value === null
                            ? (observation?.missingReason ?? "缺失")
                            : undefined
                        }
                      >
                        {displayNumber(value, metric.unit, mode)}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </article>
  )
}

export function NarrativeAnnualTrends({
  trends,
  methodology,
  audit,
}: NarrativeAnnualTrendsProps) {
  const listedCompanies = trends.companies.filter(
    (company) => company.includedYears.length > 0
  )
  const [selectedCompanyKeys, setSelectedCompanyKeys] = useState(() =>
    listedCompanies.map((company) => company.companyKey)
  )
  const [mode, setMode] = useState<TrendMode>("年度值")
  const selectedCompanies = useMemo(
    () =>
      listedCompanies.filter((company) =>
        selectedCompanyKeys.includes(company.companyKey)
      ),
    [listedCompanies, selectedCompanyKeys]
  )
  const unlistedCompanies = trends.companies.filter(
    (company) => company.includedYears.length === 0
  )

  function toggleCompany(companyKey: string) {
    setSelectedCompanyKeys((current) =>
      current.includes(companyKey)
        ? current.length === 1
          ? current
          : current.filter((key) => key !== companyKey)
        : [...current, companyKey]
    )
  }

  return (
    <section
      className="nr-panel nr-annual-trends"
      aria-labelledby="nr-annual-trends-title"
    >
      <div className="nr-section-head nr-annual-trends__heading">
        <div>
          <span className="nr-eyebrow">新版唯一计算口径</span>
          <h2 id="nr-annual-trends-title">年度趋势</h2>
          <p>
            仅采用《叙事风险维度测度（修改版）》；不构造跨维度总分，缺失年份按断点展示。
          </p>
        </div>
        <div className="nr-annual-trends__source">
          <Badge
            variant={trends.sourceMode === "postgres" ? "secondary" : "outline"}
          >
            <DatabaseIcon />{" "}
            {trends.sourceMode === "postgres" ? "数据库实时" : "脱敏快照"}
          </Badge>
          <span>数据截至 {trends.asOfDate}</span>
        </div>
      </div>

      <div className="nr-method-alert" role="note">
        <AlertTriangleIcon />
        <div>
          <strong>创新文本采用“核心词简化口径”</strong>
          <p>
            冻结40词，不显示成完整693词口径；同行业—年度基准不足时，叙事夸大度保持缺失。
          </p>
        </div>
      </div>

      <div className="nr-annual-audit-grid" aria-label="年度数据覆盖">
        <article>
          <FileCheck2Icon />
          <span>目标年报</span>
          <strong>{audit.audit.targetReportCount}</strong>
        </article>
        <article>
          <CheckCircle2Icon />
          <span>已归档</span>
          <strong>{audit.audit.archivedReportCount}</strong>
        </article>
        <article>
          <LineChartIcon />
          <span>已计算观测</span>
          <strong>{audit.audit.calculatedObservationCount}</strong>
        </article>
        <article>
          <AlertTriangleIcon />
          <span>严格缺失观测</span>
          <strong>{audit.audit.missingObservationCount}</strong>
        </article>
      </div>

      <div className="nr-trend-controls">
        <div>
          <strong>企业筛选</strong>
          <div className="nr-company-chips">
            {listedCompanies.map((company) => (
              <button
                key={company.companyKey}
                type="button"
                className={cn(
                  selectedCompanyKeys.includes(company.companyKey) &&
                    "is-active"
                )}
                aria-pressed={selectedCompanyKeys.includes(company.companyKey)}
                onClick={() => toggleCompany(company.companyKey)}
              >
                {company.companyName}
              </button>
            ))}
          </div>
        </div>
        <div className="nr-mode-switch" aria-label="年度趋势显示方式">
          {(["年度值", "年度演变率"] as const).map((item) => (
            <button
              key={item}
              type="button"
              className={cn(mode === item && "is-active")}
              aria-pressed={mode === item}
              onClick={() => setMode(item)}
            >
              {item}
            </button>
          ))}
        </div>
      </div>

      {unlistedCompanies.length ? (
        <p className="nr-unlisted-note">
          {unlistedCompanies.map((company) => company.companyName).join("、")}
          ：未上市，不纳入年报趋势，不补零。
        </p>
      ) : null}

      <div className="nr-trend-grid">
        {methodology.methodology.map((metric) => (
          <TrendChart
            key={metric.metricKey}
            metric={metric}
            companies={selectedCompanies}
            observations={trends.observations.filter(
              (item) =>
                item.metricKey === metric.metricKey &&
                selectedCompanyKeys.includes(item.companyKey)
            )}
            mode={mode}
          />
        ))}
      </div>

      <details className="nr-annual-source-ledger" id="annual-report-sources">
        <summary>查看21份年报的来源与解析记录</summary>
        <div className="nr-annual-source-ledger__intro">
          <p>
            仅展示公开来源、归档状态、章节覆盖和文件摘要；不公开年报全文或本机归档路径。
          </p>
          <Badge variant="outline">
            情感词典已锁定 · 文件摘要{" "}
            {methodology.methodVersion.sentimentDictionarySha256.slice(0, 12)}…
          </Badge>
        </div>
        <div className="nr-annual-source-ledger__scroll">
          <table>
            <caption>目标年报采集与解析审计</caption>
            <thead>
              <tr>
                <th scope="col">企业</th>
                <th scope="col">报告年度</th>
                <th scope="col">归档</th>
                <th scope="col">解析</th>
                <th scope="col">章节覆盖</th>
                <th scope="col">文件摘要</th>
                <th scope="col">公开来源</th>
              </tr>
            </thead>
            <tbody>
              {[...audit.documents]
                .sort(
                  (left, right) =>
                    left.companyKey.localeCompare(right.companyKey) ||
                    left.year - right.year
                )
                .map((document) => {
                  const company = trends.companies.find(
                    (item) => item.companyKey === document.companyKey
                  )
                  const coveredSections = Object.entries(
                    document.sectionCoverage
                  )
                    .filter(([, covered]) => covered === true)
                    .map(([section]) => section)
                  return (
                    <tr key={document.documentId}>
                      <th scope="row">
                        {company?.companyName ?? document.companyKey}
                      </th>
                      <td>{document.year}</td>
                      <td>{document.archiveStatus}</td>
                      <td>{document.parseStatus}</td>
                      <td>{coveredSections.join("、") || "未识别"}</td>
                      <td>
                        {document.fileSha256
                          ? `${document.fileSha256.slice(0, 12)}…`
                          : "—"}
                      </td>
                      <td>
                        <a
                          href={document.officialUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          原始链接 <ExternalLinkIcon aria-hidden="true" />
                        </a>
                      </td>
                    </tr>
                  )
                })}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  )
}
