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

test("horizontal section tabs keep keyboard focus fully visible", () => {
  const tabsSource = readProjectFile("src/components/ui/tabs.tsx")
  const businessStyles = readProjectFile("src/styles/business.css")

  assert.match(tabsSource, /onFocus=\{handleFocus\}/)
  assert.match(
    tabsSource,
    /scrollIntoView\(\{[\s\S]*?block:\s*"nearest"[\s\S]*?inline:\s*"nearest"[\s\S]*?\}\)/
  )
  assert.match(
    businessStyles,
    /\.section-tabs > \[data-slot="tabs-list"\][\s\S]*?scroll-padding-inline:\s*8px;/
  )
  assert.match(
    businessStyles,
    /\.section-tabs \[data-slot="tabs-trigger"\][\s\S]*?scroll-margin-inline:\s*8px;/
  )
})

test("narrow section tabs expose every destination without hidden horizontal overflow", () => {
  const businessStyles = readProjectFile("src/styles/business.css")
  const pageStyles = readProjectFile("src/styles/pages.css")

  assert.match(
    businessStyles,
    /@media \(max-width:\s*360px\)\s*\{[\s\S]*?\.section-tabs > \[data-slot="tabs-list"\]\s*\{[\s\S]*?display:\s*grid;[\s\S]*?grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);[\s\S]*?overflow-x:\s*visible;/
  )
  assert.match(
    businessStyles,
    /@media \(max-width:\s*360px\)\s*\{[\s\S]*?\.section-tabs \[data-slot="tabs-trigger"\]\s*\{[\s\S]*?width:\s*100%;[\s\S]*?min-width:\s*0;/
  )
  assert.match(
    pageStyles,
    /\.section-tabs\.research-section-tabs > \[data-slot="tabs-list"\]\s*\{[\s\S]*?align-self:\s*center;[\s\S]*?margin-inline:\s*auto;/
  )
  assert.match(
    pageStyles,
    /@media \(max-width:\s*767px\)\s*\{[\s\S]*?\.section-tabs\.research-section-tabs > \[data-slot="tabs-list"\]\s*\{[\s\S]*?display:\s*grid;[\s\S]*?grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);[\s\S]*?overflow-x:\s*visible;/
  )
})

test("the focused skip link clears the mobile navigation control", () => {
  const shellStyles = readProjectFile("src/styles/shell.css")

  assert.match(shellStyles, /\.skip-link\s*\{[\s\S]*?pointer-events:\s*none;/)
  assert.match(
    shellStyles,
    /\.skip-link:focus-visible\s*\{[\s\S]*?pointer-events:\s*auto;/
  )
  assert.match(
    shellStyles,
    /@media \(max-width:\s*767px\)\s*\{[\s\S]*?\.skip-link\s*\{[\s\S]*?top:\s*82px;[\s\S]*?left:\s*16px;/
  )
})

test("wide comparison and disclosure tables expose keyboard scroll regions", () => {
  const compareSource = readProjectFile(
    "src/components/dashboard/compare-tab.tsx"
  )
  const intelligenceSource = readProjectFile(
    "src/components/dashboard/intelligence-tab.tsx"
  )
  const businessStyles = readProjectFile("src/styles/business.css")

  assert.match(
    compareSource,
    /className="disclosure-table-wrap"[\s\S]*?role="region"[\s\S]*?tabIndex=\{0\}[\s\S]*?aria-label=\{`\$\{leftCompany\.name\}与\$\{rightCompany\.name\}风险差异数据表`\}/
  )
  assert.match(
    intelligenceSource,
    /className="disclosure-table-wrap"[\s\S]*?role="region"[\s\S]*?tabIndex=\{0\}[\s\S]*?aria-label=\{`\$\{detail\.name\}公开披露背景数据表`\}/
  )
  assert.match(
    businessStyles,
    /\.disclosure-table-wrap:focus-visible\s*\{[\s\S]*?outline:\s*2px solid/
  )
})

test("risk-news search exposes native search semantics", () => {
  const realtimeSource = readProjectFile(
    "src/components/dashboard/realtime-tab.tsx"
  )

  assert.match(realtimeSource, /type="search"/)
  assert.match(realtimeSource, /name="risk-news-search"/)
  assert.match(realtimeSource, /autoComplete="off"/)
  assert.match(realtimeSource, /aria-label="搜索风险资讯"/)
})

test("investor analysis preserves missing values as an auditable state", () => {
  const overviewSource = readProjectFile(
    "src/components/dashboard/industry-risk-review-panel.tsx"
  )
  const indicatorSource = readProjectFile(
    "src/components/dashboard/indicator-analysis-tab.tsx"
  )
  const indicatorStyles = readProjectFile("src/styles/indicator-analysis.css")

  assert.doesNotMatch(overviewSource, /缺失不补零/)
  assert.match(indicatorSource, /data-missing=\{metric\.riskPercentile === null\}/)
  assert.match(indicatorSource, /metric\.rawValue === null[\s\S]*?"缺失"/)
  assert.match(
    indicatorStyles,
    /\[data-missing="true"\][\s\S]*?repeating-linear-gradient/
  )
})

test("comparison summaries compact when neither company has an assessable dimension", () => {
  const compareSource = readProjectFile(
    "src/components/dashboard/compare-tab.tsx"
  )
  const pageStyles = readProjectFile("src/styles/pages.css")

  assert.match(compareSource, /const bothAssessmentsUnassessable =/)
  assert.match(compareSource, /compact=\{bothAssessmentsUnassessable\}/)
  assert.match(compareSource, /data-compact=\{compact\}/)
  assert.match(
    pageStyles,
    /\.company-assessment-summary\[data-compact="true"\]\s*\{[\s\S]*?padding:\s*16px 18px;/
  )
})

test("enterprise research records reserve their real height on first paint", () => {
  const pageStyles = readProjectFile("src/styles/pages.css")

  assert.doesNotMatch(
    pageStyles,
    /\.research-record-group\s*\{[^}]*content-visibility:\s*auto/s
  )
  assert.doesNotMatch(
    pageStyles,
    /\.research-record-group\s*\{[^}]*contain-intrinsic-size:/s
  )
})
