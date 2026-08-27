import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const source = readFileSync(
  new URL("../src/components/dashboard/realtime-tab.tsx", import.meta.url),
  "utf8"
)
const styles = readFileSync(
  new URL("../src/styles/risk-news.css", import.meta.url),
  "utf8"
)

test("news cards expand from their source rectangle into a centered dialog", () => {
  assert.match(source, /getBoundingClientRect\(\)/)
  assert.match(source, /origin\.left\s*\+\s*origin\.width\s*\/\s*2/)
  assert.match(source, /gsap\.fromTo\(/)
  assert.match(source, /duration: 0\.44/)
  assert.match(source, /ease: "power3\.out"/)
  assert.match(
    styles,
    /\.risk-news__modal\s*\{[\s\S]*?max-width: 980px !important/
  )
})

test("news dialog animation honors reduced motion and GSAP cleanup", () => {
  assert.match(source, /usePrefersReducedMotion\(\)/)
  assert.match(source, /clearProps: "transform,opacity,visibility"/)
  assert.match(source, /scope: cardRef/)
  assert.match(source, /revertOnUpdate: true/)
})

test("news card typography and density follow information importance", () => {
  assert.match(styles, /data-importance="high"\][\s\S]*?font-size: clamp\(23px/)
  assert.match(
    styles,
    /data-importance="medium"\][\s\S]*?font-size: clamp\(17px/
  )
  assert.match(styles, /data-importance="watch"\]:nth-child/)
})
