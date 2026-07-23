import cambriconData from "../data/company/cambricon.json" with { type: "json" }
import deepseekData from "../data/company/deepseek.json" with { type: "json" }
import fourthParadigmData from "../data/company/fourth-paradigm.json" with {
  type: "json",
}
import horizonData from "../data/company/horizon.json" with { type: "json" }
import robosenseData from "../data/company/robosense.json" with { type: "json" }
import unitreeData from "../data/company/unitree.json" with { type: "json" }
import evidenceGovernanceData from "../data/evidence-governance.json" with {
  type: "json",
}
import type {
  EvidenceSupportStrength,
  TechnologyDependencyValues,
  TechnologyEngineeringConversionValues,
  TechnologyIncidentInput,
  TechnologyInnovationContinuityValues,
  TechnologyMaturityValues,
  TechnologyPatentBarrierValues,
  TechnologyPerformanceValues,
  TechnologyResearchConversionValues,
  TechnologyRiskEvidenceReference,
  TechnologyRiskIndicatorId,
  TechnologyRiskIndicatorResult,
  TechnologyRiskScoreRequest,
  TechnologyRiskScoreResult,
  TechnologyValidationValues,
} from "../types/risk.ts"

export const TECHNOLOGY_RISK_MODEL_VERSION = "KTR-2026.07-v1"
export const TECHNOLOGY_RISK_MINIMUM_COVERED_WEIGHT = 70

const indicatorDefinitions = {
  "kci-006": { label: "核心技术性能行业分位", weight: 10 },
  "kci-007": { label: "核心论文质量与技术转化关联", weight: 8 },
  "kci-008": { label: "核心专利质量与技术壁垒", weight: 9 },
  "kci-009": { label: "持续创新能力", weight: 8 },
  "kci-010": { label: "技术成熟与阶段兑现度", weight: 20 },
  "kci-011": { label: "工程化与商业转化率", weight: 15 },
  "kci-012": { label: "独立验证与关键测试有效性", weight: 18 },
  "kci-013": { label: "关键技术外部依赖度", weight: 12 },
} as const satisfies Record<
  TechnologyRiskIndicatorId,
  { label: string; weight: number }
>

const indicatorIds = Object.keys(
  indicatorDefinitions
) as TechnologyRiskIndicatorId[]

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

type IndicatorCalculation = {
  capabilityScore: number
  riskScore: number
  formulaTrace: string
  forcedHighReason?: string
}

export class TechnologyRiskRequestError extends Error {
  readonly statusCode = 422
  readonly code = "TECHNOLOGY_SCORE_REQUEST_INVALID"

