/* eslint-disable react-refresh/only-export-components */
/**
 * PROTOTYPE — three structural directions for the risk overview, switchable
 * through ?variant=A|B|C on the existing page. Delete losing variants after
 * review and rewrite the winner as the production overview.
 */
import { useGSAP } from "@gsap/react"
import gsap from "gsap"
import { useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ExternalLinkIcon,
  FileTextIcon,
} from "lucide-react"

import {
  PRODUCTIVE_MOTION,
  usePrefersReducedMotion,
} from "@/components/motion/workflow-transition"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { IndustryRiskAssessmentApiResponse } from "@/domain/industry-risk-v1/index.ts"
import {
  buildIndustryRiskConclusion,
  generateIndustryRiskRecommendations,
} from "@/domain/industry-risk-v1/index.ts"
import "@/styles/risk-overview-prototype.css"

export type RiskOverviewPrototypeVariant = "A" | "B" | "C"

type NavigateTarget = "reports" | "realtime" | "events" | "intelligence"
type Metric = IndustryRiskAssessmentApiResponse["assessment"]["metrics"][number]
type Recommendation = ReturnType<
  typeof generateIndustryRiskRecommendations
>[number]

const prototypeVariants: readonly RiskOverviewPrototypeVariant[] = [
  "A",
  "B",
  "C",
]

const prototypeNames: Record<RiskOverviewPrototypeVariant, string> = {
  A: "投委会简报",
  B: "研究终端",
  C: "证据卷宗",
}

const percentFormatter = new Intl.NumberFormat("zh-CN", {
  style: "percent",
  maximumFractionDigits: 1,
})

const numberFormatter = new Intl.NumberFormat("zh-CN", {
  maximumFractionDigits: 4,
})

function readVariant(): RiskOverviewPrototypeVariant | null {
  if (typeof window === "undefined" || !import.meta.env.DEV) return null
  const candidate = new URLSearchParams(window.location.search).get("variant")
  return prototypeVariants.includes(candidate as RiskOverviewPrototypeVariant)
    ? (candidate as RiskOverviewPrototypeVariant)
    : null
}

export function useRiskOverviewPrototypeVariant() {
  const [variant, setVariant] = useState<RiskOverviewPrototypeVariant | null>(
    readVariant
  )

  useEffect(() => {
    if (!import.meta.env.DEV) return undefined
    const sync = () => setVariant(readVariant())
    window.addEventListener("popstate", sync)
    return () => window.removeEventListener("popstate", sync)
  }, [])

  return variant
}

function replaceVariant(variant: RiskOverviewPrototypeVariant) {
  const url = new URL(window.location.href)
  url.searchParams.set("variant", variant)
  window.history.replaceState(window.history.state, "", url)
  window.dispatchEvent(new Event("popstate"))
}

function scoreTone(score: number | null) {
  if (score === null) return "unknown"
  if (score >= 65) return "critical"
  if (score >= 55) return "high"
  if (score >= 45) return "medium"
  return "low"
}

function riskLevel(score: number | null) {
  if (score === null) return "待评估"
  if (score >= 65) return "高风险"
  if (score >= 55) return "较高风险"
  if (score >= 45) return "中等风险"
  return "较低风险"
}

interface PrototypeModel {
  response: IndustryRiskAssessmentApiResponse
  selectedRank: number
  scoredMetrics: Metric[]
  priorityMetrics: Metric[]
  recommendations: Recommendation[]
  coveragePercent: number
  conclusion: string
  benchmarkPosition: number | null
  activeIndicatorId: string | null
  activeMetric: Metric | undefined
  activeRecommendation: Recommendation | undefined
  linkedEvents: IndustryRiskAssessmentApiResponse["events"]
  onSelectIndicator: (indicatorId: string) => void
  onNavigate?: (view: NavigateTarget) => void
}

