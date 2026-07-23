import assert from "node:assert/strict"
import test from "node:test"

import {
  buildRiskRadarModel,
  RISK_RADAR_DIMENSION_ORDER,
} from "../src/lib/risk-radar.ts"
import type { RiskAssessmentDimension } from "../src/types/risk.ts"

function dimension(
  id: RiskAssessmentDimension["id"],
  score: number | null
): RiskAssessmentDimension {
  return {
    id,
    label: `${id}-label`,
    score,
    level: score === null ? null : "attention",
    assessable: score !== null,
    scoreBasis: score === null ? null : "indicator-observation",
    summary: score === null ? "待建立" : "已复核",
    evidenceIds: [],
    indicatorIds: [],
    evidenceIndicatorPairCount: 0,
  }
}

test("risk radar preserves the canonical six-dimension order", () => {
  const model = buildRiskRadarModel([
    dimension("personnel", null),
    dimension("finance", 60),
    dimension("narrative", 25),
    dimension("external", null),
    dimension("compliance", 85),
    dimension("technology", 60),
  ])

  assert.deepEqual(
    model.axes.map((axis) => axis.id),
    RISK_RADAR_DIMENSION_ORDER
  )
})

test("missing dimensions remain null and never become zero-value plot points", () => {
  const model = buildRiskRadarModel([
    dimension("narrative", 25),
    dimension("technology", null),
  ])

  const technology = model.axes.find((axis) => axis.id === "technology")

  assert.equal(technology?.score, null)
  assert.equal(technology?.point, null)
  assert.equal(model.plotPoints.length, 1)
  assert.equal(model.assessableCount, 1)
  assert.equal(model.polygonPoints, null)
})

test("one or two reviewed dimensions render points without a polygon", () => {
  const model = buildRiskRadarModel([
    dimension("narrative", 25),
    dimension("technology", 60),
  ])

  assert.equal(model.plotPoints.length, 2)
  assert.equal(model.polygonPoints, null)
})

test("three or more reviewed dimensions create a polygon from reviewed points only", () => {
  const model = buildRiskRadarModel([
    dimension("narrative", 25),
    dimension("technology", 60),
    dimension("compliance", null),
    dimension("finance", 85),
    dimension("external", null),
    dimension("personnel", null),
  ])

  assert.equal(model.plotPoints.length, 3)
  assert.equal(
    model.polygonPoints,
    model.plotPoints.map((point) => `${point.x},${point.y}`).join(" ")
  )
  assert.equal(
    model.plotPoints.some((point) => point.id === "compliance"),
    false
  )
})

test("scores are clamped to the visible zero-to-one-hundred chart range", () => {
  const model = buildRiskRadarModel([
    dimension("narrative", -10),
    dimension("technology", 120),
  ])

  assert.equal(model.axes[0].score, 0)
  assert.equal(model.axes[1].score, 100)
})
