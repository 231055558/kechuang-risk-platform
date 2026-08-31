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
const devScript = readFileSync("scripts/dev.mjs", "utf8")
const viteConfig = readFileSync("vite.config.ts", "utf8")
const graphBackend = readFileSync(
  "knowledge-graph/backend/tools/serve_risk_graph_api.py",
  "utf8"
)
const semidriveSnapshot = JSON.parse(
  readFileSync("knowledge-graph/demo/semidrive_fee_kbg_snapshot.json", "utf8")
) as {
  run_id: string
  records: Record<string, Array<Record<string, unknown>>>
}

test("风险传导页直接挂载同学原版图谱工作站", () => {
  assert.match(eventsTab, /<RiskPropagationGraph detail=\{detail\} \/>/)
  assert.doesNotMatch(eventsTab, /GraphIntegrationPanel/)
  assert.match(component, /data-graph-ui="teammate-fee-kbg"/)
  assert.match(component, /VITE_GRAPH_WORKSPACE_URL/)
  assert.match(component, /VITE_GRAPH_WORKSPACE_REVISION/)
  assert.match(component, /GRAPH_WORKSPACE_UI_REVISION/)
  assert.match(component, /DEFAULT_GRAPH_WORKSPACE_URL = "risk-graph-workspace\/"/)
  assert.doesNotMatch(component, /http:\/\/127\.0\.0\.1:876[56]\//)
  assert.match(component, /stock_code/)
  assert.match(component, /url\.searchParams\.set\(\s*"revision"/)
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
  assert.doesNotMatch(component, /teammate-graph-workspace__boundary/)
  assert.match(
    component,
    /sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"/
  )
  assert.match(component, /referrerPolicy="no-referrer"/)
})

test("原版图谱宿主具有加载态和响应式画布", () => {
  assert.match(component, /正在加载风险传导图谱/)
  assert.match(component, /setLoadedUrl\(workspaceUrl\)/)
  assert.match(component, /syncTheme\(\)/)
  assert.match(styles, /teammate-graph-workspace__frame/)
  assert.match(styles, /background: var\(--background\)/)
  assert.match(styles, /risk-os-content:has\(\.teammate-graph-workspace\)/)
  assert.match(styles, /height: 100dvh/)
  assert.match(styles, /@media \(max-width: 720px\)/)
})

test("图谱工作站使用同源代理而不是浏览器直连本地端口", () => {
  assert.match(
    component,
    /DEFAULT_GRAPH_WORKSPACE_URL = "risk-graph-workspace\/"/
  )
  assert.doesNotMatch(component, /127\.0\.0\.1:8766/)
  assert.match(viteConfig, /"\/risk-graph-workspace"/)
  assert.match(
    teammateWorkspace,
    /const api=location\.pathname\.startsWith\('\/knowledge-graph\/'\)\?'\/api\/v1\/risk-graph':'\.\/api'/
  )
})

test("同学原版图谱按股票代码定位且缺失时不回退到其他企业", () => {
  assert.match(teammateWorkspace, /get\('stock_code'\)/)
  assert.match(teammateWorkspace, /attributes\?\.stock_code/)
  assert.match(teammateWorkspace, /company\.disabled=true/)
  assert.match(teammateWorkspace, /当前企业暂无图谱快照/)
  assert.match(teammateWorkspace, /不会复用其他企业的关系/)
})

test("本地统一图谱服务加载寒武纪与芯驰两个独立快照", () => {
  assert.match(devScript, /cambricon_fee_kbg_20260826_v1=/)
  assert.match(devScript, /semidrive_fee_kbg_20260827_v1=/)
  assert.match(teammateWorkspace, /semidriveChineseText/)
  assert.match(teammateWorkspace, /PRIVATE-SEMIDRIVE/)

  assert.equal(semidriveSnapshot.run_id, "semidrive_fee_kbg_20260827_v1")
  assert.equal(semidriveSnapshot.records.knowledge_graph_nodes.length, 104)
  assert.equal(semidriveSnapshot.records.knowledge_graph_edges.length, 200)
  const company = semidriveSnapshot.records.knowledge_graph_nodes.find(
    (node) => node.node_type === "company"
  )
  assert.ok(company)
  assert.match(String(company.attributes_json), /PRIVATE-SEMIDRIVE/)
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

test("风险传导使用收束后的高密度图谱交互", () => {
  assert.match(teammateWorkspace, /企业自身事件影响全景图/)
  assert.match(teammateWorkspace, /外部主体事件风险传导图/)
  assert.doesNotMatch(
    teammateWorkspace,
    /企业主体风险事件传导图谱|外部主体影响全景图谱/
  )
  assert.match(teammateWorkspace, /n\.type==='warning_score'\)return false/)
  assert.match(teammateWorkspace, /risk_category_impacts_company/)
  assert.match(teammateWorkspace, /node-hover-tag/)
  assert.match(teammateWorkspace, /class="graph-boundary"/)
  assert.match(teammateWorkspace, /\.graph-boundary\{display:none\}/)
  assert.match(
    teammateWorkspace,
    /graph-wrap:not\(\.panorama-view\) \.lane-label\{transform:translateY\(-102px\)\}/
  )
  assert.match(teammateWorkspace, /minY:-980/)
  assert.match(teammateWorkspace, /function graphFrame/)
  assert.match(teammateWorkspace, /function clampViewport/)
  assert.match(teammateWorkspace, /setAttribute\('class','tag-layer'\)/)
  assert.match(teammateWorkspace, /事件重点：/)
  assert.match(teammateWorkspace, /titleY=74,titleStep=38,copyStep=32/)
  assert.match(teammateWorkspace, /copyY=76\+title\.length\*titleStep/)
  assert.match(
    teammateWorkspace,
    /metaY=copyY\+\(copy\.length-1\)\*copyStep\+36/
  )
  assert.doesNotMatch(teammateWorkspace, /快照：/)
  assert.match(teammateWorkspace, /@media\(max-width:1180px\)/)
  assert.match(teammateWorkspace, /grid-template-rows:minmax\(0,1fr\) 170px/)
  assert.match(
    teammateWorkspace,
    /<input id="impactThreshold" type="hidden" value="0\.50">/
  )
  assert.match(teammateWorkspace, /<input id="typeFilter" type="hidden"/)
  assert.match(teammateWorkspace, /<input id="search" type="hidden"/)
})

test("图谱后端按一级风险类别汇总到企业且保留多快照兼容", () => {
  assert.match(graphBackend, /risk_category_impacts_company/)
  assert.doesNotMatch(graphBackend, /warning_edges\s*=\s*\[/)
  assert.match(graphBackend, /snapshot_run_ids/)
  assert.match(graphBackend, /snapshot_payloads/)
  assert.match(graphBackend, /Cache-Control/)
})