function usePrototypeMotion(
  rootRef: React.RefObject<HTMLElement | null>,
  model: PrototypeModel,
  variant: RiskOverviewPrototypeVariant
) {
  const prefersReducedMotion = usePrefersReducedMotion()

  useGSAP(
    () => {
      const root = rootRef.current
      if (!root) return
      const steps = Array.from(
        root.querySelectorAll<HTMLElement>("[data-motion-step]")
      ).slice(0, 10)
      const bars = Array.from(
        root.querySelectorAll<HTMLElement>("[data-risk-bar]")
      )
      const score = root.querySelector<HTMLElement>("[data-animated-score]")
      const marker = root.querySelector<HTMLElement>("[data-rank-marker]")
      const finalScore = model.response.assessment.totalRiskScore

      if (prefersReducedMotion) {
        gsap.set([...steps, ...bars, marker].filter(Boolean), {
          clearProps: "all",
        })
        if (score) score.textContent = finalScore?.toFixed(2) ?? "—"
        return
      }

      const timeline = gsap.timeline({
        defaults: { overwrite: "auto" },
      })

      timeline.fromTo(
        steps,
        { autoAlpha: 0, y: 18 },
        {
          autoAlpha: 1,
          y: 0,
          duration: 0.34,
          stagger: 0.055,
          ease: PRODUCTIVE_MOTION.easeEnter,
          clearProps: "opacity,transform,visibility",
        }
      )

      if (score && finalScore !== null) {
        const counter = { value: 0 }
        score.textContent = "0.00"
        timeline.to(
          counter,
          {
            value: finalScore,
            duration: 0.58,
            ease: PRODUCTIVE_MOTION.easeData,
            onUpdate: () => {
              score.textContent = counter.value.toFixed(2)
            },
          },
          0.08
        )
      }

      if (marker && model.benchmarkPosition !== null) {
        timeline.fromTo(
          marker,
          { left: "0%", scale: 0.7 },
          {
            left: `${model.benchmarkPosition}%`,
            scale: 1,
            duration: 0.58,
            ease: PRODUCTIVE_MOTION.easeData,
          },
          0.08
        )
      }

      timeline.fromTo(
        bars,
        { scaleX: 0, transformOrigin: "left center" },
        {
          scaleX: 1,
          duration: 0.46,
          stagger: 0.045,
          ease: PRODUCTIVE_MOTION.easeData,
          clearProps: "transform",
        },
        0.3
      )
    },
    {
      scope: rootRef,
      dependencies: [
        model.response.company.id,
        model.response.assessment.totalRiskScore,
        prefersReducedMotion,
        variant,
      ],
      revertOnUpdate: true,
    }
  )

  useGSAP(
    () => {
      const root = rootRef.current
      if (!root || !model.activeIndicatorId || prefersReducedMotion) return
      const linked = Array.from(
        root.querySelectorAll<HTMLElement>("[data-indicator]")
      ).filter(
        (element) => element.dataset.indicator === model.activeIndicatorId
      )
      const selectedBars = linked.flatMap((element) =>
        Array.from(element.querySelectorAll<HTMLElement>("[data-risk-bar]"))
      )
      gsap.fromTo(
        linked,
        { x: -10, autoAlpha: 0.62 },
        {
          x: 0,
          autoAlpha: 1,
          duration: PRODUCTIVE_MOTION.state,
          stagger: 0.035,
          ease: PRODUCTIVE_MOTION.easeEnter,
          clearProps: "opacity,transform,visibility",
        }
      )
      gsap.fromTo(
        selectedBars,
        { scaleX: 0.72, transformOrigin: "left center" },
        {
          scaleX: 1,
          duration: PRODUCTIVE_MOTION.data,
          ease: PRODUCTIVE_MOTION.easeData,
          clearProps: "transform",
        }
      )
    },
    {
      scope: rootRef,
      dependencies: [model.activeIndicatorId, prefersReducedMotion, variant],
      revertOnUpdate: true,
    }
  )
}