  constructor(message: string) {
    super(message)
    this.name = "TechnologyRiskRequestError"
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function clampScore(value: number) {
  return Math.min(100, Math.max(0, value))
}

function roundScore(value: number) {
  return Math.round(clampScore(value) * 100) / 100
}

function finiteNumber(
  value: unknown,
  label: string,
  errors: string[],
  options: {
    integer?: boolean
    min?: number
    max?: number
  } = {}
) {
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

function percent(
  value: unknown,
  label: string,
  errors: string[]
) {
  return finiteNumber(value, label, errors, { min: 0, max: 100 })
}

function count(
  value: unknown,
  label: string,
  errors: string[]
) {
  return finiteNumber(value, label, errors, {
    integer: true,
    min: 0,
  })
}

function booleanValue(
  value: unknown,
  label: string,
  errors: string[]
) {
  if (typeof value !== "boolean") {
    errors.push(`${label}必须是布尔值。`)
    return false
  }
  return value
}

function eligibleEvidence(
  evidence: TechnologyRiskEvidenceReference[] | unknown,
  companyId: string
) {
  if (!Array.isArray(evidence)) {
    return []
  }

  return evidence.filter((reference) => {
    if (!isRecord(reference)) {
      return false
    }
    if (
      typeof reference.evidenceId !== "string" ||
      !reference.evidenceId.trim() ||
      typeof reference.locator !== "string" ||
      !reference.locator.trim()
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
      typeof governedEvidence.inferenceBasis === "string" &&
      Boolean(governedEvidence.inferenceBasis.trim()) &&
      typeof reference.inferenceBasis === "string" &&
      Boolean(reference.inferenceBasis.trim())
    )
  }) as TechnologyRiskEvidenceReference[]
}

function baseResult(
  indicatorId: TechnologyRiskIndicatorId,
  status: TechnologyRiskIndicatorResult["status"],
  validationErrors: string[] = []
): TechnologyRiskIndicatorResult {
  const definition = indicatorDefinitions[indicatorId]
  return {
    indicatorId,
    label: definition.label,
    weight: definition.weight,
    status,
    capabilityScore: null,
    riskScore: null,
    formulaTrace:
      status === "missing"
        ? "未提交该指标的原始观测值。"
        : status === "ineligible-evidence"
          ? "未找到具备精确定位的直接证据，或具备完整推导依据的推导证据。"
          : validationErrors.join("；"),
    validationErrors,
    evidenceIds: [],
  }
}

function calculateKci006(
  values: TechnologyPerformanceValues,
  errors: string[]
): IndicatorCalculation | null {
  const capability = percent(values.industryPercentile, "行业百分位", errors)
  if (capability === null || errors.length > 0) return null

  return {
    capabilityScore: capability,
    riskScore: 100 - capability,
    formulaTrace: `能力分=P=${capability}；风险分=100-P=${roundScore(100 - capability)}。`,
  }
}

function calculateKci007(
  values: TechnologyResearchConversionValues,
  errors: string[]
): IndicatorCalculation | null {
  const citation = percent(values.citationImpactScore, "引用影响力得分", errors)
  const quality = percent(
    values.topResearchQualityScore,
    "高被引或同行评议质量得分",
    errors
  )
  const patent = percent(values.patentLinkageScore, "论文专利关联得分", errors)
  const conversion = percent(
    values.productConversionScore,
    "论文产品转化得分",
    errors
  )
  const noPaper = booleanValue(
    values.noCorePaperThreeYears,
    "连续三年无核心论文标记",
    errors
  )
  const unableToMap = booleanValue(
    values.unableToMapCoreTechnology,
    "无法映射核心技术标记",
    errors
  )
  if (
    citation === null ||
    quality === null ||
    patent === null ||
    conversion === null ||
    errors.length > 0
  ) {
    return null
  }

  const capability =
    citation * 0.3 + quality * 0.2 + patent * 0.25 + conversion * 0.25
  const baseRisk = 100 - capability
  const risk = noPaper || unableToMap ? Math.max(baseRisk, 60) : baseRisk

  return {
    capabilityScore: capability,
    riskScore: risk,
    formulaTrace: `能力分=${citation}×30%+${quality}×20%+${patent}×25%+${conversion}×25%=${roundScore(capability)}；风险分=${roundScore(baseRisk)}${noPaper || unableToMap ? "，触发研究转化红旗，最低提升至60" : ""}。`,
  }
}

function calculateKci008(
  values: TechnologyPatentBarrierValues,
  errors: string[]
): IndicatorCalculation | null {
  const citation = percent(values.forwardCitationScore, "前向引用得分", errors)
  const family = percent(values.patentFamilyScore, "专利族布局得分", errors)
  const legal = percent(values.claimAndLegalScore, "权利与法律状态得分", errors)
  const coverage = percent(
    values.technologyCoverageScore,
    "技术覆盖得分",
    errors
  )
  const failed = booleanValue(
    values.widespreadCorePatentFailure,
    "核心专利大面积失效标记",
    errors
  )
  if (
    citation === null ||
    family === null ||
    legal === null ||
    coverage === null ||
    errors.length > 0
  ) {
    return null
  }

  const capability =
    citation * 0.35 + family * 0.25 + legal * 0.2 + coverage * 0.2
  const baseRisk = 100 - capability

  return {
    capabilityScore: capability,
    riskScore: baseRisk,
    formulaTrace: `能力分=${citation}×35%+${family}×25%+${legal}×20%+${coverage}×20%=${roundScore(capability)}；风险分=${roundScore(baseRisk)}${failed ? "，核心专利失效触发高风险下限85" : ""}。`,
    forcedHighReason: failed ? "核心专利大面积失效或无法覆盖主营产品" : undefined,
  }
}

function calculateKci009(
  values: TechnologyInnovationContinuityValues,
  errors: string[]
): IndicatorCalculation | null {
  const investment = percent(
    values.researchInvestmentPeerScore,
    "研发投入同业得分",
    errors
  )
  const update = percent(
    values.updateCyclePeerScore,
    "技术更新周期同业得分",
    errors
  )
  const stale = booleanValue(
    values.noEffectiveUpdateThreeYears,
    "连续三年无有效更新标记",
    errors
  )
  if (investment === null || update === null || errors.length > 0) return null

  const capability = investment * 0.4 + update * 0.6
  const baseRisk = 100 - capability

  return {
    capabilityScore: capability,
    riskScore: baseRisk,
    formulaTrace: `能力分=${investment}×40%+${update}×60%=${roundScore(capability)}；风险分=${roundScore(baseRisk)}${stale ? "，连续3年无有效更新触发高风险下限85" : ""}。`,
    forcedHighReason: stale ? "核心技术连续3年无有效更新" : undefined,
  }
}

function calculateKci010(
  values: TechnologyMaturityValues,
  errors: string[]
): IndicatorCalculation | null {
  const currentTrl = finiteNumber(values.currentTrl, "当前TRL", errors, {
    integer: true,
    min: 1,
    max: 9,
  })
  const targetTrl = finiteNumber(values.targetTrl, "目标TRL", errors, {
    integer: true,
    min: 1,
    max: 9,
  })
  const due = count(values.dueMilestones, "到期关键节点数", errors)
  const completed = count(
    values.completedOnTimeMilestones,
    "按期完成节点数",
    errors
  )
  const selfAssessed = booleanValue(
    values.selfAssessedWithoutExperimentEvidence,
    "仅自评且无实验或示范证据标记",
    errors
  )
  if (due !== null && due === 0) {
    errors.push("到期关键节点数必须大于0。")
  }
  if (due !== null && completed !== null && completed > due) {
    errors.push("按期完成节点数不能大于到期关键节点数。")
  }
  if (
    currentTrl === null ||
    targetTrl === null ||
    due === null ||
    completed === null ||
    errors.length > 0
  ) {
    return null
  }

  const trlScore = Math.max(0, 100 - 25 * Math.max(0, targetTrl - currentTrl))
  const milestoneScore = (completed / due) * 100
  const capability = trlScore * 0.6 + milestoneScore * 0.4
  const baseRisk = 100 - capability

  return {
    capabilityScore: capability,
    riskScore: baseRisk,
    formulaTrace: `TRL兑现分=max(0,100-25×max(0,${targetTrl}-${currentTrl}))=${roundScore(trlScore)}；节点兑现率=${completed}/${due}=${roundScore(milestoneScore)}；能力分=${roundScore(trlScore)}×60%+${roundScore(milestoneScore)}×40%=${roundScore(capability)}；风险分=${roundScore(baseRisk)}${selfAssessed ? "，TRL仅为自评且无实验或示范证据，提升至85" : ""}。`,
    forcedHighReason: selfAssessed
      ? "TRL 仅为自评且缺少实验或示范证据"
      : undefined,
  }
}

function calculateKci011(
  values: TechnologyEngineeringConversionValues,
  errors: string[]
): IndicatorCalculation | null {
  const completed = count(values.completedProjects, "已完成研发项目数", errors)
  const converted = count(values.convertedProjects, "已转化项目数", errors)
  if (completed !== null && completed === 0) {
    errors.push("已完成研发项目数必须大于0。")
  }
  if (completed !== null && converted !== null && converted > completed) {
    errors.push("已转化项目数不能大于已完成研发项目数。")
  }
  if (completed === null || converted === null || errors.length > 0) {
    return null
  }

  const capability = (converted / completed) * 100
  return {
    capabilityScore: capability,
    riskScore: 100 - capability,
    formulaTrace: `工程化转化率=${converted}/${completed}=${roundScore(capability)}%；风险分=100-${roundScore(capability)}=${roundScore(100 - capability)}。`,
  }
}

function calculateKci012(
  values: TechnologyValidationValues,
  errors: string[]
): IndicatorCalculation | null {
  const critical = count(values.criticalItemCount, "关键项总数", errors)
  const thirdParty = count(
    values.thirdPartyCoveredItems,
    "第三方覆盖项数",
    errors
  )
  const customer = count(values.customerCoveredItems, "客户覆盖项数", errors)
  const independent = count(
    values.independentInternalCoveredItems,
    "独立内部覆盖项数",
    errors
  )
  const selfTest = count(values.selfTestCoveredItems, "研发自测覆盖项数", errors)
  const requiredTests = count(
    values.requiredCriticalTests,
    "应执行关键测试数",
    errors
  )
  const passedTests = count(
    values.passedCriticalTests,
    "通过关键测试数",
    errors
  )
  const safetyFailure = booleanValue(
    values.mandatoryOrSafetyTestFailure,
    "强制或安全关键测试失败标记",
    errors
  )
  if (critical !== null && critical === 0) {
    errors.push("关键项总数必须大于0。")
  }
  if (requiredTests !== null && requiredTests === 0) {
    errors.push("应执行关键测试数必须大于0。")
  }
  if (
    critical !== null &&
    thirdParty !== null &&
    customer !== null &&
    independent !== null &&
    selfTest !== null &&
    thirdParty + customer + independent + selfTest > critical
  ) {
    errors.push("各类证据覆盖项数合计不能大于关键项总数。")
  }
  if (
    requiredTests !== null &&
    passedTests !== null &&
    passedTests > requiredTests
  ) {
    errors.push("通过关键测试数不能大于应执行关键测试数。")
  }
  if (
    critical === null ||
    thirdParty === null ||
    customer === null ||
    independent === null ||
    selfTest === null ||
    requiredTests === null ||
    passedTests === null ||
    errors.length > 0
  ) {
    return null
  }

  const weightedCovered =
    thirdParty + customer * 0.8 + independent * 0.5 + selfTest * 0.2
  const validationCoverage = (weightedCovered / critical) * 100
  const testPassRate = (passedTests / requiredTests) * 100
  const capability = validationCoverage * 0.4 + testPassRate * 0.6
  const baseRisk = 100 - capability

  return {
    capabilityScore: capability,
    riskScore: baseRisk,
    formulaTrace: `证据加权覆盖=(${thirdParty}×1.0+${customer}×0.8+${independent}×0.5+${selfTest}×0.2)/${critical}=${roundScore(validationCoverage)}%；关键测试通过率=${passedTests}/${requiredTests}=${roundScore(testPassRate)}%；能力分=${roundScore(validationCoverage)}×40%+${roundScore(testPassRate)}×60%=${roundScore(capability)}；风险分=${roundScore(baseRisk)}${safetyFailure ? "，强制或安全关键测试失败，提升至85" : ""}。`,
    forcedHighReason: safetyFailure
      ? "存在强制或安全关键测试失败"
      : undefined,
  }
}

function calculateKci013(
  values: TechnologyDependencyValues,
  errors: string[]
): IndicatorCalculation | null {
  const standard = count(
    values.standardCriticalModules,
    "标准关键模块数",
    errors
  )
  const highImpact = count(
    values.highImpactCriticalModules,
    "高影响关键模块数",
    errors
  )
  const externalStandard = count(
    values.irreplaceableExternalStandardModules,
    "不可替代外部标准模块数",
    errors
  )
  const externalHighImpact = count(
    values.irreplaceableExternalHighImpactModules,
    "不可替代外部高影响模块数",
    errors
  )
  const singleSource = booleanValue(
    values.highImpactSingleSource,
    "高影响单一来源标记",
    errors
  )
  const exportRestriction = booleanValue(
    values.exportRestriction,
    "出口限制标记",
    errors
  )
  const licenseRisk = booleanValue(
    values.nonRenewableCriticalLicense,
    "关键许可证不可续期标记",
    errors
  )
  if (
    standard !== null &&
    highImpact !== null &&
    standard + highImpact === 0
  ) {
    errors.push("关键模块总数必须大于0。")
  }
  if (
    standard !== null &&
    externalStandard !== null &&
    externalStandard > standard
  ) {
    errors.push("不可替代外部标准模块数不能大于标准关键模块数。")
  }
  if (
    highImpact !== null &&
    externalHighImpact !== null &&
    externalHighImpact > highImpact
  ) {
    errors.push("不可替代外部高影响模块数不能大于高影响关键模块数。")
  }
  if (
    standard === null ||
    highImpact === null ||
    externalStandard === null ||
    externalHighImpact === null ||
    errors.length > 0
  ) {
    return null
  }

  const denominator = standard + highImpact * 2
  const numerator = externalStandard + externalHighImpact * 2
  const dependency = (numerator / denominator) * 100
  const forcedHigh = singleSource || exportRestriction || licenseRisk
  const reasons = [
    singleSource ? "不可替代高影响单一来源" : "",
    exportRestriction ? "出口限制" : "",
    licenseRisk ? "关键许可证不可续期" : "",
  ].filter(Boolean)

  return {
    capabilityScore: 100 - dependency,
    riskScore: dependency,
    formulaTrace: `外部依赖度=(${externalStandard}+${externalHighImpact}×2)/(${standard}+${highImpact}×2)=${roundScore(dependency)}%；风险分=${roundScore(dependency)}${forcedHigh ? `，${reasons.join("、")}触发高风险下限85` : ""}。`,
    forcedHighReason: forcedHigh
      ? `关键技术外部依赖红旗：${reasons.join("、")}`
      : undefined,
  }
}

function calculateIndicator(
  indicatorId: TechnologyRiskIndicatorId,
  values: unknown,
  errors: string[]
) {
  if (!isRecord(values)) {
    errors.push("指标 values 必须是对象。")
    return null
  }

  switch (indicatorId) {
    case "kci-006":
      return calculateKci006(values as unknown as TechnologyPerformanceValues, errors)
    case "kci-007":
      return calculateKci007(
        values as unknown as TechnologyResearchConversionValues,
        errors
      )
    case "kci-008":
      return calculateKci008(
        values as unknown as TechnologyPatentBarrierValues,
        errors
      )
    case "kci-009":
      return calculateKci009(
        values as unknown as TechnologyInnovationContinuityValues,
        errors
      )
    case "kci-010":
      return calculateKci010(values as unknown as TechnologyMaturityValues, errors)
    case "kci-011":
      return calculateKci011(
        values as unknown as TechnologyEngineeringConversionValues,
        errors
      )
    case "kci-012":
      return calculateKci012(values as unknown as TechnologyValidationValues, errors)
    case "kci-013":
      return calculateKci013(values as unknown as TechnologyDependencyValues, errors)
  }
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize)
  }
  if (!isRecord(value)) {
    return value
  }

  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key])])
  )
}

