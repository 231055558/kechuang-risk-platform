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

function isKcrAssessmentApiResponse(
  value: unknown
): value is KcrAssessmentApiResponse {
  if (!isRecord(value) || !isRecord(value.assessment)) return false
  if (!isRecord(value.provenance)) return false

  const assessment = value.assessment
  const provenance = value.provenance
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
