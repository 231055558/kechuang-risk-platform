import { CANONICAL_RISK_DIMENSION_LABELS } from "./risk-dimensions.ts"
import type {
  CanonicalRiskDimensionId,
  RiskAssessmentDimension,
} from "@/types/risk"

export const RISK_RADAR_DIMENSION_ORDER = [
  "narrative",
  "technology",
  "compliance",
  "finance",
  "external",
  "personnel",
] as const satisfies readonly CanonicalRiskDimensionId[]

const VIEWBOX_WIDTH = 640
const VIEWBOX_HEIGHT = 440
const CENTER_X = VIEWBOX_WIDTH / 2
const CENTER_Y = 208
const PLOT_RADIUS = 142
const LABEL_RADIUS = 184
const RING_VALUES = [25, 50, 75, 100] as const

type RadarPoint = {
  id: CanonicalRiskDimensionId
  x: number
  y: number
}

export type RiskRadarAxis = {
  id: CanonicalRiskDimensionId
  label: string
  score: number | null
  end: RadarPoint
  point: RadarPoint | null
  labelPoint: RadarPoint
  textAnchor: "start" | "middle" | "end"
}

export type RiskRadarModel = {
  viewBox: string
  center: { x: number; y: number }
  axes: RiskRadarAxis[]
  rings: Array<{ value: number; points: string }>
  plotPoints: RadarPoint[]
  polygonPoints: string | null
  assessableCount: number
}

function roundCoordinate(value: number) {
  return Number(value.toFixed(2))
}

function pointAt(
  id: CanonicalRiskDimensionId,
  angle: number,
  radius: number
): RadarPoint {
  return {
    id,
    x: roundCoordinate(CENTER_X + Math.cos(angle) * radius),
    y: roundCoordinate(CENTER_Y + Math.sin(angle) * radius),
  }
}

function serializePoints(points: Array<Pick<RadarPoint, "x" | "y">>) {
  return points.map((point) => `${point.x},${point.y}`).join(" ")
}

function clampScore(score: number | null | undefined) {
  if (score === null || score === undefined || !Number.isFinite(score)) {
    return null
  }

  return Math.min(100, Math.max(0, score))
}

export function buildRiskRadarModel(
  dimensions: RiskAssessmentDimension[]
): RiskRadarModel {
  const dimensionMap = new Map(
    dimensions.map((dimension) => [dimension.id, dimension])
  )

  const axes = RISK_RADAR_DIMENSION_ORDER.map((id, index) => {
    const angle = -Math.PI / 2 + (index * Math.PI) / 3
    const score = clampScore(dimensionMap.get(id)?.score)
    const end = pointAt(id, angle, PLOT_RADIUS)
    const labelPoint = pointAt(id, angle, LABEL_RADIUS)
    const horizontalDirection = Math.cos(angle)

    return {
      id,
      label: CANONICAL_RISK_DIMENSION_LABELS[id],
      score,
      end,
      point:
        score === null ? null : pointAt(id, angle, (score / 100) * PLOT_RADIUS),
      labelPoint,
      textAnchor:
        Math.abs(horizontalDirection) < 0.1
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
        RISK_RADAR_DIMENSION_ORDER.map((id, index) =>
          pointAt(
            id,
            -Math.PI / 2 + (index * Math.PI) / 3,
            (value / 100) * PLOT_RADIUS
          )
        )
      ),
    })),
    plotPoints,
    polygonPoints: plotPoints.length >= 3 ? serializePoints(plotPoints) : null,
    assessableCount: plotPoints.length,
  }
}
