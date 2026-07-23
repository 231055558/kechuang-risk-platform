import type {
  TechnologyBaselineCalibrationIndicatorId,
  TechnologyBaselineCalibrationIndicatorResult,
  TechnologyBaselineIndicatorId,
  TechnologyBaselineIndicatorResult,
  TechnologyBaselineLifecycleStage,
  TechnologyBaselineQuantificationResult,
  TechnologyBaselineRiskBand,
} from "../types/risk.ts"

const MODEL_VERSION = "TQB-2026.07-v5"

const indicatorDefinitions = {
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
} as const satisfies Record<
  TechnologyBaselineIndicatorId,
  Pick<TechnologyBaselineIndicatorResult, "label" | "sourceCategory" | "unit">
>

const calibrationDefinitions = {
  "tqc-001": {
    label: "论文发表数量专项校准",
    sourceCategory: "论文与研究",
    unit: "篇",
    thresholdTrace: "低风险：>20 篇；中风险：5–20 篇；高风险：<5 篇。",
    getRiskBand: (value: number) =>
      value > 20 ? "low" : value >= 5 ? "medium" : "high",
  },
  "tqc-002": {
    label: "专利申请数量专项校准",
    sourceCategory: "专利与知识产权",
    unit: "件",
    thresholdTrace: "低风险：>50 件；中风险：10–50 件；高风险：<10 件。",
    getRiskBand: (value: number) =>
      value > 50 ? "low" : value >= 10 ? "medium" : "high",
  },
  "tqc-003": {
    label: "专利授权率专项校准",
    sourceCategory: "专利与知识产权",
    unit: "%",
    thresholdTrace: "低风险：>60%；中风险：30–60%；高风险：<30%。",
    getRiskBand: (value: number) =>
      value > 60 ? "low" : value >= 30 ? "medium" : "high",
  },
  "tqc-004": {
    label: "研发投入强度专项校准",
    sourceCategory: "研发投入",
    unit: "%",
    thresholdTrace: "低风险：>15%；中风险：5–15%；高风险：<5%。",
    getRiskBand: (value: number) =>
      value > 15 ? "low" : value >= 5 ? "medium" : "high",
  },
  "tqc-005": {
    label: "无形资产占净资产比专项观测",
    sourceCategory: "财务结构",
    unit: "%",
    thresholdTrace: null,
    getRiskBand: null,
  },
  "tqc-006": {
    label: "技术成熟度（TRL）专项校准",
    sourceCategory: "技术成熟度",
    unit: "TRL级",
    thresholdTrace: "低风险：≥7 级；中风险：4–6 级；高风险：≤3 级。",
    getRiskBand: (value: number) =>
      value >= 7 ? "low" : value >= 4 ? "medium" : "high",
  },
  "tqc-007": {
    label: "核心技术产品收入占比专项校准",
    sourceCategory: "商业转化",
    unit: "%",
    thresholdTrace: "低风险：>70%；中风险：30–70%；高风险：<30%。",
    getRiskBand: (value: number) =>
      value > 70 ? "low" : value >= 30 ? "medium" : "high",
  },
  "tqc-008": {
    label: "技术风险负面情感概率专项校准",
    sourceCategory: "年报文本",
    unit: "负面情感概率",
    thresholdTrace: "低风险：<0.2；中风险：0.2–0.5；高风险：>0.5。",
    getRiskBand: (value: number) =>
      value < 0.2 ? "low" : value <= 0.5 ? "medium" : "high",
  },
} as const satisfies Record<
  TechnologyBaselineCalibrationIndicatorId,
  Pick<
    TechnologyBaselineCalibrationIndicatorResult,
    "label" | "sourceCategory" | "unit" | "thresholdTrace"
  > & {
    getRiskBand:
      ((value: number) => Exclude<TechnologyBaselineRiskBand, null>) | null
  }
>

const indicatorIds = Object.keys(
  indicatorDefinitions
) as TechnologyBaselineIndicatorId[]

const calibrationIndicatorIds = Object.keys(
  calibrationDefinitions
) as TechnologyBaselineCalibrationIndicatorId[]

