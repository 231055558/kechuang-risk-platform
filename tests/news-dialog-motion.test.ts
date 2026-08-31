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

test("news cards use a consistent high-density research list", () => {
  assert.match(styles, /\.risk-news__grid\s*\{[^}]*grid-template-columns: minmax\(0, 1fr\)/s)
  assert.match(styles, /\.risk-news__card\s*\{[^}]*min-height: 0/s)
  assert.match(
    styles,
    /\.risk-news__card\s*\{[^}]*grid-template-areas:[^}]*"meta tags"[^}]*"footer footer"/s
  )
  assert.match(
    styles,
    /data-importance="high"\] h3\s*\{[^}]*font-size: 16px/s
  )
  assert.doesNotMatch(styles, /data-importance="watch"\]:nth-child/)
  assert.doesNotMatch(source, /signal\.keyFacts\.slice\(0, 2\)/)
})

test("news titles expose event dates and users can switch sort order", () => {
  assert.match(source, /useState<"importance" \| "time">/)
  assert.match(source, /aria-label="排序方式"/)
  assert.match(source, /按风险重要度/)
  assert.match(source, /按发生时间/)
  assert.match(source, /sortMode === "time"/)
  assert.match(source, /formatSourceEventTime\(signal\.publishedAt\)/)
  assert.match(styles, /\.risk-news__card h3 time\s*\{/)
})
