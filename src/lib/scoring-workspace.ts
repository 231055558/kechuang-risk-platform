import { safeGetStorageItem, safeSetStorageItem } from "./demo-state.ts"
import type {
  EvidenceScoringBinding,
  IndicatorObservation,
  ScoringWorkspaceState,
} from "@/types/risk"

export const SCORING_WORKSPACE_STORAGE_KEY =
  "kechuang-risk-scoring-workspace-v1"
export const SCORING_WORKSPACE_BACKUP_KEY =
  "kechuang-risk-scoring-workspace-v1-recovery-backup"
export const SCORING_WORKSPACE_VERSION = 1

export type ScoringWorkspaceLoadResult = {
  state: ScoringWorkspaceState
  warning: string
}

function isString(value: unknown): value is string {
  return typeof value === "string"
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isString)
}

function hasUniqueValues(values: string[]) {
  return new Set(values).size === values.length
}

function isUsableStableId(value: unknown): value is string {
  return isString(value) && Boolean(value.trim())
}

function isObservation(value: unknown): value is IndicatorObservation {
  if (!value || typeof value !== "object") return false
  const observation = value as Record<string, unknown>
  return (
    isUsableStableId(observation.id) &&
    isString(observation.companyId) &&
    isString(observation.indicatorId) &&
    ["available", "partial", "unavailable"].includes(
      String(observation.status)
    ) &&
    (observation.value === null || isString(observation.value)) &&
    isString(observation.unit) &&
    (observation.normalizedScore === undefined ||
      typeof observation.normalizedScore === "number") &&
    isString(observation.normalizationRuleVersion) &&
    (observation.reviewStatus === undefined ||
      ["reviewed", "pending"].includes(String(observation.reviewStatus))) &&
    isString(observation.reviewedBy) &&
    isString(observation.reviewedAt) &&
    isString(observation.period) &&
    isStringArray(observation.evidenceIds) &&
    hasUniqueValues(observation.evidenceIds) &&
    isString(observation.note) &&
    (observation.createdAt === undefined || isString(observation.createdAt)) &&
    (observation.updatedAt === undefined || isString(observation.updatedAt))
  )
}

function isEvidenceBinding(value: unknown): value is EvidenceScoringBinding {
  if (!value || typeof value !== "object") return false
  const binding = value as Record<string, unknown>
  return (
    isUsableStableId(binding.id) &&
    isUsableStableId(binding.observationId) &&
    isString(binding.companyId) &&
    isString(binding.indicatorId) &&
    isString(binding.evidenceId) &&
    isString(binding.period) &&
    isString(binding.unit) &&
    isString(binding.locator) &&
    (binding.inferenceBasis === undefined ||
      isString(binding.inferenceBasis)) &&
    isString(binding.createdAt) &&
    isString(binding.updatedAt)
  )
}

export function createInitialScoringWorkspace(
  observations: IndicatorObservation[] = [],
  evidenceBindings: EvidenceScoringBinding[] = [],
  now = new Date()
): ScoringWorkspaceState {
  return {
    version: SCORING_WORKSPACE_VERSION,
    observations: observations.map((observation) => ({ ...observation })),
    evidenceBindings: evidenceBindings.map((binding) => ({ ...binding })),
    defaultReviewer: "",
    updatedAt: now.toISOString(),
  }
}

export function isScoringWorkspaceState(
  value: unknown
): value is ScoringWorkspaceState {
  if (!value || typeof value !== "object") return false
  const state = value as Record<string, unknown>
  if (
    state.version !== SCORING_WORKSPACE_VERSION ||
    !Array.isArray(state.observations) ||
    !state.observations.every(isObservation) ||
    !Array.isArray(state.evidenceBindings) ||
    !state.evidenceBindings.every(isEvidenceBinding) ||
    !isString(state.defaultReviewer) ||
    !isString(state.updatedAt)
  ) {
    return false
  }

  const observations = state.observations as IndicatorObservation[]
  const evidenceBindings = state.evidenceBindings as EvidenceScoringBinding[]
  const observationById = new Map(
    observations.map((observation) => [observation.id!, observation])
  )
  if (observationById.size !== observations.length) {
    return false
  }

  const observationKeys = observations.map(
    (observation) =>
      `${observation.companyId}\u0000${observation.indicatorId}\u0000${observation.period}`
  )
  if (!hasUniqueValues(observationKeys)) {
    return false
  }

  const bindingIds = new Set(evidenceBindings.map((binding) => binding.id))
  if (bindingIds.size !== evidenceBindings.length) {
    return false
  }

  const bindingKeys = evidenceBindings.map(
    (binding) => `${binding.observationId}\u0000${binding.evidenceId}`
  )
  if (!hasUniqueValues(bindingKeys)) {
    return false
  }

  return evidenceBindings.every((binding) => {
    const observation = observationById.get(binding.observationId)
    return (
      observation !== undefined &&
      binding.companyId === observation.companyId &&
      binding.indicatorId === observation.indicatorId &&
      binding.period === observation.period &&
      binding.unit === observation.unit &&
      observation.evidenceIds.includes(binding.evidenceId)
    )
  })
}

