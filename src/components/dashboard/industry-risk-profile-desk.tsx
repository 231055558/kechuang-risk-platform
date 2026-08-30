import { useGSAP } from "@gsap/react"
import gsap from "gsap"
import { useMemo, useRef, useState } from "react"

import { IndustryRiskRadar } from "@/components/dashboard/industry-risk-radar"
import { usePrefersReducedMotion } from "@/components/motion/workflow-transition"
import { Badge } from "@/components/ui/badge"
import type { IndustryRiskAssessmentApiResponse } from "@/domain/industry-risk-v1/index.ts"
import { buildIndustryRiskConclusion } from "@/domain/industry-risk-v1/index.ts"
import {
  riskHeatColor,
  riskHeatLabel,
  riskPercentileFromRank,
} from "@/lib/risk-heat"
import "@/styles/industry-risk-profile-desk.css"

const percentFormatter = new Intl.NumberFormat("zh-CN", {
  style: "percent",
  maximumFractionDigits: 1,
})

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

function AnimatedValue({
  value,
  decimals = 0,
  suffix,
}: {
  value: number | null
  decimals?: number
  suffix?: string
}) {
  if (value === null) return <>待评估</>
  const finalValue = `${value.toFixed(decimals)}${suffix ?? ""}`
  return (
    <>
      <span
        aria-hidden="true"
        data-count-to={value}
        data-count-decimals={decimals}
        data-count-suffix={suffix ?? ""}
      >
        0{suffix ?? ""}
      </span>
      <span className="sr-only">{finalValue}</span>
    </>
  )
}

