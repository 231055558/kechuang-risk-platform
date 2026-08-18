import type {
  IndustryRiskDataset,
  IndustryRiskIndicatorId,
  IndustryRiskObservation,
} from "./model.ts"

export const INDUSTRY_RISK_MVP_METHOD_VERSION = "IRAWC-MVP-2026.08-v1" as const
export const INDUSTRY_RISK_FULL_METHOD_VERSION =
  "IRAWC-FULL-2026.08-v1" as const

export type IndustryRiskDirection = "higher-is-riskier" | "lower-is-riskier"
export type IndustryRiskWeightMethod = "entropy" | "critic"

export interface IndustryRiskMetricDefinition {
  indicatorId: IndustryRiskIndicatorId
  metricName: string
  label: string
  unit: string
  direction: IndustryRiskDirection
  limitation: string
}

export const INDUSTRY_RISK_PILOT_METRICS: readonly IndustryRiskMetricDefinition[] =
  [
    {
      indicatorId: "R07",
      metricName: "rd_intensity_pct",
      label: "研发投入强度",
      unit: "%",
      direction: "lower-is-riskier",
      limitation: "高投入但里程碑未兑现的联合预警需等待 R08 数据。",
    },
    {
      indicatorId: "R13",
      metricName: "revenue_growth_pct",
      label: "营业收入增长率",
      unit: "%",
      direction: "lower-is-riskier",
      limitation: "当前为单年度横截面，尚未覆盖持续负增长与增速骤降趋势。",
    },
    {
      indicatorId: "R14",
      metricName: "intangible_assets_ratio_change_pp",
      label: "无形资产占比变动",
      unit: "百分点",
      direction: "higher-is-riskier",
      limitation: "仅反映账面占比变动，尚未接入减值事件。",
    },
    {
      indicatorId: "R16",
      metricName: "ocf_short_debt_coverage",
      label: "经营现金流短债覆盖率",
      unit: "倍",
      direction: "lower-is-riskier",
      limitation: "当前为年度横截面，近 8 季度趋势待补。",
    },
    {
      indicatorId: "R18",
      metricName: "overseas_revenue_ratio_pct",
      label: "海外业务收入占比",
      unit: "%",
      direction: "higher-is-riskier",
      limitation: "收入暴露不等于实际损失，需与 R19 管制命中联合解释。",
    },
  ]

export interface IndustryRiskMetricScore {
  indicatorId: IndustryRiskIndicatorId
  metricName: string
  label: string
  unit: string
  rawValue: number | null
  riskPercentile: number | null
  riskScore: number | null
  sampleSize: number
  sourceId: string | null
  status: "scored" | "missing" | "not-score-ready"
  direction: IndustryRiskDirection
  formulaTrace: string
  limitation: string
}

export interface IndustryRiskCandidateAggregate {
  method: IndustryRiskWeightMethod
  score: number | null
  weights: Record<string, number>
  status: "partial-candidate" | "unavailable"
  note: string
}

export interface IndustryRiskCompanyAssessment {
  companyId: string
  companyName: string
  stockCode: string
  methodVersion: typeof INDUSTRY_RISK_MVP_METHOD_VERSION
  reportingPeriod: string
  sectorLabel: string
  industryRisk: number
  industryRiskStatus: "placeholder"
  metrics: IndustryRiskMetricScore[]
  candidateAggregates: IndustryRiskCandidateAggregate[]
  scoredIndicatorCount: number
  totalIndicatorCount: number
  isOfficialTotalScore: false
}

export interface FullIrawcScoreInput {
  historicalRiskDirectedValues: number[]
  relativeRiskPercentile: number
  beta?: number
}

export interface FullIrawcScoreResult {
  methodVersion: typeof INDUSTRY_RISK_FULL_METHOD_VERSION
  score: number | null
  historicalAnchor: number | null
  status: "scored" | "insufficient-history"
  formulaTrace: string
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value))
const round = (value: number, digits = 4) => Number(value.toFixed(digits))

function finiteValues(values: readonly number[]) {
  return values.filter(Number.isFinite)
}

/** Excel PERCENTRANK.INC-style rank with average ranks for ties. */
export function calculateRiskPercentile(
  value: number,
  sample: readonly number[],
  direction: IndustryRiskDirection
): number | null {
  if (!Number.isFinite(value)) return null
  const comparable = finiteValues(sample)
  if (comparable.length < 2) return null

  const toRiskDirection = (item: number) =>
    direction === "higher-is-riskier" ? item : -item
  const target = toRiskDirection(value)
  const sorted = comparable.map(toRiskDirection).sort((a, b) => a - b)
  const first = sorted.findIndex((item) => item === target)
  if (first === -1) return null
  const last = sorted.findLastIndex((item) => item === target)
  const averageZeroBasedRank = (first + last) / 2
  return round(averageZeroBasedRank / (sorted.length - 1))
}

