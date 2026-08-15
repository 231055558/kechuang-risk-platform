import {
  KCR_DIMENSION_WEIGHTS,
  KCR_RISK_DIMENSION_IDS,
  type KcrActionTask,
  type KcrRiskDimensionId,
} from "../domain/kcr-v1/model.ts"
import type {
  KcrAssessmentResult,
  KcrRedFlagResult,
} from "../domain/kcr-v1/scoring-engine.ts"

export const KCR_ACTION_TASK_STORAGE_KEY =
  "kechuang-risk-platform:kcr-action-tasks:v1"

export type KcrScenarioPresetId =
  "objective-baseline" | "technology-diligence" | "compliance-external"

export interface KcrScenarioPreset {
  id: KcrScenarioPresetId
  label: string
  description: string
  weights: Record<KcrRiskDimensionId, number>
  engineeringAssumption: boolean
}

export const KCR_SCENARIO_PRESETS: readonly KcrScenarioPreset[] = [
  {
    id: "objective-baseline",
    label: "客观基线",
    description: "团队工作簿固定专家权重，不作任何情景调整。",
    weights: { ...KCR_DIMENSION_WEIGHTS },
    engineeringAssumption: false,
  },
  {
    id: "technology-diligence",
    label: "技术兑现压力",
    description:
      "工程演示预设：提高技术风险权重，用于观察技术尽调偏好下的结果变化。",
    weights: {
      technology: 40,
      compliance: 15,
      finance: 15,
      external: 15,
      "personnel-governance": 15,
    },
    engineeringAssumption: true,
  },
  {
    id: "compliance-external",
    label: "合规与外部压力",
    description: "工程演示预设：提高合规与外部环境权重，不改变任何指标或事实。",
    weights: {
      technology: 15,
      compliance: 30,
      finance: 15,
      external: 30,
      "personnel-governance": 10,
    },
    engineeringAssumption: true,
  },
] as const

export interface KcrScenarioComparison {
  preset: KcrScenarioPreset
  baselineScore: number | null
  scenarioScore: number | null
  delta: number | null
  availableWeight: number
  missingDimensionIds: KcrRiskDimensionId[]
  formulaTrace: string
}

function roundScore(value: number) {
  return Number(value.toFixed(4))
}

export function getKcrScenarioPreset(id: KcrScenarioPresetId) {
  return (
    KCR_SCENARIO_PRESETS.find((preset) => preset.id === id) ??
    KCR_SCENARIO_PRESETS[0]
  )
}

export function buildKcrScenarioComparison(
  assessment: KcrAssessmentResult,
  presetId: KcrScenarioPresetId
): KcrScenarioComparison {
  const preset = getKcrScenarioPreset(presetId)
  const dimensions = new Map(
    assessment.dimensions.map((dimension) => [
      dimension.dimensionId,
      dimension.score,
    ])
  )
  const missingDimensionIds = KCR_RISK_DIMENSION_IDS.filter(
    (dimensionId) => dimensions.get(dimensionId) === null
  )
  const availableDimensions = KCR_RISK_DIMENSION_IDS.filter(
    (dimensionId) => dimensions.get(dimensionId) !== null
  )
  const availableWeight = availableDimensions.reduce(
    (sum, dimensionId) => sum + preset.weights[dimensionId],
    0
  )
  const weightedTotal = availableDimensions.reduce(
    (sum, dimensionId) =>
      sum + (dimensions.get(dimensionId) ?? 0) * preset.weights[dimensionId],
    0
  )
  const calculatedScore =
    availableWeight > 0 ? roundScore(weightedTotal / availableWeight) : null
  const scenarioScore =
    preset.id === "objective-baseline"
      ? assessment.baselineScore
      : calculatedScore
  const delta =
    scenarioScore === null || assessment.baselineScore === null
      ? null
      : roundScore(scenarioScore - assessment.baselineScore)

  return {
    preset,
    baselineScore: assessment.baselineScore,
    scenarioScore,
    delta,
    availableWeight,
    missingDimensionIds: [...missingDimensionIds],
    formulaTrace:
      availableWeight > 0
        ? `情景分=Σ(已有维度分×预设权重)/${availableWeight}=${calculatedScore ?? "—"}`
        : "情景分无法计算：没有可用维度分。",
  }
}

const ownerByIndicatorPrefix: Record<string, string> = {
  T: "技术与产品负责人",
  C: "法务合规负责人",
  F: "财务与投融资负责人",
  E: "供应链与战略负责人",
  P: "人力与董事会办公室",
}

