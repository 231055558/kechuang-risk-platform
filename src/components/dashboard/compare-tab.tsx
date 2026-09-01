import { useEffect, useState, type ReactNode } from "react"
import { CheckCircle2Icon } from "lucide-react"

import {
  EmptyState,
  ReviewStatusBadge,
  SectionHeader,
} from "@/components/dashboard/shared"
import { LiquidGlassSurface } from "@/components/liquid"
import { Reveal } from "@/components/motion/workflow-transition"
import { Badge } from "@/components/ui/badge"
import { calculateNarrativeCompanyDisplayScore } from "@/domain/narrative-risk-v1/industry-display-score"
import type { NarrativeIndustryTrendResponse } from "@/domain/narrative-risk-v1"
import { getNarrativeIndustryTrends } from "@/lib/narrative-risk-api"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import type {
  CompanySummary,
  RiskAssessment,
  RiskAssessmentDimension,
} from "@/types/risk"

type CompareTabProps = {
  companyId: string
  compareCompanyId: string
  onCompareCompanyIdChange: (companyId: string) => void
  summaries: CompanySummary[]
  assessments: Record<string, RiskAssessment>
}

type ComparisonDimension = RiskAssessmentDimension & {
  comparisonBasis?: string
  comparisonDetail?: string
}

const COMPARISON_CHART_TICKS = [0, 20, 40, 60, 80, 100] as const
const COMPARISON_CHART_WIDTH = 960
const COMPARISON_CHART_HEIGHT = 420
const COMPARISON_PLOT = {
  left: 64,
  top: 42,
  width: 872,
  height: 292,
} as const

function formatChartScore(score: number) {
  return score
    .toFixed(2)
    .replace(/\.00$/, "")
    .replace(/(\.\d)0$/, "$1")
}

function comparisonAxisLabel(label: string) {
  return label === "财务与融资风险" ? ["财务与融资", "风险"] : [label]
}

function formatDimensionScoreBasis(dimension: ComparisonDimension | null) {
  if (!dimension || dimension.score === null) {
    return "数据待补充"
  }

  if (dimension.comparisonBasis) return dimension.comparisonBasis

  if (dimension.scoreBasis === "technology-auto-score") {
    return "技术自动评分"
  }

  if (dimension.scoreBasis === "indicator-observation") {
    return "指标规则计算"
  }

  return "辅助研判分值"
}