export function calculateMvpRiskScore(
  riskPercentile: number,
  industryRisk = 0.5
) {
  return round(
    100 * (0.5 * clamp01(industryRisk) + 0.5 * clamp01(riskPercentile)),
    2
  )
}

function quantileType7(values: readonly number[], probability: number) {
  const sorted = finiteValues(values).sort((a, b) => a - b)
  if (sorted.length === 0) return null
  const position = (sorted.length - 1) * clamp01(probability)
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  if (lower === upper) return sorted[lower]
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower)
}

export function calculateHistoricalAnchor(
  historicalRiskDirectedValues: readonly number[]
) {
  const values = finiteValues(historicalRiskDirectedValues)
  if (values.length < 3) return null
  const lower = quantileType7(values, 0.05)
  const median = quantileType7(values, 0.5)
  const upper = quantileType7(values, 0.95)
  if (lower === null || median === null || upper === null || upper === lower) {
    return null
  }
  return round(clamp01((median - lower) / (upper - lower)))
}

export function calculateFullIrawcScore(
  input: FullIrawcScoreInput
): FullIrawcScoreResult {
  const anchor = calculateHistoricalAnchor(input.historicalRiskDirectedValues)
  const beta = input.beta ?? 0.4
  if (anchor === null) {
    return {
      methodVersion: INDUSTRY_RISK_FULL_METHOD_VERSION,
      score: null,
      historicalAnchor: null,
      status: "insufficient-history",
      formulaTrace: "历史样本不足，未计算 Ask，亦未补造风险分。",
    }
  }
  const percentile = clamp01(input.relativeRiskPercentile)
  const score = round(100 * clamp01(anchor + beta * (percentile - 0.5)), 2)
  return {
    methodVersion: INDUSTRY_RISK_FULL_METHOD_VERSION,
    score,
    historicalAnchor: anchor,
    status: "scored",
    formulaTrace: `100 × clamp(${anchor} + ${beta} × (${round(percentile)} - 0.5), 0, 1) = ${score}`,
  }
}

function mean(values: readonly number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function standardDeviation(values: readonly number[]) {
  const average = mean(values)
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2)))
}

function correlation(left: readonly number[], right: readonly number[]) {
  const leftMean = mean(left)
  const rightMean = mean(right)
  const numerator = left.reduce(
    (sum, value, index) =>
      sum + (value - leftMean) * (right[index] - rightMean),
    0
  )
  const denominator = Math.sqrt(
    left.reduce((sum, value) => sum + (value - leftMean) ** 2, 0) *
      right.reduce((sum, value) => sum + (value - rightMean) ** 2, 0)
  )
  return denominator === 0 ? 0 : numerator / denominator
}

function normalizeWeights(values: readonly number[]) {
  const total = values.reduce((sum, value) => sum + value, 0)
  if (total <= 0) return values.map(() => 1 / values.length)
  return values.map((value) => value / total)
}

export function calculateObjectiveWeights(
  matrix: readonly (readonly number[])[],
  method: IndustryRiskWeightMethod
) {
  if (matrix.length < 2 || matrix[0]?.length === 0) return []
  const width = matrix[0].length
  if (
    matrix.some(
      (row) =>
        row.length !== width || row.some((value) => !Number.isFinite(value))
    )
  ) {
    return []
  }
  const columns = Array.from({ length: width }, (_, column) =>
    matrix.map((row) => row[column])
  )

  if (method === "entropy") {
    const k = 1 / Math.log(matrix.length)
    const information = columns.map((column) => {
      const total = column.reduce((sum, value) => sum + Math.max(0, value), 0)
      const probabilities =
        total === 0
          ? column.map(() => 1 / column.length)
          : column.map((value) => Math.max(0, value) / total)
      const entropy =
        -k *
        probabilities.reduce(
          (sum, probability) =>
            probability === 0 ? sum : sum + probability * Math.log(probability),
          0
        )
      return Math.max(0, 1 - entropy)
    })
    return normalizeWeights(information).map((weight) => round(weight, 6))
  }

  const information = columns.map((column) => {
    const conflict = columns.reduce(
      (sum, other) => sum + (1 - correlation(column, other)),
      0
    )
    return standardDeviation(column) * conflict
  })
  return normalizeWeights(information).map((weight) => round(weight, 6))
}