function createRunId(request: TechnologyRiskScoreRequest) {
  const source = JSON.stringify(canonicalize(request))
  let left = 0x811c9dc5
  let right = 0x9e3779b9

  for (let index = 0; index < source.length; index += 1) {
    const code = source.charCodeAt(index)
    left = Math.imul(left ^ code, 0x01000193)
    right = Math.imul(right ^ code, 0x85ebca6b)
  }

  const digest = [left, right]
    .map((value) => (value >>> 0).toString(16).padStart(8, "0"))
    .join("")
  return `ktr-${digest}`
}

function monthsBetween(left: Date, right: Date) {
  return Math.max(
    0,
    (right.getUTCFullYear() - left.getUTCFullYear()) * 12 +
      right.getUTCMonth() -
      left.getUTCMonth()
  )
}

function incidentTimeFactor(occurredAt: Date, asOfDate: Date) {
  const months = monthsBetween(occurredAt, asOfDate)
  if (months <= 12) return 1
  if (months <= 24) return 0.7
  if (months <= 36) return 0.4
  return 0.2
}

function incidentResponsibilityFactor(
  responsibility: TechnologyIncidentInput["responsibility"]
) {
  return {
    primary: 1,
    secondary: 0.5,
    indirect: 0.25,
    none: 0,
  }[responsibility]
}

