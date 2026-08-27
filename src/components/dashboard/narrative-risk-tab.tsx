import { useEffect, useState } from "react"
import { AlertTriangleIcon, DatabaseIcon, ShieldAlertIcon } from "lucide-react"

import { NarrativeAnnualTrends } from "@/components/dashboard/narrative-annual-trends"
import { Badge } from "@/components/ui/badge"
import type {
  NarrativeAnnualAuditResponse,
  NarrativeAnnualMethodologyResponse,
  NarrativeAnnualTrendResponse,
} from "@/domain/narrative-risk-v1"
import {
  getNarrativeAnnualAudit,
  getNarrativeAnnualMethodology,
  getNarrativeAnnualTrends,
} from "@/lib/narrative-risk-api"
import "@/styles/narrative-risk-workspace.css"

export function NarrativeRiskTab() {
  const [trends, setTrends] = useState<NarrativeAnnualTrendResponse | null>(
    null
  )
  const [methodology, setMethodology] =
    useState<NarrativeAnnualMethodologyResponse | null>(null)
  const [audit, setAudit] = useState<NarrativeAnnualAuditResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    Promise.all([
      getNarrativeAnnualTrends(),
      getNarrativeAnnualMethodology(),
      getNarrativeAnnualAudit(),
    ])
      .then(([nextTrends, nextMethodology, nextAudit]) => {
        if (!active) return
        setTrends(nextTrends)
        setMethodology(nextMethodology)
        setAudit(nextAudit)
        setError(null)
      })
      .catch((reason: unknown) => {
        if (!active) return
        setError(
          reason instanceof Error ? reason.message : "年度趋势加载失败。"
        )
      })
    return () => {
      active = false
    }
  }, [])

  if (!trends || !methodology || !audit) {
    return error ? (
      <div className="nr-error" role="alert">
        <ShieldAlertIcon /> {error}
      </div>
    ) : (
      <div className="nr-loading">正在加载新版叙事风险年度数据…</div>
    )
  }

  const sourceMode = [
    trends.sourceMode,
    methodology.sourceMode,
    audit.sourceMode,
  ].includes("snapshot")
    ? "snapshot"
    : "postgres"

  return (
    <section className="nr-workspace" aria-labelledby="narrative-risk-title">
      <header className="nr-hero">
        <div>
          <span className="nr-eyebrow">新版年度叙事风险工作台</span>
          <h1 id="narrative-risk-title">叙事风险</h1>
          <p>
            最终计算与呈现仅采用《叙事风险维度测度（修改版）》。页面不展示旧口径结果，也不额外合成跨维度总分。
          </p>
        </div>
        <div className="nr-hero__meta" aria-label="数据状态">
          <Badge
            variant={sourceMode === "postgres" ? "secondary" : "destructive"}
          >
            <DatabaseIcon />
            {sourceMode === "postgres" ? "数据库实时" : "脱敏快照降级"}
          </Badge>
          <span>数据截至 {trends.asOfDate}</span>
          <span>方法版本 新版年度方法 · 2026-08-26</span>
        </div>
      </header>

      {sourceMode === "snapshot" ? (
        <div className="nr-fallback-alert" role="status">
          <AlertTriangleIcon />
          数据库暂不可用，当前读取同一导入批次生成的脱敏快照。
        </div>
      ) : null}
      {error ? (
        <div className="nr-error" role="alert">
          <ShieldAlertIcon /> {error}
        </div>
      ) : null}

      <NarrativeAnnualTrends
        trends={trends}
        methodology={methodology}
        audit={audit}
      />
    </section>
  )
}
