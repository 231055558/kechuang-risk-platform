import type {
  TechnologyIncidentOverlay,
  TechnologyRiskIndicatorId,
  TechnologyRiskIndicatorResult,
  TechnologyRiskScoreResult,
} from "../types/risk.ts"

const MODEL_VERSION = "KTR-2026.07-v1"

const indicatorIds = new Set<TechnologyRiskIndicatorId>([
  "kci-006",
  "kci-007",
  "kci-008",
  "kci-009",
  "kci-010",
  "kci-011",
  "kci-012",
  "kci-013",
])

const indicatorStatuses = new Set<TechnologyRiskIndicatorResult["status"]>([
  "scored",
  "missing",
  "ineligible-evidence",
  "invalid-input",
])

const incidentLevels = new Set<TechnologyIncidentOverlay["level"]>([
  "low",
  "medium-low",
  "medium-high",
  "high",
])

const incidentRiskFloors = new Set<TechnologyIncidentOverlay["riskFloor"]>([
  0, 40, 60, 85,
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function isValidDate(value: unknown): value is string {
  return isNonEmptyString(value) && !Number.isNaN(Date.parse(value))
}

function isScore(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 100
  )
}

function isNullableScore(value: unknown): value is number | null {
  return value === null || isScore(value)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
}

function isIndicatorResult(
  value: unknown
): value is TechnologyRiskIndicatorResult {
  if (!isRecord(value)) {
    return false
  }

  if (
    !indicatorIds.has(value.indicatorId as TechnologyRiskIndicatorId) ||
    !isNonEmptyString(value.label) ||
    !isScore(value.weight) ||
    !indicatorStatuses.has(
      value.status as TechnologyRiskIndicatorResult["status"]
    ) ||
    !isNullableScore(value.capabilityScore) ||
    !isNullableScore(value.riskScore) ||
    !isNonEmptyString(value.formulaTrace) ||
    !isStringArray(value.validationErrors) ||
    !isStringArray(value.evidenceIds)
  ) {
    return false
  }

  if (value.status === "scored") {
    return value.capabilityScore !== null && value.riskScore !== null
  }

  return value.capabilityScore === null && value.riskScore === null
}

function isIncidentOverlay(
  value: unknown
): value is TechnologyIncidentOverlay {
  return (
    isRecord(value) &&
    typeof value.index === "number" &&
    Number.isFinite(value.index) &&
    value.index >= 0 &&
    value.index <= 10 &&
    incidentLevels.has(value.level as TechnologyIncidentOverlay["level"]) &&
    incidentRiskFloors.has(
      value.riskFloor as TechnologyIncidentOverlay["riskFloor"]
    ) &&
    (value.incidentId === null || isNonEmptyString(value.incidentId)) &&
    isNonEmptyString(value.formulaTrace)
  )
}

export function isTechnologyRiskScoreResult(
  value: unknown
): value is TechnologyRiskScoreResult {
  if (!isRecord(value)) {
    return false
  }

  if (
    !isNonEmptyString(value.companyId) ||
    !isNonEmptyString(value.period) ||
    !isValidDate(value.asOfDate) ||
    value.modelVersion !== MODEL_VERSION ||
    !isNonEmptyString(value.runId) ||
    !isValidDate(value.generatedAt) ||
    (value.status !== "scored" &&
      value.status !== "insufficient-coverage") ||
    !isScore(value.coveredWeight) ||
    !isScore(value.weightedCoverage) ||
    !isNullableScore(value.baseScore) ||
    !isNullableScore(value.score) ||
    !Array.isArray(value.indicatorResults) ||
    value.indicatorResults.length !== indicatorIds.size ||
    !value.indicatorResults.every(isIndicatorResult) ||
    !isIncidentOverlay(value.incidentOverlay) ||
    !isStringArray(value.forcedHighReasons)
  ) {
    return false
  }

  const resultIndicatorIds = new Set(
    value.indicatorResults.map((result) => result.indicatorId)
  )
  if (
    resultIndicatorIds.size !== indicatorIds.size ||
    [...indicatorIds].some((indicatorId) => !resultIndicatorIds.has(indicatorId))
  ) {
    return false
  }

  return value.status === "scored"
    ? value.score !== null && value.baseScore !== null
    : value.score === null && value.baseScore === null
}