function findMetricObservation(
  dataset: IndustryRiskDataset,
  companyId: string,
  metric: IndustryRiskMetricDefinition
) {
  return dataset.observations.find(
    (item) =>
      item.companyId === companyId &&
      item.indicatorId === metric.indicatorId &&
      item.metricName === metric.metricName
  )
}

function usableNumericValue(observation: IndustryRiskObservation | undefined) {
  return observation &&
    observation.numericValue !== null &&
    Number.isFinite(observation.numericValue)
    ? observation.numericValue
    : null
}

function scoreMetric(
  dataset: IndustryRiskDataset,
  companyId: string,
  metric: IndustryRiskMetricDefinition,
  industryRisk: number
): IndustryRiskMetricScore {
  const observation = findMetricObservation(dataset, companyId, metric)
  const value = usableNumericValue(observation)
  const scoreReady = dataset.metadata.scoreReadyIndicatorIds.includes(
    metric.indicatorId
  )
  const sample = dataset.companies
    .map((company) =>
      usableNumericValue(findMetricObservation(dataset, company.id, metric))
    )
    .filter((item): item is number => item !== null)
  const percentile =
    value === null || !scoreReady
      ? null
      : calculateRiskPercentile(value, sample, metric.direction)
  const riskScore =
    percentile === null ? null : calculateMvpRiskScore(percentile, industryRisk)
  const status = !scoreReady
    ? "not-score-ready"
    : riskScore === null
      ? "missing"
      : "scored"

  return {
    indicatorId: metric.indicatorId,
    metricName: metric.metricName,
    label: metric.label,
    unit: metric.unit,
    rawValue: value,
    riskPercentile: percentile,
    riskScore,
    sampleSize: sample.length,
    sourceId: observation?.sourceId ?? null,
    status,
    direction: metric.direction,
    formulaTrace:
      riskScore === null
        ? "数据或可比样本不足，未评分。"
        : `100 × (0.5 × ${round(industryRisk)} + 0.5 × ${percentile}) = ${riskScore}`,
    limitation: metric.limitation,
  }
}

function buildCandidateAggregates(
  assessments: readonly Omit<
    IndustryRiskCompanyAssessment,
    "candidateAggregates"
  >[],
  companyId: string
) {
  const matrix = assessments.map((assessment) =>
    assessment.metrics.map((metric) => metric.riskScore)
  )
  const complete = matrix.every((row) =>
    row.every((value): value is number => value !== null)
  )
  if (!complete) {
    return (["entropy", "critic"] as const).map((method) => ({
      method,
      score: null,
      weights: {},
      status: "unavailable" as const,
      note: "五项试验指标存在缺失，未做插值或补零。",
    }))
  }
  const numericMatrix = matrix as number[][]
  const targetIndex = assessments.findIndex(
    (assessment) => assessment.companyId === companyId
  )
  return (["entropy", "critic"] as const).map((method) => {
    const weights = calculateObjectiveWeights(numericMatrix, method)
    const weightMap = Object.fromEntries(
      INDUSTRY_RISK_PILOT_METRICS.map((metric, index) => [
        metric.indicatorId,
        weights[index],
      ])
    )
    const score = round(
      numericMatrix[targetIndex].reduce(
        (sum, value, index) => sum + value * weights[index],
        0
      ),
      2
    )
    return {
      method,
      score,
      weights: weightMap,
      status: "partial-candidate" as const,
      note: "仅由当前 5 项可评分指标形成候选基线，不是 R05–R22 官方总分。",
    }
  })
}

export function scoreIndustryRiskDataset(
  dataset: IndustryRiskDataset,
  industryRisk = 0.5
): IndustryRiskCompanyAssessment[] {
  const clampedIndustryRisk = clamp01(industryRisk)
  const withoutAggregates = dataset.companies.map((company) => {
    const metrics = INDUSTRY_RISK_PILOT_METRICS.map((metric) =>
      scoreMetric(dataset, company.id, metric, clampedIndustryRisk)
    )
    return {
      companyId: company.id,
      companyName: company.shortName,
      stockCode: company.stockCode,
      methodVersion: INDUSTRY_RISK_MVP_METHOD_VERSION,
      reportingPeriod: dataset.metadata.reportingPeriod,
      sectorLabel: dataset.metadata.sectorLabel,
      industryRisk: clampedIndustryRisk,
      industryRiskStatus: "placeholder" as const,
      metrics,
      scoredIndicatorCount: metrics.filter(
        (metric) => metric.status === "scored"
      ).length,
      totalIndicatorCount: dataset.indicators.length,
      isOfficialTotalScore: false as const,
    }
  })

  return withoutAggregates.map((assessment) => ({
    ...assessment,
    candidateAggregates: buildCandidateAggregates(
      withoutAggregates,
      assessment.companyId
    ),
  }))
}
