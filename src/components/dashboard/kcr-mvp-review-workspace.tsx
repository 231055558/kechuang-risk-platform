import { useMemo, useState } from "react"
import {
  ArrowDownIcon,
  CheckCircle2Icon,
  ClipboardCheckIcon,
  DownloadIcon,
  FileCheck2Icon,
  FlaskConicalIcon,
  LockKeyholeIcon,
  ShieldAlertIcon,
} from "lucide-react"

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
import type { KcrAssessmentApiResponse } from "@/domain/kcr-v1/assessment-api.ts"
import {
  KCR_DIMENSION_WEIGHTS,
  type KcrActionTask,
  type KcrRiskDimensionId,
} from "@/domain/kcr-v1/model.ts"
import type { KcrRedFlagResult } from "@/domain/kcr-v1/scoring-engine.ts"
import {
  KCR_SCENARIO_PRESETS,
  buildKcrScenarioComparison,
  type KcrScenarioPresetId,
} from "@/lib/kcr-mvp-workflow"
import { cn } from "@/lib/utils"

type KcrMvpReviewWorkspaceProps = {
  response: KcrAssessmentApiResponse
  tasks: KcrActionTask[]
  onCreateTask: (redFlag: KcrRedFlagResult) => void
  onTaskStatusChange: (taskId: string, status: KcrActionTask["status"]) => void
  onOpenDimension: (dimensionId: KcrRiskDimensionId) => void
  onOpenReport: () => void
}

const taskStatusLabels: Record<KcrActionTask["status"], string> = {
  todo: "待处理",
  "in-progress": "处理中",
  blocked: "受阻",
  done: "已完成",
}

function jumpToSection(id: string) {
  document.getElementById(id)?.scrollIntoView({
    block: "start",
    behavior: "smooth",
  })
}

