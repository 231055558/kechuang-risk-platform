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

test("dashboard routes render through module-level React lazy boundaries", () => {
  const appSource = readProjectFile("src/App.tsx")

  assert.match(appSource, /\blazy,\s*\n\s*Suspense,/)
  assert.equal(
    (
      appSource.match(
        /const Lazy(?:Overview|Realtime|Intelligence|Compare|Events)Tab = lazy\(/g
      ) ?? []
    ).length,
    5
  )
  assert.match(
    appSource,
    /<Suspense fallback=\{<TabSkeleton \/>\}>[\s\S]*<WorkflowTransition/
  )
  assert.match(appSource, /function preloadView\(view: TabValue\)/)
  assert.match(appSource, /onPreloadView=\{preloadView\}/)
  assert.doesNotMatch(appSource, /\bviewComponents\b/)
  assert.doesNotMatch(appSource, /\bsetViewComponents\b/)
  assert.doesNotMatch(appSource, /\bmergeLoadedView\b/)
  assert.doesNotMatch(
    appSource,
    /useEffect\(\(\) => \{[\s\S]*loadViewComponent\(activeView\)/
  )
})

test("the desktop sidebar mounts only when the desktop media query matches", () => {
  const shellSource = readProjectFile("src/components/layout/app-shell.tsx")

  assert.match(shellSource, /useSyncExternalStore/)
  assert.match(
    shellSource,
    /const DESKTOP_LAYOUT_QUERY = "\(min-width: 1024px\)"/
  )
  assert.match(shellSource, /const isDesktop = useDesktopLayout\(\)/)
  assert.match(
    shellSource,
    /\{isDesktop \? \([\s\S]*?<SidebarNav[\s\S]*?\) : \([\s\S]*?<Sheet/
  )
  assert.doesNotMatch(shellSource, /className="hidden lg:block"/)
})

test("native liquid glass stays desktop-only while CSS glass remains available", () => {
  const liquidSource = readProjectFile(
    "src/components/liquid/liquid-glass-surface.tsx"
  )

  assert.match(liquidSource, /useSyncExternalStore/)
  assert.match(
    liquidSource,
    /const LIGHTWEIGHT_GLASS_QUERY =[\s\S]*?\(max-width: 767px\)[\s\S]*?\(pointer: coarse\)[\s\S]*?\(prefers-reduced-transparency: reduce\)[\s\S]*?\(prefers-contrast: more\)[\s\S]*?\(forced-colors: active\)/
  )
  assert.match(
    liquidSource,
    /const prefersLightweightGlass = usePrefersLightweightGlass\(\)/
  )
  assert.match(
    liquidSource,
    /const canRenderNative =[\s\S]*?!prefersLightweightGlass[\s\S]*?shouldUseRefraction/
  )
  const fallbackExpression = liquidSource.match(
    /const shouldUseFallback =\s*([\s\S]*?)\n\s*const shouldUseRefraction/
  )?.[1]
  assert.ok(fallbackExpression)
  assert.doesNotMatch(fallbackExpression, /prefersLightweightGlass/)
})

test("coarse pointers receive a 44px minimum Button target", () => {
  const buttonSource = readProjectFile("src/components/ui/button.tsx")

  assert.match(buttonSource, /\[@media\(pointer:coarse\)\]:min-h-11/)
  assert.match(buttonSource, /\[@media\(pointer:coarse\)\]:min-w-11/)
})

test("risk news defers filtering and reuses date formatters", () => {
  const realtimeSource = readProjectFile(
    "src/components/dashboard/realtime-tab.tsx"
  )
  const dateFormatSource = readProjectFile("src/lib/date-format.ts")

  assert.match(realtimeSource, /useDeferredValue/)
  assert.match(realtimeSource, /from "@\/lib\/date-format"/)
  assert.doesNotMatch(realtimeSource, /const signalDateTimeFormatter/)
  assert.match(
    realtimeSource,
    /const deferredQuery = useDeferredValue\(query\)/
  )
  assert.match(
    realtimeSource,
    /const normalizedQuery = deferredQuery\.trim\(\)/
  )
  assert.match(
    realtimeSource,
    /const visibleSignals = filteredSignals\.slice\(0, visibleCount\)/
  )
  assert.doesNotMatch(
    realtimeSource,
    /return new Intl\.DateTimeFormat\("zh-CN"/
  )
  assert.match(
    dateFormatSource,
    /const dateTimeFormatter = new Intl\.DateTimeFormat\("zh-CN"/
  )
  assert.match(
    dateFormatSource,
    /const timeFormatter = new Intl\.DateTimeFormat\("zh-CN"/
  )
})

test("risk-news cards collapse to one column within the mobile viewport", () => {
  const newsStyles = readProjectFile("src/styles/risk-news.css")
  const mobileStyles = newsStyles.match(
    /@media \(max-width: 720px\) \{([\s\S]*?)\n\}/
  )?.[1]

  assert.ok(mobileStyles)
  assert.match(
    mobileStyles,
    /\.risk-news__header\s*\{[\s\S]*?flex-direction:\s*column;/
  )
  assert.match(
    mobileStyles,
    /\.risk-news__card,[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\);/
  )
  assert.match(mobileStyles, /grid-template-areas:/)
  assert.match(mobileStyles, /min-height:\s*0;/)
})

test("enterprise research highlights stay inside the lazy research route", () => {
  const dataSource = readProjectFile("src/lib/data.ts")
  const intelligenceSource = readProjectFile(
    "src/components/dashboard/intelligence-tab.tsx"
  )
  const viteConfig = readProjectFile("vite.config.ts")

  assert.doesNotMatch(dataSource, /company-research-highlights\.json/)
  assert.match(
    intelligenceSource,
    /import companyResearchHighlightsData from "@\/data\/company-research-highlights\.json"/
  )
  assert.match(
    viteConfig,
    /name: "enterprise-research-data",[\s\S]*company-research-highlights\\\.json\$[\s\S]*priority: 30/
  )
  assert.match(
    viteConfig,
    /name: "enterprise-research-data"[\s\S]*name: "snapshot-data"/
  )
})
