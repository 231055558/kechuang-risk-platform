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
const teammateWorkspace = readFileSync(
  "knowledge-graph/frontend/risk-knowledge-graph.html",
  "utf8"
)

test("风险传导页直接挂载同学原版图谱工作站", () => {
  assert.match(eventsTab, /<RiskPropagationGraph detail=\{detail\} \/>/)
  assert.doesNotMatch(eventsTab, /GraphIntegrationPanel/)
  assert.match(component, /data-graph-ui="teammate-fee-kbg"/)
  assert.match(component, /VITE_GRAPH_WORKSPACE_URL/)
  assert.match(component, /VITE_GRAPH_WORKSPACE_REVISION/)
  assert.match(component, /http:\/\/127\.0\.0\.1:8765\//)
  assert.doesNotMatch(component, /http:\/\/127\.0\.0\.1:8766\//)
  assert.match(component, /stock_code/)
  assert.match(component, /url\.searchParams\.set\("revision"/)
  assert.match(component, /url\.searchParams\.set\("theme", theme\)/)
  assert.match(component, /kechuang-risk-graph-theme/)
  assert.match(component, /contentWindow\?\.postMessage/)
  assert.match(component, /<iframe/)
  assert.doesNotMatch(
    component,
    /同学原版图谱界面|teammate-graph-workspace__status/
  )
})

test("图谱宿主不复制关系并限制 iframe 权限", () => {
  assert.match(component, /不复用其他企业数据/)
  assert.match(
    component,
    /sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"/
  )
  assert.match(component, /referrerPolicy="no-referrer"/)
})

test("原版图谱宿主具有加载态和响应式画布", () => {
  assert.match(component, /正在按证券代码读取图谱快照/)
  assert.match(component, /setLoadedUrl\(workspaceUrl\)/)
  assert.match(component, /syncTheme\(\)/)
  assert.match(styles, /teammate-graph-workspace__frame/)
  assert.match(styles, /background: var\(--background\)/)
  assert.match(styles, /risk-os-content:has\(\.teammate-graph-workspace\)/)
  assert.match(styles, /height: 100dvh/)
  assert.match(styles, /@media \(max-width: 720px\)/)
})

test("同学原版图谱按股票代码定位且缺失时不回退到其他企业", () => {
  assert.match(teammateWorkspace, /get\('stock_code'\)/)
  assert.match(teammateWorkspace, /attributes\?\.stock_code/)
  assert.match(teammateWorkspace, /当前企业暂无图谱快照/)
  assert.match(teammateWorkspace, /不会复用其他企业的关系/)
})

test("图谱工作站跟随宿主的浅色和深色主题", () => {
  assert.match(teammateWorkspace, /kechuang-risk-graph-theme/)
  assert.match(teammateWorkspace, /documentElement\.dataset\.theme/)
  assert.match(teammateWorkspace, /data-theme="light"/)
  assert.match(teammateWorkspace, /color-scheme:light/)
  assert.match(teammateWorkspace, /background-color:#f8fbfe/)
})

test("图谱节点只移除阴影并在浅色模式使用深色文字", () => {
  assert.match(teammateWorkspace, /\.sphere-depth\{display:none!important\}/)
  assert.doesNotMatch(teammateWorkspace, /fill-opacity:1!important/)
  assert.doesNotMatch(teammateWorkspace, /stroke-opacity:1!important/)
  assert.doesNotMatch(teammateWorkspace, /\.sphere-glow[^}]*display:none/)
  assert.doesNotMatch(teammateWorkspace, /\.sphere-highlight[^}]*display:none/)
  assert.match(
    teammateWorkspace,
    /html\[data-theme="light"\] \.node \.label\{fill:#102235\}/
  )
})
