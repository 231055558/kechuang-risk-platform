import { safeGetStorageItem, safeSetStorageItem } from "./demo-state.ts"
import { isTechnologyBaselineQuantificationResult } from "./technology-baseline-validation.ts"
import { isTechnologyRiskScoreResult } from "./technology-scoring-validation.ts"
import type {
  TechnologyBaselineQuantificationRequest,
  TechnologyBaselineQuantificationResult,
  TechnologyRiskOverride,
  TechnologyRiskScoreRequest,
  TechnologyRiskScoreResult,
  TechnologyScoringWorkspaceState,
} from "@/types/risk"

export const TECHNOLOGY_SCORING_WORKSPACE_STORAGE_KEY =
  "kechuang-technology-scoring-workspace-v1"
export const TECHNOLOGY_SCORING_WORKSPACE_BACKUP_KEY =
  "kechuang-technology-scoring-workspace-v1-recovery-backup"
export const TECHNOLOGY_SCORING_WORKSPACE_VERSION = 1

type TechnologyScoringCompanyState = {
  draftRequest: TechnologyRiskScoreRequest | null
  latestResult: TechnologyRiskScoreResult | null
  override: TechnologyRiskOverride | null
  baselineDraftRequest?: TechnologyBaselineQuantificationRequest | null
  latestBaselineResult?: TechnologyBaselineQuantificationResult | null
  updatedAt: string
}

type TechnologyScoringWorkspaceShape = {
  version: 1
  companies: Record<string, TechnologyScoringCompanyState>
  updatedAt: string
}

export type TechnologyScoringCompanyPatch = Partial<
  Pick<
    TechnologyScoringCompanyState,
    | "draftRequest"
    | "latestResult"
    | "override"
    | "baselineDraftRequest"
    | "latestBaselineResult"
  >
>

