import { useEffect, useState } from "react"
import { ShieldAlertIcon } from "lucide-react"

import { NarrativeIndustryTrends } from "@/components/dashboard/narrative-industry-trends"
import type { NarrativeIndustryTrendResponse } from "@/domain/narrative-risk-v1"
import { getNarrativeIndustryTrends } from "@/lib/narrative-risk-api"
import "@/styles/narrative-risk-workspace.css"

export function NarrativeRiskTab({ companyId }: { companyId: string }) {
  const [trends, setTrends] =
    useState<NarrativeIndustryTrendResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    getNarrativeIndustryTrends()
      .then((nextTrends) => {
        if (!active) return
        setTrends(nextTrends)
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

  if (!trends) {
    return error ? (
      <div className="nr-error" role="alert">
        <ShieldAlertIcon /> {error}
      </div>
    ) : (
      <div className="nr-loading">正在加载新版叙事风险年度数据…</div>
    )
  }

  return (
    <section className="nr-workspace" aria-labelledby="narrative-risk-title">
      <header className="nr-page-header">
        <div>
          <h2 id="narrative-risk-title">叙事风险</h2>
          <p>分析企业财报叙事及其行业年度变化。</p>
        </div>
        <div className="nr-page-header__meta" aria-label="数据状态">
          <span>数据截至 {trends.asOfDate}</span>
        </div>
      </header>

      {error ? (
        <div className="nr-error" role="alert">
          <ShieldAlertIcon /> {error}
        </div>
      ) : null}

      <NarrativeIndustryTrends data={trends} companyId={companyId} />
    </section>
  )
}
