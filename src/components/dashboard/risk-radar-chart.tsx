import { useId } from "react"

import { LiquidGlassSurface } from "@/components/liquid"
import { buildRiskRadarModel } from "@/lib/risk-radar"
import type { RiskAssessmentDimension } from "@/types/risk"

type RiskRadarChartProps = {
  dimensions: RiskAssessmentDimension[]
}

function formatDimensionScoreBasis(
  dimension: RiskAssessmentDimension | undefined
) {
  if (!dimension || dimension.score === null) {
    return "尚未建立评分依据"
  }

  if (dimension.scoreBasis === "technology-auto-score") {
    return "技术自动评分"
  }

  if (dimension.scoreBasis === "indicator-observation") {
    return "人工复核观测"
  }

  return "已建立辅助研判分值"
}

export function RiskRadarChart({ dimensions }: RiskRadarChartProps) {
  const model = buildRiskRadarModel(dimensions)
  const dimensionById = new Map(
    dimensions.map((dimension) => [dimension.id, dimension])
  )
  const hasAutomaticScore = dimensions.some(
    (dimension) =>
      dimension.score !== null &&
      dimension.scoreBasis === "technology-auto-score"
  )
  const hasReviewedObservation = dimensions.some(
    (dimension) =>
      dimension.score !== null &&
      dimension.scoreBasis === "indicator-observation"
  )
  const scoreBasisHeading =
    hasAutomaticScore && hasReviewedObservation
      ? "自动评分与人工复核"
      : hasAutomaticScore
        ? "技术自动评分"
        : hasReviewedObservation
          ? "人工复核观测"
          : "评分证据闭环"
  const accessibleTitleId = useId()
  const accessibleDescriptionId = useId()
  const fillGradientId = `${useId().replaceAll(":", "")}-radar-fill`
  const pointGradientId = `${useId().replaceAll(":", "")}-radar-point`

  return (
    <LiquidGlassSurface
      variant="card"
      refractive
      className="risk-radar-glass"
      padding="0"
    >
      <div
        className="risk-radar"
        data-plot-mode={model.polygonPoints ? "polygon" : "points"}
      >
        <div className="risk-radar-heading">
          <div>
            <span>{scoreBasisHeading}</span>
            <strong>六维风险雷达</strong>
          </div>
          <p>
            <b>{model.assessableCount}/6</b>
            个维度已建立
          </p>
        </div>

        <div className="risk-radar-visual">
          <svg
            viewBox={model.viewBox}
            role="img"
            aria-labelledby={`${accessibleTitleId} ${accessibleDescriptionId}`}
            preserveAspectRatio="xMidYMid meet"
          >
            <title id={accessibleTitleId}>六维风险辅助研判雷达图</title>
            <desc id={accessibleDescriptionId}>
              仅绘制已完成评分依据和有效证据闭环的风险维度；技术风险可采用自动评分，其他维度可采用人工复核观测。缺失维度显示待建立，不按零分绘制。
            </desc>
            <defs>
              <linearGradient
                id={fillGradientId}
                x1="0%"
                y1="0%"
                x2="100%"
                y2="100%"
              >
                <stop offset="0%" className="risk-radar-gradient-start" />
                <stop offset="100%" className="risk-radar-gradient-end" />
              </linearGradient>
              <radialGradient id={pointGradientId}>
                <stop offset="0%" className="risk-radar-point-core" />
                <stop offset="100%" className="risk-radar-point-edge" />
              </radialGradient>
            </defs>

            <g className="risk-radar-grid" aria-hidden="true">
              {model.rings.map((ring) => (
                <polygon
                  key={ring.value}
                  points={ring.points}
                  data-ring={ring.value}
                />
              ))}
              {model.axes.map((axis) => (
                <line
                  key={axis.id}
                  x1={model.center.x}
                  y1={model.center.y}
                  x2={axis.end.x}
                  y2={axis.end.y}
                  data-state={axis.score === null ? "missing" : "reviewed"}
                />
              ))}
            </g>

            {model.polygonPoints ? (
              <polygon
                className="risk-radar-area"
                points={model.polygonPoints}
                fill={`url(#${fillGradientId})`}
                aria-hidden="true"
              />
            ) : null}

            <g className="risk-radar-points" aria-hidden="true">
              {model.plotPoints.map((point) => (
                <g key={point.id}>
                  <circle
                    className="risk-radar-point-halo"
                    cx={point.x}
                    cy={point.y}
                    r="9"
                  />
                  <circle
                    className="risk-radar-point"
                    cx={point.x}
                    cy={point.y}
                    r="5"
                    fill={`url(#${pointGradientId})`}
                  />
                </g>
              ))}
            </g>

            <circle
              className="risk-radar-center"
              cx={model.center.x}
              cy={model.center.y}
              r="3"
              aria-hidden="true"
            />

            <g className="risk-radar-labels" aria-hidden="true">
              {model.axes.map((axis) => (
                <text
                  key={axis.id}
                  x={axis.labelPoint.x}
                  y={axis.labelPoint.y}
                  textAnchor={axis.textAnchor}
                  data-state={axis.score === null ? "missing" : "reviewed"}
                >
                  <tspan x={axis.labelPoint.x} dy="-0.25em">
                    {axis.label}
                  </tspan>
                  <tspan
                    className="risk-radar-label-score"
                    x={axis.labelPoint.x}
                    dy="1.45em"
                  >
                    {axis.score === null ? "待建立" : `${axis.score} 分`}
                  </tspan>
                </text>
              ))}
            </g>
          </svg>
        </div>

        <ul className="risk-radar-values" aria-label="六类风险评分明细">
          {model.axes.map((axis) => (
            <li
              key={axis.id}
              data-state={axis.score === null ? "missing" : "reviewed"}
            >
              <i aria-hidden="true" />
              <span>
                <strong>{axis.label}</strong>
                <small>
                  {formatDimensionScoreBasis(dimensionById.get(axis.id))}
                </small>
              </span>
              <b>{axis.score === null ? "待建立" : axis.score}</b>
            </li>
          ))}
        </ul>

        <p className="risk-radar-note">
          待建立表示证据闭环尚未完成，不代表零分或低风险。
        </p>
      </div>
    </LiquidGlassSurface>
  )
}