export function KcrMvpReviewWorkspace({
  response,
  tasks,
  onCreateTask,
  onTaskStatusChange,
  onOpenDimension,
  onOpenReport,
}: KcrMvpReviewWorkspaceProps) {
  const { assessment } = response
  const [scenarioPresetId, setScenarioPresetId] = useState<KcrScenarioPresetId>(
    "compliance-external"
  )
  const comparison = useMemo(
    () => buildKcrScenarioComparison(assessment, scenarioPresetId),
    [assessment, scenarioPresetId]
  )
  const companyTasks = tasks.filter(
    (task) =>
      task.companyId === assessment.companyId &&
      task.snapshotId === assessment.runId
  )
  const highestDimension = [...assessment.dimensions]
    .filter((dimension) => dimension.score !== null)
    .sort((left, right) => (right.score ?? 0) - (left.score ?? 0))[0]

  return (
    <Reveal>
      <section
        className="kcr-mvp-workspace"
        aria-labelledby="kcr-mvp-workspace-title"
      >
        <header className="kcr-mvp-workspace-header">
          <div>
            <span className="eyebrow">MVP-07～10 · 决策闭环</span>
            <h3 id="kcr-mvp-workspace-title">三分钟 Review 路径</h3>
            <p>
              按顺序核对基线、证据、关系、受限情景和处置报告；整个链路不修改客观基线。
            </p>
          </div>
          <Badge variant="outline" className="kcr-mvp-ready-badge">
            <CheckCircle2Icon aria-hidden="true" />
            黄金样例可离线复现
          </Badge>
        </header>

        <ol className="kcr-mvp-review-path" aria-label="MVP Review 步骤">
          <ReviewStep
            number="01"
            label="客观基线"
            detail="35.6 · 质量指标"
            onClick={() => jumpToSection("kcr-v3-summary")}
          />
          <ReviewStep
            number="02"
            label="指标与证据"
            detail="公式 · 来源定位"
            onClick={() => {
              if (highestDimension) {
                onOpenDimension(highestDimension.dimensionId)
              }
            }}
          />
          <ReviewStep
            number="03"
            label="风险图谱"
            detail="实体 · 关系 · 红旗"
            onClick={() => jumpToSection("kcr-risk-knowledge-graph")}
          />
          <ReviewStep
            number="04"
            label="受限情景"
            detail="预设权重 · 基线锁定"
            onClick={() => jumpToSection("kcr-scenario-review")}
          />
          <ReviewStep
            number="05"
            label="处置与报告"
            detail="责任 · 时限 · 引用"
            onClick={() => jumpToSection("kcr-action-review")}
          />
        </ol>

        <div className="kcr-mvp-workspace-grid">
          <section
            id="kcr-scenario-review"
            className="kcr-scenario-review"
            aria-labelledby="kcr-scenario-title"
          >
            <div className="kcr-mvp-section-heading">
              <div>
                <span>04 · MVP-07</span>
                <h4 id="kcr-scenario-title">受限情景对比</h4>
              </div>
              <Select
                value={scenarioPresetId}
                onValueChange={(value) =>
                  setScenarioPresetId(value as KcrScenarioPresetId)
                }
              >
                <SelectTrigger aria-label="选择受限情景">
                  <FlaskConicalIcon aria-hidden="true" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {KCR_SCENARIO_PRESETS.map((preset) => (
                      <SelectItem key={preset.id} value={preset.id}>
                        {preset.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>

            <div className="kcr-scenario-scoreboard">
              <article data-kind="baseline">
                <span>
                  <LockKeyholeIcon aria-hidden="true" /> 客观基线
                </span>
                <strong>{comparison.baselineScore ?? "—"}</strong>
                <small>团队工作簿固定权重 · 永不覆盖</small>
              </article>
              <ArrowDownIcon aria-hidden="true" />
              <article data-kind="scenario">
                <span>{comparison.preset.label}</span>
                <strong>{comparison.scenarioScore ?? "—"}</strong>
                <small>
                  相对基线
                  {comparison.delta === null
                    ? " —"
                    : ` ${comparison.delta >= 0 ? "+" : ""}${comparison.delta}`}
                </small>
              </article>
            </div>

            <p className="kcr-scenario-description">
              {comparison.preset.description}
            </p>

            <div className="kcr-scenario-dimensions">
              {assessment.dimensions.map((dimension) => (
                <div key={dimension.dimensionId}>
                  <span>{dimension.label}</span>
                  <div aria-hidden="true">
                    <i
                      style={{ width: `${dimension.score ?? 0}%` }}
                      data-level={dimension.riskLevel ?? "unknown"}
                    />
                  </div>
                  <strong>{dimension.score ?? "缺失"}</strong>
                  <small>
                    {KCR_DIMENSION_WEIGHTS[dimension.dimensionId]}%
                    <b aria-hidden="true">→</b>
                    {comparison.preset.weights[dimension.dimensionId]}%
                  </small>
                </div>
              ))}
            </div>

            <div className="kcr-scenario-boundary">
              <LockKeyholeIcon aria-hidden="true" />
              <p>
                {comparison.preset.engineeringAssumption
                  ? "当前权重是工程演示预设，不代表团队方法结论；指标分、证据和 35.6 客观基线均未改变。"
                  : "当前使用团队工作簿固定专家权重，与客观基线完全一致。"}
                <span>{comparison.formulaTrace}</span>
              </p>
            </div>
          </section>

          <section
            id="kcr-action-review"
            className="kcr-action-review"
            aria-labelledby="kcr-action-title"
          >
            <div className="kcr-mvp-section-heading">
              <div>
                <span>05 · MVP-08/09</span>
                <h4 id="kcr-action-title">处置任务与审计报告</h4>
              </div>
              <Button onClick={onOpenReport}>
                <DownloadIcon data-icon="inline-start" />
                导出 V3 报告
              </Button>
            </div>

            <div className="kcr-action-summary">
              <article>
                <ShieldAlertIcon aria-hidden="true" />
                <span>可生成任务</span>
                <strong>{assessment.redFlags.length}</strong>
                <small>仅来自当前快照红旗</small>
              </article>
              <article>
                <ClipboardCheckIcon aria-hidden="true" />
                <span>本地任务</span>
                <strong>{companyTasks.length}</strong>
                <small>
                  {companyTasks.filter((task) => task.status === "done").length}{" "}
                  已完成
                </small>
              </article>
              <article>
                <FileCheck2Icon aria-hidden="true" />
                <span>报告引用</span>
                <strong>{response.evidenceCatalog.length}</strong>
                <small>证据目录完整列示</small>
              </article>
            </div>

            <div className="kcr-action-list">
              {assessment.redFlags.map((redFlag) => {
                const task = companyTasks.find(
                  (candidate) => candidate.sourceId === redFlag.eventId
                )
                return (
                  <ActionTaskCard
                    key={redFlag.eventId}
                    redFlag={redFlag}
                    task={task}
                    onCreate={() => onCreateTask(redFlag)}
                    onStatusChange={(status) => {
                      if (task) onTaskStatusChange(task.id, status)
                    }}
                  />
                )
              })}
            </div>

            <p className="kcr-action-storage-note">
              任务保存在当前浏览器，默认责任角色与 P0/P1
              时限属于待团队确认的工程默认； 不会通知真实人员，也不会改写评分。
            </p>
          </section>
        </div>
      </section>
    </Reveal>
  )
}

function ReviewStep({
  number,
  label,
  detail,
  onClick,
}: {
  number: string
  label: string
  detail: string
  onClick: () => void
}) {
  return (
    <li>
      <button type="button" onClick={onClick}>
        <span>{number}</span>
        <strong>{label}</strong>
        <small>{detail}</small>
      </button>
    </li>
  )
}

function ActionTaskCard({
  redFlag,
  task,
  onCreate,
  onStatusChange,
}: {
  redFlag: KcrRedFlagResult
  task: KcrActionTask | undefined
  onCreate: () => void
  onStatusChange: (status: KcrActionTask["status"]) => void
}) {
  return (
    <article
      className={cn("kcr-action-card", task && "kcr-action-card-created")}
    >
      <div className="kcr-action-card-heading">
        <div>
          <Badge variant="outline">{redFlag.priority}</Badge>
          <span>来源事件 {redFlag.eventId}</span>
        </div>
        {task ? (
          <Select
            value={task.status}
            onValueChange={(value) =>
              onStatusChange(value as KcrActionTask["status"])
            }
          >
            <SelectTrigger aria-label={`更新${redFlag.title}任务状态`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {Object.entries(taskStatusLabels).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        ) : (
          <Button variant="outline" onClick={onCreate}>
            <ClipboardCheckIcon data-icon="inline-start" />
            生成处置任务
          </Button>
        )}
      </div>
      <h5>{task?.title ?? redFlag.title}</h5>
      <p>{redFlag.summary}</p>
      {task ? (
        <dl>
          <div>
            <dt>责任角色</dt>
            <dd>{task.owner ?? "待分配"}</dd>
          </div>
          <div>
            <dt>截止日期</dt>
            <dd>{task.dueDate}</dd>
          </div>
          <div>
            <dt>当前状态</dt>
            <dd>{taskStatusLabels[task.status]}</dd>
          </div>
          <div>
            <dt>快照来源</dt>
            <dd>{task.snapshotId}</dd>
          </div>
        </dl>
      ) : (
        <small>
          关联证据 {redFlag.evidenceIds.join("、")} · 生成前不创建责任承诺
        </small>
      )}
    </article>
  )
}
