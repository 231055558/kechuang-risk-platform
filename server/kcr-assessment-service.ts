import cambriconAssessmentInput from "../src/data/mvp/cambricon-scoring-input-v3.json" with { type: "json" }
import {
  createKcrAssessmentApiResponse,
  type KcrAssessmentApiResponse,
} from "../src/domain/kcr-v1/assessment-api.ts"
import { calculateKcrAssessment } from "../src/domain/kcr-v1/scoring-engine.ts"

export class KcrCompanyAssessmentNotFoundError extends Error {
  readonly statusCode = 404
  readonly code = "KCR_COMPANY_ASSESSMENT_NOT_FOUND"

  constructor(companyId: string) {
    super(`企业 ${companyId} 暂无 KCR V3 评估快照。`)
    this.name = "KcrCompanyAssessmentNotFoundError"
  }
}

export function getKcrCompanyAssessment(
  companyId: string
): KcrAssessmentApiResponse {
  if (companyId !== "cambricon") {
    throw new KcrCompanyAssessmentNotFoundError(companyId)
  }

  return createKcrAssessmentApiResponse(
    calculateKcrAssessment(cambriconAssessmentInput),
    "team-workbook"
  )
}

export function scoreKcrAssessment(request: unknown): KcrAssessmentApiResponse {
  return createKcrAssessmentApiResponse(
    calculateKcrAssessment(request),
    "api-request"
  )
}
