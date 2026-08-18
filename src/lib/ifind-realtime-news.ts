import type { RealTimeDataSet, RealTimeSignal } from "@/types/risk"

type IFindResponse = { signals?: Array<{ id: string; companyId: string; title: string; summary: string; publishedAt: string; capturedAt: string; sourceUrl: string; sourceLocator: string }> }

export async function loadIFindRealtimeNews(companyId: string): Promise<RealTimeSignal[]> {
  const response = await fetch(`/api/v1/realtime-signals/ifind?companyId=${encodeURIComponent(companyId)}`)
  if (!response.ok) return []
  const payload = await response.json() as IFindResponse
  return (payload.signals ?? []).map((item) => ({
    ...item,
    scope: "company" as const,
    companyIds: [item.companyId],
    category: "企业披露" as const,
    severity: "watch" as const,
    keyFacts: [item.summary.slice(0, 240)],
    historicalContext: "iFinD MCP 实时新闻，尚未进入正式评分。",
    aiInsight: "未进行自动事实核验。",
    potentialImpact: "待人工核验后评估。",
    recommendedAction: "打开原始来源，核对主体、时间和事实后再转为风险事件。",
    researchQuestions: ["原始来源是否可访问且主体匹配？"],
    riskDimensionIds: [], indicatorIds: [], eventIds: [], heatScore: 0, sourceCount: 1,
    sourceName: "同花顺 iFinD MCP", sourceReliability: "media" as const,
    verificationStatus: "pending" as const,
  }))
}

export function mergeRealtimeNews(base: RealTimeDataSet, incoming: RealTimeSignal[]): RealTimeDataSet {
  if (!incoming.length) return base
  const signals = [...incoming, ...base.signals].sort((left, right) => right.publishedAt.localeCompare(left.publishedAt))
  return { ...base, snapshotAt: new Date().toISOString(), note: "包含公开研究快照及已配置的同花顺 iFinD MCP 实时新闻；MCP 新闻须人工核验，不自动参与评分。", dailyBrief: { ...base.dailyBrief, capturedAt: new Date().toISOString(), pendingVerificationCount: signals.filter((item) => item.verificationStatus === "pending").length }, signals }
}