const lifecycleWeights = {
  startup: {
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
} as const

const statuses = new Set<TechnologyBaselineIndicatorResult["status"]>([
  "calculated",
  "missing",
  "ineligible-evidence",
  "invalid-input",
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

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
}

function isIntegerInRange(
  value: unknown,
  minimum: number,
  maximum: number
): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= minimum &&
    value <= maximum
  )
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
}

function isLifecycleStage(
  value: unknown
): value is TechnologyBaselineLifecycleStage {
  return value === "startup" || value === "growth" || value === "stable"
}

function isIndicatorResult(
  value: unknown,
  lifecycleStage: TechnologyBaselineLifecycleStage,
  expectedIndicatorId: TechnologyBaselineIndicatorId
): value is TechnologyBaselineIndicatorResult {
  if (!isRecord(value)) {
    return false
  }

  const definition = indicatorDefinitions[expectedIndicatorId]
  const expectedWeight =
    lifecycleWeights[lifecycleStage].weights[expectedIndicatorId]
  if (
    value.indicatorId !== expectedIndicatorId ||
    value.label !== definition.label ||
    value.sourceCategory !== definition.sourceCategory ||
    value.unit !== definition.unit ||
    value.lifecycleWeight !== expectedWeight ||
    !statuses.has(
      value.status as TechnologyBaselineIndicatorResult["status"]
    ) ||
    !isNonEmptyString(value.displayValue) ||
    !isNonEmptyString(value.formulaTrace) ||
    !isStringArray(value.validationErrors) ||
    !isStringArray(value.evidenceIds) ||
    value.classification !== "official" ||
    value.scoringEligible !== false ||
    value.contributesToAggregate !== false ||
    value.riskBand !== null ||
    value.standardizedRiskScore !== null ||
    value.thresholdTrace !== null
  ) {
    return false
  }

  if (value.status !== "calculated") {
    return (
      value.value === null &&
      value.evidenceIds.length === 0 &&
      (value.status !== "invalid-input" || value.validationErrors.length > 0)
    )
  }

  return (
    isFiniteNonNegative(value.value) &&
    value.validationErrors.length === 0 &&
    value.evidenceIds.length > 0
  )
}

function riskScoreForBand(
  band: Exclude<TechnologyBaselineRiskBand, null>
): 25 | 60 | 85 {
  return band === "low" ? 25 : band === "medium" ? 60 : 85
}

function isCalibrationIndicatorResult(
  value: unknown,
  expectedIndicatorId: TechnologyBaselineCalibrationIndicatorId
): value is TechnologyBaselineCalibrationIndicatorResult {
  if (!isRecord(value)) {
    return false
  }

  const definition = calibrationDefinitions[expectedIndicatorId]
  if (
    value.indicatorId !== expectedIndicatorId ||
    value.label !== definition.label ||
    value.sourceCategory !== definition.sourceCategory ||
    value.unit !== definition.unit ||
    !statuses.has(
      value.status as TechnologyBaselineIndicatorResult["status"]
    ) ||
    !isNonEmptyString(value.displayValue) ||
    !isNonEmptyString(value.formulaTrace) ||
    !isStringArray(value.validationErrors) ||
    !isStringArray(value.evidenceIds) ||
    value.contributesToAggregate !== false
  ) {
    return false
  }

  if (value.status !== "calculated") {
    return (
      value.value === null &&
      value.evidenceIds.length === 0 &&
      value.scoringEligible === false &&
      value.riskBand === null &&
      value.standardizedRiskScore === null &&
      value.thresholdTrace === null &&
      (value.status !== "invalid-input" || value.validationErrors.length > 0)
    )
  }

  if (
    !isFiniteNonNegative(value.value) ||
    value.validationErrors.length !== 0 ||
    value.evidenceIds.length === 0
  ) {
    return false
  }

  if (definition.getRiskBand === null) {
    return (
      value.scoringEligible === false &&
      value.riskBand === null &&
      value.standardizedRiskScore === null &&
      value.thresholdTrace === null
    )
  }

  const expectedRiskBand = definition.getRiskBand(value.value)
  return (
    value.scoringEligible === true &&
    value.riskBand === expectedRiskBand &&
    value.standardizedRiskScore === riskScoreForBand(expectedRiskBand) &&
    value.thresholdTrace === definition.thresholdTrace
  )
}

