import {
  ArrowRightIcon,
  BookOpenCheckIcon,
  CalendarRangeIcon,
  ClipboardCheckIcon,
  GaugeIcon,
  ScaleIcon,
} from "lucide-react"

import {
  EmptyState,
  EvidenceList,
  GlassPanel,
  ReviewStatusBadge,
  RiskBadge,
  SectionHeader,
  SeverityBadge,
  StatusBadge,
} from "@/components/dashboard/shared"
import { KcrV3AssessmentPanel } from "@/components/dashboard/kcr-v3-assessment-panel"
import { RiskRadarChart } from "@/components/dashboard/risk-radar-chart"
import { Reveal } from "@/components/motion/workflow-transition"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { formatSourceDate } from "@/lib/date-format"
import { isEffectiveEvidence } from "@/lib/source-governance"
import type { KcrAssessmentApiResponse } from "@/domain/kcr-v1/assessment-api.ts"
import type { KcrActionTask } from "@/domain/kcr-v1/model.ts"
import type { KcrRedFlagResult } from "@/domain/kcr-v1/scoring-engine.ts"
import type {
  CompanyDetail,
  RiskAssessment,
  RiskAssessmentDimension,
  RiskEvent,
  TabValue,
} from "@/types/risk"

type OverviewTabProps = {
  detail: CompanyDetail
  assessment: RiskAssessment
  events: RiskEvent[]
  timeRange: "3m" | "6m"
  riskLens: "all" | "priority" | "high"
  onNavigate: (view: TabValue) => void
  onKcrAssessmentLoad: (value: KcrAssessmentApiResponse) => void
  onRiskLensChange: (value: "all" | "priority" | "high") => void
  onTimeRangeChange: (value: "3m" | "6m") => void
  onOpenMethod: () => void
  onOpenEvent: (eventId: string) => void
  onCreateObservation: () => void
  kcrActionTasks: KcrActionTask[]
  onCreateKcrActionTask: (redFlag: KcrRedFlagResult) => void
  onKcrActionTaskStatusChange: (
    taskId: string,
    status: KcrActionTask["status"]
  ) => void
  onOpenKcrReport: () => void
}

function getDimensionScoreLabel(dimension: RiskAssessmentDimension) {
  if (!dimension.assessable || dimension.score === null) {
    return "待建立评分依据"
  }

  if (dimension.scoreBasis === "technology-auto-score") {
    return "技术自动辅助分值"
  }

  if (dimension.scoreBasis === "indicator-observation") {
    return "人工复核辅助分值"
  }

  return "辅助研判分值"
}