export function RiskOverviewPrototype({
  response,
  selectedRank,
  onNavigate,
  variant,
}: {
  response: IndustryRiskAssessmentApiResponse
  selectedRank: number
  onNavigate?: (view: NavigateTarget) => void
  variant: RiskOverviewPrototypeVariant
}) {
  const scoredMetrics = useMemo(
    () =>
      response.assessment.metrics
        .filter((metric) => metric.riskScore !== null)
        .sort(
          (left, right) =>
            (right.riskScore ?? 0) - (left.riskScore ?? 0) ||
            left.indicatorId.localeCompare(right.indicatorId)
        ),
    [response.assessment.metrics]
  )
  const priorityMetrics = scoredMetrics.slice(0, 5)
  const defaultIndicatorId = priorityMetrics[0]?.indicatorId ?? null
  const [selection, setSelection] = useState<{
    companyId: string
    indicatorId: string | null
  }>({ companyId: response.company.id, indicatorId: defaultIndicatorId })
  const activeIndicatorId =
    selection.companyId === response.company.id
      ? selection.indicatorId
      : defaultIndicatorId
  const recommendations = generateIndustryRiskRecommendations(
    response.assessment
  )
  const benchmarkPosition =
    response.assessment.benchmarkSampleSize > 1 && selectedRank > 0
      ? Math.round(
          ((response.assessment.benchmarkSampleSize - selectedRank) /
            (response.assessment.benchmarkSampleSize - 1)) *
            100
        )
      : null
  const linkedEvents = response.events.filter(
    (event) => event.indicatorId === activeIndicatorId
  )
  const model: PrototypeModel = {
    response,
    selectedRank,
    scoredMetrics,
    priorityMetrics,
    recommendations,
    coveragePercent: Math.round(response.assessment.weightedDataCoverage * 100),
    conclusion: buildIndustryRiskConclusion(response.assessment),
    benchmarkPosition,
    activeIndicatorId,
    activeMetric: scoredMetrics.find(
      (metric) => metric.indicatorId === activeIndicatorId
    ),
    activeRecommendation: recommendations.find(
      (item) => item.indicatorId === activeIndicatorId
    ),
    linkedEvents,
    onSelectIndicator: (indicatorId) =>
      setSelection({ companyId: response.company.id, indicatorId }),
    onNavigate,
  }

  return (
    <>
      {variant === "A" ? <InvestmentMemo model={model} /> : null}
      {variant === "B" ? <ResearchTerminal model={model} /> : null}
      {variant === "C" ? <EvidenceDossier model={model} /> : null}
      {typeof document !== "undefined" && import.meta.env.DEV
        ? createPortal(<PrototypeSwitcher variant={variant} />, document.body)
        : null}
    </>
  )
}

function ScorePosition({ model }: { model: PrototypeModel }) {
  const { assessment } = model.response
  return (
    <div className="risk-prototype-score" data-motion-step>
      <span>综合风险指数</span>
      <div>
        <strong
          data-animated-score
          aria-hidden="true"
          data-final={assessment.totalRiskScore ?? ""}
        >
          {assessment.totalRiskScore ?? "—"}
        </strong>
        <Badge variant="outline">{riskLevel(assessment.totalRiskScore)}</Badge>
      </div>
      <span className="sr-only">
        综合风险指数 {assessment.totalRiskScore ?? "待评估"}
      </span>
      <div className="risk-prototype-rank-labels">
        <span>低风险端</span>
        <span>高风险端</span>
      </div>
      <div className="risk-prototype-rank-axis" aria-hidden="true">
        {model.benchmarkPosition !== null ? (
          <i data-rank-marker style={{ left: `${model.benchmarkPosition}%` }} />
        ) : null}
      </div>
      <p>
        同业排名 <b>{model.selectedRank || "—"}</b> /{" "}
        {assessment.benchmarkSampleSize}
      </p>
    </div>
  )
}

function DriverButton({
  metric,
  model,
  index,
}: {
  metric: Metric
  model: PrototypeModel
  index: number
}) {
  const active = model.activeIndicatorId === metric.indicatorId
  return (
    <button
      type="button"
      className="risk-prototype-driver"
      data-indicator={metric.indicatorId}
      data-active={active}
      data-muted={Boolean(model.activeIndicatorId && !active)}
      data-tone={scoreTone(metric.riskScore)}
      aria-pressed={active}
      onClick={() => model.onSelectIndicator(metric.indicatorId)}
    >
      <span>{String(index + 1).padStart(2, "0")}</span>
      <div>
        <div>
          <b>{metric.indicatorId}</b>
          <strong>{metric.label}</strong>
          <em>{metric.riskScore ?? "—"}</em>
        </div>
        <i aria-hidden="true">
          <span data-risk-bar style={{ width: `${metric.riskScore ?? 0}%` }} />
        </i>
      </div>
    </button>
  )
}

