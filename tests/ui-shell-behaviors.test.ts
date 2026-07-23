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

test("browser chrome follows the resolved application theme", () => {
  const documentSource = readProjectFile("index.html")
  const themeProviderSource = readProjectFile(
    "src/components/theme-provider.tsx"
  )

  assert.match(documentSource, /<meta name="theme-color" content="#f7fbff" \/>/)
  assert.match(themeProviderSource, /const THEME_COLORS:/)
  assert.match(
    themeProviderSource,
    /querySelector<HTMLMetaElement>\('meta\[name="theme-color"\]'\)/
  )
  assert.match(
    themeProviderSource,
    /\.setAttribute\("content", THEME_COLORS\[resolvedTheme\]\)/
  )
})

test("the export action remains available below the small-screen breakpoint", () => {
  const topBarSource = readProjectFile(
    "src/components/layout/top-command-bar.tsx"
  )
  const exportAction = topBarSource.match(
    /<TopIconAction[\s\S]*?label="导出风险材料"[\s\S]*?\/>/
  )?.[0]

  assert.ok(exportAction)
  assert.doesNotMatch(exportAction, /\bhidden\b/)
  assert.match(exportAction, /className="top-export-action"/)
})

test("the mobile sidebar keeps its shell stable and scrolls only navigation", () => {
  const shellStyles = readProjectFile("src/styles/shell.css")

  assert.match(
    shellStyles,
    /\.mobile-sidebar-panel \.sidebar-shell\s*\{[\s\S]*?overflow:\s*hidden/
  )
  assert.match(
    shellStyles,
    /\.mobile-sidebar-panel \.sidebar-shell > \*\s*\{[\s\S]*?flex-shrink:\s*0/
  )
  assert.match(
    shellStyles,
    /\.mobile-sidebar-panel \.sidebar-navigation-scroll\s*\{[\s\S]*?overflow-y:\s*auto[\s\S]*?overscroll-behavior-y:\s*contain/
  )
})

test("the desktop sidebar is fixed without participating in document flow", () => {
  const shellSource = readProjectFile("src/components/layout/app-shell.tsx")
  const shellStyles = readProjectFile("src/styles/shell.css")

  assert.match(shellSource, /\{isDesktop \? \(\s*<SidebarNav/)
  assert.match(
    shellStyles,
    /@media \(min-width:\s*1024px\)\s*\{[\s\S]*?\.app-shell > \.sidebar-glass\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?inset:\s*14px auto 14px 14px;/
  )
  assert.match(
    shellStyles,
    /@media \(min-width:\s*1024px\)\s*\{[\s\S]*?\.app-main\s*\{[\s\S]*?margin-left:\s*308px;/
  )
  assert.doesNotMatch(shellStyles, /\.app-shell > \.hidden\.lg\\:block/)
})

test("dialogs are constrained to the viewport and scroll internally", () => {
  const dialogSource = readProjectFile("src/components/ui/dialog.tsx")

  assert.match(dialogSource, /max-h-\[calc\(100dvh-2rem\)\]/)
  assert.match(dialogSource, /overflow-y-auto/)
  assert.match(dialogSource, /overscroll-contain/)
})

test("the shell exposes a skip link and a programmatically focusable main landmark", () => {
  const shellSource = readProjectFile("src/components/layout/app-shell.tsx")
  const shellStyles = readProjectFile("src/styles/shell.css")

  assert.match(shellSource, /href="#main-content"/)
  assert.match(shellSource, /className="skip-link"/)
  assert.match(
    shellSource,
    /<main[\s\S]*?id="main-content"[\s\S]*?tabIndex=\{-1\}/
  )
  assert.match(shellStyles, /\.skip-link:focus-visible/)
  assert.match(
    shellStyles,
    /\.app-main:focus-visible\s*\{[\s\S]*?outline:\s*0/
  )
  assert.match(
    shellStyles,
    /\.app-main:focus-visible \.top-command-glass[\s\S]*?0 0 0 1px/
  )
})

test("the sidebar company selector has an explicit accessible name", () => {
  const sidebarSource = readProjectFile("src/components/layout/sidebar-nav.tsx")

  assert.match(
    sidebarSource,
    /<SelectTrigger[\s\S]*?className="sidebar-company-trigger"[\s\S]*?aria-label="选择当前研究企业"/
  )
})

test("accepted primary navigation moves focus after mobile sheet closure", () => {
  const shellSource = readProjectFile("src/components/layout/app-shell.tsx")

  assert.match(shellSource, /navigationFocusRequestRef/)
  assert.match(shellSource, /accepted:\s*boolean \| null/)
  assert.match(shellSource, /sheetClosed:\s*boolean/)
  assert.match(shellSource, /accepted !== true/)
  assert.match(
    shellSource,
    /request\.itemId !== activeNavigationItemRef\.current/
  )
  assert.match(
    shellSource,
    /mainContentRef\.current\?\.focus\(\{\s*preventScroll: true/
  )
  assert.match(shellSource, /onCloseAutoFocus=/)
  assert.match(shellSource, /request\.sheetClosed = true/)
  assert.match(shellSource, /mobileNavButtonRef\.current\?\.focus\(\{/)
})

test("the sidebar keeps only the realtime badge, not a duplicate signal feed", () => {
  const shellSource = readProjectFile("src/components/layout/app-shell.tsx")
  const sidebarSource = readProjectFile("src/components/layout/sidebar-nav.tsx")
  const topBarSource = readProjectFile(
    "src/components/layout/top-command-bar.tsx"
  )

  assert.match(shellSource, /group=\{activeNav\.group\}/)
  assert.match(topBarSource, /className="top-command-context"/)
  assert.match(
    sidebarSource,
    /item\.id === "realtime-intelligence"\s*\?\s*highPriorityCount/
  )
  assert.match(
    sidebarSource,
    /liveCount !== undefined && liveCount > 0 \? \(/
  )
  assert.doesNotMatch(sidebarSource, /sidebar-live-feed/)
  assert.doesNotMatch(sidebarSource, /handleRealtimeSignalSelect/)
})
