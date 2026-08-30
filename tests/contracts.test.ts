import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import {
  createInitialDemoState,
  DEMO_STATE_STORAGE_KEY,
  DEMO_STATE_VERSION,
  migrateDemoState,
} from "../src/lib/demo-state.ts"
import {
  getNavigationItemIdForTarget,
  navGroups,
  navItems,
  resolveActiveNavigationItem,
} from "../src/lib/nav-data.ts"
import {
  formatDataSourceLabel,
  isCandidateDataSource,
} from "../src/lib/source-governance.ts"

const testDirectory = dirname(fileURLToPath(import.meta.url))
const projectRoot = join(testDirectory, "..")

function readProjectFile(path: string) {
  return readFileSync(join(projectRoot, path), "utf8")
}

test("glass styles keep the standard backdrop declaration last", () => {
  const styleFiles = [
    "src/styles/theme.css",
    "src/styles/shell.css",
    "src/styles/pages.css",
    "src/styles/business.css",
  ]
  const reversedPair =
    /^(\s*)backdrop-filter:\s*([^;\n]+);\n\1-webkit-backdrop-filter:\s*\2;/gm
  const backdropDeclaration = /^(\s*)backdrop-filter:\s*([^;\n]+);/gm

  styleFiles.forEach((path) => {
    const source = readProjectFile(path)
    assert.doesNotMatch(
      source,
      reversedPair,
      `${path} must place -webkit-backdrop-filter before backdrop-filter`
    )

    for (const match of source.matchAll(backdropDeclaration)) {
      if (match[2].trim() === "none") {
        continue
      }

      const declarationStart = match.index ?? 0
      const previousLineStart =
        source.lastIndexOf("\n", declarationStart - 2) + 1
      const previousLine = source.slice(previousLineStart, declarationStart)
      assert.match(
        previousLine,
        new RegExp(
          `^${match[1]}-webkit-backdrop-filter:\\s*${match[2].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")};\\n$`
        ),
        `${path}:${source.slice(0, declarationStart).split("\n").length} must pair -webkit-backdrop-filter with backdrop-filter`
      )
    }
  })
})

test("navigation exposes the nine approved investor workflows", () => {
  assert.equal(navItems.length, 9)
  assert.equal(new Set(navItems.map((item) => item.id)).size, navItems.length)
  assert.equal(
    new Set(navItems.map((item) => item.label)).size,
    navItems.length
  )
  assert.deepEqual(
    navItems.map(({ id, label, group, target }) => ({
      id,
      label,
      group,
      target,
    })),
    [
      {
        id: "risk-assessment",
        label: "风险总览",
        group: "风险研判",
        target: { view: "overview" },
      },
      {
        id: "indicator-analysis",
        label: "指标分析",
        group: "风险研判",
        target: { view: "intelligence", researchSection: "metrics" },
      },
      {
        id: "narrative-risk",
        label: "叙事风险",
        group: "风险研判",
        target: { view: "narrative" },
      },
      {
        id: "risk-transmission",
        label: "风险传导",
        group: "风险研判",
        target: { view: "events", operationsSection: "transmission" },
      },
      {
        id: "realtime-intelligence",
        label: "风险资讯",
        group: "信息与比较",
        target: { view: "realtime" },
      },
      {
        id: "comparison",
        label: "企业对比",
        group: "信息与比较",
        target: { view: "compare" },
      },
      {
        id: "risk-reports",
        label: "企业报告",
        group: "输出与策略",
        target: { view: "reports" },
      },
      {
        id: "investment-research",
        label: "投资研判",
        group: "输出与策略",
        target: { view: "events", operationsSection: "investment" },
      },
      {
        id: "investment-advice",
        label: "风险应对",
        group: "输出与策略",
        target: { view: "events", operationsSection: "advice" },
      },
    ]
  )
  assert.deepEqual(navGroups, ["风险研判", "信息与比较", "输出与策略"])
  assert.ok(navItems.every((item) => item.description.trim().length > 0))

  assert.equal(
    resolveActiveNavigationItem("events", "profile", "transmission"),
    "risk-transmission"
  )
  assert.equal(
    resolveActiveNavigationItem("events", "profile", "governance"),
    "risk-transmission"
  )
  assert.equal(
    resolveActiveNavigationItem("events", "profile", "investment"),
    "investment-research"
  )
  assert.equal(
    resolveActiveNavigationItem("events", "profile", "advice"),
    "investment-advice"
  )
  assert.equal(
    resolveActiveNavigationItem("intelligence", "metrics", "events"),
    "indicator-analysis"
  )
  assert.equal(
    resolveActiveNavigationItem("reports", "profile", "events"),
    "risk-reports"
  )
  assert.equal(
    getNavigationItemIdForTarget({
      view: "events",
      operationsSection: "transmission",
    }),
    "risk-transmission"
  )
})

