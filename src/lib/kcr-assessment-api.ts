import {
  getKcrCompanyAssessmentApiPath,
  type KcrAssessmentApiResponse,
} from "../domain/kcr-v1/assessment-api.ts"

interface ApiErrorPayload {
  error?: {
    code?: unknown
    message?: unknown
  }
}

export class KcrAssessmentApiError extends Error {
  readonly status: number | null
  readonly code: string

  constructor(message: string, code: string, status: number | null) {
    super(message)
    this.name = "KcrAssessmentApiError"
    this.status = status
    this.code = code
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isRatio(value: unknown) {
  return typeof value === "number" && value >= 0 && value <= 1
}

function isScore(value: unknown) {
  return typeof value === "number" && value >= 0 && value <= 100
}

const evidenceSourceTiers = new Set([
  "regulator",
  "exchange",
  "company-filing",
  "official-company",
  "commercial-api",
  "research",
  "media",
  "manual",
])

const evidenceSupportStrengths = new Set(["direct", "inferred", "background"])

function isSafeSourceUrl(value: unknown) {
  if (value === null) return true
  if (typeof value !== "string" || !value.trim()) return false

  try {
    const url = new URL(value)
    return url.protocol === "https:" || url.protocol === "http:"
  } catch {
    return false
  }
}

function isEvidenceCatalog(
  value: unknown
): value is KcrAssessmentApiResponse["evidenceCatalog"] {
  if (!Array.isArray(value) || value.length === 0) return false
  const ids = new Set<string>()

  return value.every((item) => {
    if (!isRecord(item)) return false
    if (
      typeof item.id !== "string" ||
      !item.id.trim() ||
      ids.has(item.id) ||
      typeof item.title !== "string" ||
      !item.title.trim() ||
      typeof item.sourceName !== "string" ||
      !item.sourceName.trim() ||
      typeof item.locator !== "string" ||
      !item.locator.trim() ||
      typeof item.sourceTier !== "string" ||
      !evidenceSourceTiers.has(item.sourceTier) ||
      !isSafeSourceUrl(item.sourceUrl) ||
      (item.publishedAt !== null && typeof item.publishedAt !== "string")
    ) {
      return false
    }

    ids.add(item.id)
    return true
  })
}

function isIndicatorEvidenceReference(
  value: unknown,
  evidenceIds: ReadonlySet<string>
) {
  if (!isRecord(value)) return false
  if (
    typeof value.evidenceId !== "string" ||
    !evidenceIds.has(value.evidenceId) ||
    typeof value.locator !== "string" ||
    !value.locator.trim() ||
    typeof value.supportStrength !== "string" ||
    !evidenceSupportStrengths.has(value.supportStrength)
  ) {
    return false
  }

  if (value.supportStrength === "inferred") {
    return (
      typeof value.inferenceBasis === "string" &&
      value.inferenceBasis.trim().length > 0
    )
  }

  return value.inferenceBasis === null || typeof value.inferenceBasis === "string"
}

function isIndicatorResult(value: unknown, evidenceIds: ReadonlySet<string>) {
  if (!isRecord(value)) return false
  return (
    typeof value.id === "string" &&
    typeof value.dimensionId === "string" &&
    typeof value.label === "string" &&
    typeof value.weight === "number" &&
    (value.riskScore === null || isScore(value.riskScore)) &&
    (value.dataStatus === "complete" ||
      value.dataStatus === "partial" ||
      value.dataStatus === "missing") &&
    isRatio(value.coverageFactor) &&
    isRatio(value.evidenceConfidence) &&
    typeof value.rationale === "string" &&
    Array.isArray(value.evidence) &&
    value.evidence.every((reference) =>
      isIndicatorEvidenceReference(reference, evidenceIds)
    ) &&
    (value.weightedContribution === null ||
      typeof value.weightedContribution === "number") &&
    typeof value.formulaTrace === "string"
  )
}

function isKcrAssessmentApiResponse(
  value: unknown
): value is KcrAssessmentApiResponse {
  if (!isRecord(value) || !isRecord(value.assessment)) return false
  if (!isRecord(value.provenance)) return false
  if (!isEvidenceCatalog(value.evidenceCatalog)) return false

  const assessment = value.assessment
  const provenance = value.provenance
  const evidenceIds = new Set(value.evidenceCatalog.map((item) => item.id))
  return (
    assessment.modelVersion === "KCR-SCORE-2026.08-v3" &&
    assessment.methodVersion === "KCR-2026.08-v1" &&
    typeof assessment.companyId === "string" &&
    (assessment.baselineScore === null ||
      (typeof assessment.baselineScore === "number" &&
        assessment.baselineScore >= 0 &&
        assessment.baselineScore <= 100)) &&
    typeof assessment.riskLevelLabel === "string" &&
    isRatio(assessment.evidenceCoverage) &&
    isRatio(assessment.confidence) &&
    Array.isArray(assessment.dimensions) &&
    assessment.dimensions.length === 5 &&
    Array.isArray(assessment.indicatorResults) &&
    assessment.indicatorResults.length === 18 &&
    assessment.indicatorResults.every((indicator) =>
      isIndicatorResult(indicator, evidenceIds)
    ) &&
    Array.isArray(assessment.redFlags) &&
    Array.isArray(assessment.warnings) &&
    provenance.methodStatus === "candidate-for-team-review" &&
    provenance.methodSource === "team-workbook" &&
    typeof provenance.methodSourceLabel === "string" &&
    typeof provenance.assessmentInputSourceLabel === "string" &&
    Array.isArray(provenance.engineeringDefaults)
  )
}

async function readPayload(response: Response) {
  try {
    return (await response.json()) as unknown
  } catch {
    return null
  }
}

export async function fetchKcrCompanyAssessment(
  companyId: string,
  options: {
    fetch?: typeof globalThis.fetch
    signal?: AbortSignal
  } = {}
) {
  const fetchImpl = options.fetch ?? globalThis.fetch
  const response = await fetchImpl(getKcrCompanyAssessmentApiPath(companyId), {
    method: "GET",
    headers: { accept: "application/json" },
    signal: options.signal,
  })
  const payload = await readPayload(response)

  if (!response.ok) {
    const errorPayload = isRecord(payload) ? (payload as ApiErrorPayload) : null
    const message =
      typeof errorPayload?.error?.message === "string"
        ? errorPayload.error.message
        : "KCR V3 评估暂时无法加载。"
    const code =
      typeof errorPayload?.error?.code === "string"
        ? errorPayload.error.code
        : "KCR_ASSESSMENT_FETCH_FAILED"
    throw new KcrAssessmentApiError(message, code, response.status)
  }

  if (!isKcrAssessmentApiResponse(payload)) {
    throw new KcrAssessmentApiError(
      "KCR V3 评估响应格式不正确。",
      "KCR_ASSESSMENT_RESPONSE_INVALID",
      response.status
    )
  }

  return payload
}