export function CompareTab({
  companyId,
  compareCompanyId,
  onCompareCompanyIdChange,
  summaries,
  assessments,
}: CompareTabProps) {
  const [narrativeTrends, setNarrativeTrends] =
    useState<NarrativeIndustryTrendResponse | null>(null)

  useEffect(() => {
    let active = true
    getNarrativeIndustryTrends()
      .then((data) => {
        if (active) setNarrativeTrends(data)
      })
      .catch(() => {
        if (active) setNarrativeTrends(null)
      })
    return () => {
      active = false
    }
  }, [])

  const leftCompany = summaries.find((company) => company.id === companyId)
  const rightCompany =
    summaries.find((company) => company.id === compareCompanyId) ??
    summaries.find((company) => company.id !== companyId)

  if (!leftCompany || !rightCompany) {
    return (
      <div className="page-stack">
        <EmptyState
          title="暂无可对比企业"
          description="至少需要两家具有研究档案的企业，才能建立共同口径的风险对比。"
        />
      </div>
    )
  }

  const leftAssessment = assessments[leftCompany.id]
  const rightAssessment = assessments[rightCompany.id]

  if (!leftAssessment || !rightAssessment) {
    return (
      <div className="page-stack">
        <EmptyState
          title="对比评估尚未就绪"
          description="至少一方缺少当前方法版本的风险评估数据，请先完成评估数据核验。"
        />
      </div>
    )
  }

  const leftNarrativeScore = narrativeTrends
    ? calculateNarrativeCompanyDisplayScore(
        narrativeTrends,
        leftCompany.stockCode
      )
    : null
  const rightNarrativeScore = narrativeTrends
    ? calculateNarrativeCompanyDisplayScore(
        narrativeTrends,
        rightCompany.stockCode
      )
    : null
  const dimensionRows = leftAssessment.dimensions.map((leftDimension) => {
    const rightDimension =
      rightAssessment.dimensions.find(
        (dimension) => dimension.id === leftDimension.id
      ) ?? null
    if (leftDimension.id !== "narrative") {
      return { left: leftDimension, right: rightDimension }
    }

    const comparisonBasis = "年度行业排名加权分"
    const comparisonDetail = "信息模糊性、叙事夸大性、风险披露充分性三项等权"
    return {
      left: {
        ...leftDimension,
        score: leftNarrativeScore?.score ?? null,
        assessable: leftNarrativeScore !== null,
        comparisonBasis,
        comparisonDetail,
      },
      right: rightDimension
        ? {
            ...rightDimension,
            score: rightNarrativeScore?.score ?? null,
            assessable: rightNarrativeScore !== null,
            comparisonBasis,
            comparisonDetail,
          }
        : null,
    }
  })
  const comparableCount = dimensionRows.filter(
    ({ left, right }) => left.score !== null && right?.score !== null
  ).length
  const bothAssessmentsUnassessable =
    leftAssessment.assessableDimensionCount === 0 &&
    rightAssessment.assessableDimensionCount === 0

  return (
    <div className="page-stack">
      <Reveal>
        <div
          className={cn(
            "compare-summary",
            bothAssessmentsUnassessable && "compare-summary-empty"
          )}
        >
          <LiquidGlassSurface
            variant="card"
            className="compare-company-glass"
            padding="0"
          >
            <CompanyAssessmentSummary
              company={leftCompany}
              assessment={leftAssessment}
              tone="primary"
              compact={bothAssessmentsUnassessable}
            />
          </LiquidGlassSurface>
          <LiquidGlassSurface
            variant="card"
            className="compare-company-glass"
            padding="0"
          >
            <CompanyAssessmentSummary
              company={rightCompany}
              assessment={rightAssessment}
              tone="secondary"
              compact={bothAssessmentsUnassessable}
              nameControl={
                <Select
                  value={rightCompany.id}
                  onValueChange={onCompareCompanyIdChange}
                >
                  <SelectTrigger
                    id="compare-company-select"
                    className="compare-card-selector"
                    aria-label="选择对比企业"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent
                    position="popper"
                    side="bottom"
                    align="start"
                    sideOffset={8}
                    className="liquid-menu compare-company-menu"
                  >
                    <SelectGroup>
                      {summaries
                        .filter((company) => company.id !== companyId)
                        .map((company) => (
                          <SelectItem key={company.id} value={company.id}>
                            {company.name}
                          </SelectItem>
                        ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              }
            />
          </LiquidGlassSurface>
        </div>
      </Reveal>

      <Reveal>
        <section className="page-section compare-chart-section">
          <SectionHeader
            title="六维风险对照图"
            tone="blue"
            action={
              <div className="compare-chart-actions">
                <span className="compare-coverage tabular-number">
                  {comparableCount}/6 维可比
                </span>
                {comparableCount > 0 ? (
                  <div className="chart-legend" aria-label="图例">
                    <span>
                      <i data-series="left" />
                      {leftCompany.name}
                    </span>
                    <span>
                      <i data-series="right" />
                      {rightCompany.name}
                    </span>
                  </div>
                ) : null}
              </div>
            }
          />
          {comparableCount > 0 ? (
            <>
              <div
                className="compare-dimension-chart"
                role="img"
                aria-label={`${leftCompany.name}与${rightCompany.name}六类风险对照图`}
                aria-describedby="compare-dimension-chart-data"
              >
                <GroupedRiskChart
                  rows={dimensionRows}
                  leftName={leftCompany.name}
                  rightName={rightCompany.name}
                />
              </div>
              <ul id="compare-dimension-chart-data" className="sr-only">
                {dimensionRows.map(({ left, right }) => (
                  <li key={left.id}>
                    {left.label}：{leftCompany.name}
                    {left.score === null ? "数据待补充" : `${left.score}分`}；
                    {rightCompany.name}
                    {right?.score === null || right?.score === undefined
                      ? "数据待补充"
                      : `${right.score}分`}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <div className="compare-chart-empty">
              <EmptyState
                title="暂无共同口径的可视化分值"
                description="双方六类风险尚未形成共同口径下的可比指标。图表不将缺失项绘制为低风险，可在下方查看数据覆盖差异。"
              />
            </div>
          )}
        </section>
      </Reveal>

      <Reveal>
        {comparableCount > 0 ? (
          <section className="page-section compare-table-section">
            <SectionHeader
              title="可审计差异表"
              tone="teal"
              description="差值用于定位双方风险差异和建议动作优先级，不对缺失数据进行插值。"
            />
            <div
              className="disclosure-table-wrap"
              role="region"
              tabIndex={0}
              aria-label={`${leftCompany.name}与${rightCompany.name}风险差异数据表`}
            >
              <table className="business-table comparison-table">
                <thead>
                  <tr>
                    <th>风险维度</th>
                    <th>{leftCompany.name}</th>
                    <th>{rightCompany.name}</th>
                    <th>差异判断</th>
                    <th>证据基础</th>
                  </tr>
                </thead>
                <tbody>
                  {dimensionRows.map(({ left, right }) => (
                    <ComparisonRow
                      key={left.id}
                      left={left}
                      right={right}
                      leftName={leftCompany.name}
                      rightName={rightCompany.name}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : (
          <section className="page-section compare-readiness-section">
            <SectionHeader
              title="可比条件检查"
              tone="teal"
              description="双方当前没有共同可评估维度，先展示缺失闭环，不重复铺设一张全空差异表。"
            />
            <div className="compare-readiness-grid">
              <AssessmentReadiness
                companyName={leftCompany.name}
                assessment={leftAssessment}
              />
              <AssessmentReadiness
                companyName={rightCompany.name}
                assessment={rightAssessment}
              />
              <article className="compare-readiness-next">
                <span>建立共同口径</span>
                <strong>至少补齐一个相同维度的评分依据与有效证据</strong>
                <p>
                  双方使用同一指标定义、期间与归一化规则自动形成差值；缺失指标不参与比较。
                </p>
              </article>
            </div>
          </section>
        )}
      </Reveal>

    </div>
  )
}

function AssessmentReadiness({
  companyName,
  assessment,
}: {
  companyName: string
  assessment: RiskAssessment
}) {
  return (
    <article className="compare-readiness-item">
      <span>{companyName}</span>
      <strong className="tabular-number">
        {assessment.assessableDimensionCount}/6 维可评估
      </strong>
      <p>
        评分证据覆盖率 {assessment.effectiveEvidenceCoverage}% · 指标可用度{" "}
        {assessment.indicatorAvailability}% ·{assessment.scoreBasisLabel}
      </p>
    </article>
  )
}

function CompanyAssessmentSummary({
  company,
  assessment,
  tone,
  nameControl,
  compact = false,
}: {
  company: CompanySummary
  assessment: RiskAssessment
  tone: "primary" | "secondary"
  nameControl?: ReactNode
  compact?: boolean
}) {
  return (
    <article
      className="company-assessment-summary"
      data-tone={tone}
      data-compact={compact}
    >
      <div className="company-assessment-title">
        <div className="company-assessment-identity">
          <span>{company.sector}</span>
          {nameControl ? (
            <>
              <h2 className="sr-only">{company.name}</h2>
              {nameControl}
            </>
          ) : (
            <h2>{company.name}</h2>
          )}
        </div>
        <ReviewStatusBadge
          status={assessment.reviewStatus}
          assessableDimensionCount={assessment.assessableDimensionCount}
        />
      </div>
      {compact ? (
        <div className="company-assessment-compact-state">
          <strong className="tabular-number">
            {assessment.assessableDimensionCount}/6
          </strong>
          <span>该维度数据待补充，暂不参与双方差值计算</span>
        </div>
      ) : (
        <>
          <div className="company-assessment-score">
            <strong className="tabular-number">{assessment.scoreLabel}</strong>
            <span>{assessment.label}</span>
          </div>
          <dl>
            <div>
              <dt>可评估维度</dt>
              <dd className="tabular-number">
                {assessment.assessableDimensionCount}/6
              </dd>
            </div>
            <div>
              <dt>评分证据覆盖率</dt>
              <dd className="tabular-number">
                {assessment.effectiveEvidenceCoverage}%
              </dd>
            </div>
            <div>
              <dt>指标可用度</dt>
              <dd className="tabular-number">
                {assessment.indicatorAvailability}%
              </dd>
            </div>
          </dl>
        </>
      )}
    </article>
  )
}

function GroupedRiskChart({
  rows,
  leftName,
  rightName,
}: {
  rows: Array<{
    left: ComparisonDimension
    right: ComparisonDimension | null
  }>
  leftName: string
  rightName: string
}) {
  const groupWidth = COMPARISON_PLOT.width / rows.length
  const barWidth = 34
  const barGap = 8
  const baseline = COMPARISON_PLOT.top + COMPARISON_PLOT.height

  const bar = (
    score: number | null,
    x: number,
    series: "left" | "right",
    key: string
  ) => {
    if (score === null) {
      return (
        <g key={key} className="compare-coordinate-missing">
          <line x1={x} x2={x + barWidth} y1={baseline - 2} y2={baseline - 2} />
          <text x={x + barWidth / 2} y={baseline - 10} textAnchor="middle">
            —
          </text>
        </g>
      )
    }

    const boundedScore = Math.max(0, Math.min(100, score))
    const height = (boundedScore / 100) * COMPARISON_PLOT.height
    const y = baseline - height
    return (
      <g key={key}>
        <rect
          className="compare-coordinate-bar"
          data-series={series}
          x={x}
          y={y}
          width={barWidth}
          height={height}
          rx="4"
        />
        <text
          className="compare-coordinate-value tabular-number"
          x={x + barWidth / 2}
          y={Math.max(COMPARISON_PLOT.top + 12, y - 8)}
          textAnchor="middle"
        >
          {formatChartScore(score)}
        </text>
      </g>
    )
  }

  return (
    <div className="compare-coordinate-wrap" aria-hidden="true">
      <svg
        className="compare-coordinate-chart"
        viewBox={`0 0 ${COMPARISON_CHART_WIDTH} ${COMPARISON_CHART_HEIGHT}`}
        focusable="false"
      >
        <text className="compare-coordinate-title" x="0" y="14">
          风险分值（0–100）
        </text>
        {COMPARISON_CHART_TICKS.map((tick) => {
          const y = baseline - (tick / 100) * COMPARISON_PLOT.height
          return (
            <g key={tick}>
              <line
                className="compare-coordinate-grid"
                x1={COMPARISON_PLOT.left}
                x2={COMPARISON_PLOT.left + COMPARISON_PLOT.width}
                y1={y}
                y2={y}
              />
              <text
                className="compare-coordinate-tick tabular-number"
                x={COMPARISON_PLOT.left - 12}
                y={y + 4}
                textAnchor="end"
              >
                {tick}
              </text>
            </g>
          )
        })}
        <line
          className="compare-coordinate-axis"
          x1={COMPARISON_PLOT.left}
          x2={COMPARISON_PLOT.left}
          y1={COMPARISON_PLOT.top}
          y2={baseline}
        />
        <line
          className="compare-coordinate-axis"
          x1={COMPARISON_PLOT.left}
          x2={COMPARISON_PLOT.left + COMPARISON_PLOT.width}
          y1={baseline}
          y2={baseline}
        />
        {rows.map(({ left, right }, index) => {
          const center = COMPARISON_PLOT.left + groupWidth * (index + 0.5)
          const leftX = center - barGap / 2 - barWidth
          const rightX = center + barGap / 2
          const labelLines = comparisonAxisLabel(left.label)
          return (
            <g key={left.id}>
              {bar(left.score, leftX, "left", `${left.id}-left`)}
              {bar(right?.score ?? null, rightX, "right", `${left.id}-right`)}
              <text
                className="compare-coordinate-label"
                x={center}
                y={baseline + 28}
                textAnchor="middle"
              >
                {labelLines.map((line, lineIndex) => (
                  <tspan key={line} x={center} dy={lineIndex === 0 ? 0 : 16}>
                    {line}
                  </tspan>
                ))}
              </text>
            </g>
          )
        })}
      </svg>
      <p className="compare-coordinate-note">
        <span data-series="left">{leftName}</span>
        <span data-series="right">{rightName}</span>
        <small>同组柱并列比较；数值越高表示该维度风险越高。</small>
      </p>
    </div>
  )
}

function ComparisonRow({
  left,
  right,
  leftName,
  rightName,
}: {
  left: ComparisonDimension
  right: ComparisonDimension | null
  leftName: string
  rightName: string
}) {
  const leftScore = left.score
  const rightScore = right?.score ?? null
  const comparable = leftScore !== null && rightScore !== null
  const delta =
    comparable && leftScore !== null && rightScore !== null
      ? leftScore - rightScore
      : null
  const difference =
    delta === null
      ? "暂不可比"
      : Math.abs(delta) < 5
        ? "差异较小"
        : delta > 0
          ? `${leftName}风险分值更高`
          : `${rightName}风险分值更高`
  const leftBasis = formatDimensionScoreBasis(left)
  const rightBasis = formatDimensionScoreBasis(right)

  return (
    <tr>
      <th scope="row">{left.label}</th>
      <td className="tabular-number">{left.score ?? "暂无可比分值"}</td>
      <td className="tabular-number">{right?.score ?? "暂无可比分值"}</td>
      <td>
        <Badge
          variant="outline"
          className={cn(
            "status-badge",
            delta === null
              ? "status-neutral"
              : Math.abs(delta) < 5
                ? "status-success"
                : "status-warning"
          )}
        >
          {delta !== null && Math.abs(delta) < 5 ? (
            <CheckCircle2Icon aria-hidden="true" />
          ) : null}
          {difference}
        </Badge>
      </td>
      <td className="tabular-number">
        {comparable
          ? left.comparisonDetail && right?.comparisonDetail
            ? `${leftBasis} / ${rightBasis} · ${left.comparisonDetail}`
            : `${leftBasis} / ${rightBasis} · ${left.evidenceIds.length} / ${right?.evidenceIds.length ?? 0} 条评分证据`
          : `${leftBasis} / ${rightBasis}；至少一方尚未完成评分证据闭环`}
      </td>
    </tr>
  )
}
