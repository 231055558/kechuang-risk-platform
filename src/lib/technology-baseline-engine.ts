import cambriconData from "../data/company/cambricon.json" with { type: "json" }
import deepseekData from "../data/company/deepseek.json" with { type: "json" }
import fourthParadigmData from "../data/company/fourth-paradigm.json" with {
  type: "json",
}
import horizonData from "../data/company/horizon.json" with {
  type: "json",
}
import robosenseData from "../data/company/robosense.json" with {
  type: "json",
}
import unitreeData from "../data/company/unitree.json" with { type: "json" }
import evidenceGovernanceData from "../data/evidence-governance.json" with {
  type: "json",
}
import type {
  EvidenceSupportStrength,
  TechnologyBaselineCalibrationIndicatorId,
  TechnologyBaselineCalibrationIndicatorResult,
  TechnologyBaselineEvidenceReference,
  TechnologyBaselineIndicatorId,
  TechnologyBaselineIndicatorResult,
  TechnologyBaselineLifecycleStage,
  TechnologyBaselineMetricId,
  TechnologyBaselineQuantificationRequest,
  TechnologyBaselineQuantificationResult,
  TechnologyBaselineRiskBand,
  TechnologyBaselineValues,
} from "../types/risk.ts"

export const TECHNOLOGY_BASELINE_MODEL_VERSION = "TQB-2026.07-v5"

const baselineIndicatorIds = [
  "tqi-001",
  "tqi-002",
  "tqi-003",
  "tqi-004",
  "tqi-005",
  "tqi-006",
] as const satisfies readonly TechnologyBaselineIndicatorId[]

const calibrationIndicatorIds = [
  "tqc-001",
  "tqc-002",
  "tqc-003",
  "tqc-004",
  "tqc-005",
  "tqc-006",
  "tqc-007",
  "tqc-008",
] as const satisfies readonly TechnologyBaselineCalibrationIndicatorId[]

const lifecycleConfiguration = {
  startup: {
    label: "初创期",
    technologyDimensionWeight: 30,
    weights: {
      "tqi-001": 4,
      "tqi-002": 6,
      "tqi-003": 7,
      "tqi-004": 6,
      "tqi-005": 5,
      "tqi-006": 2,
    },
  },
  growth: {
    label: "成长期",
    technologyDimensionWeight: 25,
    weights: {
      "tqi-001": 3,
      "tqi-002": 6,
      "tqi-003": 6,
      "tqi-004": 5,
      "tqi-005": 3,
      "tqi-006": 2,
    },
  },
  stable: {
    label: "稳定期",
    technologyDimensionWeight: 20,
    weights: {
      "tqi-001": 2,
      "tqi-002": 5,
      "tqi-003": 5,
      "tqi-004": 4,
      "tqi-005": 3,
      "tqi-006": 1,
    },
  },
} as const satisfies Record<
  TechnologyBaselineLifecycleStage,
  {
    label: string
    technologyDimensionWeight: number
    weights: Record<TechnologyBaselineIndicatorId, number>
  }
>

type IndicatorMetadata = Pick<
  TechnologyBaselineIndicatorResult,
  "label" | "sourceCategory" | "unit"
>

type CalibrationIndicatorMetadata = Pick<
  TechnologyBaselineCalibrationIndicatorResult,
  "label" | "sourceCategory" | "unit"
> & {
  thresholdTrace: string | null
}

const indicatorMetadata = {
  "tqi-001": {
    label: "论文发表数量",
    sourceCategory: "论文与研究",
    unit: "篇",
  },
  "tqi-002": {
    label: "专利产出效率",
    sourceCategory: "专利与知识产权",
    unit: "件",
  },
  "tqi-003": {
    label: "研发投入强度",
    sourceCategory: "研发投入",
    unit: "%",
  },
  "tqi-004": {
    label: "人均知识产权效率",
    sourceCategory: "专利与知识产权",
    unit: "件/百名研发人员",
  },
  "tqi-005": {
    label: "技术合同成交额",
    sourceCategory: "商业转化",
    unit: "万元",
  },
  "tqi-006": {
    label: "年报技术风险关键词密度",
    sourceCategory: "年报文本",
    unit: "负面情感概率",
  },
} as const satisfies Record<TechnologyBaselineIndicatorId, IndicatorMetadata>

