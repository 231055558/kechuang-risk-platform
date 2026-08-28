import { useEffect, useState, type ReactNode } from "react"
import { CheckCircle2Icon, ScaleIcon } from "lucide-react"

import {
  EmptyState,
  ReviewStatusBadge,
  SectionHeader,
} from "@/components/dashboard/shared"
import { LiquidGlassSurface } from "@/components/liquid"
import { Reveal } from "@/components/motion/workflow-transition"
import { Badge } from "@/components/ui/badge"
import {
  calculateNarrativeCompanyDisplayScore,
} from "@/domain/narrative-risk-v1/industry-display-score"
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
    const comparisonDetail =
      "信息模糊性、叙事夸大性、风险披露充分性三项等权"
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
            description={`五项客观风险横条展示双方在同一方法版本与维度口径下形成的风险分值；叙事风险复用年度行业排名加权分的三项等权结果，仅用于对照、不计入综合指数。缺失项不按低风险处理。${leftCompany.name}采用${leftAssessment.scoreBasisLabel}，${rightCompany.name}采用${rightAssessment.scoreBasisLabel}。`}
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
                <div aria-hidden="true">
                  {dimensionRows.map(({ left, right }) => (
                    <div key={left.id} className="compare-chart-row">
                      <div className="compare-chart-label">{left.label}</div>
                      <ChartBar
                        companyName={leftCompany.name}
                        score={left.score}
                        series="left"
                      />
                      <ChartBar
                        companyName={rightCompany.name}
                        score={right?.score ?? null}
                        series="right"
                      />
                    </div>
                  ))}
                </div>
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

      <Reveal>
        <section className="method-boundary-note">
          <ScaleIcon aria-hidden="true" />
          <div>
            <strong>对比边界</strong>
            <p>
              客观风险维度使用同一方法版本 {leftAssessment.methodVersion}
              ，评分基础分别为 {leftAssessment.scoreBasisLabel} 与{" "}
              {rightAssessment.scoreBasisLabel}
              ；叙事风险使用年度行业排名加权展示分，与客观评分相互独立且不计入综合指数。缺失项不会按零分参与计算。
            </p>
          </div>
        </section>
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

function ChartBar({
  companyName,
  score,
  series,
}: {
  companyName: string
  score: number | null
  series: "left" | "right"
}) {
  return (
    <div
      className="compare-bar-track"
      aria-label={`${companyName}：${score === null ? "数据待补充" : `${score}分`}`}
    >
      {score === null ? (
        <span className="compare-bar-missing">暂无可比分值</span>
      ) : (
        <>
          <span
            className="compare-bar-fill"
            data-series={series}
            style={{ width: `${score}%` }}
          />
          <strong className="tabular-number">{score}</strong>
        </>
      )}
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