test("sidebar notification badges render only for positive realtime counts", () => {
  const sidebarSource = readProjectFile("src/components/layout/sidebar-nav.tsx")

  assert.match(sidebarSource, /liveCount !== undefined && liveCount > 0 \? \(/)
  assert.doesNotMatch(sidebarSource, /liveCount !== undefined \? \(/)
})

test("candidate and currently used sources have distinct governance labels", () => {
  assert.equal(isCandidateDataSource("Wind/同花顺市值数据"), true)
  assert.equal(isCandidateDataSource("天眼查/企查查诉讼数据"), true)
  assert.equal(isCandidateDataSource("企业年报与交易所公告"), false)
  assert.match(formatDataSourceLabel("智慧芽专利数据"), /^待授权候选数据源 · /)
  assert.match(formatDataSourceLabel("企业年报"), /^公开或企业自有来源 · /)
})

test("initial demo state uses the v2 storage and subtab contract", () => {
  const now = new Date("2026-07-15T10:30:00+08:00")
  const state = createInitialDemoState("deepseek", "fourth-paradigm", now)

  assert.equal(DEMO_STATE_STORAGE_KEY, "kechuang-risk-demo-state-v2")
  assert.equal(DEMO_STATE_VERSION, 2)
  assert.deepEqual(state, {
    version: 2,
    companyId: "deepseek",
    compareCompanyId: "fourth-paradigm",
    activeView: "overview",
    researchSection: "profile",
    operationsSection: "events",
    riskLens: "all",
    timeRange: "6m",
    statusMap: {},
    promotedEvents: [],
    promotedSignalIds: [],
    lastUpdatedAt: now.toISOString(),
  })
})

test("v1 routes migrate into the correct v2 workflow subtabs", () => {
  const fallback = createInitialDemoState("deepseek", "fourth-paradigm")
  const cases = [
    {
      activeView: "lifecycle" as const,
      expectedView: "intelligence",
      expectedResearch: "lifecycle",
      expectedOperations: "events",
    },
    {
      activeView: "transmission" as const,
      expectedView: "events",
      expectedResearch: "profile",
      expectedOperations: "transmission",
    },
    {
      activeView: "governance" as const,
      expectedView: "events",
      expectedResearch: "profile",
      expectedOperations: "investment",
    },
    {
      activeView: "ai-flow" as const,
      expectedView: "overview",
      expectedResearch: "profile",
      expectedOperations: "events",
    },
  ]

  cases.forEach(
    ({ activeView, expectedView, expectedResearch, expectedOperations }) => {
      const migrated = migrateDemoState({ version: 1, activeView }, fallback)
      assert.equal(migrated.version, 2)
      assert.equal(migrated.activeView, expectedView)
      assert.equal(migrated.researchSection, expectedResearch)
      assert.equal(migrated.operationsSection, expectedOperations)
    }
  )
})

test("dashboard views use stable lazy boundaries and preload only on user intent", () => {
  const appSource = readProjectFile("src/App.tsx")
  const sidebarSource = readProjectFile("src/components/layout/sidebar-nav.tsx")

  assert.equal(
    (
      appSource.match(
        /const load(?:Overview|Realtime|Intelligence|Compare|Events)Tab = cachedImport/g
      ) ?? []
    ).length,
    5
  )
  assert.equal(
    (
      appSource.match(
        /const Lazy(?:Overview|Realtime|Intelligence|Compare|Events)Tab = lazy\(/g
      ) ?? []
    ).length,
    5
  )
  assert.match(appSource, /function preloadView\(view: TabValue\)/)
  assert.match(appSource, /onPreloadView=\{preloadView\}/)
  assert.match(sidebarSource, /onPointerEnter=\{onPreload\}/)
  assert.match(sidebarSource, /onFocus=\{onPreload\}/)
  assert.match(
    appSource,
    /<Suspense fallback=\{<TabSkeleton \/>\}>[\s\S]*<WorkflowTransition/
  )
  assert.doesNotMatch(appSource, /const VIEW_ORDER/)
  assert.doesNotMatch(appSource, /const preloadQueue/)
  assert.doesNotMatch(appSource, /requestIdleCallback/)
  assert.doesNotMatch(appSource, /Promise\.all\(/)
  assert.doesNotMatch(
    appSource,
    /\.forEach\(\s*\(view\) => \{\s*void prepareView\(view\)/
  )
  assert.match(appSource, /function TabSkeleton\(\)/)
})

test("structured navigation switches views and subtabs in place", () => {
  const appSource = readProjectFile("src/App.tsx")
  const shellSource = readProjectFile("src/components/layout/app-shell.tsx")
  const sidebarSource = readProjectFile("src/components/layout/sidebar-nav.tsx")
  const liquidSurfaceSource = readProjectFile(
    "src/components/liquid/liquid-glass-surface.tsx"
  )
  const liquidNativeSource = readProjectFile(
    "src/components/liquid/liquid-glass-native-renderer.tsx"
  )

  assert.doesNotMatch(appSource, /useTransition/)
  assert.match(appSource, /const navigationRequestRef = useRef\(0\)/)
  assert.match(appSource, /const navigationTargetRequestRef = useRef\(0\)/)
  assert.doesNotMatch(appSource, /\[navigationView, setNavigationView\]/)
  assert.doesNotMatch(shellSource, /\[navigationView, setNavigationView\]/)
  assert.match(
    sidebarSource,
    /function SidebarWorkflowNavigation[\s\S]*const \[pendingNavigation, setPendingNavigation\]/
  )
  assert.match(
    sidebarSource,
    /setPendingNavigation\(\{ itemId: item\.id, companyId \}\)[\s\S]*await onNavigate\(item\.target\)[\s\S]*setPendingNavigation\(null\)/
  )
  assert.doesNotMatch(appSource, /flushSync/)
  assert.match(
    appSource,
    /const handleViewChange = async \(view: TabValue\) => \{[\s\S]*setActiveView\(view\)[\s\S]*await prepareView\(view\)/
  )
  assert.match(
    appSource,
    /if \(!ready\) \{[\s\S]*setActiveView\(previousView\)[\s\S]*return false/
  )
  assert.match(
    appSource,
    /const handleNavigationTarget = async \(target: NavigationTarget\) => \{[\s\S]*setResearchSection\(target\.researchSection!\)[\s\S]*setOperationsSection\(target\.operationsSection!\)[\s\S]*await handleViewChange\(target\.view\)/
  )
  assert.match(appSource, /<AppShell[\s\S]*activeView=\{activeView\}/)
  assert.doesNotMatch(sidebarSource, /onPointerDown=\{onPreload\}/)
  assert.match(sidebarSource, /onPointerEnter=\{onPreload\}/)
  assert.match(sidebarSource, /onFocus=\{onPreload\}/)
  assert.match(sidebarSource, /className="sidebar-navigation-scroll"/)
  assert.doesNotMatch(sidebarSource, /sidebar-live-feed/)
  assert.doesNotMatch(sidebarSource, /variant="nav-active"/)
  assert.match(liquidSurfaceSource, /trackPointer = false/)
  assert.match(
    liquidNativeSource,
    /globalMousePos=\{trackPointer \? undefined : STATIC_MOUSE_POSITION\}/
  )
})

test("investor strategy and graph integration have no enterprise task workflows", () => {
  const eventsSource = readProjectFile(
    "src/components/dashboard/events-tab.tsx"
  )
  const graphSource = readProjectFile(
    "src/components/dashboard/risk-propagation-graph.tsx"
  )

  assert.doesNotMatch(eventsSource, /TabsTrigger/)
  assert.doesNotMatch(eventsSource, /TabsList/)
  assert.doesNotMatch(eventsSource, /TabsContent/)
  assert.match(eventsSource, /section === "investment"/)
  assert.match(eventsSource, /section === "advice"/)
  assert.match(eventsSource, /<RiskPropagationGraph detail=\{detail\}/)
  assert.match(graphSource, /KCR-RISK-GRAPH-2026\.08-v1/)
  assert.match(graphSource, /data-graph-ui="teammate-fee-kbg"/)
  assert.match(graphSource, /stock_code/)
  assert.doesNotMatch(
    `${eventsSource}\n${graphSource}`,
    /EventRegister|Governance|AutomaticRiskAdvice/
  )
  assert.doesNotMatch(
    `${eventsSource}\n${graphSource}`,
    />负责人<|>待处理<|>截止日期<|>处置任务/
  )
})

test("risk-news centered reading dialog remains scoped and cannot promote management tasks", () => {
  const realtimeSource = readProjectFile(
    "src/components/dashboard/realtime-tab.tsx"
  )

  assert.match(
    realtimeSource,
    /previousCompanyIdRef\.current === detail\.id[\s\S]*setSelectedSignalId\(null\)[\s\S]*onFocusSignalHandled\(\)/
  )
  assert.doesNotMatch(realtimeSource, /onPromote\(/)
  assert.match(realtimeSource, /<RiskNewsDialog/)
  assert.match(realtimeSource, /className="risk-news__modal"/)
  assert.match(realtimeSource, /useGSAP\(/)
  assert.match(realtimeSource, /usePrefersReducedMotion\(\)/)
  assert.doesNotMatch(realtimeSource, /<Sheet/)
  assert.doesNotMatch(
    realtimeSource,
    /recommendedAction|researchQuestions|转为事件|待处理/
  )
})

test("workflow sections reveal once on viewport entry with a reduced-motion fallback", () => {
  const workflowSource = readProjectFile(
    "src/components/motion/workflow-transition.tsx"
  )
  const shellStyles = readProjectFile("src/styles/shell.css")
  assert.match(workflowSource, /className="workflow-transition"/)
  assert.match(workflowSource, /export function Reveal/)
  assert.match(workflowSource, /IntersectionObserver/)
  assert.match(workflowSource, /prefers-reduced-motion: reduce/)
  assert.match(workflowSource, /data-reveal-state=/)
  assert.match(workflowSource, /unobserve/)
  assert.doesNotMatch(workflowSource, /useLayoutEffect/)
  assert.doesNotMatch(workflowSource, /getBoundingClientRect\(\)/)
  assert.doesNotMatch(workflowSource, /MutationObserver/)
  assert.doesNotMatch(workflowSource, /querySelectorAll/)
  assert.match(
    shellStyles,
    /\.motion-reveal\[data-reveal-state="pending"\]\s*\{[\s\S]*opacity:\s*0\.96/
  )
  assert.match(shellStyles, /translate3d\(0,\s*4px,\s*0\)/)
  assert.match(
    shellStyles,
    /\.motion-reveal\s*\{[\s\S]*opacity\s+240ms[\s\S]*transform\s+240ms/
  )
  assert.doesNotMatch(
    shellStyles,
    /\.motion-reveal\[data-reveal-state="pending"\]\s*\{[\s\S]*?filter:\s*blur/
  )
})

test("controlled mobile navigation restores focus to its trigger", () => {
  const shellSource = readProjectFile("src/components/layout/app-shell.tsx")
  const topBarSource = readProjectFile(
    "src/components/layout/top-command-bar.tsx"
  )

  assert.match(shellSource, /onCloseAutoFocus=/)
  assert.match(shellSource, /mobileNavButtonRef\.current\?\.focus\(\)/)
  assert.match(topBarSource, /buttonRef=\{mobileNavButtonRef\}/)
})

test("global theme and reset controls stay fixed at the page bottom-left", () => {
  const controlsSource = readProjectFile(
    "src/components/layout/top-command-bar.tsx"
  )
  const riskOsStyles = readProjectFile("src/styles/risk-os.css")

  assert.match(controlsSource, /切换到浅色模式/)
  assert.match(controlsSource, /label="恢复初始状态"/)
  assert.doesNotMatch(
    controlsSource,
    /top-command-title|risk-os-command-surface/
  )
  assert.match(
    riskOsStyles,
    /\.risk-os-global-controls-wrap\s*\{[\s\S]*?bottom:\s*16px;[\s\S]*?left:\s*16px;/
  )
})

test("the shell renders no global page title bar", () => {
  const shellSource = readProjectFile("src/components/layout/app-shell.tsx")
  const controlsSource = readProjectFile(
    "src/components/layout/top-command-bar.tsx"
  )

  assert.doesNotMatch(shellSource, /<TopCommandBar|app-page-title/)
  assert.match(shellSource, /<GlobalShellControls/)
  assert.doesNotMatch(controlsSource, /<header|<h1|top-command-title/)
})

test("legacy governance entry is absent from the investor overview", () => {
  const overviewSource = readProjectFile(
    "src/components/dashboard/overview-tab.tsx"
  )

  assert.match(overviewSource, /<IndustryRiskReviewPanel/)
  assert.doesNotMatch(
    overviewSource,
    /governance-entry-action|事件清单|责任状态/
  )
})

test("assessment overview leads with top risks and excludes management actions", () => {
  const overviewSource = readProjectFile(
    "src/components/dashboard/industry-risk-review-panel.tsx"
  )
  const profileDeskSource = readProjectFile(
    "src/components/dashboard/industry-risk-profile-desk.tsx"
  )
  const profileStyles = readProjectFile(
    "src/styles/industry-risk-profile-desk.css"
  )

  assert.match(profileDeskSource, /综合风险指数/)
  assert.match(profileDeskSource, /Top 3 风险驱动/)
  assert.match(profileDeskSource, /slice\(0, 3\)/)
  assert.match(overviewSource, /近期事件/)
  assert.doesNotMatch(
    overviewSource,
    /generateIndustryRiskRecommendations|建议优先执行|处置任务/
  )
  assert.match(profileStyles, /\.risk-profile-desk__conclusion \{/)
})

test("large reading surfaces preserve translucent liquid-glass depth", () => {
  const businessStyles = readProjectFile("src/styles/business.css")
  const pageStyles = readProjectFile("src/styles/pages.css")

  assert.doesNotMatch(
    businessStyles,
    /var\(--glass-reading-bg\)\s+(?:9[5-9]|100)%/
  )
  assert.doesNotMatch(pageStyles, /var\(--glass-reading-bg\)\s+(?:9[5-9]|100)%/)
  assert.match(businessStyles, /--reading-glass-fill/)
  assert.match(businessStyles, /--reading-glass-edge/)
})

test("dialog motion preserves the primitive centering transform", () => {
  const businessStyles = readProjectFile("src/styles/business.css")
  const dialogKeyframes = businessStyles.match(
    /@keyframes glass-dialog-in \{[\s\S]*?\n\}/
  )?.[0]

  assert.ok(dialogKeyframes)
  assert.doesNotMatch(dialogKeyframes, /\btransform:/)
  assert.doesNotMatch(dialogKeyframes, /\btranslate:/)
  assert.match(dialogKeyframes, /\bscale:/)
})

test("reset, exports, and session persistence remain wired without presentation-only UI", () => {
  const appSource = readProjectFile("src/App.tsx")
  const topBarSource = readProjectFile(
    "src/components/layout/top-command-bar.tsx"
  )
  const shellSource = readProjectFile("src/components/layout/app-shell.tsx")
  const shellStyles = readProjectFile("src/styles/shell.css")
  const businessStyles = readProjectFile("src/styles/business.css")

  assert.match(appSource, /saveDemoState\(/)
  assert.match(appSource, /恢复初始状态/)
  assert.match(appSource, /printRiskSummary/)
  assert.match(appSource, /exportEventsCsv/)
  assert.match(appSource, /exportRiskSummaryPng/)
  ;[appSource, topBarSource, shellSource].forEach((source) => {
    assert.doesNotMatch(source, /答辩|比赛|挑战杯|汇报|defense/i)
  })
  assert.doesNotMatch(shellStyles, /\.defense-/)
  assert.doesNotMatch(businessStyles, /\.defense-/)
})

test("the realtime intelligence dataset states its research and collection boundaries", () => {
  const realtimeSource = readProjectFile("src/data/realtime-signals.json")
  const realtime = JSON.parse(realtimeSource) as { note: string }

  assert.match(realtime.note, /实时情报/)
  assert.match(
    realtime.note,
    /为风险识别、论文与专利研究、经营研判和事件转化提供输入/
  )
  assert.match(realtime.note, /不代表浏览器实时抓取/)
  assert.match(realtime.note, /不代表.*监管机构认定的风险事实/)
})

test("structured research method states the automatic calculation and action boundaries", () => {
  const appSource = readProjectFile("src/App.tsx")

  assert.match(appSource, /结构化辅助研判流程/)
  assert.match(appSource, /自动计算与排序/)
  assert.match(appSource, /建议生成与持续更新/)
  assert.match(appSource, /系统建议聚焦风险应对/)
  assert.doesNotMatch(appSource, /AI 工作流/)
  assert.doesNotMatch(appSource, /AI 辅助方法/)
  assert.doesNotMatch(appSource, /模型负责归纳和提示/)
  assert.doesNotMatch(
    appSource,
    /从披露、论文和技术材料中抽取事实、事件与主体关系/
  )
})

test("the nine investor workflows use the approved terminology", () => {
  const overviewSource = readProjectFile(
    "src/components/dashboard/industry-risk-review-panel.tsx"
  )
  const realtimeSource = readProjectFile(
    "src/components/dashboard/realtime-tab.tsx"
  )
  const intelligenceSource = readProjectFile(
    "src/components/dashboard/indicator-analysis-tab.tsx"
  )
  const compareSource = readProjectFile(
    "src/components/dashboard/compare-tab.tsx"
  )
  const eventsSource = readProjectFile(
    "src/components/dashboard/events-tab.tsx"
  )
  const graphSource = readProjectFile(
    "src/components/dashboard/risk-propagation-graph.tsx"
  )
  const reportsSource = readProjectFile(
    "src/components/dashboard/risk-reports-tab.tsx"
  )

  assert.match(overviewSource, /风险总览/)
  assert.match(overviewSource, /近期事件/)
  assert.match(realtimeSource, /风险资讯/)
  assert.match(intelligenceSource, /指标分析/)
  assert.match(intelligenceSource, /同业风险分位矩阵/)
  assert.match(intelligenceSource, /点击行查看公式与来源/)
  assert.match(intelligenceSource, /方法含义/)
  assert.match(compareSource, /六维风险对照图/)
  assert.match(`${eventsSource}\n${graphSource}`, /风险传导/)
  assert.match(eventsSource, /投资研判/)
  assert.match(eventsSource, /风险应对/)
  assert.match(reportsSource, /企业风险报告/)
  assert.match(reportsSource, /数据库已收录的报告与正式来源/)
})

test("legacy risk-feed terminology is absent from user-facing workflow files", () => {
  const sources = [
    "README.md",
    "src/App.tsx",
    "src/lib/data.ts",
    "src/lib/nav-data.ts",
    "src/data/realtime-signals.json",
    "src/components/dashboard/realtime-tab.tsx",
    "src/components/dashboard/events-tab.tsx",
    "src/components/layout/sidebar-nav.tsx",
  ].map(readProjectFile)

  sources.forEach((source) => {
    assert.doesNotMatch(source, /风险动态/)
    assert.doesNotMatch(source, /风险信号快照/)
  })
})

test("workflow content starts with meaningful controls instead of empty page headers", () => {
  const sharedSource = readProjectFile("src/components/dashboard/shared.tsx")
  const sidebarSource = readProjectFile("src/components/layout/sidebar-nav.tsx")
  const topBarSource = readProjectFile(
    "src/components/layout/top-command-bar.tsx"
  )
  const workflowSources = [
    "overview-tab.tsx",
    "realtime-tab.tsx",
    "intelligence-tab.tsx",
    "compare-tab.tsx",
    "events-tab.tsx",
  ].map((file) => readProjectFile(`src/components/dashboard/${file}`))

  assert.doesNotMatch(sharedSource, /export function PageHeader/)
  workflowSources.forEach((source) => {
    assert.doesNotMatch(source, /PageHeader/)
    assert.doesNotMatch(source, /snapshot-label/)
  })
  assert.doesNotMatch(sidebarSource, /快照 \{detail\.snapshotAt\}/)
  assert.doesNotMatch(sidebarSource, /方法版本/)
  assert.doesNotMatch(topBarSource, /SNAPSHOT|当前企业|会话更新/)
})

test("method and comparison controls live in their relevant content regions", () => {
  const indicatorSource = readProjectFile(
    "src/components/dashboard/indicator-analysis-tab.tsx"
  )
  const compareSource = readProjectFile(
    "src/components/dashboard/compare-tab.tsx"
  )
  const topBarSource = readProjectFile(
    "src/components/layout/top-command-bar.tsx"
  )

  assert.match(indicatorSource, /点击行查看公式与来源/)
  assert.match(indicatorSource, /title="方法含义与公式解析"/)
  assert.match(indicatorSource, /<RiskScoreFormula/)
  assert.match(indicatorSource, /indicator-method-sheet__parameters/)
  assert.doesNotMatch(indicatorSource, /原始观测/)
  assert.doesNotMatch(topBarSource, /打开方法与模型/)
  assert.match(compareSource, /nameControl=/)
  assert.match(compareSource, /className="compare-card-selector"/)
  assert.match(
    compareSource,
    /SelectContent[\s\S]*position="popper"[\s\S]*side="bottom"[\s\S]*align="start"/
  )
  assert.match(
    compareSource,
    /compare-summary[\s\S]*CompanyAssessmentSummary[\s\S]*tone="secondary"[\s\S]*nameControl=/
  )
  assert.doesNotMatch(compareSource, /compare-switcher-glass/)
})

test("the investor workstation defines the shell and major workflow surfaces", () => {
  const overviewSource = readProjectFile(
    "src/components/dashboard/industry-risk-review-panel.tsx"
  )
  const topBarSource = readProjectFile(
    "src/components/layout/top-command-bar.tsx"
  )
  const sharedSource = readProjectFile("src/components/dashboard/shared.tsx")
  const workflowSurfaces = [
    {
      path: "src/components/dashboard/realtime-tab.tsx",
      pattern: /className="risk-news__grid"/,
    },
    {
      path: "src/components/dashboard/indicator-analysis-tab.tsx",
      pattern: /className="indicator-analysis__peer-matrix"/,
    },
    {
      path: "src/components/dashboard/compare-tab.tsx",
      pattern: /className="compare-company-glass"/,
    },
    {
      path: "src/components/dashboard/risk-propagation-graph.tsx",
      pattern: /className="teammate-graph-workspace"/,
    },
  ]
  const riskOsStyles = readProjectFile("src/styles/risk-os.css")
  const indexStyles = readProjectFile("src/index.css")

  assert.match(overviewSource, /<IndustryRiskProfileDesk/)
  assert.match(overviewSource, /investor-overview__lower-grid/)
  assert.match(overviewSource, /近期事件/)
  assert.match(sharedSource, /risk-os-panel-frame/)
  assert.doesNotMatch(sharedSource, /<LiquidGlassSurface/)
  assert.match(topBarSource, /risk-os-global-controls/)
  assert.doesNotMatch(topBarSource, /LiquidGlassSurface/)
  workflowSurfaces.forEach(({ path, pattern }) => {
    assert.match(readProjectFile(path), pattern)
  })
  assert.match(indexStyles, /@import "\.\/styles\/risk-os\.css";/)
  assert.match(riskOsStyles, /\.risk-os-sidebar-surface/)
  assert.match(riskOsStyles, /\.risk-os-global-controls/)
  assert.match(riskOsStyles, /\.risk-os-shell \.industry-graph-content/)
  assert.match(
    riskOsStyles,
    /\.risk-os-shell \.liquid-glass-surface\s*\{[\s\S]*?background:\s*transparent !important/
  )
})

test("reading-heavy workflows use dense investor surfaces and removed pages stay removed", () => {
  const realtimeSource = readProjectFile(
    "src/components/dashboard/realtime-tab.tsx"
  )
  const intelligenceSource = readProjectFile(
    "src/components/dashboard/indicator-analysis-tab.tsx"
  )
  const eventsSource = readProjectFile(
    "src/components/dashboard/events-tab.tsx"
  )
  const graphSource = readProjectFile(
    "src/components/dashboard/risk-propagation-graph.tsx"
  )

  assert.match(realtimeSource, /className="risk-news__grid"/)
  assert.match(
    intelligenceSource,
    /className="indicator-analysis__peer-matrix"/
  )
  assert.match(eventsSource, /<RiskPropagationGraph detail=\{detail\}/)
  assert.match(graphSource, /className="teammate-graph-workspace"/)
  assert.doesNotMatch(eventsSource, /event-register|governance-workspace/)

  ;[
    "src/components/dashboard/ai-flow-tab.tsx",
    "src/components/dashboard/lifecycle-tab.tsx",
    "src/components/dashboard/transmission-tab.tsx",
    "src/components/dashboard/governance-tab.tsx",
  ].forEach((path) => {
    assert.equal(existsSync(join(projectRoot, path)), false)
  })
})

test("customer workflows expose auditable calculations without task management", () => {
  const intelligenceSource = readProjectFile(
    "src/components/dashboard/intelligence-tab.tsx"
  )
  const workspaceSource = readProjectFile(
    "src/components/dashboard/scoring-workspace.tsx"
  )
  const realtimeSource = readProjectFile(
    "src/components/dashboard/realtime-tab.tsx"
  )
  const eventsSource = readProjectFile(
    "src/components/dashboard/events-tab.tsx"
  )
  const indicatorSource = readProjectFile(
    "src/components/dashboard/indicator-analysis-tab.tsx"
  )

  assert.doesNotMatch(intelligenceSource, /<ScoringWorkspace/)
  assert.match(intelligenceSource, /<IndicatorAnalysisTab/)
  assert.match(workspaceSource, /六类风险量化工作台/)
  assert.match(workspaceSource, /riskQuantificationCatalogByDimension/)
  assert.match(workspaceSource, /技术专项自动评分/)
  assert.match(workspaceSource, /待规则校准/)
  assert.match(
    workspaceSource,
    /尚缺行业基准、组合规则或授权数据校准，不会以不完整口径自动计分/
  )
  assert.match(indicatorSource, /riskPercentile/)
  assert.match(indicatorSource, /RiskScoreFormula/)
  assert.match(indicatorSource, /本次代入/)
  assert.match(indicatorSource, /missingReason/)
  assert.doesNotMatch(
    eventsSource,
    /getAdmittedIndicators|getObservationIndicators/
  )
  assert.match(realtimeSource, /getCanonicalRiskDimensionLabels/)
})

test("investment constraints reserve columns for sequence, icon, and copy", () => {
  const pageStyles = readProjectFile("src/styles/pages.css")

  assert.match(
    pageStyles,
    /\.constraint-row\s*\{[^}]*grid-template-columns:\s*28px 20px minmax\(0, 1fr\)/s
  )
})
