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
  assert.match(component, /GRAPH_WORKSPACE_UI_REVISION/)
  assert.match(component, /http:\/\/127\.0\.0\.1:8765\//)
  assert.doesNotMatch(component, /http:\/\/127\.0\.0\.1:8766\//)
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

test("同学原版图谱按股票代码定位且缺失时不回退到其他企业", () => {
  assert.match(teammateWorkspace, /get\('stock_code'\)/)
  assert.match(teammateWorkspace, /attributes\?\.stock_code/)
  assert.match(teammateWorkspace, /当前企业暂无图谱快照/)
  assert.match(teammateWorkspace, /不会复用其他企业的关系/)
  assert.doesNotMatch(teammateWorkspace, /本地审计快照已加载|当前快照|快照：/)
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

test("事件传导图移除辅助预警并由一级风险类别收束到右侧企业", () => {
  assert.match(teammateWorkspace, /n\.type==='warning_score'\)return false/)
  assert.match(teammateWorkspace, /root\.cx=1510/)
  assert.match(teammateWorkspace, /risk_category_impacts_company/)
  assert.doesNotMatch(
    teammateWorkspace,
    /relation==='event_impacts_company'\)\{path\.classList\.add\('company-impact'/
  )
})

test("两个图谱提供即时节点简介和有限画布", () => {
  assert.match(teammateWorkspace, /node-hover-tag/)
  assert.match(teammateWorkspace, /node:hover \.node-hover-tag/)
  assert.match(teammateWorkspace, /function nodeHoverTag/)
  assert.match(teammateWorkspace, /function graphFrame/)
  assert.match(teammateWorkspace, /function clampViewport/)
  assert.match(teammateWorkspace, /minY=\(1-k\)\*frame\.maxY/)
  assert.match(teammateWorkspace, /maxY=\(1-k\)\*frame\.minY/)
  assert.doesNotMatch(teammateWorkspace, /limitY=120\+extra\*380/)
  assert.match(teammateWorkspace, /class="graph-boundary"/)
  assert.match(teammateWorkspace, /图谱已限制在边框范围内/)
})

test("节点球体只保留主名称且事件标签展示完整名称与重点", () => {
  assert.match(teammateWorkspace, /\.node \.sub\{display:none!important\}/)
  assert.match(teammateWorkspace, /\.node \.score\{display:none!important\}/)
  assert.match(teammateWorkspace, /class="tag-title"/)
  assert.match(
    teammateWorkspace,
    /hoverTagLines\(nodeLabel\(n\),22,isRiskEvent\(n\)\?3:2,false\)/
  )
  assert.match(teammateWorkspace, /事件重点：/)
  assert.match(teammateWorkspace, /items\.slice\(0,3\)/)
})

test("所有节点简介标签统一绘制在最顶层覆盖层", () => {
  assert.match(teammateWorkspace, /setAttribute\('class','tag-layer'\)/)
  assert.match(teammateWorkspace, /data-owner=/)
  assert.match(teammateWorkspace, /world\?\.appendChild\(tagLayer\)/)
  assert.match(teammateWorkspace, /tagLayer\.appendChild\(tag\)/)
  assert.match(teammateWorkspace, /tag\.dataset\.hovered='true'/)
  assert.match(
    teammateWorkspace,
    /\.tag-layer \.node-hover-tag\[data-hovered="true"\]/
  )
})

test("内嵌风险传导页压缩工具区并让完整图谱占满首屏", () => {
  assert.match(teammateWorkspace, /dataset\.embedded/)
  assert.match(
    teammateWorkspace,
    /html\[data-embedded="true"\] header\{display:flex/
  )
  assert.match(
    teammateWorkspace,
    /html\[data-embedded="true"\] header p.*\{display:none\}/
  )
  assert.match(
    teammateWorkspace,
    /html\[data-embedded="true"\] \.layout\{flex:1 1 auto/
  )
  assert.match(
    teammateWorkspace,
    /html\[data-embedded="true"\] \.graph-wrap svg/
  )
  assert.match(teammateWorkspace, /height:100%;min-height:0/)
})

test("图谱切换按钮与企业选择同排且固定使用重要主体阈值", () => {
  assert.match(
    teammateWorkspace,
    /<section class="controls"[^\n]*<nav class="graph-tabs"/
  )
  assert.match(
    teammateWorkspace,
    /<input id="impactThreshold" type="hidden" value="0\.50">/
  )
  assert.match(teammateWorkspace, /<input id="typeFilter" type="hidden"/)
  assert.match(teammateWorkspace, /<input id="search" type="hidden"/)
  assert.doesNotMatch(teammateWorkspace, /<select id="impactThreshold"/)
  assert.doesNotMatch(teammateWorkspace, /<select id="typeFilter"/)
  assert.doesNotMatch(teammateWorkspace, /placeholder="风险源、事件或指标"/)
  assert.doesNotMatch(teammateWorkspace, /全部风险节点/)
  assert.doesNotMatch(teammateWorkspace, /impactThreshold\.closest/)
})
