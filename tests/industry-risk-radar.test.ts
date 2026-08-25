import assert from "node:assert/strict"
import test from "node:test"

import type {
  IndustryRiskDimensionScore,
  IndustryRiskWeightedDimensionId,
} from "../src/domain/industry-risk-v1/index.ts"
import {
  buildIndustryRiskRadarModel,
  INDUSTRY_RISK_RADAR_DIMENSION_ORDER,
} from "../src/lib/industry-risk-radar.ts"

function dimension(
  id: IndustryRiskWeightedDimensionId,
  score: number | null,
  label = `${id}-label`
): IndustryRiskDimensionScore {
  return {
    id,
    label,
    score,
    weight: 0.2,
    availableIndicatorCount: score === null ? 0 : 1,
    totalIndicatorCount: 1,
    indicatorIds: [],
    indicatorWeights: {},
    status: score === null ? "missing" : "scored",
  }
}

test("industry radar always uses the fixed five-domain order", () => {
  const model = buildIndustryRiskRadarModel([
    dimension("personnel", 50),
    dimension("finance", 30),
    dimension("technology", 10),
    dimension("external", 40),
    dimension("compliance", 20),
  ])

  assert.deepEqual(
    model.axes.map((axis) => axis.id),
    INDUSTRY_RISK_RADAR_DIMENSION_ORDER
  )
  assert.deepEqual(
    model.axes.map((axis) => axis.score),
    [10, 20, 30, 40, 50]
  )
  assert.equal(model.rings.length, 4)
  assert.equal(model.axes.length, 5)
})

test("scores are clamped to the visible zero-to-one-hundred range", () => {
  const model = buildIndustryRiskRadarModel([
    dimension("technology", -10),
    dimension("compliance", 120),
    dimension("finance", Number.NaN),
  ])

  assert.equal(model.axes[0].score, 0)
  assert.deepEqual(model.axes[0].point, {
    id: "technology",
    ...model.center,
  })
  assert.equal(model.axes[1].score, 100)
  assert.deepEqual(model.axes[1].point, model.axes[1].end)
  assert.equal(model.axes[2].score, null)
  assert.equal(model.axes[2].point, null)
})

test("five available domains close one SVG polygon", () => {
  const model = buildIndustryRiskRadarModel(
    INDUSTRY_RISK_RADAR_DIMENSION_ORDER.map((id, index) =>
      dimension(id, 20 + index * 10)
    )
  )

  assert.equal(model.assessableCount, 5)
  assert.equal(
    model.polygonPoints,
    model.plotPoints.map((point) => `${point.x},${point.y}`).join(" ")
  )
  assert.equal(
    model.centerPoints,
    Array.from({ length: 5 }, () => `${model.center.x},${model.center.y}`).join(
      " "
    )
  )
})

test("a missing domain stays absent and prevents a misleading polygon", () => {
  const model = buildIndustryRiskRadarModel([
    dimension("technology", 20),
    dimension("compliance", 30),
    dimension("finance", null),
    dimension("external", 50),
    dimension("personnel", 60),
  ])
  const financeAxis = model.axes.find((axis) => axis.id === "finance")

  assert.equal(financeAxis?.score, null)
  assert.equal(financeAxis?.point, null)
  assert.equal(model.assessableCount, 4)
  assert.equal(model.plotPoints.length, 4)
  assert.equal(
    model.plotPoints.some((point) => point.id === "finance"),
    false
  )
  assert.equal(model.polygonPoints, null)
})

test("an omitted domain uses its public label but never becomes a zero score", () => {
  const model = buildIndustryRiskRadarModel([
    dimension("technology", 0, "技术能力风险"),
  ])
  const technologyAxis = model.axes.find((axis) => axis.id === "technology")
  const complianceAxis = model.axes.find((axis) => axis.id === "compliance")

  assert.equal(technologyAxis?.label, "技术能力风险")
  assert.equal(technologyAxis?.score, 0)
  assert.ok(technologyAxis?.point)
  assert.equal(complianceAxis?.label, "合规风险")
  assert.equal(complianceAxis?.score, null)
  assert.equal(complianceAxis?.point, null)
})
