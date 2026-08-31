import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const testDirectory = dirname(fileURLToPath(import.meta.url))
const projectRoot = join(testDirectory, "..")

function readProjectFile(path: string) {
  return readFileSync(join(projectRoot, path), "utf8")
}

test("mobile investor workflows collapse dense surfaces without task selectors", () => {
  const businessStyles = readProjectFile("src/styles/business.css")
  const newsStyles = readProjectFile("src/styles/risk-news.css")
  const indicatorStyles = readProjectFile("src/styles/indicator-analysis.css")
  const operationsStyles = readProjectFile("src/styles/investor-operations.css")
  const eventsSource = readProjectFile(
    "src/components/dashboard/events-tab.tsx"
  )

  assert.match(
    businessStyles,
    /@media \(max-width: 767px\) \{[\s\S]*?\.section-tabs \[data-slot="tabs-trigger"\][\s\S]*?min-width:\s*44px;[\s\S]*?min-height:\s*44px;/
  )
  ;[newsStyles, indicatorStyles, operationsStyles].forEach((source) => {
    assert.match(source, /@media \(max-width: 720px\)/)
  })
  assert.doesNotMatch(eventsSource, /event-select-menu|event-register-status/)
})

test("comparison and investor metric values use tabular numerals", () => {
  const businessStyles = readProjectFile("src/styles/business.css")
  const compareSource = readProjectFile(
    "src/components/dashboard/compare-tab.tsx"
  )
  const indicatorSource = readProjectFile(
    "src/components/dashboard/indicator-analysis-tab.tsx"
  )
  const indicatorStyles = readProjectFile("src/styles/indicator-analysis.css")

  assert.match(
    businessStyles,
    /\.tabular-number\s*\{[\s\S]*?font-variant-numeric:\s*tabular-nums;/
  )
  assert.ok(
    (compareSource.match(/\btabular-number\b/g) ?? []).length >= 8,
    "comparison scores, percentages, coverage and evidence counts should use tabular numerals"
  )
  assert.ok(
    /font-variant-numeric:\s*tabular-nums/.test(indicatorStyles) &&
      /riskPercentile/.test(indicatorSource),
    "indicator scores and percentiles should use tabular numerals"
  )
})

test("risk-news dates use the shared zh-CN formatters and semantic time elements", () => {
  const realtimeSource = readProjectFile(
    "src/components/dashboard/realtime-tab.tsx"
  )

  assert.match(realtimeSource, /from "@\/lib\/date-format"/)
  assert.match(realtimeSource, /formatSourceDateTime\(signal\.publishedAt\)/)
  assert.match(realtimeSource, /formatSourceEventTime\(signal\.publishedAt\)/)
  assert.match(realtimeSource, /dateTime=\{signal\.publishedAt\}/)
})
