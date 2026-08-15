import {
  KCR_RISK_DIMENSION_IDS,
  type KcrAssessmentDimensionResult,
  type KcrRiskDimensionId,
} from "../domain/kcr-v1/index.ts"

const VIEWBOX_WIDTH = 520
const VIEWBOX_HEIGHT = 400
const CENTER_X = VIEWBOX_WIDTH / 2
const CENTER_Y = 184
const PLOT_RADIUS = 124
const LABEL_RADIUS = 158
const RING_VALUES = [25, 50, 75, 100] as const

interface RadarPoint {
  id: KcrRiskDimensionId
  x: number
  y: number
}

export interface KcrRiskRadarAxis {
  id: KcrRiskDimensionId
  label: string
  score: number | null
  end: RadarPoint
  point: RadarPoint | null
  labelPoint: RadarPoint
  textAnchor: "start" | "middle" | "end"
}

export interface KcrRiskRadarModel {
  viewBox: string
  center: { x: number; y: number }
  axes: KcrRiskRadarAxis[]
  rings: Array<{ value: number; points: string }>
  polygonPoints: string | null
}

function roundCoordinate(value: number) {
  return Number(value.toFixed(2))
}

function pointAt(id: KcrRiskDimensionId, angle: number, radius: number) {
  return {
    id,
    x: roundCoordinate(CENTER_X + Math.cos(angle) * radius),
    y: roundCoordinate(CENTER_Y + Math.sin(angle) * radius),
  }
}

function serializePoints(points: Array<Pick<RadarPoint, "x" | "y">>) {
  return points.map((point) => `${point.x},${point.y}`).join(" ")
}

function clampScore(score: number | null) {
  if (score === null || !Number.isFinite(score)) return null
  return Math.min(100, Math.max(0, score))
}

export function buildKcrRiskRadarModel(
  dimensions: KcrAssessmentDimensionResult[]
): KcrRiskRadarModel {
  const dimensionMap = new Map(
    dimensions.map((dimension) => [dimension.dimensionId, dimension])
  )
  const axes = KCR_RISK_DIMENSION_IDS.map((id, index) => {
    const angle = -Math.PI / 2 + (index * Math.PI * 2) / 5
    const score = clampScore(dimensionMap.get(id)?.score ?? null)
    const labelPoint = pointAt(id, angle, LABEL_RADIUS)
    const horizontalDirection = Math.cos(angle)
    return {
      id,
      label: dimensionMap.get(id)?.label ?? id,
      score,
      end: pointAt(id, angle, PLOT_RADIUS),
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
        KCR_RISK_DIMENSION_IDS.map((id, index) =>
          pointAt(
            id,
            -Math.PI / 2 + (index * Math.PI * 2) / 5,
            (value / 100) * PLOT_RADIUS
          )
        )
      ),
    })),
    polygonPoints:
      plotPoints.length === KCR_RISK_DIMENSION_IDS.length
        ? serializePoints(plotPoints)
        : null,
  }
}
