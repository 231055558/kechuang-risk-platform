import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const eventsSource = readFileSync(
  new URL("../src/components/dashboard/events-tab.tsx", import.meta.url),
  "utf8"
)
const styles = readFileSync(
  new URL("../src/styles/investor-operations.css", import.meta.url),
  "utf8"
)

test("投资研判呈现机构、个人和银行三类实际决策问题", () => {
  assert.match(eventsSource, /同业参照/)
  assert.match(eventsSource, /投资机构 · 决策/)
  assert.match(eventsSource, /个人投资者 · 持仓/)
  assert.match(eventsSource, /银行 · 授信/)
  assert.match(eventsSource, /研判执行方案/)
  assert.match(eventsSource, /必须回答/)
  assert.match(eventsSource, /操作边界/)
  assert.match(eventsSource, /执行动作/)
  assert.match(eventsSource, /所需材料/)
  assert.match(eventsSource, /验证方式/)
  assert.doesNotMatch(eventsSource, /建议买入|建议卖出|预期收益/)
})

test("风险应对使用预警信号和可验证企业整改建议", () => {
  assert.match(eventsSource, /关键风险信号/)
  assert.match(eventsSource, /立即整改/)
  assert.match(eventsSource, /中期整改/)
  assert.match(eventsSource, /长期复评/)
  assert.match(eventsSource, /产出物/)
  assert.match(eventsSource, /验证标准/)
  assert.doesNotMatch(eventsSource, /责任人|责任部门|截止日期|任务状态|待处理/)
})

test("风险信号表保留可访问的横向滚动", () => {
  assert.match(styles, /@media \(max-width: 720px\)/)
  assert.match(
    styles,
    /\.risk-response__signal-table-wrap[\s\S]*overflow-x: auto/
  )
})

test("研判执行与三阶段整改使用可扫描的大字号行动版式", () => {
  assert.match(
    eventsSource,
    /investor-perspective__action-copy[\s\S]*<strong>执行动作<\/strong>[\s\S]*<span>\{step\.action\}<\/span>/
  )
  assert.match(eventsSource, /className="risk-response__action-copy"/)
  assert.match(
    styles,
    /\.investor-perspective__execution h5\s*\{[^}]*font-size: 18px/s
  )
  assert.match(
    styles,
    /\.investor-perspective__action-copy span\s*\{[^}]*font-size: 13px/s
  )
  assert.match(
    styles,
    /\.risk-response__timeline\s*\{[^}]*grid-template-columns: 1fr/s
  )
  assert.match(
    styles,
    /\.risk-response__action-list\s*\{[^}]*grid-template-columns: repeat\(2,/s
  )
  assert.match(
    styles,
    /\.risk-response__action-list h4\s*\{[^}]*font-size: 15px/s
  )
  assert.match(
    styles,
    /\.risk-response__action-copy p\s*\{[^}]*font-size: 12px/s
  )
  assert.match(styles, /\.risk-response__timeline h3\s*\{[^}]*font-size: 22px/s)
})