const calibrationIndicatorMetadata = {
  "tqc-001": {
    label: "论文发表数量专项校准",
    sourceCategory: "论文与研究",
    unit: "篇",
    thresholdTrace: "低风险：>20 篇；中风险：5–20 篇；高风险：<5 篇。",
  },
  "tqc-002": {
    label: "专利申请数量专项校准",
    sourceCategory: "专利与知识产权",
    unit: "件",
    thresholdTrace: "低风险：>50 件；中风险：10–50 件；高风险：<10 件。",
  },
  "tqc-003": {
    label: "专利授权率专项校准",
    sourceCategory: "专利与知识产权",
    unit: "%",
    thresholdTrace: "低风险：>60%；中风险：30–60%；高风险：<30%。",
  },
  "tqc-004": {
    label: "研发投入强度专项校准",
    sourceCategory: "研发投入",
    unit: "%",
    thresholdTrace: "低风险：>15%；中风险：5–15%；高风险：<5%。",
  },
  "tqc-005": {
    label: "无形资产占净资产比专项观测",
    sourceCategory: "财务结构",
    unit: "%",
    thresholdTrace: null,
  },
  "tqc-006": {
    label: "技术成熟度（TRL）专项校准",
    sourceCategory: "技术成熟度",
    unit: "TRL级",
    thresholdTrace: "低风险：≥7 级；中风险：4–6 级；高风险：≤3 级。",
  },
  "tqc-007": {
    label: "核心技术产品收入占比专项校准",
    sourceCategory: "商业转化",
    unit: "%",
    thresholdTrace: "低风险：>70%；中风险：30–70%；高风险：<30%。",
  },
  "tqc-008": {
    label: "技术风险负面情感概率专项校准",
    sourceCategory: "年报文本",
    unit: "负面情感概率",
    thresholdTrace: "低风险：<0.2；中风险：0.2–0.5；高风险：>0.5。",
  },
} as const satisfies Record<
  TechnologyBaselineCalibrationIndicatorId,
  CalibrationIndicatorMetadata
>

const evidenceSupportStrengths = new Set<EvidenceSupportStrength>([
  "direct",
  "inferred",
  "background",
  "pending",
])

type GovernedEvidence = {
  companyId: string
  supportStrength: EvidenceSupportStrength
  inferenceBasis?: string
}

type BaselineInput = {
  value: number
  formulaTrace: string
  displayValue?: string
}

const evidenceGovernanceRegistry = new Map(
  evidenceGovernanceData.flatMap((record) =>
    typeof record.id === "string" &&
    evidenceSupportStrengths.has(
      record.supportStrength as EvidenceSupportStrength
    )
      ? [
          [
            record.id,
            {
              supportStrength:
                record.supportStrength as EvidenceSupportStrength,
              inferenceBasis:
                typeof record.inferenceBasis === "string"
                  ? record.inferenceBasis
                  : undefined,
            },
          ] as const,
        ]
      : []
  )
)

const companyEvidenceCatalogs = [
  cambriconData,
  deepseekData,
  fourthParadigmData,
  horizonData,
  robosenseData,
  unitreeData,
]

const governedEvidenceRegistry = new Map<string, GovernedEvidence>()

companyEvidenceCatalogs.forEach((company) => {
  if (typeof company.id !== "string" || !Array.isArray(company.evidence)) {
    return
  }

  company.evidence.forEach((evidence) => {
    if (typeof evidence.id !== "string") {
      return
    }

    const governance = evidenceGovernanceRegistry.get(evidence.id)
    if (!governance) {
      return
    }

    governedEvidenceRegistry.set(evidence.id, {
      companyId: company.id,
      ...governance,
    })
  })
})