export function isTechnologyBaselineQuantificationResult(
  value: unknown
): value is TechnologyBaselineQuantificationResult {
  if (!isRecord(value) || !isLifecycleStage(value.lifecycleStage)) {
    return false
  }

  const lifecycleStage = value.lifecycleStage
  const lifecycle = lifecycleWeights[lifecycleStage]
  if (
    !isNonEmptyString(value.companyId) ||
    !isNonEmptyString(value.period) ||
    !isValidDate(value.asOfDate) ||
    value.modelVersion !== MODEL_VERSION ||
    !isNonEmptyString(value.runId) ||
    !isValidDate(value.generatedAt) ||
    (value.status !== "completed" && value.status !== "partial") ||
    value.technologyDimensionWeight !== lifecycle.technologyDimensionWeight ||
    !Array.isArray(value.lifecycleWeights) ||
    value.lifecycleWeights.length !== indicatorIds.length ||
    !value.lifecycleWeights.every(
      (weight, index) =>
        isRecord(weight) &&
        weight.label ===
          indicatorDefinitions[
            indicatorIds[index] as TechnologyBaselineIndicatorId
          ].label &&
        weight.weight ===
          lifecycle.weights[
            indicatorIds[index] as TechnologyBaselineIndicatorId
          ]
    ) ||
    !isIntegerInRange(value.quantifiedIndicatorCount, 0, indicatorIds.length) ||
    !isNonEmptyString(value.calibrationMessage) ||
    value.score !== null ||
    value.riskBand !== null ||
    !isIntegerInRange(
      value.quantifiedWeight,
      0,
      lifecycle.technologyDimensionWeight
    ) ||
    value.scoringStatus !== "calibration-observation-only" ||
    !Array.isArray(value.indicatorResults) ||
    value.indicatorResults.length !== indicatorIds.length ||
    !Array.isArray(value.calibrationIndicatorResults) ||
    value.calibrationIndicatorResults.length !==
      calibrationIndicatorIds.length ||
    !isIntegerInRange(
      value.calibratedIndicatorCount,
      0,
      calibrationIndicatorIds.length
    ) ||
    !isNonEmptyString(value.disclaimer)
  ) {
    return false
  }

  if (
    !value.indicatorResults.every((result, index) =>
      isIndicatorResult(
        result,
        lifecycleStage,
        indicatorIds[index] as TechnologyBaselineIndicatorId
      )
    ) ||
    !value.calibrationIndicatorResults.every((result, index) =>
      isCalibrationIndicatorResult(
        result,
        calibrationIndicatorIds[
          index
        ] as TechnologyBaselineCalibrationIndicatorId
      )
    )
  ) {
    return false
  }

  const calculated = value.indicatorResults.filter(
    (result) => result.status === "calculated"
  )
  const quantifiedWeight = calculated.reduce(
    (total, result) => total + (result.lifecycleWeight ?? 0),
    0
  )
  const calibrated = value.calibrationIndicatorResults.filter(
    (result) => result.status === "calculated"
  )
  const scoredCalibrationCount = calibrated.filter(
    (result) => result.scoringEligible
  ).length
  const expectedCalibrationStatus =
    scoredCalibrationCount === 0
      ? "pending"
      : scoredCalibrationCount === calibrationIndicatorIds.length - 1
        ? "complete"
        : "partial"

  return (
    value.quantifiedIndicatorCount === calculated.length &&
    value.quantifiedWeight === quantifiedWeight &&
    value.status ===
      (calculated.length === indicatorIds.length ? "completed" : "partial") &&
    value.calibratedIndicatorCount === calibrated.length &&
    value.calibrationStatus === expectedCalibrationStatus
  )
}
