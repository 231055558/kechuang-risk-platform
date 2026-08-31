import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import test from "node:test"

const sidebar = readFileSync("src/components/layout/sidebar-nav.tsx", "utf8")
const shellStyles = readFileSync("src/styles/shell.css", "utf8")
const riskStyles = readFileSync("src/styles/risk-os.css", "utf8")
const documentSource = readFileSync("index.html", "utf8")
const logoPath = "public/brand/kechuang-risk-logo.png"

test("platform uses the supplied eagle shield as its brand logo", () => {
  assert.equal(existsSync(logoPath), true)
  assert.match(sidebar, /src="\.\/brand\/kechuang-risk-logo\.png"/)
  assert.match(sidebar, /className="sidebar-brand-logo"/)
  assert.doesNotMatch(sidebar, /ShieldCheckIcon/)
  assert.match(shellStyles, /\.sidebar-brand-logo\s*\{/)
  assert.match(documentSource, /rel="icon"[^>]*kechuang-risk-logo\.png/)
  assert.match(documentSource, /rel="apple-touch-icon"[^>]*kechuang-risk-logo\.png/)
  assert.match(
    riskStyles,
    /:root:not\(\.dark\) \.risk-os-sidebar \.sidebar-brand-mark\s*\{[^}]*border: 0;[^}]*background: #ffffff;[^}]*box-shadow: 0 2px 10px rgb\(37 99 235 \/ 8%\);/s
  )
})