export type TechnologyScoringWorkspaceLoadResult = {
  state: TechnologyScoringWorkspaceState
  warning: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isNullableRecord(value: unknown) {
  return value === null || isRecord(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function isValidDateString(value: unknown): value is string {
  return isNonEmptyString(value) && !Number.isNaN(Date.parse(value))
}

function isLegacyBaselineDraft(value: unknown) {
  if (!isRecord(value)) {
    return false
  }
  const { values } = value
  if (!isRecord(values)) {
    return false
  }

  // v5 adds patent applications, intangible assets, TRL and product revenue.
  // Only the removed total-assets input identifies the earlier draft shape.
  return Object.hasOwn(values, "totalAssets")
}

function isLegacyBaselineResult(value: unknown) {
  return (
    isRecord(value) &&
    (value.modelVersion === "TQB-2026.07-v3" ||
      value.modelVersion === "TQB-2026.07-v4")
  )
}

function isCompanyCoreState(value: unknown): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    isNullableRecord(value.draftRequest) &&
    (value.latestResult === null ||
      isTechnologyRiskScoreResult(value.latestResult)) &&
    isNullableRecord(value.override) &&
    isValidDateString(value.updatedAt)
  )
}

function createWorkspaceState(
  companies: Record<string, TechnologyScoringCompanyState>,
  updatedAt: string
) {
  return {
    version: TECHNOLOGY_SCORING_WORKSPACE_VERSION,
    companies,
    updatedAt,
  } as TechnologyScoringWorkspaceState
}

function toWorkspaceShape(
  state: TechnologyScoringWorkspaceState
): TechnologyScoringWorkspaceShape {
  return state as unknown as TechnologyScoringWorkspaceShape
}

export function createInitialTechnologyScoringWorkspace(
  now = new Date()
): TechnologyScoringWorkspaceState {
  return {
    version: TECHNOLOGY_SCORING_WORKSPACE_VERSION,
    companies: {},
    updatedAt: now.toISOString(),
  } as unknown as TechnologyScoringWorkspaceState
}

export function resetTechnologyScoringWorkspace(
  now = new Date()
): TechnologyScoringWorkspaceState {
  return createInitialTechnologyScoringWorkspace(now)
}

export function isTechnologyScoringWorkspaceState(
  value: unknown
): value is TechnologyScoringWorkspaceState {
  if (!isRecord(value)) {
    return false
  }

  if (
    value.version !== TECHNOLOGY_SCORING_WORKSPACE_VERSION ||
    !isRecord(value.companies) ||
    !isValidDateString(value.updatedAt)
  ) {
    return false
  }

  return Object.entries(value.companies).every(([companyId, company]) => {
    if (!isNonEmptyString(companyId) || !isCompanyCoreState(company)) {
      return false
    }

    return (
      (company.baselineDraftRequest === undefined ||
        (isRecord(company.baselineDraftRequest) &&
          !isLegacyBaselineDraft(company.baselineDraftRequest)) ||
        company.baselineDraftRequest === null) &&
      (company.latestBaselineResult === undefined ||
        company.latestBaselineResult === null ||
        isTechnologyBaselineQuantificationResult(company.latestBaselineResult))
    )
  })
}

function migrateLegacyBaselineWorkspace(
  value: unknown
): TechnologyScoringWorkspaceState | null {
  if (
    !isRecord(value) ||
    value.version !== TECHNOLOGY_SCORING_WORKSPACE_VERSION ||
    !isRecord(value.companies) ||
    !isValidDateString(value.updatedAt)
  ) {
    return null
  }

  let migrated = false
  const companies: Record<string, TechnologyScoringCompanyState> = {}

  for (const [companyId, company] of Object.entries(value.companies)) {
    if (!isNonEmptyString(companyId) || !isCompanyCoreState(company)) {
      return null
    }

    const legacyDraft = isLegacyBaselineDraft(company.baselineDraftRequest)
    const legacyResult = isLegacyBaselineResult(company.latestBaselineResult)
    const hasValidDraft =
      company.baselineDraftRequest === undefined ||
      company.baselineDraftRequest === null ||
      isRecord(company.baselineDraftRequest)
    const hasValidResult =
      company.latestBaselineResult === undefined ||
      company.latestBaselineResult === null ||
      isTechnologyBaselineQuantificationResult(company.latestBaselineResult)

    if ((!hasValidDraft || !hasValidResult) && !legacyDraft && !legacyResult) {
      return null
    }

    if (legacyDraft || legacyResult) {
      migrated = true
      companies[companyId] = {
        draftRequest: company.draftRequest as TechnologyScoringCompanyState["draftRequest"],
        latestResult: company.latestResult as TechnologyScoringCompanyState["latestResult"],
        override: company.override as TechnologyScoringCompanyState["override"],
        baselineDraftRequest: legacyDraft
          ? null
          : ((company.baselineDraftRequest as TechnologyBaselineQuantificationRequest | null | undefined) ??
            null),
        latestBaselineResult: legacyResult
          ? null
          : ((company.latestBaselineResult as TechnologyBaselineQuantificationResult | null | undefined) ??
            null),
        updatedAt: company.updatedAt as string,
      }
      continue
    }

    companies[companyId] = {
      draftRequest: company.draftRequest as TechnologyScoringCompanyState["draftRequest"],
      latestResult: company.latestResult as TechnologyScoringCompanyState["latestResult"],
      override: company.override as TechnologyScoringCompanyState["override"],
      baselineDraftRequest:
        (company.baselineDraftRequest as TechnologyBaselineQuantificationRequest | null | undefined) ??
        null,
      latestBaselineResult:
        (company.latestBaselineResult as TechnologyBaselineQuantificationResult | null | undefined) ??
        null,
      updatedAt: company.updatedAt as string,
    }
  }

  return migrated ? createWorkspaceState(companies, new Date().toISOString()) : null
}

function backUpInvalidWorkspace(raw: string) {
  return safeSetStorageItem(
    () => window.localStorage,
    TECHNOLOGY_SCORING_WORKSPACE_BACKUP_KEY,
    raw
  )
}

export function loadTechnologyScoringWorkspace(
  fallback: TechnologyScoringWorkspaceState
): TechnologyScoringWorkspaceLoadResult {
  if (typeof window === "undefined") {
    return { state: fallback, warning: "" }
  }

  const raw = safeGetStorageItem(
    () => window.localStorage,
    TECHNOLOGY_SCORING_WORKSPACE_STORAGE_KEY
  )
  if (!raw) {
    return { state: fallback, warning: "" }
  }

  try {
    const parsed: unknown = JSON.parse(raw)
    if (isTechnologyScoringWorkspaceState(parsed)) {
      return { state: parsed, warning: "" }
    }
    const migrated = migrateLegacyBaselineWorkspace(parsed)
    if (migrated) {
      saveTechnologyScoringWorkspace(migrated)
      return {
        state: migrated,
        warning:
          "旧版技术量化结果已清除；已保留兼容草稿，请按 TQB-2026.07-v5 口径重新运行。",
      }
    }
  } catch {
    // Preserve the original payload below so it can be inspected or recovered.
  }

  const backedUp = backUpInvalidWorkspace(raw)
  return {
    state: fallback,
    warning: backedUp
      ? "检测到损坏或未知版本的技术风险评分数据，已备份并恢复初始工作区。"
      : "检测到损坏或未知版本的技术风险评分数据，已恢复初始工作区，但浏览器未能保存备份。",
  }
}

export function saveTechnologyScoringWorkspace(
  state: TechnologyScoringWorkspaceState
) {
  if (
    typeof window === "undefined" ||
    !isTechnologyScoringWorkspaceState(state)
  ) {
    return false
  }

  try {
    return safeSetStorageItem(
      () => window.localStorage,
      TECHNOLOGY_SCORING_WORKSPACE_STORAGE_KEY,
      JSON.stringify(state)
    )
  } catch {
    return false
  }
}

export function upsertTechnologyScoringCompany(
  state: TechnologyScoringWorkspaceState,
  companyId: string,
  patch: TechnologyScoringCompanyPatch,
  now = new Date()
): TechnologyScoringWorkspaceState {
  if (!isNonEmptyString(companyId)) {
    throw new TypeError("companyId must be a non-empty string")
  }

  const current = toWorkspaceShape(state)
  const existing = current.companies[companyId]
  const updatedAt = now.toISOString()
  const nextCompany: TechnologyScoringCompanyState = {
    draftRequest: existing?.draftRequest ?? null,
    latestResult: existing?.latestResult ?? null,
    override: existing?.override ?? null,
    baselineDraftRequest: existing?.baselineDraftRequest ?? null,
    latestBaselineResult: existing?.latestBaselineResult ?? null,
    updatedAt,
  }

  if (Object.hasOwn(patch, "draftRequest")) {
    nextCompany.draftRequest = patch.draftRequest ?? null
  }
  if (Object.hasOwn(patch, "latestResult")) {
    nextCompany.latestResult = patch.latestResult ?? null
  }
  if (Object.hasOwn(patch, "override")) {
    nextCompany.override = patch.override ?? null
  }
  if (Object.hasOwn(patch, "baselineDraftRequest")) {
    nextCompany.baselineDraftRequest = patch.baselineDraftRequest ?? null
  }
  if (Object.hasOwn(patch, "latestBaselineResult")) {
    nextCompany.latestBaselineResult = patch.latestBaselineResult ?? null
  }

  return {
    ...current,
    companies: {
      ...current.companies,
      [companyId]: nextCompany,
    },
    updatedAt,
  } as unknown as TechnologyScoringWorkspaceState
}

export function clearTechnologyScoringCompany(
  state: TechnologyScoringWorkspaceState,
  companyId: string,
  now = new Date()
): TechnologyScoringWorkspaceState {
  const current = toWorkspaceShape(state)
  const companies = { ...current.companies }
  delete companies[companyId]

  return {
    ...current,
    companies,
    updatedAt: now.toISOString(),
  } as unknown as TechnologyScoringWorkspaceState
}
