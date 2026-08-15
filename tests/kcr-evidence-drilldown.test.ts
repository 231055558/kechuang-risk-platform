import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const projectRoot = dirname(
  fileURLToPath(new URL("../package.json", import.meta.url))
)

function readProjectFile(path: string) {
  return readFileSync(join(projectRoot, path), "utf8")
}

test("five V3 dimension cards open the indicator and evidence drilldown", () => {
  const panel = readProjectFile(
    "src/components/dashboard/kcr-v3-assessment-panel.tsx"
  )

  assert.match(panel, /onSelectDimension\(dimension\.dimensionId\)/)
  assert.match(panel, /查看\$\{dimension\.label\}的/)
  assert.match(panel, /assessment\.indicatorResults\.filter/)
  assert.match(panel, /<KcrEvidenceDrilldown/)
  assert.doesNotMatch(panel, /指标贡献和证据下钻将在下一任务节点接入/)
})

test("drilldown exposes workbook rationale, formula, source locator and safe links", () => {
  const drilldown = readProjectFile(
    "src/components/dashboard/kcr-evidence-drilldown.tsx"
  )

  assert.match(drilldown, /KCR V3 可解释证据链/)
  assert.match(drilldown, /工作簿评分依据/)
  assert.match(drilldown, /indicator\.formulaTrace/)
  assert.match(drilldown, /本指标引用位置/)
  assert.match(drilldown, /来源覆盖范围/)
  assert.match(drilldown, /推断依据/)
  assert.match(drilldown, /背景材料仅用于交叉核验/)
  assert.match(drilldown, /target="_blank"/)
  assert.match(drilldown, /rel="noreferrer noopener"/)
})
