import {
  INDUSTRY_RISK_WEIGHTED_DIMENSIONS,
  type IndustryRiskDimensionScore,
  type IndustryRiskWeightedDimensionId,
} from "../domain/industry-risk-v1/index.ts"

export const INDUSTRY_RISK_RADAR_DIMENSION_ORDER = [
  "technology",
  "compliance",
  "finance",
  "external",
  "personnel",
] as const satisfies readonly IndustryRiskWeightedDimensionId[]

const VIEWBOX_WIDTH = 460
const VIEWBOX_HEIGHT = 390
const CENTER_X = VIEWBOX_WIDTH / 2
const CENTER_Y = 184
const PLOT_RADIUS = 124
const LABEL_RADIUS = 158
const RING_VALUES = [25, 50, 75, 100] as const

export interface IndustryRiskRadarPoint {
  id: IndustryRiskWeightedDimensionId
  x: number
  y: number
}

export interface IndustryRiskRadarAxis {
  id: IndustryRiskWeightedDimensionId
  label: string
  score: number | null
  end: IndustryRiskRadarPoint
  point: IndustryRiskRadarPoint | null
  labelPoint: IndustryRiskRadarPoint
  textAnchor: "start" | "middle" | "end"
}

export interface IndustryRiskRadarModel {
  viewBox: string
  center: { x: number; y: number }
  axes: IndustryRiskRadarAxis[]
  rings: Array<{ value: number; points: string }>
  plotPoints: IndustryRiskRadarPoint[]
  centerPoints: string
  polygonPoints: string | null
  assessableCount: number
}

const DIMENSION_LABELS = new Map(
  INDUSTRY_RISK_WEIGHTED_DIMENSIONS.map((dimension) => [
    dimension.id,
    dimension.label,
  ])
)

function roundCoordinate(value: number) {
  return Number(value.toFixed(2))
}

function pointAt(
  id: IndustryRiskWeightedDimensionId,
  angle: number,
  radius: number
): IndustryRiskRadarPoint {
  return {
    id,
    x: roundCoordinate(CENTER_X + Math.cos(angle) * radius),
    y: roundCoordinate(CENTER_Y + Math.sin(angle) * radius),
  }
}

function serializePoints(
  points: Array<Pick<IndustryRiskRadarPoint, "x" | "y">>
) {
  return points.map((point) => `${point.x},${point.y}`).join(" ")
}

function clampScore(score: number | null | undefined) {
  if (score === null || score === undefined || !Number.isFinite(score)) {
    return null
  }

  return Math.min(100, Math.max(0, score))
}

export function buildIndustryRiskRadarModel(
  dimensions: IndustryRiskDimensionScore[]
): IndustryRiskRadarModel {
  const dimensionMap = new Map(
    dimensions.map((dimension) => [dimension.id, dimension])
  )

  const axes = INDUSTRY_RISK_RADAR_DIMENSION_ORDER.map((id, index) => {
    const dimension = dimensionMap.get(id)
    const angle =
      -Math.PI / 2 +
      (index * Math.PI * 2) / INDUSTRY_RISK_RADAR_DIMENSION_ORDER.length
    const score = clampScore(dimension?.score)
    const labelPoint = pointAt(id, angle, LABEL_RADIUS)
    const horizontalDirection = Math.cos(angle)

    return {
      id,
      label: dimension?.label ?? DIMENSION_LABELS.get(id) ?? id,
      score,
      end: pointAt(id, angle, PLOT_RADIUS),
      point:
        score === null ? null : pointAt(id, angle, (score / 100) * PLOT_RADIUS),
      labelPoint,
      textAnchor:
        Math.abs(horizontalDirection) < 0.12
          ? ("middle" as const)
          : horizontalDirection > 0
            ? ("start" as const)
            : ("end" as const),
    }
  })

  const plotPoints = axes.flatMap((axis) => (axis.point ? [axis.point] : []))

  return {
    viewBox: `0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`,
    center: { x: CENTER_X, y: CENTER_Y },
    axes,
    rings: RING_VALUES.map((value) => ({
      value,
      points: serializePoints(
        INDUSTRY_RISK_RADAR_DIMENSION_ORDER.map((id, index) =>
          pointAt(
            id,
            -Math.PI / 2 +
              (index * Math.PI * 2) /
                INDUSTRY_RISK_RADAR_DIMENSION_ORDER.length,
            (value / 100) * PLOT_RADIUS
          )
        )
      ),
    })),
    plotPoints,
    centerPoints: serializePoints(
      plotPoints.map(() => ({ x: CENTER_X, y: CENTER_Y }))
    ),
    polygonPoints:
      plotPoints.length === INDUSTRY_RISK_RADAR_DIMENSION_ORDER.length
        ? serializePoints(plotPoints)
        : null,
    assessableCount: plotPoints.length,
  }
}
