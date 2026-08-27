import { useMemo, useState } from "react"

import { Badge } from "@/components/ui/badge"
import type { CompanyDetail } from "@/types/risk"
import "@/styles/risk-propagation-graph.css"

const DEFAULT_GRAPH_WORKSPACE_URL = "http://127.0.0.1:8766/"

function stockCodeFromCompanyId(companyId: string) {
  const match = companyId.match(/(?:^|-)\d{6}$/)
  return match?.[0].replace(/^-/, "") ?? companyId
}

function teammateWorkspaceUrl(companyId: string) {
  const configuredUrl =
    import.meta.env.VITE_GRAPH_WORKSPACE_URL || DEFAULT_GRAPH_WORKSPACE_URL
  const url = new URL(configuredUrl, window.location.href)
  url.searchParams.set("stock_code", stockCodeFromCompanyId(companyId))
  url.searchParams.set("embedded", "1")
  return url.toString()
}

export function RiskPropagationGraph({ detail }: { detail: CompanyDetail }) {
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null)
  const workspaceUrl = useMemo(
    () => teammateWorkspaceUrl(detail.id),
    [detail.id]
  )
  const isLoading = loadedUrl !== workspaceUrl

  return (
    <section
      className="teammate-graph-workspace"
      data-graph-contract="KCR-RISK-GRAPH-2026.08-v1"
      data-graph-ui="teammate-fee-kbg"
      aria-label={`${detail.name}风险传导图谱`}
    >
      <div className="teammate-graph-workspace__status">
        <div>
          <strong>{detail.name}</strong>
          <span>金融事件演化知识大图</span>
        </div>
        <Badge variant="outline">
          {isLoading ? "正在连接图谱服务" : "同学原版图谱界面"}
        </Badge>
      </div>
      <div className="teammate-graph-workspace__frame-shell">
        {isLoading ? (
          <div className="teammate-graph-workspace__loading" role="status">
            正在按证券代码读取图谱快照…
          </div>
        ) : null}
        <iframe
          key={workspaceUrl}
          src={workspaceUrl}
          title={`${detail.name}金融事件演化风险知识图谱`}
          className="teammate-graph-workspace__frame"
          sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
          referrerPolicy="no-referrer"
          onLoad={() => setLoadedUrl(workspaceUrl)}
        />
      </div>
      <p className="teammate-graph-workspace__boundary">
        图谱节点、关系与条件演化均由独立图谱服务提供；当前企业没有关系快照时，不复用其他企业数据。
      </p>
    </section>
  )
}