export function IndustryRiskProfileDesk({
  response,
  selectedRank,
}: {
  response: IndustryRiskAssessmentApiResponse
  selectedRank: number
}) {
  const rootRef = useRef<HTMLElement>(null)
  const prefersReducedMotion = usePrefersReducedMotion()
  const [activeDimensionId, setActiveDimensionId] = useState<string | null>(
    null
  )
  const { assessment } = response
  const narrativeRisk = assessment.financialReportNarrativeRisk
  const totalScore = assessment.totalRiskScore
  const coveragePercent = Math.round(assessment.weightedDataCoverage * 100)
  const conclusion = buildIndustryRiskConclusion(assessment)
  const priorityMetrics = useMemo(
    () =>
      assessment.metrics
        .filter((metric) => metric.riskScore !== null)
        .sort((left, right) => (right.riskScore ?? 0) - (left.riskScore ?? 0))
        .slice(0, 3),
    [assessment.metrics]
  )
  const benchmarkPosition =
    assessment.benchmarkSampleSize > 1 && selectedRank > 0
      ? ((selectedRank - 1) / (assessment.benchmarkSampleSize - 1)) * 100
      : 0
  const totalRiskPercentile = riskPercentileFromRank(
    selectedRank,
    assessment.benchmarkSampleSize
  )
  const motionKey = `${response.company.id}:${assessment.methodVersion}`

  useGSAP(
    () => {
      const root = rootRef.current
      if (!root) return
      const counters = Array.from(
        root.querySelectorAll<HTMLElement>("[data-count-to]")
      )
      const bars = Array.from(
        root.querySelectorAll<HTMLElement>("[data-growth-bar]")
      )
      const marker = root.querySelector<HTMLElement>("[data-rank-marker]")
      const rows = Array.from(
        root.querySelectorAll<HTMLElement>("[data-risk-driver]")
      )

      const setCounterToFinal = (counter: HTMLElement) => {
        const value = Number(counter.dataset.countTo ?? 0)
        const decimals = Number(counter.dataset.countDecimals ?? 0)
        const suffix = counter.dataset.countSuffix ?? ""
        counter.textContent = `${value.toFixed(decimals)}${suffix}`
      }

      if (prefersReducedMotion) {
        counters.forEach(setCounterToFinal)
        gsap.set([...bars, ...rows], {
          clearProps: "transform,opacity,visibility",
        })
        if (marker) marker.style.left = `${benchmarkPosition}%`
        root.dataset.motionState = "reduced"
        return
      }

      root.dataset.motionState = "running"
      const timeline = gsap.timeline({
        defaults: { overwrite: "auto" },
        onComplete: () => {
          counters.forEach(setCounterToFinal)
          root.dataset.motionState = "complete"
        },
      })

      counters.forEach((counter, index) => {
        const target = Number(counter.dataset.countTo ?? 0)
        const decimals = Number(counter.dataset.countDecimals ?? 0)
        const suffix = counter.dataset.countSuffix ?? ""
        const proxy = { value: 0 }
        counter.textContent = `0${suffix}`
        timeline.to(
          proxy,
          {
            value: target,
            duration: index === 0 ? 0.92 : 0.72,
            ease: "power3.out",
            onUpdate: () => {
              counter.textContent = `${proxy.value.toFixed(decimals)}${suffix}`
            },
          },
          index === 0 ? 0.04 : 0.18 + Math.min(index, 5) * 0.035
        )
      })

      timeline.fromTo(
        bars,
        { scaleX: 0, transformOrigin: "left center" },
        {
          scaleX: 1,
          duration: 0.74,
          stagger: 0.075,
          ease: "power3.out",
          clearProps: "transform",
        },
        0.1
      )
      if (marker) {
        timeline.fromTo(
          marker,
          { left: "0%", opacity: 0.45 },
          {
            left: `${benchmarkPosition}%`,
            opacity: 1,
            duration: 0.82,
            ease: "power3.out",
          },
          0.08
        )
      }
      timeline.fromTo(
        rows,
        { opacity: 0, x: 12 },
        {
          opacity: 1,
          x: 0,
          duration: 0.38,
          stagger: 0.055,
          ease: "power2.out",
          clearProps: "transform,opacity",
        },
        0.22
      )
    },
    {
      scope: rootRef,
      dependencies: [motionKey, benchmarkPosition, prefersReducedMotion],
      revertOnUpdate: true,
    }
  )

  return (
    <section
      ref={rootRef}
      className="risk-profile-desk"
      data-tone={scoreTone(totalScore)}
      data-risk-percentile={totalRiskPercentile ?? "missing"}
      style={
        {
          "--risk-profile-accent": riskHeatColor(totalRiskPercentile),
        } as React.CSSProperties
      }
      data-motion-key={motionKey}
      data-motion-state="idle"
      aria-label={`${response.company.shortName}风险决策概览`}
    >
      <header className="risk-profile-desk__conclusion">
        <div>
          <span className="eyebrow">系统自动结论</span>
          <h3>{conclusion}</h3>
          <p>
            综合指数和风险驱动由 R05–R22
            客观指标自动计算；财报叙事独立评估，不混入客观总分。
          </p>
        </div>
        <Badge variant="outline">
          {riskLevel(totalScore)} · {riskHeatLabel(totalRiskPercentile)}
        </Badge>
      </header>

      <section
        className="risk-profile-desk__narrative"
        aria-label="财报叙事风险结构"
      >
        <div>
          <strong>财报叙事风险</strong>
          <small>财报语料接入后独立计算；新闻资讯不参与评分</small>
        </div>
        <ul>
          {narrativeRisk.dimensions.map((dimension) => (
            <li key={dimension.id}>
              <span>{dimension.label}</span>
              <Badge variant="outline">
                {dimension.status === "assessable" ? "可评估" : "数据接入中"}
              </Badge>
            </li>
          ))}
        </ul>
      </section>

      <div className="risk-profile-desk__matrix">
        <article className="risk-profile-desk__score">
          <div className="risk-profile-desk__section-heading">
            <div>
              <h3>综合风险指数</h3>
            </div>
            <Badge variant="outline">0–100</Badge>
          </div>
          <strong className="risk-profile-desk__score-value">
            <AnimatedValue value={totalScore} decimals={2} />
          </strong>
          <p>数值越高，表示该企业在当前行业样本中的相对风险越突出。</p>
          <div className="risk-profile-desk__score-track" aria-hidden="true">
            <span data-growth-bar style={{ width: `${totalScore ?? 0}%` }} />
          </div>

          <div className="risk-profile-desk__rank">
            <div>
              <span>同业风险位置</span>
              <strong>
                第 {selectedRank || "—"} / {assessment.benchmarkSampleSize} 位
              </strong>
            </div>
            <div className="risk-profile-desk__rank-axis" aria-hidden="true">
              <i data-rank-marker style={{ left: `${benchmarkPosition}%` }} />
            </div>
            <div className="risk-profile-desk__rank-labels">
              <span>风险较高</span>
              <span>风险较低</span>
            </div>
          </div>

          <dl className="risk-profile-desk__facts">
            <div>
              <dt>有效指标</dt>
              <dd>
                <AnimatedValue
                  value={assessment.weightedScoredIndicatorCount}
                />
                <small> / 18</small>
              </dd>
            </div>
            <div>
              <dt>数据覆盖</dt>
              <dd>
                <AnimatedValue value={coveragePercent} suffix="%" />
              </dd>
            </div>
            <div>
              <dt>风险事件</dt>
              <dd>
                <AnimatedValue value={response.events.length} />
                <small> 条</small>
              </dd>
            </div>
          </dl>
        </article>

        <article className="risk-profile-desk__radar">
          <div className="risk-profile-desk__section-heading">
            <div>
              <h3>五大风险领域</h3>
            </div>
            <Badge variant="outline">R05–R22</Badge>
          </div>
          <IndustryRiskRadar
            dimensions={assessment.dimensionScores}
            activeDimensionId={activeDimensionId}
            onDimensionSelect={setActiveDimensionId}
          />
        </article>

        <section className="risk-profile-desk__drivers">
          <div className="risk-profile-desk__section-heading">
            <div>
              <h3>Top 3 风险驱动</h3>
            </div>
            <span>按单项风险分排序</span>
          </div>
          {priorityMetrics.length ? (
            <ol>
              {priorityMetrics.map((metric, index) => {
                const isActive =
                  activeDimensionId !== null &&
                  activeDimensionId === metric.dimensionId
                const isMuted =
                  activeDimensionId !== null &&
                  activeDimensionId !== metric.dimensionId
                return (
                  <li
                    key={metric.indicatorId}
                    data-risk-driver
                    data-active={isActive}
                    data-muted={isMuted}
                    style={
                      {
                        "--risk-driver-heat": riskHeatColor(
                          metric.riskPercentile
                        ),
                      } as React.CSSProperties
                    }
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setActiveDimensionId((current) =>
                          current === metric.dimensionId
                            ? null
                            : metric.dimensionId
                        )
                      }
                    >
                      <span className="risk-profile-desk__driver-rank">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <span className="risk-profile-desk__driver-copy">
                        <span>
                          <b>{metric.indicatorId}</b>
                          {metric.label}
                        </span>
                        <i aria-hidden="true">
                          <span
                            data-growth-bar
                            style={{ width: `${metric.riskScore ?? 0}%` }}
                          />
                        </i>
                        <small>
                          同业风险分位{" "}
                          {metric.riskPercentile === null
                            ? "待补充"
                            : percentFormatter.format(metric.riskPercentile)}
                        </small>
                      </span>
                      <strong>
                        <AnimatedValue value={metric.riskScore} decimals={2} />
                      </strong>
                    </button>
                  </li>
                )
              })}
            </ol>
          ) : (
            <p className="risk-profile-desk__empty">
              当前暂无可计算指标，数据补充后会自动生成重点排序。
            </p>
          )}
        </section>
      </div>
    </section>
  )
}
