import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const component = readFileSync(
  "src/components/dashboard/risk-propagation-graph.tsx",
  "utf8"
)
const eventsTab = readFileSync(
  "src/components/dashboard/events-tab.tsx",
  "utf8"
)
const styles = readFileSync("src/styles/risk-propagation-graph.css", "utf8")

test("风险传导页只挂载双图谱工作站，不保留旧占位面板", () => {
  assert.match(eventsTab, /<RiskPropagationGraph detail=\{detail\} \/>/)
  assert.doesNotMatch(eventsTab, /GraphIntegrationPanel/)
  assert.match(component, /企业自身事件/)
  assert.match(component, /外部主体传导/)
  assert.match(component, /fetchRiskGraph\(detail\.id, view/)
})

test("图谱明确区分事实、规则映射和条件推演", () => {
  assert.match(component, /已核验事实/)
  assert.match(component, /规则映射/)
  assert.match(component, /条件推演/)
  assert.match(component, /不会复用其他企业的关系或生成无证据的传导边/)
  assert.match(component, /evidenceState = "predictive"/)
})

test("图谱具备专业画布交互、证据下钻与无障碍降级", () => {
  assert.match(component, /cytoscape\(/)
  assert.match(component, /name: "fcose"/)
  assert.match(component, /查看公开证据/)
  assert.match(component, /沉浸查看/)
  assert.match(component, /usePrefersReducedMotion/)
  assert.match(component, /prefersReducedMotion \? 0 : 520/)
  assert.match(styles, /data-immersive="true"/)
  assert.match(styles, /@media \(max-width: 680px\)/)
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/)
})
