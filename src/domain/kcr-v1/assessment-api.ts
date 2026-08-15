import type {
  KcrAssessmentEvidenceInput,
  KcrAssessmentResult,
} from "./scoring-engine.ts"

export const KCR_ASSESSMENT_SCORE_API_PATH =
  "api/v1/kcr/assessments/score" as const
export const KCR_COMPANY_ASSESSMENT_API_PREFIX = "api/v1/kcr/companies" as const

export type KcrAssessmentInputSource = "team-workbook" | "api-request"

export interface KcrEngineeringDefault {
  id:
    | "manual-review-coverage"
    | "red-flag-priority"
    | "evidence-admission"
    | "score-rounding"
  label: string
  value: string
  confirmationStatus: "needs-team-confirmation"
}

export interface KcrAssessmentProvenance {
  methodStatus: "candidate-for-team-review"
  methodSource: "team-workbook"
  methodSourceLabel: string
  assessmentInputSource: KcrAssessmentInputSource
  assessmentInputSourceLabel: string
  engineeringDefaults: KcrEngineeringDefault[]
}

export interface KcrAssessmentApiResponse {
  assessment: KcrAssessmentResult
  evidenceCatalog: KcrAssessmentEvidenceInput[]
  provenance: KcrAssessmentProvenance
}

export const KCR_ENGINEERING_DEFAULTS: KcrEngineeringDefault[] = [
  {
    id: "manual-review-coverage",
    label: "人工复核覆盖率阈值",
    value: "70%",
    confirmationStatus: "needs-team-confirmation",
  },
  {
    id: "red-flag-priority",
    label: "红旗事件 P0/P1 映射",
    value: "critical/high=P0，其余=P1",
    confirmationStatus: "needs-team-confirmation",
  },
  {
    id: "evidence-admission",
    label: "评分证据准入分类",
    value: "直接证据或写明依据的推断证据",
    confirmationStatus: "needs-team-confirmation",
  },
  {
    id: "score-rounding",
    label: "评分展示精度",
    value: "最多四位小数",
    confirmationStatus: "needs-team-confirmation",
  },
]

export function getKcrCompanyAssessmentApiPath(companyId: string) {
  return `${KCR_COMPANY_ASSESSMENT_API_PREFIX}/${encodeURIComponent(companyId)}/assessment`
}

export function createKcrAssessmentApiResponse(
  assessment: KcrAssessmentResult,
  assessmentInputSource: KcrAssessmentInputSource,
  evidenceCatalog: readonly KcrAssessmentEvidenceInput[]
): KcrAssessmentApiResponse {
  return {
    assessment,
    evidenceCatalog: evidenceCatalog.map((evidence) => ({ ...evidence })),
    provenance: {
      methodStatus: "candidate-for-team-review",
      methodSource: "team-workbook",
      methodSourceLabel: "团队 2026-08-13 寒武纪工作簿",
      assessmentInputSource,
      assessmentInputSourceLabel:
        assessmentInputSource === "team-workbook"
          ? "团队工作簿脱敏快照"
          : "本次 API 请求",
      engineeringDefaults: KCR_ENGINEERING_DEFAULTS.map((item) => ({
        ...item,
      })),
    },
  }
}
