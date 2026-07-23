import assert from "node:assert/strict"
import test from "node:test"

import {
  getCanonicalRiskDimensionId,
  getCanonicalRiskDimensionIds,
  getCanonicalRiskDimensionLabel,
  getCanonicalRiskDimensionLabels,
} from "../src/lib/risk-dimensions.ts"

test("legacy eight-dimension ids and labels collapse into six canonical risks", () => {
  assert.equal(getCanonicalRiskDimensionId("tech"), "technology")
  assert.equal(getCanonicalRiskDimensionId("网络安全"), "technology")
  assert.equal(getCanonicalRiskDimensionId("知识产权"), "technology")
  assert.equal(getCanonicalRiskDimensionId("知识产权许可合规"), "compliance")
  assert.equal(getCanonicalRiskDimensionId("知识产权诉讼"), "compliance")
  assert.equal(getCanonicalRiskDimensionId("data"), "compliance")
  assert.equal(getCanonicalRiskDimensionId("科技伦理"), "compliance")
  assert.equal(getCanonicalRiskDimensionId("监管政策"), "compliance")
  assert.equal(getCanonicalRiskDimensionId("经营财务"), "finance")
  assert.equal(getCanonicalRiskDimensionId("外部环境/地缘"), "external")
})

test("canonical risk formatters deduplicate ids and expose customer labels", () => {
  assert.deepEqual(
    getCanonicalRiskDimensionIds([
      "tech",
      "cyber",
      "ip",
      "data",
      "regulatory",
      "finance",
      "external",
    ]),
    ["technology", "compliance", "finance", "external"]
  )
  assert.deepEqual(
    getCanonicalRiskDimensionLabels(["tech", "cyber", "data", "ethics"]),
    ["技术风险", "合规风险"]
  )
  assert.equal(getCanonicalRiskDimensionLabel("personnel"), "人员风险")
  assert.equal(getCanonicalRiskDimensionLabel("其他专题"), "其他专题")
})