function calculateIncidentOverlay(
  incidents: TechnologyIncidentInput[],
  asOfDate: Date,
  companyId: string
): TechnologyRiskScoreResult["incidentOverlay"] & {
  forcedHighReasons: string[]
} {
  let highestIndex = 0
  let highestIncidentId: string | null = null
  let highestTrace = "未提交具备计分证据的重大技术事故。"
  const forcedHighReasons: string[] = []

  incidents.forEach((incident) => {
    const evidence = eligibleEvidence(incident.evidence, companyId)
    const occurredAt = new Date(incident.occurredAt)
    if (
      evidence.length === 0 ||
      Number.isNaN(occurredAt.getTime()) ||
      !Number.isFinite(incident.severity) ||
      incident.severity < 0 ||
      incident.severity > 10 ||
      !["primary", "secondary", "indirect", "none"].includes(
        incident.responsibility
      )
    ) {
      return
    }

    const responsibilityFactor = incidentResponsibilityFactor(
      incident.responsibility
    )
    const timeFactor = incidentTimeFactor(occurredAt, asOfDate)
    const index = incident.severity * responsibilityFactor * timeFactor

    if (index > highestIndex) {
      highestIndex = index
      highestIncidentId = incident.id
      highestTrace = `${incident.description}：严重度${incident.severity}×责任系数${responsibilityFactor}×时间系数${timeFactor}=${roundScore(index)}。`
    }

    if (incident.concealed) {
      forcedHighReasons.push(`事故“${incident.description}”存在隐瞒情形`)
    }
    if (incident.repeatedSeriousIncident) {
      forcedHighReasons.push(`事故“${incident.description}”属于重复严重事故`)
    }
    if (incident.severity >= 8 && incident.responsibility === "primary") {
      forcedHighReasons.push(
        `事故“${incident.description}”严重度达到8且承担主要责任`
      )
    }
  })

  const index = roundScore(highestIndex)
  const level =
    index === 0
      ? "low"
      : index <= 2
        ? "medium-low"
        : index <= 5
          ? "medium-high"
          : "high"
  const riskFloor = {
    low: 0,
    "medium-low": 40,
    "medium-high": 60,
    high: 85,
  }[level] as 0 | 40 | 60 | 85

  return {
    index,
    level,
    riskFloor,
    incidentId: highestIncidentId,
    formulaTrace: highestTrace,
    forcedHighReasons,
  }
}

