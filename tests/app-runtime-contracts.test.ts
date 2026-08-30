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

test("new MVP sessions default to the company with the R01–R22 industry workspace", () => {
  const dataSource = readProjectFile("src/lib/data-r01.ts")

  assert.match(
    dataSource,
    /export const defaultCompanyId = detailRegistry\["star-688256"\][\s\S]*\? "star-688256"/
  )
})

test("failed lazy views render a retryable local error boundary", () => {
  const appSource = readProjectFile("src/App.tsx")

  assert.match(appSource, /class ViewLoadErrorBoundary extends Component/)
  assert.match(appSource, /static getDerivedStateFromError/)
  assert.match(
    appSource,
    /setLazyTabs\(\(current\) =>[\s\S]*createLazyViewComponent\(view\)/
  )
  assert.match(
    appSource,
    /<ViewLoadErrorBoundary[\s\S]*onRetry=\{retryViewLoad\}[\s\S]*<Suspense fallback=\{<TabSkeleton \/>\}>/
  )
})

test("navigation commits only successfully loaded views", () => {
  const appSource = readProjectFile("src/App.tsx")

  assert.match(
    appSource,
    /const \[committedView, setCommittedView\] = useState<TabValue>/
  )
  assert.match(
    appSource,
    /const previousView = committedViewRef\.current[\s\S]*setActiveView\(view\)[\s\S]*await prepareView\(view\)/
  )
  assert.match(
    appSource,
    /if \(!ready\) \{[\s\S]*setActiveView\(previousView\)[\s\S]*return false/
  )
  assert.match(
    appSource,
    /committedViewRef\.current = view[\s\S]*setCommittedView\(view\)/
  )
})

test("company changes invalidate pending structured navigation and focus state", () => {
  const appSource = readProjectFile("src/App.tsx")
  const sidebarSource = readProjectFile("src/components/layout/sidebar-nav.tsx")

  assert.match(
    appSource,
    /const handleCompanyChange = \(value: string\) => \{[\s\S]*navigationRequestRef\.current \+= 1[\s\S]*navigationTargetRequestRef\.current \+= 1/
  )
  assert.match(
    appSource,
    /const companyIdRef = useRef\(restoredState\.companyId\)/
  )
  assert.match(
    appSource,
    /setFocusedRealtimeSignalId\(null\)[\s\S]*setFocusedEventId\(null\)/
  )
  assert.match(
    sidebarSource,
    /pendingNavigation\?\.companyId === companyId[\s\S]*pendingNavigation\.itemId[\s\S]*activeNavigationItem/
  )
})

test("session persistence is synchronous and flushes on pagehide", () => {
  const appSource = readProjectFile("src/App.tsx")

  assert.doesNotMatch(
    appSource,
    /useEffect\(\(\) => \{\s*const timer = window\.setTimeout\(\(\) => \{\s*const saved = saveDemoState/
  )
  assert.match(appSource, /const demoStateSnapshot = useMemo<DemoState>/)
  assert.match(
    appSource,
    /window\.addEventListener\("pagehide", persistLatestState\)/
  )
  assert.match(appSource, /commitDemoState/)
})

test("exports share guarded loading, execution, and feedback", () => {
  const appSource = readProjectFile("src/App.tsx")

  assert.match(
    appSource,
    /const exportInProgressRef = useRef<ExportKind \| null>/
  )
  assert.match(
    appSource,
    /const runExport = async \(kind: ExportKind\) => \{[\s\S]*try \{[\s\S]*await loadReportExport\(\)[\s\S]*catch[\s\S]*finally/
  )
  assert.match(appSource, /disabled=\{exportInProgress !== null\}/)
  assert.match(appSource, /aria-busy=\{pending\}/)
  assert.doesNotMatch(
    appSource,
    /onClick=\{async \(\) => \{\s*const \{ (?:printRiskSummary|exportEventsCsv|exportRiskSummaryPng) \} = await loadReportExport/
  )
})

test("restored and interactive comparison companies cannot equal the primary", () => {
  const appSource = readProjectFile("src/App.tsx")

  assert.match(appSource, /function resolveCompareCompanyId\(/)
  assert.match(
    appSource,
    /requestedCompanyId !== companyId[\s\S]*detailRegistry\[requestedCompanyId\]/
  )
  assert.match(
    appSource,
    /compareCompanyId: resolveCompareCompanyId\([\s\S]*restored\.compareCompanyId/
  )
  assert.match(
    appSource,
    /const handleCompareCompanyChange = \(value: string\)/
  )
  assert.match(
    appSource,
    /onCompareCompanyIdChange=\{handleCompareCompanyChange\}/
  )
})

test("customer metrics replace the manual scoring workspace while technology tools stay isolated", () => {
  const appSource = readProjectFile("src/App.tsx")
  const intelligenceSource = readProjectFile(
    "src/components/dashboard/intelligence-tab.tsx"
  )
  const technologyWorkspaceSource = readProjectFile(
    "src/components/dashboard/technology-scoring-panel.tsx"
  )

  assert.match(appSource, /const scoringCreateRequestRef = useRef\(0\)/)
  assert.match(
    appSource,
    /const accepted = await handleNavigationTarget\(\{\s*view: "intelligence",\s*researchSection: "metrics",\s*\}\)[\s\S]*if \(accepted\) \{[\s\S]*scoringCreateRequestRef\.current \+= 1[\s\S]*setScoringCreateToken\(scoringCreateRequestRef\.current\)/
  )
  assert.match(
    appSource,
    /const handleCreateObservationRequestHandled = useCallback\(\(\) => \{[\s\S]*setScoringCreateToken\(0\)/
  )
  assert.doesNotMatch(intelligenceSource, /<ScoringWorkspace/)
  assert.match(
    intelligenceSource,
    /<IndicatorAnalysisTab companyId=\{detail\.id\}/
  )
  assert.match(
    technologyWorkspaceSource,
    /createToken <= lastCreateTokenRef\.current[\s\S]*lastCreateTokenRef\.current = createToken[\s\S]*openIndicatorEditor\([\s\S]*onCreateRequestHandled\(\)/
  )
  assert.match(
    intelligenceSource,
    /<TechnologyScoringPanel[\s\S]*key=\{detail\.id\}[\s\S]*createToken=\{0\}/
  )
})

test("scoring dialog only closes after an actual company change", () => {
  const workspaceSource = readProjectFile(
    "src/components/dashboard/scoring-workspace.tsx"
  )

  assert.match(
    workspaceSource,
    /const previousCompanyIdRef = useRef\(detail\.id\)/
  )
  assert.match(
    workspaceSource,
    /if \(previousCompanyIdRef\.current === detail\.id\) \{[\s\S]*return[\s\S]*\}[\s\S]*previousCompanyIdRef\.current = detail\.id[\s\S]*setDialogOpen\(false\)/
  )
})

test("runtime scoring summaries reach desktop and mobile sidebars", () => {
  const appSource = readProjectFile("src/App.tsx")
  const shellSource = readProjectFile("src/components/layout/app-shell.tsx")

  assert.match(
    appSource,
    /const runtimeCompanySummaries = useMemo\([\s\S]*buildCompanySummaries\(runtimeAssessmentRegistry\)/
  )
  assert.match(
    appSource,
    /<AppShell[\s\S]*companySummaries=\{runtimeCompanySummaries\}/
  )
  assert.equal(
    shellSource.match(/companySummaries=\{companySummaries\}/g)?.length,
    2
  )
})

test("global reset restores scoring state and exports receive runtime bindings", () => {
  const appSource = readProjectFile("src/App.tsx")

  assert.match(
    appSource,
    /const handleResetDemo = \(\) => \{[\s\S]*const scoringSaved = resetScoringWorkspace\(\)[\s\S]*const technologyScoringSaved = resetTechnologyWorkspace\(\)/
  )
  assert.equal(
    appSource.match(/scoringWorkspace\.evidenceBindings/g)?.length,
    6
  )
  assert.match(
    appSource,
    /printRiskSummary\([\s\S]*scoringWorkspace\.evidenceBindings/
  )
  assert.match(
    appSource,
    /exportEventsCsv\([\s\S]*scoringWorkspace\.evidenceBindings/
  )
  assert.match(
    appSource,
    /exportRiskSummaryPng\([\s\S]*scoringWorkspace\.evidenceBindings/
  )
})

test("technology scoring workspace feeds assessments and the research panel", () => {
  const appSource = readProjectFile("src/App.tsx")
  const intelligenceSource = readProjectFile(
    "src/components/dashboard/intelligence-tab.tsx"
  )
  const apiSource = readProjectFile("src/lib/technology-scoring-api.ts")

  assert.match(appSource, /useTechnologyScoringWorkspace\(\)/)
  assert.match(
    appSource,
    /buildAssessmentRegistry\([\s\S]*scoringWorkspace\.observations,[\s\S]*scoringWorkspace\.evidenceBindings,[\s\S]*technologyWorkspace\.companies/
  )
  assert.match(
    appSource,
    /technologyCompanyState=\{[\s\S]*technologyWorkspace\.companies\[detail\.id\]/
  )
  assert.match(appSource, /onScoreTechnology=\{handleScoreTechnology\}/)
  assert.match(
    intelligenceSource,
    /<TechnologyScoringPanel[\s\S]*onScore=\{onScoreTechnology\}[\s\S]*onClear=\{onClearTechnology\}/
  )
  assert.match(
    apiSource,
    /TECHNOLOGY_RISK_SCORE_API_PATH = "api\/v1\/technology-risk\/score"/
  )
  assert.doesNotMatch(
    apiSource,
    /TECHNOLOGY_RISK_SCORE_API_PATH = "\/api\/v1\/technology-risk\/score"/
  )
})

test("local storage failures remain visible in the scoring workspace", () => {
  const appSource = readProjectFile("src/App.tsx")
  const hookSource = readProjectFile("src/hooks/use-scoring-workspace.ts")
  const workspaceSource = readProjectFile(
    "src/components/dashboard/scoring-workspace.tsx"
  )

  assert.match(hookSource, /const \[storageWarning, setStorageWarning\]/)
  assert.match(hookSource, /浏览器无法写入本地存储；刷新后可能丢失/)
  assert.match(appSource, /storageWarning=\{scoringStorageWarning\}/)
  assert.match(
    workspaceSource,
    /\{storageWarning \? \([\s\S]*className="scoring-storage-warning"[\s\S]*role="status"/
  )
})

test("overview renders the industry assessment through an accessible radar", () => {
  const overviewSource = readProjectFile(
    "src/components/dashboard/industry-risk-profile-desk.tsx"
  )
  const radarSource = readProjectFile(
    "src/components/dashboard/industry-risk-radar.tsx"
  )

  assert.match(
    overviewSource,
    /<IndustryRiskRadar[\s\S]*dimensions=\{assessment\.dimensionScores\}/
  )
  assert.match(radarSource, /aria-labelledby=\{`\$\{titleId\} \$\{descriptionId\}`\}/)
  assert.match(radarSource, /<title id=\{titleId\}>/)
  assert.match(radarSource, /<desc id=\{descriptionId\}>/)
  assert.match(radarSource, /五大风险领域评分/)
  assert.match(radarSource, /缺失领域不按零分绘制/)
})

test("assessment views distinguish technology scoring from rule-calculated indicators", () => {
  const radarSource = readProjectFile(
    "src/components/dashboard/risk-radar-chart.tsx"
  )
  const compareSource = readProjectFile(
    "src/components/dashboard/compare-tab.tsx"
  )

  assert.match(radarSource, /dimension\.scoreBasis === "technology-auto-score"/)
  assert.match(radarSource, /技术自动评分/)
  assert.match(radarSource, /指标规则计算/)

  assert.match(
    compareSource,
    /dimension\.scoreBasis === "technology-auto-score"/
  )
  assert.match(compareSource, /统一方法口径/)
  assert.match(compareSource, /技术自动评分/)
  assert.match(compareSource, /指标规则计算/)
})

test("all report formats expose the assessment score basis", () => {
  const reportSource = readProjectFile("src/lib/report-export.ts")

  assert.match(reportSource, /\["评分基础", assessment\.scoreBasisLabel\]/)
  assert.match(
    reportSource,
    /\["维度", "辅助研判分值", "分值来源", "判断摘要", "证据引用"\]/
  )
  assert.match(
    reportSource,
    /评分基础：<\/strong>\$\{escapeHtml\(assessment\.scoreBasisLabel\)\}/
  )
  assert.match(
    reportSource,
    /context\.fillText\(createPngAssessmentMethodText\(assessment\), 78, 178\)/
  )
  assert.doesNotMatch(reportSource, /人工复核辅助分值/)
})
