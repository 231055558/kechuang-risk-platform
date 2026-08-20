import { useEffect, useId, useState } from "react"
import {
  AlertTriangleIcon,
  ArrowRightIcon,
  BookOpenCheckIcon,
  DatabaseZapIcon,
  RefreshCwIcon,
  ShieldCheckIcon,
} from "lucide-react"

import { GlassPanel } from "@/components/dashboard/shared"
import { IndustryRiskReviewPanel } from "@/components/dashboard/industry-risk-review-panel"
import { KcrEvidenceDrilldown } from "@/components/dashboard/kcr-evidence-drilldown"
import { KcrMvpReviewWorkspace } from "@/components/dashboard/kcr-mvp-review-workspace"
import { KcrRiskKnowledgeGraph } from "@/components/dashboard/kcr-risk-knowledge-graph"
import { LiquidGlassSurface } from "@/components/liquid"
import { Reveal } from "@/components/motion/workflow-transition"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { KcrAssessmentApiResponse } from "@/domain/kcr-v1/assessment-api.ts"
import type {
  KcrActionTask,
  KcrRiskDimensionId,
} from "@/domain/kcr-v1/model.ts"
import type {
  KcrAssessmentDimensionResult,
  KcrRedFlagResult,
} from "@/domain/kcr-v1/scoring-engine.ts"
import { formatSourceDate } from "@/lib/date-format"
import { fetchKcrCompanyAssessment } from "@/lib/kcr-assessment-api"
import { buildKcrRiskRadarModel } from "@/lib/kcr-risk-radar"

type LoadState =
  | { status: "loading" }
  | { status: "success"; value: KcrAssessmentApiResponse }
  | { status: "error"; message: string }

type KcrV3AssessmentPanelProps = {
  companyId: string
  onAssessmentLoad: (value: KcrAssessmentApiResponse) => void
  onOpenMethod: () => void
  actionTasks: KcrActionTask[]
  onCreateActionTask: (redFlag: KcrRedFlagResult) => void
  onActionTaskStatusChange: (
    taskId: string,
    status: KcrActionTask["status"]
  ) => void
  onOpenReport: () => void
}

const percentFormatter = new Intl.NumberFormat("zh-CN", {
  style: "percent",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
})

