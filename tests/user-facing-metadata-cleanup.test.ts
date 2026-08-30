import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

function read(path: string) {
  return readFileSync(path, "utf8")
}

test("primary workflows omit decorative English eyebrow labels", () => {
  const files = [
    "src/components/dashboard/industry-risk-review-panel.tsx",
    "src/components/dashboard/industry-risk-profile-desk.tsx",
    "src/components/dashboard/indicator-analysis-tab.tsx",
    "src/components/dashboard/realtime-tab.tsx",
    "src/components/dashboard/events-tab.tsx",
  ].map(read)
  const source = files.join("\n")

  for (const label of [
    "Investor risk monitor",
    "Financial narrative",
    "Risk position",
    "Risk structure",
    "Top drivers",
    "Recent events",
    "Research next",
    "Objective indicator analytics",
    "Peer percentile heat",
    "Cross-company view",
    "Metric ledger",
    "Risk intelligence",
    "Investment risk review",
    "Decision execution plan",
    "Investor risk response",
    "Early warning monitor",
  ]) {
    assert.doesNotMatch(source, new RegExp(label))
  }
})

test("technical version and snapshot metadata stay out of primary pages", () => {
  const sidebar = read("src/components/layout/sidebar-nav.tsx")
  const indicator = read("src/components/dashboard/indicator-analysis-tab.tsx")
  const graph = read("knowledge-graph/frontend/risk-knowledge-graph.html")
  const app = read("src/App.tsx")

  assert.doesNotMatch(sidebar, /方法版本/)
  assert.doesNotMatch(indicator, /方法 \{response\.assessment\.methodVersion\}/)
  assert.doesNotMatch(indicator, /截至 \{response\.provenance\.sourceDate\}/)
  assert.doesNotMatch(graph, /本地审计快照已加载|当前快照|快照：/)
  assert.doesNotMatch(app, /className="app-footer"/)
})