function addUtcDays(date: string, days: number) {
  const parsed = new Date(`${date}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("评估日期无效，无法生成处置期限。")
  }
  parsed.setUTCDate(parsed.getUTCDate() + days)
  return parsed.toISOString().slice(0, 10)
}

export function createKcrActionTaskFromRedFlag({
  assessment,
  redFlag,
  now = new Date(),
}: {
  assessment: KcrAssessmentResult
  redFlag: KcrRedFlagResult
  now?: Date
}): KcrActionTask {
  const primaryIndicatorId = redFlag.sourceIndicatorIds[0]
  const owner = primaryIndicatorId
    ? (ownerByIndicatorPrefix[primaryIndicatorId[0] ?? ""] ?? "风险管理负责人")
    : "风险管理负责人"
  const timestamp = now.toISOString()

  return {
    id: `kcr-task-${assessment.companyId}-${redFlag.eventId}`,
    companyId: assessment.companyId,
    snapshotId: assessment.runId,
    sourceType: "event",
    sourceId: redFlag.eventId,
    title: `复核并处置：${redFlag.title}`,
    description: redFlag.summary,
    priority: redFlag.priority,
    owner,
    dueDate: addUtcDays(
      assessment.assessmentAt,
      redFlag.priority === "P0" ? 7 : 14
    ),
    status: "todo",
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

export function updateKcrActionTaskStatus(
  task: KcrActionTask,
  status: KcrActionTask["status"],
  now = new Date()
): KcrActionTask {
  return {
    ...task,
    status,
    updatedAt: now.toISOString(),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

const taskStatuses = new Set<KcrActionTask["status"]>([
  "todo",
  "in-progress",
  "blocked",
  "done",
])
const taskPriorities = new Set<KcrActionTask["priority"]>(["P0", "P1", "P2"])

function isIsoDate(value: unknown) {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`))
  )
}

function isIsoDateTime(value: unknown) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value))
}

function isStoredKcrActionTask(value: unknown): value is KcrActionTask {
  if (!isRecord(value)) return false
  return (
    typeof value.id === "string" &&
    value.id.length > 0 &&
    typeof value.companyId === "string" &&
    value.companyId.length > 0 &&
    typeof value.snapshotId === "string" &&
    value.snapshotId.length > 0 &&
    value.sourceType === "event" &&
    typeof value.sourceId === "string" &&
    value.sourceId.length > 0 &&
    typeof value.title === "string" &&
    value.title.length > 0 &&
    typeof value.description === "string" &&
    value.description.length > 0 &&
    typeof value.priority === "string" &&
    taskPriorities.has(value.priority as KcrActionTask["priority"]) &&
    (value.owner === null ||
      (typeof value.owner === "string" && value.owner.length > 0)) &&
    isIsoDate(value.dueDate) &&
    typeof value.status === "string" &&
    taskStatuses.has(value.status as KcrActionTask["status"]) &&
    isIsoDateTime(value.createdAt) &&
    isIsoDateTime(value.updatedAt)
  )
}

export function parseStoredKcrActionTasks(value: string | null) {
  if (!value) return []
  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed) || !parsed.every(isStoredKcrActionTask)) {
      return []
    }
    return parsed.map((task) => ({ ...task }))
  } catch {
    return []
  }
}

export function readStoredKcrActionTasks(storage?: Pick<Storage, "getItem">) {
  try {
    const resolvedStorage = storage ?? window.localStorage
    return parseStoredKcrActionTasks(
      resolvedStorage.getItem(KCR_ACTION_TASK_STORAGE_KEY)
    )
  } catch {
    return []
  }
}

export function saveStoredKcrActionTasks(
  tasks: readonly KcrActionTask[],
  storage?: Pick<Storage, "setItem">
) {
  if (!tasks.every(isStoredKcrActionTask)) return false
  try {
    const resolvedStorage = storage ?? window.localStorage
    resolvedStorage.setItem(KCR_ACTION_TASK_STORAGE_KEY, JSON.stringify(tasks))
    return true
  } catch {
    return false
  }
}

export function clearStoredKcrActionTasks(
  storage?: Pick<Storage, "removeItem">
) {
  try {
    const resolvedStorage = storage ?? window.localStorage
    resolvedStorage.removeItem(KCR_ACTION_TASK_STORAGE_KEY)
    return true
  } catch {
    return false
  }
}
