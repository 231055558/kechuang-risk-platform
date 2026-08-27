import assert from "node:assert/strict"
import test from "node:test"

import {
  calculateAnnualChange,
  calculateDisclosureQuality,
  calculateInnovationActionStrength,
  calculateTone,
  minMaxMap,
  normalizeInformationSufficiency,
  winsorize,
  zScores,
} from "../src/domain/narrative-risk-v1/annual-methodology.ts"

test("信息充分性按0.5和1.0归一化并限制在0至1", () => {
  assert.equal(normalizeInformationSufficiency(0.2), 0)
  assert.equal(normalizeInformationSufficiency(0.5), 0)
  assert.equal(normalizeInformationSufficiency(0.75), 0.5)
  assert.equal(normalizeInformationSufficiency(1), 1)
  assert.equal(normalizeInformationSufficiency(1.8), 1)
})

test("年报披露质量对风险语境模糊度取反并三项等权", () => {
  assert.equal(calculateDisclosureQuality(0.75, 0.2, 0.5), 0.6)
  assert.equal(calculateDisclosureQuality(1.5, 0, 1), 1)
})

test("年度演变率使用绝对值分母和一百万分之一平滑项", () => {
  assert.equal(calculateAnnualChange(null, 1), null)
  assert.equal(calculateAnnualChange(2, null), null)
  assert.ok(Math.abs((calculateAnnualChange(2, 1) ?? 0) - 0.999999) < 1e-6)
  assert.ok(Math.abs((calculateAnnualChange(-1, -2) ?? 0) - 0.49999975) < 1e-6)
})

test("缩尾、标准分和极差映射覆盖边界与零方差", () => {
  assert.deepEqual(winsorize([0, 10, 20], 0.25, 0.75), [5, 10, 15])
  assert.equal(zScores([3, 3, 3]), null)
  const scores = zScores([1, 2, 3])
  assert.ok(scores)
  assert.ok(Math.abs(scores?.[1] ?? 1) < 1e-12)
  assert.equal(minMaxMap([2, 2]), null)
  assert.deepEqual(minMaxMap([2, 4, 6]), [0, 0.5, 1])
})

test("创新行动强度只接受非负整数的年度发明申请数", () => {
  assert.equal(calculateInnovationActionStrength(0), 0)
  assert.equal(calculateInnovationActionStrength(9), Math.log(10))
  assert.throws(() => calculateInnovationActionStrength(-1), RangeError)
  assert.throws(() => calculateInnovationActionStrength(1.5), RangeError)
})

test("管理者语调零分母保持缺失并按新版区间标记", () => {
  assert.deepEqual(calculateTone(0, 0, 100), {
    positiveIntensity: 0,
    negativeIntensity: 0,
    netPositiveTone: null,
    riskLabel: null,
  })
  assert.equal(calculateTone(1, 3, 20).riskLabel, "高风险")
  assert.equal(calculateTone(3, 2, 20).riskLabel, "中风险")
  assert.equal(calculateTone(9, 1, 20).riskLabel, "低风险")
  assert.deepEqual(calculateTone(1, 1, 0), {
    positiveIntensity: null,
    negativeIntensity: null,
    netPositiveTone: null,
    riskLabel: null,
  })
})