function validateRequest(value: unknown): asserts value is TechnologyRiskScoreRequest {
  if (!isRecord(value)) {
    throw new TechnologyRiskRequestError("请求体必须是对象。")
  }
  if (typeof value.companyId !== "string" || !value.companyId.trim()) {
    throw new TechnologyRiskRequestError("companyId 不能为空。")
  }
  if (typeof value.period !== "string" || !value.period.trim()) {
    throw new TechnologyRiskRequestError("period 不能为空。")
  }
  if (
    typeof value.asOfDate !== "string" ||
    !value.asOfDate.trim() ||
    Number.isNaN(Date.parse(value.asOfDate))
  ) {
    throw new TechnologyRiskRequestError("asOfDate 必须是有效日期。")
  }
  if (!isRecord(value.indicators)) {
    throw new TechnologyRiskRequestError("indicators 必须是对象。")
  }
  if (value.incidents !== undefined && !Array.isArray(value.incidents)) {
    throw new TechnologyRiskRequestError("incidents 必须是数组。")
  }
}

export function calculateTechnologyRisk(
  requestValue: unknown,
  now = new Date()
): TechnologyRiskScoreResult {
  validateRequest(requestValue)
  const request = requestValue
  const indicatorResults: TechnologyRiskIndicatorResult[] = []
  const forcedHighReasons: string[] = []

  indicatorIds.forEach((indicatorId) => {
    const input = request.indicators[indicatorId]
    if (!input) {
      indicatorResults.push(baseResult(indicatorId, "missing"))
      return
    }
    if (!isRecord(input)) {
      indicatorResults.push(
        baseResult(indicatorId, "invalid-input", ["指标输入必须是对象。"])
      )
      return
    }

    const evidence = eligibleEvidence(input.evidence, request.companyId)
    if (evidence.length === 0) {
      indicatorResults.push(baseResult(indicatorId, "ineligible-evidence"))
      return
    }

    const validationErrors: string[] = []
    const calculation = calculateIndicator(
      indicatorId,
      input.values,
      validationErrors
    )
    if (!calculation || validationErrors.length > 0) {
      indicatorResults.push(
        baseResult(indicatorId, "invalid-input", validationErrors)
      )
      return
    }
    if (calculation.forcedHighReason) {
      forcedHighReasons.push(calculation.forcedHighReason)
    }

    indicatorResults.push({
      indicatorId,
      label: indicatorDefinitions[indicatorId].label,
      weight: indicatorDefinitions[indicatorId].weight,
      status: "scored",
      capabilityScore: roundScore(calculation.capabilityScore),
      riskScore: roundScore(calculation.riskScore),
      formulaTrace: calculation.formulaTrace,
      validationErrors: [],
      evidenceIds: [...new Set(evidence.map((item) => item.evidenceId))],
    })
  })

  const scoredIndicators = indicatorResults.filter(
    (
      result
    ): result is TechnologyRiskIndicatorResult & { riskScore: number } =>
      result.status === "scored" && result.riskScore !== null
  )
  const coveredWeight = scoredIndicators.reduce(
    (total, indicator) => total + indicator.weight,
    0
  )
  const weightedCoverage = coveredWeight
  const baseScore =
    coveredWeight >= TECHNOLOGY_RISK_MINIMUM_COVERED_WEIGHT
      ? roundScore(
          scoredIndicators.reduce(
            (total, indicator) =>
              total + indicator.riskScore * indicator.weight,
            0
          ) / coveredWeight
        )
      : null

  const asOfDate = new Date(request.asOfDate)
  const incidentOverlay = calculateIncidentOverlay(
    request.incidents ?? [],
    asOfDate,
    request.companyId
  )
  forcedHighReasons.push(...incidentOverlay.forcedHighReasons)
  const uniqueForcedHighReasons = [...new Set(forcedHighReasons)]
  const score =
    baseScore === null
      ? null
      : roundScore(
          Math.max(
            baseScore,
            incidentOverlay.riskFloor,
            uniqueForcedHighReasons.length > 0 ? 85 : 0
          )
        )

  return {
    companyId: request.companyId.trim(),
    period: request.period.trim(),
    asOfDate: request.asOfDate,
    modelVersion: TECHNOLOGY_RISK_MODEL_VERSION,
    runId: createRunId(request),
    generatedAt: now.toISOString(),
    status: score === null ? "insufficient-coverage" : "scored",
    coveredWeight,
    weightedCoverage,
    baseScore,
    score,
    indicatorResults,
    incidentOverlay: {
      index: incidentOverlay.index,
      level: incidentOverlay.level,
      riskFloor: incidentOverlay.riskFloor,
      incidentId: incidentOverlay.incidentId,
      formulaTrace: incidentOverlay.formulaTrace,
    },
    forcedHighReasons: uniqueForcedHighReasons,
  }
}
