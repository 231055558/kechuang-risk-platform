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

test("the institutional research desk is the final presentation layer", () => {
  const indexStyles = readProjectFile("src/index.css")
  const riskOsStyles = readProjectFile("src/styles/risk-os.css")

  assert.doesNotMatch(indexStyles, /@fontsource-variable\/geist/)
  assert.match(
    indexStyles,
    /@import "\.\/styles\/apple-design\.css";\s*@import "\.\/styles\/risk-os\.css";/
  )
  assert.match(riskOsStyles, /--risk-os-sidebar:\s*#17191d/)
  assert.match(riskOsStyles, /--risk-os-blue:\s*#3157d5/)
  assert.match(riskOsStyles, /--risk-os-danger:\s*#bd3447/)
  assert.match(riskOsStyles, /"PingFang SC"/)
  assert.match(riskOsStyles, /font-variant-numeric:\s*tabular-nums/)
})

test("the research desk preserves reduced motion and forced-colors fallbacks", () => {
  const riskOsStyles = readProjectFile("src/styles/risk-os.css")

  assert.match(
    riskOsStyles,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*animation-duration:\s*0\.01ms !important/
  )
  assert.match(
    riskOsStyles,
    /@media \(forced-colors: active\)[\s\S]*outline:\s*2px solid Highlight/
  )
})

test("the shell uses flat institutional surfaces instead of liquid glass", () => {
  const sidebarSource = readProjectFile(
    "src/components/layout/sidebar-nav.tsx"
  )
  const topBarSource = readProjectFile(
    "src/components/layout/top-command-bar.tsx"
  )
  const sharedSource = readProjectFile("src/components/dashboard/shared.tsx")
  const riskOsStyles = readProjectFile("src/styles/risk-os.css")

  assert.match(sidebarSource, /risk-os-sidebar-surface/)
  assert.match(sidebarSource, /机构研究工作站/)
  assert.doesNotMatch(sidebarSource, /LiquidGlassSurface/)
  assert.match(topBarSource, /risk-os-command-surface/)
  assert.doesNotMatch(topBarSource, /LiquidGlassSurface/)
  assert.match(sharedSource, /risk-os-panel-frame/)
  assert.doesNotMatch(sharedSource, /<LiquidGlassSurface/)
  assert.match(
    riskOsStyles,
    /\.risk-os-shell \.liquid-glass-surface\s*\{[\s\S]*?backdrop-filter:\s*none !important/
  )
})

test("risk colors, narrative colors, and interaction colors have separate roles", () => {
  const riskOsStyles = readProjectFile("src/styles/risk-os.css")

  assert.match(riskOsStyles, /--risk-os-blue:\s*#3157d5/)
  assert.match(riskOsStyles, /--risk-os-danger:\s*#bd3447/)
  assert.match(riskOsStyles, /--risk-os-warning:\s*#9a5b00/)
  assert.match(riskOsStyles, /--risk-os-success:\s*#18725a/)
  assert.match(riskOsStyles, /--risk-os-narrative:\s*#7257c7/)
  assert.match(
    riskOsStyles,
    /\[data-tone="negative"\][\s\S]*?var\(--risk-os-danger\)/
  )
})

test("productive motion uses scoped GSAP and a single reduced-motion store", () => {
  const motionSource = readProjectFile(
    "src/components/motion/workflow-transition.tsx"
  )

  assert.match(motionSource, /gsap\.registerPlugin\(useGSAP\)/)
  assert.match(motionSource, /scope:\s*sceneRef/)
  assert.match(motionSource, /revertOnUpdate:\s*true/)
  assert.match(motionSource, /usePrefersReducedMotion\(\)/)
  assert.match(motionSource, /scene:\s*0\.38/)
  assert.match(motionSource, /graph:\s*0\.52/)
  assert.doesNotMatch(motionSource, /bounce|elastic/i)
})
