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

test("the Apple material layer is loaded last and uses the system font stack", () => {
  const indexStyles = readProjectFile("src/index.css")
  const themeStyles = readProjectFile("src/styles/theme.css")

  assert.doesNotMatch(indexStyles, /@fontsource-variable\/geist/)
  assert.match(
    indexStyles,
    /@import "\.\/styles\/pages\.css";\s*@import "\.\/styles\/apple-design\.css";/
  )
  assert.match(themeStyles, /--font-sans:\s*[\s\S]*?-apple-system/)
  assert.match(themeStyles, /BlinkMacSystemFont/)
  assert.match(themeStyles, /"SF Pro Text"/)
  assert.match(themeStyles, /"PingFang SC"/)
  assert.match(themeStyles, /--ease-spring:\s*linear\(/)
})

test("Apple accessibility preferences disable refraction and strengthen materials", () => {
  const themeStyles = readProjectFile("src/styles/theme.css")
  const appleStyles = readProjectFile("src/styles/apple-design.css")
  const liquidSource = readProjectFile(
    "src/components/liquid/liquid-glass-surface.tsx"
  )

  assert.match(themeStyles, /@media \(prefers-reduced-transparency: reduce\)/)
  assert.match(themeStyles, /@media \(prefers-contrast: more\)/)
  assert.match(
    liquidSource,
    /prefers-reduced-transparency: reduce[\s\S]*prefers-contrast: more[\s\S]*forced-colors: active/
  )
  assert.match(
    appleStyles,
    /@media \(prefers-reduced-transparency: reduce\)[\s\S]*?\.liquid-glass-effect-host[\s\S]*?display:\s*none !important/
  )
  assert.match(appleStyles, /@media \(prefers-contrast: more\)/)
  assert.match(appleStyles, /@media \(forced-colors: active\)/)
})

test("glass is layered across shell, reading planes, and overlays instead of rows", () => {
  const sidebarSource = readProjectFile(
    "src/components/layout/sidebar-nav.tsx"
  )
  const appleStyles = readProjectFile("src/styles/apple-design.css")

  assert.match(
    sidebarSource,
    /variant="selector"[\s\S]*?refractive=\{false\}/
  )
  assert.match(
    appleStyles,
    /\.sidebar-company-glass\s*\{[\s\S]*?backdrop-filter:\s*none/
  )
  assert.match(
    appleStyles,
    /\.page-section,[\s\S]*?\.research-highlight-glass\s*\{[\s\S]*?backdrop-filter:\s*none/
  )
  assert.match(
    appleStyles,
    /\.page-section \[data-slot="card"\]:not\(\.research-highlight-glass\)\s*\{[\s\S]*?backdrop-filter:\s*none/
  )
  assert.match(
    appleStyles,
    /\[data-slot="dialog-content"\],[\s\S]*?\[data-slot="sheet-content"\]\s*\{[\s\S]*?backdrop-filter:\s*blur\(32px\)/
  )
  assert.match(
    appleStyles,
    /\[data-slot="dialog-overlay"\],[\s\S]*?\[data-slot="sheet-overlay"\]\s*\{[\s\S]*?backdrop-filter:\s*none/
  )
})

test("page section tones and dark materials can override the base glass layer", () => {
  const businessStyles = readProjectFile("src/styles/business.css")
  const appleStyles = readProjectFile("src/styles/apple-design.css")

  assert.doesNotMatch(
    businessStyles,
    /\.page-section:not\(\.glass-panel-surface \.page-section\)/
  )
  assert.doesNotMatch(
    appleStyles,
    /\.page-section:not\(\.glass-panel-surface \.page-section\)/
  )
  assert.match(
    businessStyles,
    /\.page-section:not\(:where\(\.glass-panel-surface \.page-section\)\)/
  )
  assert.match(
    appleStyles,
    /\.page-section:not\(:where\(\.glass-panel-surface \.page-section\)\)/
  )
  assert.match(
    appleStyles,
    /\.dark \.page-section\s*\{[\s\S]*?oklch\(0\.72 0\.035 228 \/ 0\.055\)/
  )
})

test("controls provide immediate press feedback with interruptible spring release", () => {
  const buttonSource = readProjectFile("src/components/ui/button.tsx")
  const appleStyles = readProjectFile("src/styles/apple-design.css")

  assert.match(
    buttonSource,
    /transition-\[color,background-color,border-color,box-shadow,transform,opacity\]/
  )
  assert.doesNotMatch(buttonSource, /hover:\[&_svg/)
  assert.match(
    appleStyles,
    /\[data-slot="button"\]:not\(:disabled\):active,[\s\S]*?transform:\s*scale\(0\.97\)/
  )
  assert.match(
    appleStyles,
    /\.top-icon-button:active\s*\{[\s\S]*?transform:\s*scale\(0\.92\)/
  )
  assert.match(
    appleStyles,
    /transition:[\s\S]*?transform var\(--motion-instant\) var\(--ease-spring\)/
  )
})

test("popover, dialog, and sheet motion use symmetric paths", () => {
  const appleStyles = readProjectFile("src/styles/apple-design.css")

  assert.match(
    appleStyles,
    /@keyframes glass-popover-in[\s\S]*?translate3d\(0, -5px, 0\)[\s\S]*?translate3d\(0, 0, 0\)/
  )
  assert.match(
    appleStyles,
    /@keyframes glass-popover-out[\s\S]*?translate3d\(0, 0, 0\)[\s\S]*?translate3d\(0, -5px, 0\)/
  )
  assert.match(
    appleStyles,
    /@keyframes glass-dialog-in[\s\S]*?scale:\s*0\.985[\s\S]*?scale:\s*1/
  )
  assert.match(
    appleStyles,
    /@keyframes glass-dialog-out[\s\S]*?scale:\s*1[\s\S]*?scale:\s*0\.985/
  )
  assert.match(
    appleStyles,
    /@keyframes glass-sheet-in[\s\S]*?translate:\s*var\(--glass-sheet-shift-x\) var\(--glass-sheet-shift-y\)[\s\S]*?translate:\s*0 0/
  )
  assert.match(
    appleStyles,
    /@keyframes glass-sheet-out[\s\S]*?translate:\s*0 0[\s\S]*?translate:\s*var\(--glass-sheet-shift-x\) var\(--glass-sheet-shift-y\)/
  )
})
