import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import { demoPercentileForMissingHeat } from "../src/lib/demo-heat.ts"

test("演示热力补全围绕同业均值稳定生成且不修改输入", () => {
  const observed = [0.2, 0.4, 0.6, null]
  const snapshot = structuredClone(observed)
  const first = demoPercentileForMissingHeat("star-688256", "R17", observed)
  const second = demoPercentileForMissingHeat("star-688256", "R17", observed)

  assert.equal(first, second)
  assert.ok(first >= 0.32 && first <= 0.48)
  assert.deepEqual(observed, snapshot)
})

test("全列缺失时使用中位演示基线且企业之间存在确定性差异", () => {
  const left = demoPercentileForMissingHeat("company-a", "R21", [])
  const right = demoPercentileForMissingHeat("company-b", "R21", [])

  assert.ok(left >= 0.42 && left <= 0.58)
  assert.ok(right >= 0.42 && right <= 0.58)
  assert.notEqual(left, right)
})

test("演示补全只进入前端矩阵，不覆盖事实字段", () => {
  const component = readFileSync(
    "src/components/dashboard/indicator-analysis-tab.tsx",
    "utf8"
  )
  const service = readFileSync("server/industry-risk-service.ts", "utf8")

  assert.match(component, /demoPercentileForMissingHeat/)
  assert.match(component, /data-demo-imputed/)
  assert.match(component, /演示补全/)
  assert.doesNotMatch(service, /demoPercentileForMissingHeat|demo-imputed/)
})