function KcrRiskRadar({
  dimensions,
  onSelectDimension,
}: {
  dimensions: KcrAssessmentDimensionResult[]
  onSelectDimension: (dimensionId: KcrRiskDimensionId) => void
}) {
  const model = buildKcrRiskRadarModel(dimensions)
  const titleId = useId()
  const descriptionId = useId()
  const gradientId = `${useId().replaceAll(":", "")}-kcr-radar`

  return (
    <LiquidGlassSurface
      variant="card"
      refractive
      className="kcr-v3-radar-glass"
      padding="0"
    >
      <div className="kcr-v3-radar">
        <div className="kcr-v3-panel-heading">
          <div>
            <span>团队工作簿复算</span>
            <h3>五维风险分布</h3>
          </div>
          <Badge variant="outline">点击维度下钻</Badge>
        </div>

        <svg
          viewBox={model.viewBox}
          role="img"
          aria-labelledby={`${titleId} ${descriptionId}`}
        >
          <title id={titleId}>寒武纪 KCR V3 五维风险分布</title>
          <desc id={descriptionId}>
            展示技术、合规、财务与融资、外部环境、人员与治理五个维度的工作簿复算分值。
          </desc>
          <defs>
            <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" className="kcr-v3-radar-gradient-start" />
              <stop offset="100%" className="kcr-v3-radar-gradient-end" />
            </linearGradient>
          </defs>
          <g className="kcr-v3-radar-grid" aria-hidden="true">
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
              className="kcr-v3-radar-area"
              points={model.polygonPoints}
              fill={`url(#${gradientId})`}
              aria-hidden="true"
            />
          ) : null}
          <g className="kcr-v3-radar-points" aria-hidden="true">
            {model.axes.flatMap((axis) =>
              axis.point ? (
                <circle
                  key={axis.id}
                  cx={axis.point.x}
                  cy={axis.point.y}
                  r="5"
                />
              ) : (
                []
              )
            )}
          </g>
          <g className="kcr-v3-radar-labels" aria-hidden="true">
            {model.axes.map((axis) => (
              <text
                key={axis.id}
                x={axis.labelPoint.x}
                y={axis.labelPoint.y}
                textAnchor={axis.textAnchor}
              >
                <tspan x={axis.labelPoint.x} dy="-0.25em">
                  {axis.label}
                </tspan>
                <tspan x={axis.labelPoint.x} dy="1.45em">
                  {axis.score === null ? "数据不足" : `${axis.score} 分`}
                </tspan>
              </text>
            ))}
          </g>
        </svg>

        <ul className="kcr-v3-dimension-values" aria-label="五维风险评分明细">
          {dimensions.map((dimension) => (
            <li key={dimension.dimensionId}>
              <button
                type="button"
                data-level={dimension.riskLevel ?? "unknown"}
                aria-label={`查看${dimension.label}的 ${dimension.indicatorIds.length} 项指标与来源证据`}
                onClick={() => onSelectDimension(dimension.dimensionId)}
              >
                <span>
                  <strong>{dimension.label}</strong>
                  <small>{dimension.indicatorIds.length} 项加权指标</small>
                </span>
                <b>{dimension.score ?? "—"}</b>
                <ArrowRightIcon aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </LiquidGlassSurface>
  )
}

function KcrV3LoadingPanel() {
  return (
    <GlassPanel className="kcr-v3-state" variant="floating" role="status">
      <DatabaseZapIcon aria-hidden="true" />
      <div>
        <strong>正在读取 KCR V3 评估</strong>
        <p>从本地评分 API 复算团队工作簿快照。</p>
      </div>
    </GlassPanel>
  )
}

export function KcrV3AssessmentPanel({
  companyId,
  onAssessmentLoad,
  onOpenMethod,
  actionTasks,
  onCreateActionTask,
  onActionTaskStatusChange,
  onOpenReport,
}: KcrV3AssessmentPanelProps) {
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<LoadState>({ status: "loading" })
  const [selectedDimension, setSelectedDimension] = useState<{
    companyId: string
    dimensionId: KcrRiskDimensionId
  } | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    void fetchKcrCompanyAssessment(companyId, { signal: controller.signal })
      .then((value) => {
        setState({ status: "success", value })
        onAssessmentLoad(value)
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setState({
          status: "error",
          message:
            error instanceof Error
              ? error.message
              : "KCR V3 评估暂时无法加载。",
        })
      })

    return () => controller.abort()
  }, [attempt, companyId, onAssessmentLoad])

  if (state.status === "loading") {
    return (
      <Reveal>
        <KcrV3LoadingPanel />
      </Reveal>
    )
  }

  if (state.status === "error") {
    return (
      <Reveal>
        <GlassPanel className="kcr-v3-state" variant="floating" role="alert">
          <AlertTriangleIcon aria-hidden="true" />
          <div>
            <strong>KCR V3 评估加载失败</strong>
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
            重新加载
          </Button>
        </GlassPanel>
      </Reveal>
    )
  }

  const { assessment, provenance } = state.value
  const primaryRedFlag = assessment.redFlags[0]
  const activeDimension =
    selectedDimension?.companyId === companyId
      ? assessment.dimensions.find(
          (dimension) => dimension.dimensionId === selectedDimension.dimensionId
        )
      : undefined
  const selectedIndicators = activeDimension
    ? assessment.indicatorResults.filter(
        (indicator) => indicator.dimensionId === activeDimension.dimensionId
      )
    : []

  return (
    <>
      <Reveal>
        <GlassPanel
          id="kcr-v3-summary"
          className="kcr-v3-summary"
          surfaceClassName="kcr-v3-summary-glass"
          variant="floating"
          aria-labelledby="kcr-v3-title"
        >
          <div className="kcr-v3-conclusion">
            <div className="kcr-v3-title-row">
              <div>
                <span className="eyebrow">KCR V3 · 团队工作簿复算</span>
                <h2 id="kcr-v3-title">寒武纪客观风险基线</h2>
              </div>
              <div className="kcr-v3-title-actions">
                <Badge variant="outline" className="kcr-v3-candidate-badge">
                  候选方法
                </Badge>
                <Button variant="outline" onClick={onOpenMethod}>
                  <BookOpenCheckIcon data-icon="inline-start" />
                  方法与来源
                </Button>
              </div>
            </div>

            <div className="kcr-v3-score-line">
              <strong>{assessment.baselineScore ?? "—"}</strong>
              <span>/ 100</span>
              <Badge
                className="kcr-v3-level-badge"
                data-level={assessment.riskLevel ?? "unknown"}
              >
                {assessment.riskLevelLabel}风险
              </Badge>
            </div>
            <p>
              {primaryRedFlag?.summary ??
                "评分来自团队工作簿脱敏快照，并由后端 V3 引擎重新计算。"}
            </p>
            <div className="kcr-v3-meta">
              <span>方法 {assessment.methodVersion}</span>
              <span>评估日期 {formatSourceDate(assessment.assessmentAt)}</span>
              <span>数据截至 {formatSourceDate(assessment.dataCutoff)}</span>
              <span>运行标识 {assessment.runId}</span>
            </div>
          </div>

          <div className="kcr-v3-kpis">
            <article>
              <span>证据覆盖率</span>
              <strong>
                {percentFormatter.format(assessment.evidenceCoverage)}
              </strong>
              <small>完整与部分证据分开计量</small>
            </article>
            <article>
              <span>证据置信度</span>
              <strong>{percentFormatter.format(assessment.confidence)}</strong>
              <small>与风险分独立展示</small>
            </article>
            <article>
              <span>已评分维度</span>
              <strong>
                {
                  assessment.dimensions.filter((item) => item.score !== null)
                    .length
                }
                /5
              </strong>
              <small>18 项加权指标</small>
            </article>
            <article>
              <span>红旗事件</span>
              <strong>{assessment.redFlags.length}</strong>
              <small>不覆盖客观基线</small>
            </article>
          </div>

          <div className="kcr-v3-provenance">
            <ShieldCheckIcon aria-hidden="true" />
            <p>
              <strong>{provenance.methodSourceLabel}</strong>
              <span>
                当前为候选方法；{provenance.engineeringDefaults.length}{" "}
                项工程默认仍待团队确认。
              </span>
            </p>
          </div>
        </GlassPanel>
      </Reveal>

      <IndustryRiskReviewPanel companyId={companyId} />

      <Reveal>
        <KcrRiskKnowledgeGraph
          response={state.value}
          companyLabel="寒武纪"
          onOpenDimension={(dimensionId) =>
            setSelectedDimension({ companyId, dimensionId })
          }
        />
      </Reveal>

      <Reveal>
        <section className="kcr-v3-analysis-grid" aria-label="KCR V3 评估分析">
          <KcrRiskRadar
            dimensions={assessment.dimensions}
            onSelectDimension={(dimensionId) =>
              setSelectedDimension({ companyId, dimensionId })
            }
          />

          <LiquidGlassSurface
            variant="card"
            className="kcr-v3-red-flags-glass"
            padding="0"
          >
            <div className="kcr-v3-red-flags">
              <div className="kcr-v3-panel-heading">
                <div>
                  <span>独立风险提示</span>
                  <h3>红旗事件</h3>
                </div>
                <Badge variant="outline">{assessment.redFlags.length} 项</Badge>
              </div>
              <div className="kcr-v3-red-flag-list">
                {assessment.redFlags.map((redFlag) => (
                  <article key={redFlag.eventId}>
                    <div>
                      <AlertTriangleIcon aria-hidden="true" />
                      <Badge variant="outline">{redFlag.priority}</Badge>
                    </div>
                    <h4>{redFlag.title}</h4>
                    <p>{redFlag.summary}</p>
                    <small>
                      已关联 {redFlag.evidenceIds.length} 条证据 · 不改写基线分
                    </small>
                  </article>
                ))}
              </div>
              <p className="kcr-v3-next-step">
                红旗事件与传播路径已接入上方关系图谱；两者均不改写客观基线。
              </p>
            </div>
          </LiquidGlassSurface>
        </section>
      </Reveal>

      <KcrMvpReviewWorkspace
        response={state.value}
        tasks={actionTasks}
        onCreateTask={onCreateActionTask}
        onTaskStatusChange={onActionTaskStatusChange}
        onOpenDimension={(dimensionId) =>
          setSelectedDimension({ companyId, dimensionId })
        }
        onOpenReport={onOpenReport}
      />

      {activeDimension ? (
        <KcrEvidenceDrilldown
          open
          onOpenChange={(open) => {
            if (!open) setSelectedDimension(null)
          }}
          dimension={activeDimension}
          indicators={selectedIndicators}
          evidenceCatalog={state.value.evidenceCatalog}
          methodVersion={assessment.methodVersion}
          dataCutoff={assessment.dataCutoff}
        />
      ) : null}
    </>
  )
}
