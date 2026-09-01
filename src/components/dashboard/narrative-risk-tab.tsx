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
      <header className="nr-hero">
        <div>
          <span className="nr-eyebrow">新版年度叙事风险工作台</span>
          <h1 id="narrative-risk-title">叙事风险</h1>
          <p>
            统计94家企业年报中的原始叙事指数，以行业年度范围定位单家企业；不额外合成总分。
          </p>
        </div>
        <div className="nr-hero__meta" aria-label="数据状态">
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
