import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { useTheme } from "@/components/theme-provider"
import type { CompanyDetail } from "@/types/risk"
import "@/styles/risk-propagation-graph.css"

const DEFAULT_GRAPH_WORKSPACE_URL = "risk-graph-workspace/"
const GRAPH_WORKSPACE_UI_REVISION = "graph-ux-cleanup-20260830-v1"

function stockCodeFromCompanyId(companyId: string) {
  const match = companyId.match(/(?:^|-)\d{6}$/)
  return match?.[0].replace(/^-/, "") ?? companyId
}

type GraphTheme = "light" | "dark"

function teammateWorkspaceUrl(companyId: string, theme: GraphTheme) {
  const configuredUrl =
    import.meta.env.VITE_GRAPH_WORKSPACE_URL || DEFAULT_GRAPH_WORKSPACE_URL
  const configuredRevision = import.meta.env.VITE_GRAPH_WORKSPACE_REVISION
  const url = new URL(configuredUrl, window.location.href)
  url.searchParams.set("stock_code", stockCodeFromCompanyId(companyId))
  url.searchParams.set("embedded", "1")
  url.searchParams.set("theme", theme)
  url.searchParams.set(
    "revision",
    configuredRevision
      ? `${configuredRevision}-${GRAPH_WORKSPACE_UI_REVISION}`
      : GRAPH_WORKSPACE_UI_REVISION
  )
  return url.toString()
}

export function RiskPropagationGraph({ detail }: { detail: CompanyDetail }) {
  const { theme } = useTheme()
  const resolvedTheme: GraphTheme =
    theme === "dark" || theme === "light"
      ? theme
      : document.documentElement.classList.contains("dark")
        ? "dark"
        : "light"
  const frameRef = useRef<HTMLIFrameElement>(null)
  const [initialTheme] = useState<GraphTheme>(resolvedTheme)
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null)
  const workspaceUrl = useMemo(
    () => teammateWorkspaceUrl(detail.id, initialTheme),
    [detail.id, initialTheme]
  )
  const workspaceOrigin = useMemo(
    () => new URL(workspaceUrl).origin,
    [workspaceUrl]
  )
  const syncTheme = useCallback(() => {
    frameRef.current?.contentWindow?.postMessage(
      {
        type: "kechuang-risk-graph-theme",
        theme: resolvedTheme,
      },
      workspaceOrigin
    )
  }, [resolvedTheme, workspaceOrigin])

  useEffect(() => {
    syncTheme()
  }, [syncTheme])

  const isLoading = loadedUrl !== workspaceUrl

  return (
    <section
      className="teammate-graph-workspace"
      data-graph-contract="KCR-RISK-GRAPH-2026.08-v1"
      data-graph-ui="teammate-fee-kbg"
      aria-label={`${detail.name}风险传导图谱`}
    >
      <div className="teammate-graph-workspace__frame-shell">
        {isLoading ? (
          <div className="teammate-graph-workspace__loading" role="status">
            正在加载风险传导图谱…
          </div>
        ) : null}
        <iframe
          ref={frameRef}
          key={workspaceUrl}
          src={workspaceUrl}
          title={`${detail.name}金融事件演化风险知识图谱`}
          className="teammate-graph-workspace__frame"
          sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
          referrerPolicy="no-referrer"
          onLoad={() => {
            setLoadedUrl(workspaceUrl)
            syncTheme()
          }}
        />
      </div>
    </section>
  )
}
