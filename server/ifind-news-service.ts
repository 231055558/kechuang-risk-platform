export type IFindNewsRecord = {
  id: string
  companyId: string
  title: string
  summary: string
  publishedAt: string
  capturedAt: string
  sourceUrl: string
  sourceLocator: string
}

type McpTool = {
  name?: unknown
  description?: unknown
  inputSchema?: { properties?: Record<string, unknown> }
}

const companies: Record<string, { short: string; full: string; ticker?: string }> = {
  cambricon: { short: "寒武纪", full: "中科寒武纪科技股份有限公司", ticker: "688256.SH" },
  deepseek: { short: "DeepSeek", full: "深度求索" },
  unitree: { short: "宇树科技", full: "杭州宇树科技股份有限公司" },
  horizon: { short: "地平线", full: "北京地平线机器人技术研发有限公司" },
  "fourth-paradigm": { short: "第四范式", full: "北京第四范式智能技术股份有限公司" },
  robosense: { short: "速腾聚创", full: "深圳市速腾聚创科技有限公司" },
}

function asRecords(value: unknown): Record<string, unknown>[] {
  if (typeof value === "string") {
    try { return asRecords(JSON.parse(value)) } catch { return [] }
  }
  if (Array.isArray(value)) return value.flatMap(asRecords)
  if (!value || typeof value !== "object") return []
  const record = value as Record<string, unknown>
  if (Array.isArray(record.content)) {
    const fromContent = record.content.flatMap((item) =>
      item && typeof item === "object" && typeof (item as Record<string, unknown>).text === "string"
        ? asRecords((item as Record<string, unknown>).text)
        : []
    )
    if (fromContent.length) return fromContent
  }
  for (const key of ["data", "items", "results", "news", "articles", "records", "list"]) {
    const nested = asRecords(record[key])
    if (nested.length) return nested
  }
  return [record]
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function parseMcpResponse(raw: string) {
  const dataFrames = raw.split(/\r?\n/).flatMap((line) => {
    if (!line.startsWith("data:")) return []
    try { return [JSON.parse(line.slice(5).trim())] } catch { return [] }
  })
  return dataFrames.at(-1) ?? JSON.parse(raw)
}

export class IFindNewsService {
  private readonly url: string
  private readonly authorization: string
  private readonly recentDays: number

  constructor(
    url = process.env.IFIND_MCP_NEWS_URL ?? "",
    authorization = process.env.IFIND_MCP_AUTHORIZATION ?? "",
    recentDays = Math.max(1, Number(process.env.IFIND_MCP_RECENT_DAYS ?? "30"))
  ) {
    this.url = url
    this.authorization = authorization
    this.recentDays = recentDays
  }

  get configured() {
    return Boolean(this.url && this.authorization)
  }

  private async request(method: string, params: object, notification = false): Promise<unknown> {
    const response = await fetch(this.url, {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        authorization: this.authorization,
      },
      body: JSON.stringify({ jsonrpc: "2.0", ...(notification ? {} : { id: crypto.randomUUID() }), method, params }),
      signal: AbortSignal.timeout(20_000),
    })
    if (!response.ok) throw new Error(`iFinD MCP returned HTTP ${response.status}`)
    const raw = await response.text()
    if (notification || !raw.trim()) return null
    const parsed = parseMcpResponse(raw) as { result?: unknown; error?: unknown }
    if (parsed.error) throw new Error("iFinD MCP returned an error")
    return parsed.result ?? parsed
  }

  async collect(companyId: string): Promise<IFindNewsRecord[]> {
    if (!this.configured || !companies[companyId]) return []
    await this.request("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "kechuang-risk-platform", version: "1.0" } })
    await this.request("notifications/initialized", {}, true)
    const listed = await this.request("tools/list", {}) as { tools?: McpTool[] }
    const tools = listed.tools ?? []
    const tool = tools.find((item) => ["search_news", "search_notice"].includes(String(item.name))) ?? tools.find((item) => /news|search|资讯|新闻|公告/i.test(`${item.name ?? ""} ${item.description ?? ""}`))
    if (!tool || typeof tool.name !== "string") throw new Error("iFinD MCP 未提供新闻查询工具")
    const company = companies[companyId]
    const start = new Date(Date.now() - this.recentDays * 86_400_000).toISOString().slice(0, 10)
    const end = new Date().toISOString().slice(0, 10)
    const result = await this.request("tools/call", { name: tool.name, arguments: { query: `${company.full} ${company.short}`, time_start: start, time_end: end, size: 20 } })
    const capturedAt = new Date().toISOString()
    return asRecords(result).flatMap((record, index) => {
      const title = text(record.title ?? record.headline ?? record["资讯标题"])
      const summary = text(record.content ?? record.summary ?? record.text ?? record["资讯内容"]) || title
      const haystack = `${title} ${summary}`.toLowerCase()
      if (!title || !haystack.includes(company.short.toLowerCase())) return []
      const publishedAt = text(record.published_at ?? record.publish_time ?? record.date ?? record["日期"]) || capturedAt
      return [{ id: `ifind-${companyId}-${crypto.randomUUID()}-${index}`, companyId, title, summary: summary.slice(0, 4000), publishedAt, capturedAt, sourceUrl: text(record.url ?? record.URL ?? record.link ?? record.source_url), sourceLocator: `同花顺 iFinD MCP · 工具 ${tool.name} · 查询 ${company.full}` }]
    })
  }
}