function LinkedDecision({ model }: { model: PrototypeModel }) {
  const event = model.linkedEvents[0]
  return (
    <div
      className="risk-prototype-linked-decision"
      data-indicator={model.activeIndicatorId ?? undefined}
      data-motion-step
    >
      <section>
        <span>处置建议</span>
        <h4>
          {model.activeRecommendation?.title ?? "当前指标暂无规则化处置建议"}
        </h4>
        <p>
          {model.activeRecommendation?.action ??
            "保留指标结论，继续核验公开来源与企业正式披露。"}
        </p>
      </section>
      <section>
        <span>直接证据</span>
        <h4>{event?.title ?? "当前无结构化事件证据"}</h4>
        <p>
          {event
            ? `${event.date ?? "日期待补充"} · ${event.eventType}`
            : "该指标仍可由财报、公告或其他公开观测支持；事件层暂不强行补位。"}
        </p>
        {event?.url ? (
          <a href={event.url} target="_blank" rel="noreferrer">
            原始来源 <ExternalLinkIcon aria-hidden="true" />
          </a>
        ) : null}
      </section>
    </div>
  )
}

function InvestmentMemo({ model }: { model: PrototypeModel }) {
  const rootRef = useRef<HTMLElement>(null)
  usePrototypeMotion(rootRef, model, "A")
  return (
    <section ref={rootRef} className="risk-prototype risk-prototype--memo">
      <header className="risk-prototype-kicker" data-motion-step>
        <span>PROTOTYPE A · INVESTMENT MEMO</span>
        <p>编辑式研究简报；阅读判断，而不是扫一堆 KPI 卡片。</p>
      </header>
      <div className="risk-memo-layout">
        <aside className="risk-memo-rail">
          <div data-motion-step>
            <span>研究对象</span>
            <h3>{model.response.company.shortName}</h3>
            <p>{model.response.assessment.benchmarkGroupLabel}</p>
          </div>
          <ScorePosition model={model} />
          <dl data-motion-step>
            <div>
              <dt>有效指标</dt>
              <dd>
                {model.response.assessment.weightedScoredIndicatorCount}/18
              </dd>
            </div>
            <div>
              <dt>数据覆盖</dt>
              <dd>{model.coveragePercent}%</dd>
            </div>
            <div>
              <dt>风险事件</dt>
              <dd>{model.response.events.length} 条</dd>
            </div>
          </dl>
        </aside>

        <article className="risk-memo-document">
          <div className="risk-memo-heading" data-motion-step>
            <span>投委会摘要 · {new Date().getFullYear()}</span>
            <h3>{model.conclusion}</h3>
            <p>
              判断只使用当前可用的 R05–R22 客观指标；缺失项不补零，R01–R04
              继续作为独立叙事观察。
            </p>
          </div>
          <section className="risk-memo-drivers" data-motion-step>
            <header>
              <span>支持判断的主要因素</span>
              <small>点击一项查看建议与证据</small>
            </header>
            {model.priorityMetrics.map((metric, index) => (
              <DriverButton
                key={metric.indicatorId}
                metric={metric}
                model={model}
                index={index}
              />
            ))}
          </section>
          <LinkedDecision model={model} />
          <footer data-motion-step>
            <span>IRAWC-CRITIC-2026.08-v2</span>
            <Button onClick={() => model.onNavigate?.("reports")}>
              阅读完整风险报告 <ArrowRightIcon data-icon="inline-end" />
            </Button>
          </footer>
        </article>
      </div>
    </section>
  )
}

