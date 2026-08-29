import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const source = readFileSync("src/components/dashboard/compare-tab.tsx", "utf8")
const styles = readFileSync("src/styles/pages.css", "utf8")

test("enterprise comparison uses a grouped 0-100 coordinate chart", () => {
  assert.match(source, /COMPARISON_CHART_TICKS = \[0, 20, 40, 60, 80, 100\]/)
  assert.match(source, /function GroupedRiskChart/)
  assert.match(source, /<svg[\s\S]*?viewBox=/)
  assert.match(source, /风险分值（0–100）/)
  assert.match(source, /data-series=\{series\}/)
  assert.match(source, /data-series="left"/)
  assert.match(source, /data-series="right"/)
  assert.match(source, /缺失项不画零分柱/)
  assert.doesNotMatch(source, /function ChartBar/)
  assert.doesNotMatch(source, /compare-bar-track/)
})

test("coordinate chart keeps distinct enterprise colors and audit text", () => {
  assert.match(
    styles,
    /\.compare-coordinate-bar\s*\{[\s\S]*?fill: var\(--compare-left-chart-color\)/
  )
  assert.match(
    styles,
    /\.compare-coordinate-bar\[data-series="right"\]\s*\{[\s\S]*?fill: var\(--compare-right-chart-color\)/
  )
  assert.match(styles, /\.light \.compare-chart-section/)
  assert.match(styles, /var\(--brand\) 64%, white/)
  assert.match(styles, /var\(--compare-secondary\) 68%/)
  assert.match(source, /aria-describedby="compare-dimension-chart-data"/)
  assert.match(source, /id="compare-dimension-chart-data" className="sr-only"/)
  assert.match(source, /同组柱并列比较；数值越高表示该维度风险越高/)
})
