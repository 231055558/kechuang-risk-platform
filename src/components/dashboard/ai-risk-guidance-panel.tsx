import { useEffect, useRef, useState } from "react"
import { RefreshCwIcon, ShieldCheckIcon, SparklesIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type {
  IndustryRiskAiGuidancePerspective,
  IndustryRiskAiGuidanceResponse,
} from "@/domain/industry-risk-v1/index.ts"
import { fetchIndustryRiskAiGuidance } from "@/lib/industry-risk-api"

type GuidanceState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; response: IndustryRiskAiGuidanceResponse }
  | { status: "error"; message: string }

const perspectiveCopy: Record<
  IndustryRiskAiGuidancePerspective,
  { title: string; description: string }
> = {
  institution: {
    title: "AI投委会研判补充",
    description: "围绕高分位信号、证据缺口和风险约束补充专项尽调思路。",
  },
  individual: {
    title: "AI个人风险核验补充",
    description: "围绕风险承受、原始证据和集中暴露补充人工检查问题。",
  },
  bank: {
    title: "AI授信审查补充",
    description: "围绕财务覆盖、第一还款来源和重大风险补充审查思路。",
  },
  "enterprise-response": {
    title: "AI降险方案补充",
    description: "在规则整改清单之外，补充跨指标的整改与验证思路。",
  },
}

export function AiRiskGuidancePanel({
  companyId,
  perspective,
}: {
  companyId: string
  perspective: IndustryRiskAiGuidancePerspective
}) {
  const [state, setState] = useState<GuidanceState>({ status: "idle" })
  const controllerRef = useRef<AbortController | null>(null)
  const copy = perspectiveCopy[perspective]

  useEffect(
    () => () => {
      controllerRef.current?.abort()
    },
    []
  )

  async function generate() {
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    setState({ status: "loading" })
    try {
      const response = await fetchIndustryRiskAiGuidance(
        companyId,
        perspective,
        { signal: controller.signal }
      )
      if (!controller.signal.aborted) setState({ status: "success", response })
    } catch (error) {
      if (controller.signal.aborted) return
      setState({
        status: "error",
        message:
          error instanceof Error ? error.message : "AI增强建议暂时不可用。",
      })
    }
  }

  return (
    <section className="ai-risk-guidance" aria-labelledby="ai-guidance-title">
      <header>
        <div className="ai-risk-guidance__heading">
          <span className="ai-risk-guidance__icon">
            <SparklesIcon aria-hidden="true" />
          </span>
          <div>
            <div className="ai-risk-guidance__eyebrow">
              <Badge variant="outline">AI增强</Badge>
              <span>不改变评分结果</span>
            </div>
            <h3 id="ai-guidance-title">{copy.title}</h3>
            <p>{copy.description}</p>
          </div>
        </div>
        <Button
          type="button"
          variant={state.status === "success" ? "outline" : "default"}
          disabled={state.status === "loading"}
          onClick={() => void generate()}
        >
          {state.status === "loading" ? (
            <RefreshCwIcon data-icon="inline-start" className="animate-spin" />
          ) : (
            <SparklesIcon data-icon="inline-start" />
          )}
          {state.status === "loading"
            ? "正在生成"
            : state.status === "success"
              ? "重新生成"
              : "生成AI补充建议"}
        </Button>
      </header>

      {state.status === "idle" ? (
        <div className="ai-risk-guidance__notice">
          <ShieldCheckIcon aria-hidden="true" />
          <p>
            点击后仅发送当前企业已校验的R05–R22指标、缺失原因和最多8条结构化事件；不发送新闻正文、图谱、付费原始响应或个人资产信息。
          </p>
        </div>
      ) : null}

      {state.status === "loading" ? (
        <div className="ai-risk-guidance__state" role="status">
          <strong>正在基于现有证据形成补充建议</strong>
          <p>规则研判仍是主结论，AI只补充可人工复核的思路。</p>
        </div>
      ) : null}

      {state.status === "error" ? (
        <div className="ai-risk-guidance__state" role="alert" data-error="true">
          <strong>AI增强建议未生成</strong>
          <p>{state.message}</p>
        </div>
      ) : null}

      {state.status === "success" ? (
        <AiGuidanceResult response={state.response} />
      ) : null}
    </section>
  )
}

function AiGuidanceResult({
  response,
}: {
  response: IndustryRiskAiGuidanceResponse
}) {
  return (
    <div className="ai-risk-guidance__result">
      <div className="ai-risk-guidance__summary">
        <p>{response.summary}</p>
        <small>
          {response.provider === "deepseek" ? "DeepSeek" : "OpenAI"} · 模型{" "}
          {response.model} · 数据截至 {response.sourceDate}
        </small>
      </div>

      <div className="ai-risk-guidance__recommendations">
        {response.recommendations.map((recommendation, index) => (
          <article key={`${index}-${recommendation.title}`}>
            <header>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <h4>{recommendation.title}</h4>
            </header>
            <p>{recommendation.rationale}</p>
            <dl>
              <div>
                <dt>AI补充动作</dt>
                <dd>{recommendation.action}</dd>
              </div>
              <div>
                <dt>人工验证</dt>
                <dd>{recommendation.verification}</dd>
              </div>
            </dl>
            <div className="ai-risk-guidance__evidence">
              {recommendation.evidence.map((evidence) => (
                <span
                  key={evidence.indicatorId}
                  data-missing={evidence.status === "missing"}
                  title={evidence.missingReason ?? evidence.label}
                >
                  <strong>{evidence.indicatorId}</strong>
                  {evidence.status === "scored"
                    ? `风险分 ${evidence.riskScore?.toFixed(2)} · P${Math.round((evidence.riskPercentile ?? 0) * 100)} · ${evidence.sourceCount}条来源`
                    : `数据缺失 · ${evidence.missingReason}`}
                </span>
              ))}
            </div>
          </article>
        ))}
      </div>

      <ul className="ai-risk-guidance__limitations">
        {response.limitations.map((limitation) => (
          <li key={limitation}>{limitation}</li>
        ))}
      </ul>
    </div>
  )
}