function ResearchTerminal({ model }: { model: PrototypeModel }) {
  const rootRef = useRef<HTMLElement>(null)
  const sourceById = new Map(
    model.response.sources.map((source) => [source.id, source])
  )
  usePrototypeMotion(rootRef, model, "B")
  return (
    <section ref={rootRef} className="risk-prototype risk-prototype--terminal">
      <header className="risk-prototype-kicker" data-motion-step>
        <span>PROTOTYPE B · ANALYST TERMINAL</span>
        <p>指标表是主画面；选择一行，右侧立即解释数值、来源与处置。</p>
      </header>
      <div className="risk-terminal-dimensions" data-motion-step>
        {model.response.assessment.dimensionScores.map((dimension) => (
          <div key={dimension.id} data-tone={scoreTone(dimension.score)}>
            <span>{dimension.label}</span>
            <strong>{dimension.score ?? "—"}</strong>
            <i aria-hidden="true">
              <span
                data-risk-bar
                style={{ width: `${dimension.score ?? 0}%` }}
              />
            </i>
          </div>
        ))}
      </div>
      <div className="risk-terminal-layout">
        <div className="risk-terminal-table-wrap" data-motion-step>
          <table>
            <thead>
              <tr>
                <th>指标</th>
                <th>风险分</th>
                <th>同业分位</th>
                <th>观测值</th>
                <th>来源</th>
              </tr>
            </thead>
            <tbody>
              {model.scoredMetrics.map((metric) => {
                const active = metric.indicatorId === model.activeIndicatorId
                const source = metric.sourceId
                  ? sourceById.get(metric.sourceId)
                  : undefined
                return (
                  <tr
                    key={metric.indicatorId}
                    data-indicator={metric.indicatorId}
                    data-active={active}
                    data-muted={Boolean(model.activeIndicatorId && !active)}
                    onClick={() => model.onSelectIndicator(metric.indicatorId)}
                  >
                    <td>
                      <button type="button" aria-pressed={active}>
                        <b>{metric.indicatorId}</b>
                        <span>{metric.label}</span>
                      </button>
                    </td>
                    <td>
                      <strong>{metric.riskScore ?? "—"}</strong>
                      <i aria-hidden="true">
                        <span
                          data-risk-bar
                          style={{ width: `${metric.riskScore ?? 0}%` }}
                        />
                      </i>
                    </td>
                    <td>
                      {metric.riskPercentile === null
                        ? "—"
                        : percentFormatter.format(metric.riskPercentile)}
                    </td>
                    <td>
                      {metric.rawValue === null
                        ? "—"
                        : `${numberFormatter.format(metric.rawValue)} ${metric.unit}`}
                    </td>
                    <td>{source?.institution ?? "公开来源"}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <aside className="risk-terminal-inspector" data-motion-step>
          <span>SELECTED INDICATOR</span>
          <div className="risk-terminal-inspector-score">
            <b>{model.activeMetric?.indicatorId ?? "—"}</b>
            <strong>{model.activeMetric?.riskScore ?? "—"}</strong>
          </div>
          <h3>{model.activeMetric?.label ?? "请选择指标"}</h3>
          <dl>
            <div>
              <dt>同业分位</dt>
              <dd>
                {model.activeMetric?.riskPercentile === null ||
                model.activeMetric?.riskPercentile === undefined
                  ? "—"
                  : percentFormatter.format(model.activeMetric.riskPercentile)}
              </dd>
            </div>
            <div>
              <dt>关联事件</dt>
              <dd>{model.linkedEvents.length} 条</dd>
            </div>
          </dl>
          <p>{model.activeMetric?.formulaTrace ?? "选择一行查看公式痕迹。"}</p>
          <LinkedDecision model={model} />
        </aside>
      </div>
    </section>
  )
}

function EvidenceDossier({ model }: { model: PrototypeModel }) {
  const rootRef = useRef<HTMLElement>(null)
  const newestEvents = [...model.response.events]
    .sort((left, right) => (right.date ?? "").localeCompare(left.date ?? ""))
    .slice(0, 7)
  const newestNews = model.response.narrativeNews.slice(0, 4)
  usePrototypeMotion(rootRef, model, "C")
  return (
    <section ref={rootRef} className="risk-prototype risk-prototype--dossier">
      <header className="risk-prototype-kicker" data-motion-step>
        <span>PROTOTYPE C · EVIDENCE DOSSIER</span>
        <p>把风险指标当作卷宗索引；中间阅读事件，右侧形成研判。</p>
      </header>
      <div className="risk-dossier-layout">
        <nav className="risk-dossier-index" aria-label="重点风险索引">
          <div data-motion-step>
            <span>CASE</span>
            <h3>{model.response.company.shortName}</h3>
            <p>
              {model.response.assessment.totalRiskScore ?? "—"} ·{" "}
              {riskLevel(model.response.assessment.totalRiskScore)}
            </p>
          </div>
          <ol data-motion-step>
            {model.priorityMetrics.map((metric, index) => (
              <li key={metric.indicatorId}>
                <DriverButton metric={metric} model={model} index={index} />
              </li>
            ))}
          </ol>
        </nav>

        <main className="risk-dossier-evidence" data-motion-step>
          <header>
            <span>证据时间线</span>
            <strong>
              {model.activeMetric?.indicatorId ?? "全部"} ·{" "}
              {model.activeMetric?.label ?? "公开事件"}
            </strong>
          </header>
          <div className="risk-dossier-timeline">
            {newestEvents.map((event) => {
              const linked = event.indicatorId === model.activeIndicatorId
              return (
                <article
                  key={event.id}
                  data-indicator={event.indicatorId ?? undefined}
                  data-active={linked}
                  data-muted={Boolean(model.activeIndicatorId && !linked)}
                >
                  <time>{event.date ?? "日期待补充"}</time>
                  <i aria-hidden="true" />
                  <div>
                    <span>
                      {event.indicatorId ?? "事件"} · {event.eventType}
                    </span>
                    <h4>{event.title}</h4>
                    {event.url ? (
                      <a href={event.url} target="_blank" rel="noreferrer">
                        查看公告 <ExternalLinkIcon aria-hidden="true" />
                      </a>
                    ) : null}
                  </div>
                </article>
              )
            })}
          </div>
          <section className="risk-dossier-news">
            <header>
              <span>叙事样本</span>
              <small>不进入总分</small>
            </header>
            {newestNews.map((news) => (
              <a key={news.id} href={news.url} target="_blank" rel="noreferrer">
                <span>{news.mediaName || "财经媒体"}</span>
                <strong>{news.title}</strong>
                <time>{news.publishedAt ?? "日期待补充"}</time>
              </a>
            ))}
          </section>
        </main>

        <aside className="risk-dossier-judgement">
          <div data-motion-step>
            <span>研判结论</span>
            <h3>{model.conclusion}</h3>
          </div>
          <ScorePosition model={model} />
          <LinkedDecision model={model} />
          <Button
            variant="outline"
            onClick={() => model.onNavigate?.("realtime")}
          >
            查看全部风险资讯
          </Button>
          <Button onClick={() => model.onNavigate?.("reports")}>
            <FileTextIcon data-icon="inline-start" />
            打开正式报告
          </Button>
        </aside>
      </div>
    </section>
  )
}

function PrototypeSwitcher({
  variant,
}: {
  variant: RiskOverviewPrototypeVariant
}) {
  useEffect(() => {
    if (!import.meta.env.DEV) return undefined
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return
      }
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
      const index = prototypeVariants.indexOf(variant)
      const direction = event.key === "ArrowRight" ? 1 : -1
      const next =
        prototypeVariants[
          (index + direction + prototypeVariants.length) %
            prototypeVariants.length
        ]
      replaceVariant(next)
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [variant])

  if (!import.meta.env.DEV) return null
  const index = prototypeVariants.indexOf(variant)
  const previous =
    prototypeVariants[
      (index - 1 + prototypeVariants.length) % prototypeVariants.length
    ]
  const next = prototypeVariants[(index + 1) % prototypeVariants.length]
  return (
    <div
      className="risk-prototype-switcher"
      role="toolbar"
      aria-label="结构原型切换"
    >
      <button
        type="button"
        aria-label={`查看${prototypeNames[previous]}`}
        onClick={() => replaceVariant(previous)}
      >
        <ArrowLeftIcon aria-hidden="true" />
      </button>
      <div>
        <span>结构原型 {variant} / 3</span>
        <strong>{prototypeNames[variant]}</strong>
      </div>
      <button
        type="button"
        aria-label={`查看${prototypeNames[next]}`}
        onClick={() => replaceVariant(next)}
      >
        <ArrowRightIcon aria-hidden="true" />
      </button>
    </div>
  )
}