export class TechnologyBaselineRequestError extends Error {
  readonly statusCode = 422
  readonly code = "TECHNOLOGY_BASELINE_REQUEST_INVALID"

  constructor(message: string) {
    super(message)
    this.name = "TechnologyBaselineRequestError"
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function isLifecycleStage(
  value: unknown
): value is TechnologyBaselineLifecycleStage {
  return value === "startup" || value === "growth" || value === "stable"
}

function round(value: number, digits = 2) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function formatNumber(value: number, digits = 2) {
  return new Intl.NumberFormat("zh-CN", {
    maximumFractionDigits: digits,
  }).format(value)
}

function validateRequest(
  request: unknown
): TechnologyBaselineQuantificationRequest {
  if (!isRecord(request)) {
    throw new TechnologyBaselineRequestError("请求体必须是对象。")
  }
  if (!isNonEmptyString(request.companyId)) {
    throw new TechnologyBaselineRequestError("请提供企业标识。")
  }
  if (!isNonEmptyString(request.period)) {
    throw new TechnologyBaselineRequestError("请填写量化期间。")
  }
  if (
    !isNonEmptyString(request.asOfDate) ||
    Number.isNaN(Date.parse(request.asOfDate))
  ) {
    throw new TechnologyBaselineRequestError("请填写有效的数据截止日期。")
  }
  if (!isLifecycleStage(request.lifecycleStage)) {
    throw new TechnologyBaselineRequestError("生命周期必须为初创期、成长期或稳定期。")
  }
  if (!isRecord(request.values)) {
    throw new TechnologyBaselineRequestError("原始量化字段必须是对象。")
  }
  if (request.evidence !== undefined && !Array.isArray(request.evidence)) {
    throw new TechnologyBaselineRequestError("证据绑定必须是数组。")
  }

  return {
    companyId: request.companyId.trim(),
    period: request.period.trim(),
    asOfDate: request.asOfDate,
    lifecycleStage: request.lifecycleStage,
    values: request.values as TechnologyBaselineValues,
    evidence: (request.evidence ?? []) as TechnologyBaselineEvidenceReference[],
  }
}

function optionalFiniteNumber(
  values: TechnologyBaselineValues,
  key: keyof TechnologyBaselineValues,
  label: string,
  errors: string[],
  options: {
    integer?: boolean
    min?: number
    max?: number
  } = {}
) {
  const value = values[key]
  if (value === undefined) {
    return null
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    errors.push(`${label}必须是有限数值。`)
    return null
  }
  if (options.integer && !Number.isInteger(value)) {
    errors.push(`${label}必须是整数。`)
  }
  if (options.min !== undefined && value < options.min) {
    errors.push(`${label}不能小于 ${options.min}。`)
  }
  if (options.max !== undefined && value > options.max) {
    errors.push(`${label}不能大于 ${options.max}。`)
  }
  return value
}

function getEligibleEvidence(
  references: TechnologyBaselineEvidenceReference[],
  companyId: string,
  indicatorId: TechnologyBaselineMetricId
) {
  return references.filter((reference) => {
    if (
      !isRecord(reference) ||
      reference.indicatorId !== indicatorId ||
      !isNonEmptyString(reference.evidenceId) ||
      !isNonEmptyString(reference.locator)
    ) {
      return false
    }

    const governedEvidence = governedEvidenceRegistry.get(reference.evidenceId)
    if (
      !governedEvidence ||
      governedEvidence.companyId !== companyId ||
      governedEvidence.supportStrength !== reference.supportStrength
    ) {
      return false
    }

    if (governedEvidence.supportStrength === "direct") {
      return true
    }

    return (
      governedEvidence.supportStrength === "inferred" &&
      isNonEmptyString(governedEvidence.inferenceBasis) &&
      isNonEmptyString(reference.inferenceBasis)
    )
  })
}

function getLifecycleWeight(
  lifecycleStage: TechnologyBaselineLifecycleStage,
  indicatorId: TechnologyBaselineIndicatorId
) {
  return lifecycleConfiguration[lifecycleStage].weights[indicatorId]
}

function baseResult(
  lifecycleStage: TechnologyBaselineLifecycleStage,
  indicatorId: TechnologyBaselineIndicatorId,
  status: TechnologyBaselineIndicatorResult["status"],
  formulaTrace: string,
  validationErrors: string[] = []
): TechnologyBaselineIndicatorResult {
  const metadata = indicatorMetadata[indicatorId]
  return {
    indicatorId,
    label: metadata.label,
    sourceCategory: metadata.sourceCategory,
    lifecycleWeight: getLifecycleWeight(lifecycleStage, indicatorId),
    status,
    value: null,
    displayValue: "待补充",
    unit: metadata.unit,
    formulaTrace,
    validationErrors,
    evidenceIds: [],
    classification: "official",
    scoringEligible: false,
    contributesToAggregate: false,
    riskBand: null,
    standardizedRiskScore: null,
    thresholdTrace: null,
  }
}

function makeResult(
  request: TechnologyBaselineQuantificationRequest,
  indicatorId: TechnologyBaselineIndicatorId,
  input: BaselineInput | null,
  errors: string[]
): TechnologyBaselineIndicatorResult {
  if (errors.length > 0) {
    return baseResult(
      request.lifecycleStage,
      indicatorId,
      "invalid-input",
      errors.join("；"),
      errors
    )
  }
  if (!input) {
    return baseResult(
      request.lifecycleStage,
      indicatorId,
      "missing",
      "未提交该指标所需的原始量化字段。"
    )
  }

  const evidence = getEligibleEvidence(
    request.evidence,
    request.companyId,
    indicatorId
  )
  if (evidence.length === 0) {
    return baseResult(
      request.lifecycleStage,
      indicatorId,
      "ineligible-evidence",
      "已录入原始值，但未绑定具备精确定位的直接证据，或具备完整推导依据的推导证据。"
    )
  }

  const metadata = indicatorMetadata[indicatorId]
  return {
    indicatorId,
    label: metadata.label,
    sourceCategory: metadata.sourceCategory,
    lifecycleWeight: getLifecycleWeight(request.lifecycleStage, indicatorId),
    status: "calculated",
    value: round(input.value),
    displayValue:
      input.displayValue ??
      `${formatNumber(round(input.value))}${metadata.unit}`,
    unit: metadata.unit,
    formulaTrace: input.formulaTrace,
    validationErrors: [],
    evidenceIds: evidence.map((reference) => reference.evidenceId),
    classification: "official",
    scoringEligible: false,
    contributesToAggregate: false,
    riskBand: null,
    standardizedRiskScore: null,
    thresholdTrace: null,
  }
}

function calibrationBaseResult(
  indicatorId: TechnologyBaselineCalibrationIndicatorId,
  status: TechnologyBaselineCalibrationIndicatorResult["status"],
  formulaTrace: string,
  validationErrors: string[] = []
): TechnologyBaselineCalibrationIndicatorResult {
  const metadata = calibrationIndicatorMetadata[indicatorId]
  return {
    indicatorId,
    label: metadata.label,
    sourceCategory: metadata.sourceCategory,
    status,
    value: null,
    displayValue: "待补充",
    unit: metadata.unit,
    formulaTrace,
    validationErrors,
    evidenceIds: [],
    scoringEligible: false,
    contributesToAggregate: false,
    riskBand: null,
    standardizedRiskScore: null,
    thresholdTrace: null,
  }
}

function calibrationBand(
  indicatorId: Exclude<TechnologyBaselineCalibrationIndicatorId, "tqc-005">,
  value: number
): Exclude<TechnologyBaselineRiskBand, null> {
  switch (indicatorId) {
    case "tqc-001":
      return value > 20 ? "low" : value >= 5 ? "medium" : "high"
    case "tqc-002":
      return value > 50 ? "low" : value >= 10 ? "medium" : "high"
    case "tqc-003":
      return value > 60 ? "low" : value >= 30 ? "medium" : "high"
    case "tqc-004":
      return value > 15 ? "low" : value >= 5 ? "medium" : "high"
    case "tqc-006":
      return value >= 7 ? "low" : value >= 4 ? "medium" : "high"
    case "tqc-007":
      return value > 70 ? "low" : value >= 30 ? "medium" : "high"
    case "tqc-008":
      return value < 0.2 ? "low" : value <= 0.5 ? "medium" : "high"
  }
}

function standardizedScoreForBand(
  riskBand: Exclude<TechnologyBaselineRiskBand, null>
): 25 | 60 | 85 {
  if (riskBand === "low") {
    return 25
  }
  if (riskBand === "medium") {
    return 60
  }
  return 85
}

function makeCalibrationResult(
  request: TechnologyBaselineQuantificationRequest,
  indicatorId: TechnologyBaselineCalibrationIndicatorId,
  input: BaselineInput | null,
  errors: string[]
): TechnologyBaselineCalibrationIndicatorResult {
  if (errors.length > 0) {
    return calibrationBaseResult(
      indicatorId,
      "invalid-input",
      errors.join("；"),
      errors
    )
  }
  if (!input) {
    return calibrationBaseResult(
      indicatorId,
      "missing",
      "未提交该专项校准所需的原始量化字段。"
    )
  }

  const evidence = getEligibleEvidence(
    request.evidence,
    request.companyId,
    indicatorId
  )
  if (evidence.length === 0) {
    return calibrationBaseResult(
      indicatorId,
      "ineligible-evidence",
      "已录入原始值，但未绑定具备精确定位的直接证据，或具备完整推导依据的推导证据。"
    )
  }

  const metadata = calibrationIndicatorMetadata[indicatorId]
  if (indicatorId === "tqc-005") {
    return {
      indicatorId,
      label: metadata.label,
      sourceCategory: metadata.sourceCategory,
      status: "calculated",
      value: round(input.value),
      displayValue:
        input.displayValue ??
        `${formatNumber(round(input.value))}${metadata.unit}`,
      unit: metadata.unit,
      formulaTrace: input.formulaTrace,
      validationErrors: [],
      evidenceIds: evidence.map((reference) => reference.evidenceId),
      scoringEligible: false,
      contributesToAggregate: false,
      riskBand: null,
      standardizedRiskScore: null,
      thresholdTrace: null,
    }
  }

  const riskBand = calibrationBand(indicatorId, input.value)
  return {
    indicatorId,
    label: metadata.label,
    sourceCategory: metadata.sourceCategory,
    status: "calculated",
    value: round(input.value),
    displayValue:
      input.displayValue ?? `${formatNumber(round(input.value))}${metadata.unit}`,
    unit: metadata.unit,
    formulaTrace: input.formulaTrace,
    validationErrors: [],
    evidenceIds: evidence.map((reference) => reference.evidenceId),
    scoringEligible: true,
    contributesToAggregate: false,
    riskBand,
    standardizedRiskScore: standardizedScoreForBand(riskBand),
    thresholdTrace: metadata.thresholdTrace,
  }
}

function papersInput(values: TechnologyBaselineValues, errors: string[]) {
  const value = optionalFiniteNumber(
    values,
    "papersPublished",
    "年度 SCI/核心期刊论文数",
    errors,
    { integer: true, min: 0 }
  )
  return value === null
    ? null
    : {
        value,
        formulaTrace: `年度 SCI/核心期刊论文数=${formatNumber(value)} 篇。`,
      }
}

function patentEfficiencyInput(
  values: TechnologyBaselineValues,
  errors: string[]
) {
  const validInventionPatents = optionalFiniteNumber(
    values,
    "validInventionPatents",
    "累计有效发明专利授权量",
    errors,
    { integer: true, min: 0 }
  )
  if (validInventionPatents === null || errors.length > 0) {
    return null
  }
  return {
    value: validInventionPatents,
    formulaTrace: `累计有效发明专利授权量=${formatNumber(validInventionPatents)} 件。`,
  }
}

function researchIntensityInput(
  values: TechnologyBaselineValues,
  errors: string[]
) {
  const expense = optionalFiniteNumber(
    values,
    "researchDevelopmentExpense",
    "研发费用",
    errors,
    { min: 0 }
  )
  const revenue = optionalFiniteNumber(
    values,
    "operatingRevenue",
    "营业收入",
    errors,
    { min: 0 }
  )
  if (expense === null || revenue === null || errors.length > 0) {
    return null
  }
  if (revenue === 0) {
    errors.push("营业收入必须大于 0，才能计算研发投入强度。")
    return null
  }

  const value = (expense / revenue) * 100
  return {
    value,
    displayValue: `${formatNumber(round(value))}%`,
    formulaTrace: `研发投入强度=${formatNumber(expense)} ÷ ${formatNumber(revenue)} × 100%=${formatNumber(round(value))}%。`,
  }
}

function intellectualPropertyEfficiencyInput(
  values: TechnologyBaselineValues,
  errors: string[]
) {
  const total = optionalFiniteNumber(
    values,
    "totalIntellectualProperty",
    "知识产权拥有件数",
    errors,
    { integer: true, min: 0 }
  )
  const researchStaff = optionalFiniteNumber(
    values,
    "researchStaffCount",
    "研发人员数",
    errors,
    { integer: true, min: 0 }
  )
  if (total === null || researchStaff === null || errors.length > 0) {
    return null
  }
  if (researchStaff === 0) {
    errors.push("研发人员数必须大于 0，才能计算人均知识产权效率。")
    return null
  }

  const value = total / (researchStaff / 100)
  return {
    value,
    displayValue: `${formatNumber(round(value))} 件/百名研发人员`,
    formulaTrace: `人均知识产权效率=${formatNumber(total)} ÷ (${formatNumber(researchStaff)} ÷ 100)=${formatNumber(round(value))} 件/百名研发人员。`,
  }
}

function technologyContractInput(
  values: TechnologyBaselineValues,
  errors: string[]
) {
  const value = optionalFiniteNumber(
    values,
    "technologyContractTransactionAmount",
    "年度技术合同成交总额",
    errors,
    { min: 0 }
  )
  return value === null
    ? null
    : {
        value,
        formulaTrace: `年度技术合同成交总额=${formatNumber(value)} 万元。`,
      }
}

function negativeProbabilityInput(
  values: TechnologyBaselineValues,
  errors: string[]
) {
  const value = optionalFiniteNumber(
    values,
    "annualReportRiskNegativeProbability",
    "年报技术风险关键词负面情感概率",
    errors,
    { min: 0, max: 1 }
  )
  return value === null
    ? null
    : {
        value,
        displayValue: formatNumber(round(value, 3), 3),
        formulaTrace: `年报技术风险关键词经已记录的文本模型处理后，负面情感概率=${formatNumber(round(value, 3), 3)}。`,
      }
}

function patentApplicationsInput(
  values: TechnologyBaselineValues,
  errors: string[]
) {
  const value = optionalFiniteNumber(
    values,
    "patentApplications",
    "累计发明专利申请量",
    errors,
    { integer: true, min: 0 }
  )
  return value === null
    ? null
    : {
        value,
        formulaTrace: `累计发明专利申请量=${formatNumber(value)} 件。`,
      }
}

function patentGrantRateInput(
  values: TechnologyBaselineValues,
  errors: string[]
) {
  const applications = optionalFiniteNumber(
    values,
    "patentApplications",
    "累计发明专利申请量",
    errors,
    { integer: true, min: 0 }
  )
  const grants = optionalFiniteNumber(
    values,
    "patentGrants",
    "累计发明专利授权量",
    errors,
    { integer: true, min: 0 }
  )
  if (applications === null || grants === null || errors.length > 0) {
    return null
  }
  if (applications === 0) {
    errors.push("累计发明专利申请量必须大于 0，才能计算专利授权率。")
    return null
  }

  const value = (grants / applications) * 100
  return {
    value,
    displayValue: `${formatNumber(round(value))}%`,
    formulaTrace: `专利授权率=${formatNumber(grants)} ÷ ${formatNumber(applications)} × 100%=${formatNumber(round(value))}%。`,
  }
}

function intangibleAssetsRatioInput(
  values: TechnologyBaselineValues,
  errors: string[]
) {
  const intangibleAssets = optionalFiniteNumber(
    values,
    "intangibleAssets",
    "无形资产",
    errors,
    { min: 0 }
  )
  const netAssets = optionalFiniteNumber(values, "netAssets", "净资产", errors, {
    min: 0,
  })
  if (intangibleAssets === null || netAssets === null || errors.length > 0) {
    return null
  }
  if (netAssets === 0) {
    errors.push("净资产必须大于 0，才能计算无形资产占净资产比。")
    return null
  }

  const value = (intangibleAssets / netAssets) * 100
  return {
    value,
    displayValue: `${formatNumber(round(value))}%`,
    formulaTrace: `无形资产占净资产比=${formatNumber(intangibleAssets)} ÷ ${formatNumber(netAssets)} × 100%=${formatNumber(round(value))}%。`,
  }
}

function trlInput(values: TechnologyBaselineValues, errors: string[]) {
  const value = optionalFiniteNumber(
    values,
    "currentTrl",
    "当前技术成熟度（TRL）",
    errors,
    { integer: true, min: 1, max: 9 }
  )
  return value === null
    ? null
    : {
        value,
        displayValue: `TRL ${formatNumber(value)} 级`,
        formulaTrace: `当前技术成熟度=${formatNumber(value)} 级。`,
      }
}

function coreTechnologyProductRevenueRatioInput(
  values: TechnologyBaselineValues,
  errors: string[]
) {
  const coreRevenue = optionalFiniteNumber(
    values,
    "coreTechnologyProductRevenue",
    "核心技术产品收入",
    errors,
    { min: 0 }
  )
  const operatingRevenue = optionalFiniteNumber(
    values,
    "operatingRevenue",
    "营业收入",
    errors,
    { min: 0 }
  )
  if (coreRevenue === null || operatingRevenue === null || errors.length > 0) {
    return null
  }
  if (operatingRevenue === 0) {
    errors.push("营业收入必须大于 0，才能计算核心技术产品收入占比。")
    return null
  }

  const value = (coreRevenue / operatingRevenue) * 100
  return {
    value,
    displayValue: `${formatNumber(round(value))}%`,
    formulaTrace: `核心技术产品收入占比=${formatNumber(coreRevenue)} ÷ ${formatNumber(operatingRevenue)} × 100%=${formatNumber(round(value))}%。`,
  }
}

export function calculateTechnologyBaseline(
  rawRequest: unknown,
  now = new Date()
): TechnologyBaselineQuantificationResult {
  const request = validateRequest(rawRequest)
  const resultInputs = [
    ["tqi-001", papersInput],
    ["tqi-002", patentEfficiencyInput],
    ["tqi-003", researchIntensityInput],
    ["tqi-004", intellectualPropertyEfficiencyInput],
    ["tqi-005", technologyContractInput],
    ["tqi-006", negativeProbabilityInput],
  ] as const satisfies ReadonlyArray<
    readonly [
      TechnologyBaselineIndicatorId,
      (values: TechnologyBaselineValues, errors: string[]) => BaselineInput | null,
    ]
  >

  const indicatorResults = resultInputs.map(([indicatorId, getInput]) => {
    const errors: string[] = []
    return makeResult(request, indicatorId, getInput(request.values, errors), errors)
  })
  const calibrationInputs = [
    ["tqc-001", papersInput],
    ["tqc-002", patentApplicationsInput],
    ["tqc-003", patentGrantRateInput],
    ["tqc-004", researchIntensityInput],
    ["tqc-005", intangibleAssetsRatioInput],
    ["tqc-006", trlInput],
    ["tqc-007", coreTechnologyProductRevenueRatioInput],
    ["tqc-008", negativeProbabilityInput],
  ] as const satisfies ReadonlyArray<
    readonly [
      TechnologyBaselineCalibrationIndicatorId,
      (values: TechnologyBaselineValues, errors: string[]) => BaselineInput | null,
    ]
  >
  const calibrationIndicatorResults = calibrationInputs.map(
    ([indicatorId, getInput]) => {
      const errors: string[] = []
      return makeCalibrationResult(
        request,
        indicatorId,
        getInput(request.values, errors),
        errors
      )
    }
  )
  const quantifiedIndicatorCount = indicatorResults.filter(
    (result) => result.status === "calculated"
  ).length
  const calibratedIndicatorCount = calibrationIndicatorResults.filter(
    (result) => result.status === "calculated"
  ).length
  const thresholdedCalibrationCount = calibrationIndicatorResults.filter(
    (result) => result.scoringEligible
  ).length
  const configuration = lifecycleConfiguration[request.lifecycleStage]
  const quantifiedWeight = indicatorResults.reduce(
    (total, result) =>
      result.status === "calculated"
        ? total + (result.lifecycleWeight ?? 0)
        : total,
    0
  )

  return {
    companyId: request.companyId,
    period: request.period,
    asOfDate: request.asOfDate,
    lifecycleStage: request.lifecycleStage,
    modelVersion: TECHNOLOGY_BASELINE_MODEL_VERSION,
    runId: `tqb-${now.getTime().toString(36)}-${request.companyId}`,
    generatedAt: now.toISOString(),
    status:
      quantifiedIndicatorCount === baselineIndicatorIds.length
        ? "completed"
        : "partial",
    technologyDimensionWeight: configuration.technologyDimensionWeight,
    lifecycleWeights: baselineIndicatorIds.map((indicatorId) => ({
      label: indicatorMetadata[indicatorId].label,
      weight: configuration.weights[indicatorId],
    })),
    quantifiedIndicatorCount,
    calibrationStatus:
      thresholdedCalibrationCount === 0
        ? "pending"
        : thresholdedCalibrationCount === calibrationIndicatorIds.length - 1
          ? "complete"
          : "partial",
    calibrationMessage:
      thresholdedCalibrationCount === 0
        ? "专项校准尚未形成可评分观测：请补充带精确定位的原始值和可用证据。无形资产占净资产比仅保留公式观测，不设风险阈值。"
        : `已形成 ${thresholdedCalibrationCount}/7 项具阈值的专项校准观测；标准分按 Excel 阈值映射为低风险 25、中风险 60、高风险 85。无形资产占净资产比仅保留公式观测，不设风险阈值。`,
    score: null,
    riskBand: null,
    quantifiedWeight,
    scoringStatus: "calibration-observation-only",
    indicatorResults,
    calibrationIndicatorResults,
    calibratedIndicatorCount,
    disclaimer:
      "正式技术量化仅记录六项官方指标、公式和生命周期权重。专项校准仅将技术专表中已给出阈值的单项观测映射为 25/60/85，不生成综合分、不驱动六维雷达图，也不替代人工尽调、监管认定或投资决策。",
  }
}

export function getTechnologyBaselineIndicatorIds() {
  return [...baselineIndicatorIds]
}

export function getTechnologyBaselineCalibrationIndicatorIds() {
  return [...calibrationIndicatorIds]
}
