import { useGSAP } from "@gsap/react"
import gsap from "gsap"
import { useId, useMemo, useRef } from "react"

import { usePrefersReducedMotion } from "@/components/motion/workflow-transition"
import type { IndustryRiskDimensionScore } from "@/domain/industry-risk-v1/index.ts"
import { buildIndustryRiskRadarModel } from "@/lib/industry-risk-radar"
import { riskHeatColor } from "@/lib/risk-heat"

export function IndustryRiskRadar({
  dimensions,
  activeDimensionId,
  onDimensionSelect,
}: {
  dimensions: IndustryRiskDimensionScore[]
  activeDimensionId?: string | null
  onDimensionSelect?: (dimensionId: string | null) => void
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const prefersReducedMotion = usePrefersReducedMotion()
  const titleId = useId()
  const descriptionId = useId()
  const fillId = `${useId().replaceAll(":", "")}-industry-radar-fill`
  const model = useMemo(
    () => buildIndustryRiskRadarModel(dimensions),
    [dimensions]
  )
  const scoreByDimension = useMemo(
    () => new Map(model.axes.map((axis) => [axis.id, axis.score])),
    [model.axes]
  )

  useGSAP(
    () => {
      const root = rootRef.current
      if (!root) return
      const area = root.querySelector<SVGPolygonElement>("[data-radar-area]")
      const points = Array.from(
        root.querySelectorAll<SVGCircleElement>("[data-radar-point]")
      )
      const bars = Array.from(
        root.querySelectorAll<HTMLElement>("[data-radar-bar]")
      )

      if (prefersReducedMotion) {
        gsap.set([...points, ...bars], {
          clearProps: "transform,opacity,visibility",
        })
        if (area && model.polygonPoints) {
          area.setAttribute("points", model.polygonPoints)
        }
        return
      }

      const timeline = gsap.timeline({ defaults: { overwrite: "auto" } })
      if (area && model.polygonPoints) {
        timeline.fromTo(
          area,
          { attr: { points: model.centerPoints }, opacity: 0.22 },
          {
            attr: { points: model.polygonPoints },
            opacity: 1,
            duration: 1.05,
            ease: "power3.out",
          },
          0.08
        )
      }
      points.forEach((point, index) => {
        const finalX = Number(point.dataset.x)
        const finalY = Number(point.dataset.y)
        timeline.fromTo(
          point,
          {
            attr: { cx: model.center.x, cy: model.center.y },
            opacity: 0.28,
          },
          {
            attr: { cx: finalX, cy: finalY },
            opacity: 1,
            duration: 0.82,
            ease: "power3.out",
          },
          0.16 + index * 0.07
        )
      })
      timeline.fromTo(
        bars,
        { scaleX: 0, transformOrigin: "left center" },
        {
          scaleX: 1,
          duration: 0.72,
          stagger: 0.06,
          ease: "power2.out",
          clearProps: "transform",
        },
        0.28
      )
    },
    {
      scope: rootRef,
      dependencies: [dimensions, prefersReducedMotion],
      revertOnUpdate: true,
    }
  )

  return (
    <div ref={rootRef} className="industry-risk-radar">
      <svg
        viewBox={model.viewBox}
        role="img"
        aria-labelledby={`${titleId} ${descriptionId}`}
        preserveAspectRatio="xMidYMid meet"
      >
        <title id={titleId}>五域风险雷达</title>
        <desc id={descriptionId}>
          展示技术、合规、财务与融资、外部和人员五个客观风险领域。顶点由中心向外表示风险增大；缺失领域不按零分绘制。
        </desc>
        <defs>
          <linearGradient id={fillId} x1="10%" y1="0%" x2="90%" y2="100%">
            <stop offset="0%" />
            <stop offset="100%" />
          </linearGradient>
        </defs>
        <g className="industry-risk-radar-grid" aria-hidden="true">
          {model.rings.map((ring) => (
            <polygon
              key={ring.value}
              points={ring.points}
              data-ring={ring.value}
            />
          ))}
          {model.axes.map((axis) => (
            <line
              key={axis.id}
              x1={model.center.x}
              y1={model.center.y}
              x2={axis.end.x}
              y2={axis.end.y}
            />
          ))}
        </g>
        {model.polygonPoints ? (
          <polygon
            data-radar-area
            className="industry-risk-radar-area"
            points={model.polygonPoints}
            fill={`url(#${fillId})`}
            aria-hidden="true"
          />
        ) : null}
        <g className="industry-risk-radar-points" aria-hidden="true">
          {model.plotPoints.map((point) => (
            <circle
              key={point.id}
              data-radar-point
              data-x={point.x}
              data-y={point.y}
              data-active={activeDimensionId === point.id}
              data-muted={Boolean(
                activeDimensionId && activeDimensionId !== point.id
              )}
              cx={point.x}
              cy={point.y}
              r={activeDimensionId === point.id ? 6 : 4.5}
              style={{
                fill: riskHeatColor(
                  (scoreByDimension.get(point.id) ?? 0) / 100
                ),
              }}
            />
          ))}
        </g>
        <circle
          className="industry-risk-radar-center"
          cx={model.center.x}
          cy={model.center.y}
          r="3"
        />
        <g className="industry-risk-radar-labels" aria-hidden="true">
          {model.axes.map((axis) => (
            <text
              key={axis.id}
              x={axis.labelPoint.x}
              y={axis.labelPoint.y}
              textAnchor={axis.textAnchor}
              data-active={activeDimensionId === axis.id}
              data-muted={Boolean(
                activeDimensionId && activeDimensionId !== axis.id
              )}
            >
              <tspan x={axis.labelPoint.x}>
                {axis.label.replace("风险", "")}
              </tspan>
              <tspan x={axis.labelPoint.x} dy="1.35em">
                {axis.score === null ? "暂无数据" : axis.score.toFixed(1)}
              </tspan>
            </text>
          ))}
        </g>
      </svg>

      <ul aria-label="五大风险领域评分">
        {model.axes.map((axis) => (
          <li
            key={axis.id}
            data-active={activeDimensionId === axis.id}
            data-missing={axis.score === null}
            style={
              {
                "--radar-axis-heat": riskHeatColor(
                  axis.score === null ? null : axis.score / 100
                ),
              } as React.CSSProperties
            }
          >
            <button
              type="button"
              aria-pressed={activeDimensionId === axis.id}
              onClick={() =>
                onDimensionSelect?.(
                  activeDimensionId === axis.id ? null : axis.id
                )
              }
            >
              <span>{axis.label}</span>
              <strong>
                {axis.score === null ? "—" : axis.score.toFixed(2)}
              </strong>
              <i aria-hidden="true">
                <span data-radar-bar style={{ width: `${axis.score ?? 0}%` }} />
              </i>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
