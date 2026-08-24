import { useEffect, useState } from "react"
import {
  ArrowRightIcon,
  LightbulbIcon,
  RefreshCwIcon,
  ShieldAlertIcon,
  SparklesIcon,
} from "lucide-react"

import { GlassPanel } from "@/components/dashboard/shared"
import { Reveal } from "@/components/motion/workflow-transition"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  buildIndustryRiskConclusion,
  generateIndustryRiskRecommendations,
  type IndustryRiskAssessmentApiResponse,
} from "@/domain/industry-risk-v1/index.ts"
import { fetchIndustryRiskAssessment } from "@/lib/industry-risk-api"

type AdviceState =
  | { status: "loading" }
  | { status: "success"; value: IndustryRiskAssessmentApiResponse }
  | { status: "error"; companyId: string; message: string }

export function AutomaticRiskAdvicePanel({ companyId }: { companyId: string }) {
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<AdviceState>({ status: "loading" })

  useEffect(() => {
    const controller = new AbortController()
    void fetchIndustryRiskAssessment(companyId, { signal: controller.signal })
      .then((value) => setState({ status: "success", value }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setState({
          status: "error",
          companyId,
          message:
            error instanceof Error ? error.message : "系统建议暂时无法加载。",
        })
      })
    return () => controller.abort()
  }, [attempt, companyId])

  if (
    state.status === "loading" ||
    (state.status === "success" && state.value.company.id !== companyId) ||
    (state.status === "error" && state.companyId !== companyId)
  ) {
    return (
      <Reveal>
        <GlassPanel className="industry-risk-state" variant="floating">
          <SparklesIcon aria-hidden="true" />
          <div>
            <strong>正在生成系统建议</strong>
            <p>根据当前企业风险指数和高影响指标匹配行动方案。</p>
          </div>
        </GlassPanel>
      </Reveal>
    )
  }

  if (state.status === "error") {
    return (
      <Reveal>
        <GlassPanel className="industry-risk-state" variant="floating">
          <ShieldAlertIcon aria-hidden="true" />
          <div>
            <strong>系统建议加载失败</strong>
            <p>{state.message}</p>
          </div>
          <Button
            variant="outline"
            onClick={() => {
              setState({ status: "loading" })
              setAttempt((value) => value + 1)
            }}
          >
            <RefreshCwIcon data-icon="inline-start" />
            重新生成
          </Button>
        </GlassPanel>
      </Reveal>
    )
  }

  const { assessment } = state.value
  const recommendations = generateIndustryRiskRecommendations(assessment)
  const conclusion = buildIndustryRiskConclusion(assessment)

  return (
    <div className="tab-content-stack automatic-advice-page">
      <Reveal>
        <GlassPanel
          className="automatic-advice-hero"
          surfaceClassName="automatic-advice-hero-glass"
          variant="floating"
        >
          <div className="automatic-advice-hero-icon">
            <LightbulbIcon aria-hidden="true" />
          </div>
          <div>
            <span className="eyebrow">系统自动结论</span>
            <h2>{state.value.company.shortName}风险应对建议</h2>
            <p>{conclusion}</p>
          </div>
          <article>
            <span>综合风险指数</span>
            <strong>{assessment.totalRiskScore ?? "—"}</strong>
            <small>
              {assessment.weightedScoredIndicatorCount}/18 项指标已纳入
            </small>
          </article>
        </GlassPanel>
      </Reveal>

      <Reveal>
        <section className="automatic-advice-section">
          <header>
            <div>
              <span className="eyebrow">建议动作</span>
              <h3>按风险影响排序执行</h3>
              <p>
                系统依据当前企业高风险指标自动匹配处置规则，并随指标分值更新。
              </p>
            </div>
            <Badge variant="outline">
              自动生成 {recommendations.length} 项
            </Badge>
          </header>
          <div className="automatic-action-grid">
            {recommendations.map((recommendation, index) => (
              <article
                key={recommendation.indicatorId}
                data-priority={recommendation.priority}
              >
                <div className="automatic-action-index">
                  {String(index + 1).padStart(2, "0")}
                </div>
                <div className="automatic-action-main">
                  <div>
                    <Badge variant="outline">{recommendation.priority}</Badge>
                    <span>{recommendation.trigger}</span>
                  </div>
                  <h4>{recommendation.title}</h4>
                  <p>{recommendation.action}</p>
                </div>
                <ArrowRightIcon aria-hidden="true" />
              </article>
            ))}
          </div>
        </section>
      </Reveal>

      <Reveal>
        <section className="automatic-advice-boundary">
          <strong>建议定位</strong>
          <p>
            本页提供由风险指标自动触发的风险应对动作，用于确定尽调、治理和持续跟踪优先级；不输出买入、卖出或收益预测。
          </p>
        </section>
      </Reveal>
    </div>
  )
}