function backUpInvalidWorkspace(raw: string) {
  return safeSetStorageItem(
    () => window.localStorage,
    SCORING_WORKSPACE_BACKUP_KEY,
    raw
  )
}

export function loadScoringWorkspace(
  fallback: ScoringWorkspaceState
): ScoringWorkspaceLoadResult {
  if (typeof window === "undefined") {
    return { state: fallback, warning: "" }
  }

  const raw = safeGetStorageItem(
    () => window.localStorage,
    SCORING_WORKSPACE_STORAGE_KEY
  )
  if (!raw) {
    return { state: fallback, warning: "" }
  }

  try {
    const parsed: unknown = JSON.parse(raw)
    if (isScoringWorkspaceState(parsed)) {
      return { state: parsed, warning: "" }
    }
  } catch {
    // The raw payload is preserved below for manual recovery.
  }

  const backedUp = backUpInvalidWorkspace(raw)
  return {
    state: fallback,
    warning: backedUp
      ? "检测到损坏或未知版本的评分数据，已备份并恢复初始工作区。"
      : "检测到损坏或未知版本的评分数据，已恢复初始工作区，但浏览器未能保存备份。",
  }
}

export function saveScoringWorkspace(state: ScoringWorkspaceState) {
  if (typeof window === "undefined" || !isScoringWorkspaceState(state)) {
    return false
  }

  try {
    return safeSetStorageItem(
      () => window.localStorage,
      SCORING_WORKSPACE_STORAGE_KEY,
      JSON.stringify(state)
    )
  } catch {
    return false
  }
}

export function upsertWorkspaceObservation(
  state: ScoringWorkspaceState,
  observation: IndicatorObservation,
  evidenceBindings: EvidenceScoringBinding[],
  now = new Date()
) {
  const nowIso = now.toISOString()
  const existingById = observation.id
    ? state.observations.find((item) => item.id === observation.id)
    : undefined
  const existingByBusinessKey = state.observations.find(
    (item) =>
      item.companyId === observation.companyId &&
      item.indicatorId === observation.indicatorId &&
      item.period === observation.period
  )
  const observationId =
    existingById?.id ||
    existingByBusinessKey?.id ||
    observation.id ||
    createStableId("observation")
  const replacedObservationIds = new Set(
    [existingById?.id, existingByBusinessKey?.id].filter(
      (id): id is string => Boolean(id)
    )
  )
  const nextObservation: IndicatorObservation = {
    ...observation,
    id: observationId,
    createdAt:
      existingById?.createdAt ||
      existingByBusinessKey?.createdAt ||
      observation.createdAt ||
      nowIso,
    updatedAt: nowIso,
  }
  const nextBindings = evidenceBindings.map((binding) => {
    const existing = state.evidenceBindings.find(
      (item) =>
        (item.observationId === observationId ||
          replacedObservationIds.has(item.observationId)) &&
        item.evidenceId === binding.evidenceId
    )
    return {
      ...binding,
      id: existing?.id || binding.id || createStableId("binding"),
      observationId,
      createdAt: existing?.createdAt || binding.createdAt || nowIso,
      updatedAt: nowIso,
    }
  })

  return {
    ...state,
    observations: [
      ...state.observations.filter(
        (item) =>
          !replacedObservationIds.has(item.id ?? "") &&
          !(
            item.companyId === observation.companyId &&
            item.indicatorId === observation.indicatorId &&
            item.period === observation.period
          )
      ),
      nextObservation,
    ],
    evidenceBindings: [
      ...state.evidenceBindings.filter(
        (binding) =>
          binding.observationId !== observationId &&
          !replacedObservationIds.has(binding.observationId)
      ),
      ...nextBindings,
    ],
    updatedAt: nowIso,
  } satisfies ScoringWorkspaceState
}

export function deleteWorkspaceObservation(
  state: ScoringWorkspaceState,
  observationId: string,
  now = new Date()
) {
  return {
    ...state,
    observations: state.observations.filter(
      (observation) => observation.id !== observationId
    ),
    evidenceBindings: state.evidenceBindings.filter(
      (binding) => binding.observationId !== observationId
    ),
    updatedAt: now.toISOString(),
  } satisfies ScoringWorkspaceState
}

export function createStableId(prefix: string) {
  if (
    typeof globalThis.crypto !== "undefined" &&
    typeof globalThis.crypto.randomUUID === "function"
  ) {
    return `${prefix}-${globalThis.crypto.randomUUID()}`
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}
