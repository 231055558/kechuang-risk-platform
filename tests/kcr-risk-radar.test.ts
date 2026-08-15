import assert from "node:assert/strict"
import test from "node:test"

import goldenInput from "../src/data/mvp/cambricon-scoring-input-v3.json" with { type: "json" }
import { calculateKcrAssessment } from "../src/domain/kcr-v1/scoring-engine.ts"
import { buildKcrRiskRadarModel } from "../src/lib/kcr-risk-radar.ts"

test("KCR radar preserves the five workbook dimensions and scores", () => {
  const assessment = calculateKcrAssessment(goldenInput)
  const model = buildKcrRiskRadarModel(assessment.dimensions)

  assert.deepEqual(
    model.axes.map((axis) => [axis.id, axis.score]),
    [
      ["technology", 20.8],
      ["compliance", 46.5],
      ["finance", 28.5],
      ["external", 63.75],
      ["personnel-governance", 17.6667],
    ]
  )
  assert.equal(model.rings.length, 4)
  assert.ok(model.polygonPoints)
})

test("KCR radar does not close a misleading polygon with missing dimensions", () => {
  const assessment = calculateKcrAssessment(goldenInput)
  assessment.dimensions[0].score = null
  const model = buildKcrRiskRadarModel(assessment.dimensions)

  assert.equal(model.polygonPoints, null)
  assert.equal(model.axes[0].point, null)
})
