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
  assert.match(component, /stock_code/)
  assert.match(component, /<iframe/)
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
  assert.match(component, /onLoad=\{\(\) => setLoadedUrl\(workspaceUrl\)\}/)
  assert.match(styles, /teammate-graph-workspace__frame/)
  assert.match(styles, /@media \(max-width: 720px\)/)
})

test("图谱工作站使用同源代理而不是浏览器直连本地端口", () => {
  assert.match(
    component,
    /DEFAULT_GRAPH_WORKSPACE_URL = "risk-graph-workspace\/"/
  )
  assert.doesNotMatch(component, /127\.0\.0\.1:8766/)
  assert.match(viteConfig, /"\/risk-graph-workspace"/)
  assert.match(teammateWorkspace, /const api='\.\/api'/)
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
  assert.equal(semidriveSnapshot.records.knowledge_graph_nodes.length, 69)
  assert.equal(semidriveSnapshot.records.knowledge_graph_edges.length, 130)
  const company = semidriveSnapshot.records.knowledge_graph_nodes.find(
    (node) => node.node_type === "company"
  )
  assert.ok(company)
  assert.match(String(company.attributes_json), /PRIVATE-SEMIDRIVE/)
})