export function OverviewTab({
  detail,
  assessment,
  events,
  timeRange,
  riskLens,
  onNavigate,
  onKcrAssessmentLoad,
  onRiskLensChange,
  onTimeRangeChange,
  onOpenMethod,
  onOpenEvent,
  onCreateObservation,
  kcrActionTasks,
  onCreateKcrActionTask,
  onKcrActionTaskStatusChange,
  onOpenKcrReport,
}: OverviewTabProps) {
  const sortedDimensions = [...assessment.dimensions].sort((left, right) => {
    if (left.score === null) return 1
    if (right.score === null) return -1
    return right.score - left.score
  })
  const allDimensionsUnassessable = sortedDimensions.every(
    (dimension) => dimension.score === null
  )
  const effectiveRiskLens = allDimensionsUnassessable ? "all" : riskLens
  const visibleDimensions = sortedDimensions.filter((dimension) => {
    if (effectiveRiskLens === "priority") {
      return dimension.score !== null && dimension.score >= 60
    }
    if (effectiveRiskLens === "high") {
      return dimension.score !== null && dimension.score >= 75
    }
    return true
  })
  const highestDimension = sortedDimensions.find(
    (dimension) => dimension.score !== null
  )
  const recentEvents = filterRecentEvents(events, detail.snapshotAt, timeRange)
    .sort((left, right) => right.identifiedAt.localeCompare(left.identifiedAt))
    .slice(0, 4)
  const scoringEvidenceIds = [
    ...new Set(sortedDimensions.flatMap((dimension) => dimension.evidenceIds)),
  ].filter((id) => {
    const evidence = detail.evidence.find((item) => item.id === id)
    return evidence ? isEffectiveEvidence(evidence) : false
  })
  const keyEvidenceIds =
    scoringEvidenceIds.length > 0
      ? scoringEvidenceIds
      : detail.evidence
          .filter(isEffectiveEvidence)
          .map((evidence) => evidence.id)
  const latestHighEvent = [...events]
    .filter((event) => event.severity === "high")
    .sort((left, right) =>
      right.identifiedAt.localeCompare(left.identifiedAt)
    )[0]

  if (detail.id === "cambricon") {
    return (
      <div className="page-stack">
        <KcrV3AssessmentPanel
          companyId={detail.id}
          onAssessmentLoad={onKcrAssessmentLoad}
          onOpenMethod={onOpenMethod}
          actionTasks={kcrActionTasks}
          onCreateActionTask={onCreateKcrActionTask}
          onActionTaskStatusChange={onKcrActionTaskStatusChange}
          onOpenReport={onOpenKcrReport}
        />
      </div>
    )
  }

  return (
    <div className="page-stack">
      <Reveal>
        <GlassPanel
          className="assessment-summary"
          surfaceClassName="assessment-hero-glass"
          variant="floating"
          aria-labelledby="assessment-title"
        >
          <div className="assessment-conclusion">
            <div className="assessment-conclusion-top">
              <div>
                <span className="eyebrow">当前辅助结论</span>
                <h2
                  id="assessment-title"
                  className={
                    highestDimension
                      ? "assessment-title assessment-title-priority"
                      : "assessment-title assessment-title-empty"
                  }
                  aria-label={
                    highestDimension
                      ? `${highestDimension.label}是当前公开证据下的优先复核方向`
                      : undefined
                  }
                >
                  {highestDimension ? (
                    <>
                      <span
                        className="assessment-title-risk"
                        aria-hidden="true"
                      >
                        {highestDimension.label}
                      </span>
                      <span
                        className="assessment-title-context"
                        aria-hidden="true"
                      >
                        当前公开证据指向的优先复核方向
                      </span>
                    </>
                  ) : (
                    "已有研究资料，评分依据待建立"
                  )}
                </h2>
              </div>
              <div className="assessment-conclusion-actions">
                <ReviewStatusBadge
                  status={assessment.reviewStatus}
                  assessableDimensionCount={assessment.assessableDimensionCount}
                />
                <Button
                  variant="outline"
                  className="assessment-method-action"
                  onClick={onOpenMethod}
                >
                  <BookOpenCheckIcon data-icon="inline-start" />
                  方法与模型
                </Button>
              </div>
            </div>
            <p>
              {latestHighEvent?.description ??
                highestDimension?.summary ??
                "已收录公开证据与风险事件；补齐技术自动评分输入及证据，或建立人工复核观测后再进行量化。"}
            </p>
            <div className="assessment-meta">
              <span>方法版本 {assessment.methodVersion}</span>
              <span>研判数据截至 {formatSourceDate(detail.snapshotAt)}</span>
              <span>{assessment.scoreBasisLabel}</span>
            </div>
          </div>

          <div className="assessment-kpi-grid">
            <AssessmentKpi
              label={assessment.label}
              value={assessment.scoreLabel}
              note={
                assessment.score === null
                  ? assessment.assessableDimensionCount === 0
                    ? "技术自动评分或人工复核观测待建立"
                    : `仅 ${assessment.assessableDimensionCount}/6 个维度具备评分依据`
                  : `${assessment.scoreBasisLabel}下的可评估维度等权汇总`
              }
            />
            <AssessmentKpi
              label="可评估维度"
              value={`${assessment.assessableDimensionCount}/6`}
              note="自动评分或人工观测均须完成证据闭环"
            />
            <AssessmentKpi
              label="评分证据覆盖率"
              value={`${assessment.effectiveEvidenceCoverage}%`}
              note="进入评分配对的来源 URL 占比"
            />
            <AssessmentKpi
              label="指标可用度"
              value={`${assessment.indicatorAvailability}%`}
              note="当前企业已引用的口径准入指标占比"
            />
          </div>
          <p className="assessment-disclaimer">{assessment.disclaimer}</p>
        </GlassPanel>
      </Reveal>

      <Reveal>
        <section className="page-section">
          <SectionHeader
            title="六类风险"
            tone="violet"
            description="叙事、技术、合规、财务与融资、外部、人员六类口径来自新版指标表；没有充分证据的维度不展示虚假精确分数。"
            action={
              <div className="section-filters">
                <Select
                  value={effectiveRiskLens}
                  disabled={allDimensionsUnassessable}
                  onValueChange={(value) =>
                    onRiskLensChange(value as "all" | "priority" | "high")
                  }
                >
                  <SelectTrigger aria-label="风险视角">
                    <ScaleIcon aria-hidden="true" />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="all">全部维度</SelectItem>
                      <SelectItem value="priority">60 分以上</SelectItem>
                      <SelectItem value="high">75 分以上</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>
            }
          />
          {allDimensionsUnassessable ? (
            <div className="dimension-empty-summary" role="status">
              <div className="dimension-empty-copy">
                <strong>六类风险尚未建立评分依据</strong>
                <p>
                  已有公开材料和研究记录，但尚未形成技术自动评分输入与有效证据闭环，也未完成可计分的人工复核观测，不以
                  0 分代替缺失。
                </p>
              </div>
              <ul aria-label="待建立评分依据的风险维度">
                {sortedDimensions.map((dimension) => (
                  <li key={dimension.id} data-dimension={dimension.id}>
                    {dimension.label}
                  </li>
                ))}
              </ul>
              <Button
                className="dimension-empty-action"
                onClick={onCreateObservation}
              >
                <ClipboardCheckIcon data-icon="inline-start" />
                建立评分依据
              </Button>
            </div>
          ) : (
            <>
              <RiskRadarChart dimensions={assessment.dimensions} />
              {visibleDimensions.length > 0 ? (
                <div className="dimension-list">
                  {visibleDimensions.map((dimension) => (
                    <article
                      key={dimension.id}
                      className="dimension-row"
                      data-dimension={dimension.id}
                    >
                      <div className="dimension-row-copy">
                        <div className="dimension-row-title">
                          <h3>{dimension.label}</h3>
                          {dimension.level ? (
                            <RiskBadge level={dimension.level} />
                          ) : (
                            <Badge
                              variant="outline"
                              className="status-badge status-neutral"
                            >
                              待建立评分
                            </Badge>
                          )}
                        </div>
                        <p>{dimension.summary}</p>
                        <div className="dimension-row-meta">
                          <span>
                            {dimension.indicatorIds.length} 项评分指标
                          </span>
                          <span>
                            {dimension.evidenceIndicatorPairCount}{" "}
                            组评分证据关联
                          </span>
                        </div>
                      </div>
                      <div className="dimension-score">
                        <strong>{dimension.score ?? "—"}</strong>
                        <span>{getDimensionScoreLabel(dimension)}</span>
                      </div>
                      <div
                        className="dimension-meter"
                        role="progressbar"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={dimension.score ?? undefined}
                        aria-valuetext={
                          dimension.score === null
                            ? "待建立评分观测"
                            : `${dimension.score} 分`
                        }
                        aria-label={`${dimension.label}：${
                          dimension.score === null
                            ? "待建立评分观测"
                            : `${dimension.score} 分`
                        }`}
                      >
                        <span
                          data-level={dimension.level ?? "unknown"}
                          style={{ width: `${dimension.score ?? 0}%` }}
                        />
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div
                  className="empty-state-inline"
                  role="status"
                  aria-live="polite"
                >
                  当前筛选下没有满足阈值且证据充分的风险维度。
                </div>
              )}
            </>
          )}
        </section>
      </Reveal>

      <Reveal>
        <section className="page-section">
          <SectionHeader
            title="关键研究证据"
            tone="teal"
            description={
              scoringEvidenceIds.length > 0
                ? "以下有效证据已进入技术自动评分或人工复核观测的评分闭环，可计入评分证据覆盖率。"
                : "以下为可核验公开材料，但尚未进入自动评分或人工观测的证据闭环，因此不计入评分证据覆盖率。"
            }
            action={
              <Button
                variant="outline"
                onClick={() => onNavigate("intelligence")}
              >
                查看证据档案
                <ArrowRightIcon data-icon="inline-end" />
              </Button>
            }
          />
          <EvidenceList
            detail={detail}
            evidenceIds={keyEvidenceIds}
            limit={4}
          />
        </section>
      </Reveal>

      <Reveal>
        <section className="page-section">
          <SectionHeader
            title="近期事件"
            tone="amber"
            description="按事件识别日期整理近期风险信号，帮助继续追踪事实、传导与处置进展。"
            action={
              <div className="section-filters">
                <Select
                  value={timeRange}
                  onValueChange={(value) =>
                    onTimeRangeChange(value as "3m" | "6m")
                  }
                >
                  <SelectTrigger aria-label="事件时间范围">
                    <CalendarRangeIcon aria-hidden="true" />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="3m">近 3 个月</SelectItem>
                      <SelectItem value="6m">近 6 个月</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <Button variant="outline" onClick={() => onNavigate("events")}>
                  全部事件
                  <ArrowRightIcon data-icon="inline-end" />
                </Button>
              </div>
            }
          />
          {recentEvents.length > 0 ? (
            <div className="event-preview-list">
              {recentEvents.map((event) => (
                <button
                  key={event.id}
                  type="button"
                  className="event-preview-row"
                  onClick={() => onOpenEvent(event.id)}
                >
                  <time dateTime={event.identifiedAt}>
                    {event.identifiedAt}
                  </time>
                  <div>
                    <div className="event-preview-title">
                      <strong>{event.riskType}</strong>
                      <SeverityBadge severity={event.severity} />
                      <StatusBadge status={event.status} />
                    </div>
                    <p>{event.description}</p>
                  </div>
                  <ArrowRightIcon aria-hidden="true" />
                </button>
              ))}
            </div>
          ) : (
            <EmptyState
              title="当前时间范围暂无事件"
              description="可切换时间范围，或前往实时情报核验并转入新的风险事件。"
            />
          )}
        </section>
      </Reveal>

      <Reveal>
        <section className="governance-entry">
          <div>
            <div className="page-kicker">
              <ClipboardCheckIcon aria-hidden="true" />
              <span>事件处理</span>
            </div>
            <h2>把风险结论落实到事件、传导和处置动作</h2>
            <p>
              从已识别事实进入事件清单，继续查看风险传导、责任状态和投资约束。
            </p>
          </div>
          <Button
            variant="outline"
            className="governance-entry-action"
            onClick={() => onNavigate("events")}
          >
            查看事件清单
            <ArrowRightIcon data-icon="inline-end" />
          </Button>
        </section>
      </Reveal>
    </div>
  )
}

function AssessmentKpi({
  label,
  value,
  note,
}: {
  label: string
  value: string
  note: string
}) {
  return (
    <article className="assessment-kpi-item">
      <div>
        <span className="assessment-kpi-label">{label}</span>
        <strong className="assessment-kpi-value">{value}</strong>
      </div>
      <div className="assessment-kpi-note">
        <GaugeIcon aria-hidden="true" />
        <span>{note}</span>
      </div>
    </article>
  )
}

function filterRecentEvents(
  events: RiskEvent[],
  snapshotAt: string,
  timeRange: "3m" | "6m"
) {
  const snapshot = new Date(snapshotAt)
  if (Number.isNaN(snapshot.getTime())) {
    return events
  }

  const cutoff = new Date(snapshot)
  cutoff.setMonth(cutoff.getMonth() - (timeRange === "3m" ? 3 : 6))

  return events.filter((event) => new Date(event.identifiedAt) >= cutoff)
}
