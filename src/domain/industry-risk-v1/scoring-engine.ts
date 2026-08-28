import {
  resolveIndustryRiskBenchmarkGroup,
  resolveIndustryRiskBenchmarkGroupId,
} from "./benchmark-classification.ts"
import {
  INDUSTRY_RISK_INDICATOR_IDS,
  INDUSTRY_RISK_WEIGHTED_INDICATOR_IDS,
  type IndustryRiskDataset,
  type IndustryRiskIndicatorId,
  type IndustryRiskObservation,
} from "./model.ts"

export const INDUSTRY_RISK_MVP_METHOD_VERSION =
  "IRAWC-CRITIC-2026.08-v3" as const
export const INDUSTRY_RISK_FULL_METHOD_VERSION =
  "IRAWC-FULL-2026.08-v2" as const

export type IndustryRiskDirection = "higher-is-riskier" | "lower-is-riskier"
export type IndustryRiskWeightMethod = "entropy" | "critic"
export type IndustryRiskWeightedDimensionId =
  "technology" | "compliance" | "finance" | "external" | "personnel"

interface IndustryRiskMetricCandidate {
  metricName: string
  comparableGroup: string
}

export interface IndustryRiskMetricDefinition {
  indicatorId: IndustryRiskIndicatorId
  metricName: string
  metricCandidates: readonly IndustryRiskMetricCandidate[]
  label: string
  unit: string
  direction: IndustryRiskDirection
  limitation: string
  kind: "narrative" | "weighted"
  dimensionId: IndustryRiskWeightedDimensionId | null
  composite?: "sanctions-list-sum"
}

const metric = (
  indicatorId: IndustryRiskIndicatorId,
  label: string,
  unit: string,
  direction: IndustryRiskDirection,
  limitation: string,
  kind: IndustryRiskMetricDefinition["kind"],
  dimensionId: IndustryRiskWeightedDimensionId | null,
  candidates: readonly (readonly [string, string])[],
  composite?: IndustryRiskMetricDefinition["composite"]
): IndustryRiskMetricDefinition => ({
  indicatorId,
  metricName: candidates[0]?.[0] ?? indicatorId,
  metricCandidates: candidates.map(([metricName, comparableGroup]) => ({
    metricName,
    comparableGroup,
  })),
  label,
  unit,
  direction,
  limitation,
  kind,
  dimensionId,
  composite,
})

export const INDUSTRY_RISK_BENCHMARK_METRICS: readonly IndustryRiskMetricDefinition[] =
  [
    metric(
      "R01",
      "叙事热度基本面背离度",
      "条",
      "higher-is-riskier",
      "当前使用财经新闻检索量代理叙事热度，尚未扣除基本面增长差异。",
      "narrative",
      null,
      [["finance_news_retrieved_count_proxy", "finance-news-volume"]]
    ),
    metric(
      "R02",
      "第三方与自身表述偏差",
      "%",
      "higher-is-riskier",
      "当前以第三方负面新闻占比代理表述偏差，不能替代公告全文词频差。",
      "narrative",
      null,
      [["third_party_negative_news_share_pct_proxy", "negative-news-share"]]
    ),
    metric(
      "R03",
      "自身评价一致性/稳定性",
      "余弦相似度",
      "lower-is-riskier",
      "报告文本相似度为代理值；上市时间较短的企业可能缺少连续四季度。",
      "narrative",
      null,
      [["formal_report_narrative_similarity_proxy", "narrative-similarity"]]
    ),
    metric(
      "R04",
      "概念股标签关联度",
      "%",
      "higher-is-riskier",
      "当前以概念关键词新闻占比代理概念暴露，不是概念业务收入占比。",
      "narrative",
      null,
      [["concept_keyword_news_share_pct_proxy", "concept-news-share"]]
    ),
    metric(
      "R05",
      "技术先进性—专利质量",
      "项",
      "lower-is-riskier",
      "当前使用有效/授权/专利存量代理，尚缺专利族、去自引前向引用和IPC年份标准化。",
      "weighted",
      "technology",
      [
        ["cnipa_core_operating_entity_valid_count", "cnipa-valid-count"],
        ["cnipa_listed_entity_valid_count", "cnipa-valid-count"],
        ["patent_authorized_count_proxy", "authorized-patent-count"],
        ["patent_total_count_proxy", "patent-total-count"],
        ["tyc_paid_patent_total_asof", "tyc-patent-total"],
      ]
    ),
    metric(
      "R06",
      "核心技术人员占比",
      "%",
      "lower-is-riskier",
      "以研发人员占比作为核心技术人员占比的统一代理。",
      "weighted",
      "technology",
      [["rd_personnel_ratio_pct", "rd-personnel-ratio"]]
    ),
    metric(
      "R07",
      "研发投入强度与趋势",
      "%",
      "lower-is-riskier",
      "以最新研发投入强度做横截面基准，趋势信息作为后续解释。",
      "weighted",
      "technology",
      [["rd_intensity_pct", "rd-intensity"]]
    ),
    metric(
      "R08",
      "研发/募投里程碑兑现度",
      "次",
      "higher-is-riskier",
      "以延期、负面或变更事件数代理未兑现程度，未获得统一加权兑现率。",
      "weighted",
      "technology",
      [
        ["fundraising_project_delay_event_count", "milestone-delay-events"],
        ["rd_negative_milestone_event_count", "negative-milestone-events"],
        ["fundraising_project_change_event_count", "project-change-events"],
      ]
    ),
    metric(
      "R09",
      "重大技术与知识产权事件",
      "项",
      "higher-is-riskier",
      "不利状态和质量事件是事件数量代理，未建立损失、责任与时间系数。",
      "weighted",
      "technology",
      [
        ["tyc_paid_patent_page_adverse_status_count", "patent-adverse-sample"],
        [
          "cnipa_verified_adverse_patent_legal_event_count",
          "cnipa-adverse-events",
        ],
        ["technology_ip_quality_event_count", "technology-ip-events"],
        ["manufacturing_quality_inspection_event_count", "quality-events"],
      ]
    ),
    metric(
      "R10",
      "监管处罚次数",
      "条",
      "higher-is-riskier",
      "累计处罚代理不完全等同于单季度处罚次数。",
      "weighted",
      "compliance",
      [
        ["tyc_paid_admin_penalty_total_asof", "administrative-penalties"],
        [
          "securities_regulatory_penalty_or_measure_count_last5y",
          "securities-regulatory-measures",
        ],
        [
          "official_penalty_related_announcement_count",
          "official-penalty-events",
        ],
      ]
    ),
    metric(
      "R11",
      "交易所问询次数",
      "次",
      "higher-is-riskier",
      "按同口径报告期问询主题数进行行业内比较。",
      "weighted",
      "compliance",
      [
        ["exchange_inquiry_topic_count", "exchange-inquiry-count"],
        ["exchange_inquiry_topic_count_ytd", "exchange-inquiry-count-ytd"],
      ]
    ),
    metric(
      "R12",
      "诉讼风险",
      "件",
      "higher-is-riskier",
      "不同来源分别比较案件总数、被告判决或重大诉讼披露，未统一金额占营收口径。",
      "weighted",
      "compliance",
      [
        ["tyc_paid_lawsuit_total_asof", "tyc-lawsuit-count"],
        ["defendant_judgment_count", "defendant-judgment-count"],
        ["major_litigation_disclosure", "major-litigation-count"],
        [
          "litigation_arbitration_announcement_count",
          "litigation-announcement-count",
        ],
      ]
    ),
    metric(
      "R13",
      "营业收入增长率",
      "%",
      "lower-is-riskier",
      "使用最新可比报告期的营业收入同比增长率。",
      "weighted",
      "finance",
      [["revenue_growth_pct", "revenue-growth"]]
    ),
    metric(
      "R14",
      "无形资产减值风险",
      "%/百分点",
      "higher-is-riskier",
      "同口径比较无形资产占比变动或占比水平，不能替代正式减值测试。",
      "weighted",
      "finance",
      [
        ["intangible_assets_ratio_change_pp", "intangible-ratio-change"],
        ["intangible_assets_to_total_assets_pct", "intangible-assets-ratio"],
        ["intangible_assets_ratio_pct", "intangible-assets-ratio"],
      ]
    ),
    metric(
      "R15",
      "融资成本",
      "%/元",
      "higher-is-riskier",
      "债务成本率与利息支出分别在同口径样本内排名，未形成完整WACC。",
      "weighted",
      "finance",
      [
        ["debt_financing_cost_average_debt_proxy_pct", "average-debt-cost"],
        ["debt_financing_cost_ending_debt_proxy_pct", "ending-debt-cost"],
        ["interest_expense_yuan", "interest-expense"],
      ]
    ),
    metric(
      "R16",
      "经营现金流与短期偿债压力",
      "倍",
      "lower-is-riskier",
      "优先使用经营现金流短债覆盖率，缺失时使用现金短债比。",
      "weighted",
      "finance",
      [
        ["ocf_short_debt_coverage", "ocf-short-debt-coverage"],
        ["cash_short_debt_ratio", "cash-short-debt-ratio"],
      ]
    ),
    metric(
      "R17",
      "关键供应链进口依赖度",
      "家",
      "lower-is-riskier",
      "以已核验境内供应商数代理，样本较小且注册地不等于生产国。",
      "weighted",
      "external",
      [
        [
          "tyc_paid_supplier_domestic_profile_count",
          "domestic-supplier-profile-count",
        ],
      ]
    ),
    metric(
      "R18",
      "海外业务收入占比",
      "%",
      "higher-is-riskier",
      "海外收入暴露不等同于实际损失，需与管制命中联合解释。",
      "weighted",
      "external",
      [["overseas_revenue_ratio_pct", "overseas-revenue-ratio"]]
    ),
    metric(
      "R19",
      "出口管制与制裁暴露度",
      "类清单",
      "higher-is-riskier",
      "合并美国CSL与欧盟FSD精确命中数；尚缺BOM/ECCN影响比例和集团穿透。",
      "weighted",
      "external",
      [["export_control_list_hit_count", "export-control-list-hits"]],
      "sanctions-list-sum"
    ),
    metric(
      "R20",
      "控制权稀释与稳定性",
      "%",
      "lower-is-riskier",
      "以可获得的最大控制人持股比例代理，尚缺表决权协议和一致行动关系。",
      "weighted",
      "personnel",
      [["maximum_controller_ratio_pct", "controller-ratio"]]
    ),
    metric(
      "R21",
      "高管关联风险暴露度",
      "条",
      "higher-is-riskier",
      "以企业/境内主体风险聚合代理高管关联暴露，关联风险不等于人员本人违法。",
      "weighted",
      "personnel",
      [
        ["tyc_core_entity_enterprise_risk_total_asof", "enterprise-risk-total"],
        ["tyc_paid_enterprise_risk_total_asof", "enterprise-risk-total"],
      ]
    ),
    metric(
      "R22",
      "关键管理与技术人员稳定性",
      "人/事件",
      "higher-is-riskier",
      "以核心技术人员离职/变更事件数代理流失率，尚缺统一期初人数分母。",
      "weighted",
      "personnel",
      [
        ["core_tech_departure_event_count", "core-personnel-events"],
        [
          "core_tech_departure_event_count_annual_report",
          "core-personnel-events",
        ],
        [
          "core_tech_personnel_change_announcement_count",
          "core-personnel-events",
        ],
        [
          "core_tech_change_official_announcement_count",
          "core-personnel-events",
        ],
      ]
    ),
  ]

export const INDUSTRY_RISK_PILOT_METRICS =
  INDUSTRY_RISK_BENCHMARK_METRICS.filter((item) => item.kind === "weighted")

export const INDUSTRY_RISK_WEIGHTED_DIMENSIONS: readonly {
  id: IndustryRiskWeightedDimensionId
  label: string
  indicatorIds: readonly IndustryRiskIndicatorId[]
}[] = [
  {
    id: "technology",
    label: "技术风险",
    indicatorIds: ["R05", "R06", "R07", "R08", "R09"],
  },
  {
    id: "compliance",
    label: "合规风险",
    indicatorIds: ["R10", "R11", "R12"],
  },
  {
    id: "finance",
    label: "财务与融资风险",
    indicatorIds: ["R13", "R14", "R15", "R16"],
  },
  {
    id: "external",
    label: "外部风险",
    indicatorIds: ["R17", "R18", "R19"],
  },
  {
    id: "personnel",
    label: "人员风险",
    indicatorIds: ["R20", "R21", "R22"],
  },
]

export interface IndustryRiskMetricScore {
  indicatorId: IndustryRiskIndicatorId
  metricName: string
  comparableGroup: string
  label: string
  unit: string
  rawValue: number | null
  riskPercentile: number | null
  riskScore: number | null
  centeredRiskScore: number | null
  sampleSize: number
  sourceId: string | null
  sourceIds: string[]
  status: "scored" | "missing" | "not-score-ready"
  direction: IndustryRiskDirection
  kind: "narrative" | "weighted"
  dimensionId: IndustryRiskWeightedDimensionId | null
  formulaTrace: string
  limitation: string
  missingReason: string | null
}

export interface IndustryRiskCandidateAggregate {
  method: IndustryRiskWeightMethod
  score: number | null
  weights: Record<string, number>
  status: "usable-benchmark" | "partial-candidate" | "unavailable"
  note: string
}

export const INDUSTRY_FINANCIAL_NARRATIVE_METHOD_VERSION =
  "KCR-FINANCIAL-NARRATIVE-2026.08-v1" as const

export const INDUSTRY_FINANCIAL_NARRATIVE_DIMENSIONS = [
  {
    id: "management-tone",
    label: "管理层语调",
    description: "基于正式财报文本识别管理层表述语调及其异常变化。",
  },
  {
    id: "innovation-talk-action-gap",
    label: "创新“多言寡行”",
    description: "比较财报创新叙述与可核验创新产出之间的偏离程度。",
  },
  {
    id: "effective-information-uncertainty",
    label: "有效信息与不确定性",
    description: "衡量财报有效信息含量、不确定性表述及其期间变化。",
  },
] as const

export type IndustryFinancialNarrativeDimensionId =
  (typeof INDUSTRY_FINANCIAL_NARRATIVE_DIMENSIONS)[number]["id"]

export interface IndustryFinancialNarrativeDimensionAssessment {
  id: IndustryFinancialNarrativeDimensionId
  label: string
  description: string
  score: number | null
  status: "data-pending" | "assessable"
  missingReason: string | null
}

export interface IndustryFinancialReportNarrativeRisk {
  methodVersion: typeof INDUSTRY_FINANCIAL_NARRATIVE_METHOD_VERSION
  corpus: "annual-report"
  status: "data-pending" | "partially-assessable" | "assessed"
  score: number | null
  dimensions: IndustryFinancialNarrativeDimensionAssessment[]
  newsExcludedFromScore: true
  affectsObjectiveScore: false
  note: string
}

export interface IndustryRiskDimensionScore {
  id: IndustryRiskWeightedDimensionId
  label: string
  score: number | null
  weight: number
  availableIndicatorCount: number
  totalIndicatorCount: number
  indicatorIds: IndustryRiskIndicatorId[]
  indicatorWeights: Record<string, number>
  status: "scored" | "missing"
}

export interface IndustryRiskCompanyAssessment {
  companyId: string
  companyName: string
  stockCode: string
  peerGroupId: string
  benchmarkGroupId: string
  benchmarkGroupLabel: string
  benchmarkSampleSize: number
  methodVersion: typeof INDUSTRY_RISK_MVP_METHOD_VERSION
  reportingPeriod: string
  sectorLabel: string
  industryRisk: number
  industryRiskStatus: "fixed-anchor"
  alpha: number
  beta: number
  metrics: IndustryRiskMetricScore[]
  financialReportNarrativeRisk: IndustryFinancialReportNarrativeRisk
  dimensionScores: IndustryRiskDimensionScore[]
  totalRiskScore: number | null
  totalRiskStatus: "usable-benchmark" | "unavailable"
  weightedDataCoverage: number
  candidateAggregates: IndustryRiskCandidateAggregate[]
  scoredIndicatorCount: number
  weightedScoredIndicatorCount: number
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

interface ResolvedMetricValue {
  value: number
  metricName: string
  comparableGroup: string
  unit: string
  sourceId: string
  sourceIds: string[]
}

interface R17LowRiskFloorEvidence {
  sourceId: string
  sourceIds: string[]
  evidenceLabel: string
}

interface R17ConfirmedExposureEvidence {
  sourceId: string
  sourceIds: string[]
  evidenceLabel: string
}

interface IndustryRiskScoringOptions {
  industryRisk?: number
  alpha?: number
  beta?: number
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
  return round((first + last) / 2 / (sorted.length - 1))
}

export function calculateMvpRiskScore(
  riskPercentile: number,
  industryRisk = 0.5,
  alpha = 0.5,
  beta = 0.5
) {
  const total = alpha + beta
  const normalizedAlpha = total > 0 ? alpha / total : 0.5
  const normalizedBeta = total > 0 ? beta / total : 0.5
  return round(
    100 *
      clamp01(
        normalizedAlpha * clamp01(industryRisk) +
          normalizedBeta * clamp01(riskPercentile)
      ),
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
  const beta = clamp01(input.beta ?? 0.5)
  const alpha = 1 - beta
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
  const score = round(100 * clamp01(alpha * anchor + beta * percentile), 2)
  return {
    methodVersion: INDUSTRY_RISK_FULL_METHOD_VERSION,
    score,
    historicalAnchor: anchor,
    status: "scored",
    formulaTrace: `100 × (${round(alpha)} × ${anchor} + ${round(beta)} × ${round(percentile)}) = ${score}`,
  }
}

function mean(values: readonly number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function standardDeviation(values: readonly number[]) {
  if (values.length < 2) return 0
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

function normalizeWeights(
  values: readonly number[],
  active?: readonly boolean[]
) {
  const activeIndexes = values.flatMap((_, index) =>
    active && !active[index] ? [] : [index]
  )
  if (activeIndexes.length === 0) return values.map(() => 0)
  const total = activeIndexes.reduce(
    (sum, index) => sum + Math.max(0, values[index]),
    0
  )
  if (total <= 0) {
    const equal = 1 / activeIndexes.length
    return values.map((_, index) => (activeIndexes.includes(index) ? equal : 0))
  }
  return values.map((value, index) =>
    activeIndexes.includes(index) ? Math.max(0, value) / total : 0
  )
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
  return calculateObjectiveWeightsWithMissing(matrix, method)
}

export function calculateObjectiveWeightsWithMissing(
  matrix: readonly (readonly (number | null)[])[],
  method: IndustryRiskWeightMethod
) {
  if (matrix.length < 2 || matrix[0]?.length === 0) return []
  const width = matrix[0].length
  if (matrix.some((row) => row.length !== width)) return []
  const columns = Array.from({ length: width }, (_, column) =>
    matrix.map((row) => row[column])
  )
  const active = columns.map(
    (column) =>
      column.filter((value): value is number => value !== null).length >= 2
  )
  if (method === "entropy") {
    const information = columns.map((column, index) => {
      const values = column.filter(
        (value): value is number => value !== null && Number.isFinite(value)
      )
      if (!active[index]) return 0
      const epsilon = 1e-12
      const adjusted = values.map((value) => Math.max(0, value) + epsilon)
      const total = adjusted.reduce((sum, value) => sum + value, 0)
      const probabilities = adjusted.map((value) => value / total)
      const entropy =
        -(1 / Math.log(values.length)) *
        probabilities.reduce(
          (sum, probability) => sum + probability * Math.log(probability),
          0
        )
      return Math.max(0, 1 - entropy)
    })
    return normalizeWeights(information, active).map((weight) =>
      round(weight, 6)
    )
  }
  const information = columns.map((column, columnIndex) => {
    const values = column.filter(
      (value): value is number => value !== null && Number.isFinite(value)
    )
    if (!active[columnIndex]) return 0
    const conflict = columns.reduce((sum, other, otherIndex) => {
      if (otherIndex === columnIndex || !active[otherIndex]) return sum
      const left: number[] = []
      const right: number[] = []
      for (let row = 0; row < matrix.length; row += 1) {
        const leftValue = column[row]
        const rightValue = other[row]
        if (leftValue !== null && rightValue !== null) {
          left.push(leftValue)
          right.push(rightValue)
        }
      }
      const rho = left.length >= 2 ? correlation(left, right) : 0
      return sum + (1 - Math.abs(rho))
    }, 0)
    return standardDeviation(values) * conflict
  })
  return normalizeWeights(information, active).map((weight) => round(weight, 6))
}

function observationDate(observation: IndustryRiskObservation) {
  return (
    observation.asOfDate ??
    observation.periodEnd ??
    observation.periodStart ??
    ""
  )
}

function latestObservationForMetric(
  dataset: IndustryRiskDataset,
  companyId: string,
  metricName: string
) {
  return dataset.observations
    .filter(
      (item) =>
        item.companyId === companyId &&
        item.metricName === metricName &&
        item.numericValue !== null &&
        Number.isFinite(item.numericValue)
    )
    .sort(
      (left, right) =>
        observationDate(right).localeCompare(observationDate(left)) ||
        right.id.localeCompare(left.id)
    )[0]
}

function resolveMetricValue(
  dataset: IndustryRiskDataset,
  companyId: string,
  definition: IndustryRiskMetricDefinition
): ResolvedMetricValue | null {
  if (definition.composite === "sanctions-list-sum") {
    const observations = [
      latestObservationForMetric(
        dataset,
        companyId,
        "us_csl_distinct_list_hit_count"
      ),
      latestObservationForMetric(
        dataset,
        companyId,
        "eu_fsd_exact_name_hit_count"
      ),
    ].filter((item): item is IndustryRiskObservation => Boolean(item))
    if (observations.length === 0) return null
    return {
      value: observations.reduce(
        (sum, item) => sum + (item.numericValue ?? 0),
        0
      ),
      metricName: "export_control_list_hit_count",
      comparableGroup: "export-control-list-hits",
      unit: definition.unit,
      sourceId: observations[0].sourceId,
      sourceIds: [
        ...new Set(
          observations.flatMap((item) => item.sourceIds ?? [item.sourceId])
        ),
      ],
    }
  }
  for (const candidate of definition.metricCandidates) {
    const observation = latestObservationForMetric(
      dataset,
      companyId,
      candidate.metricName
    )
    if (!observation || observation.numericValue === null) continue
    return {
      value: observation.numericValue,
      metricName: candidate.metricName,
      comparableGroup: candidate.comparableGroup,
      unit: observation.unit ?? definition.unit,
      sourceId: observation.sourceId,
      sourceIds: observation.sourceIds ?? [observation.sourceId],
    }
  }
  return null
}

function resolveR17LowRiskFloorEvidence(
  dataset: IndustryRiskDataset,
  companyId: string
): R17LowRiskFloorEvidence | null {
  const zeroSupplierObservation = dataset.observations.find(
    (item) =>
      item.companyId === companyId &&
      item.indicatorId === "R17" &&
      item.numericValue === 0 &&
      item.confidence >= 0.75 &&
      [
        "tyc_paid_supplier_disclosed_count",
        "verified_external_supplier_count",
        "verified_overseas_supplier_count",
        "external_supplier_count",
        "overseas_supplier_count",
      ].includes(item.metricName)
  )
  if (zeroSupplierObservation) {
    return {
      sourceId: zeroSupplierObservation.sourceId,
      sourceIds:
        zeroSupplierObservation.sourceIds ?? [zeroSupplierObservation.sourceId],
      evidenceLabel: "结构化供应商检查明确返回零条记录",
    }
  }

  const zeroSupplierDisclosure = dataset.supplementaryObservations?.find(
    (item) =>
      item.companyId === companyId &&
      item.relatedIndicatorId === "R17" &&
      item.numericValue === 0 &&
      item.confidence >= 0.8 &&
      /供应商/.test(item.factName) &&
      /采购占比|集中度|外部|境外/.test(item.factName) &&
      item.sourceId !== null
  )
  if (!zeroSupplierDisclosure?.sourceId) return null
  return {
    sourceId: zeroSupplierDisclosure.sourceId,
    sourceIds: [zeroSupplierDisclosure.sourceId],
    evidenceLabel: `${zeroSupplierDisclosure.factName}明确披露为零`,
  }
}

function resolveR17ConfirmedExposureEvidence(
  dataset: IndustryRiskDataset,
  companyId: string
): R17ConfirmedExposureEvidence | null {
  const observation = dataset.observations
    .filter(
      (item) =>
        item.companyId === companyId &&
        item.indicatorId === "R17" &&
        item.metricName === "verified_external_procurement_disclosure" &&
        item.textValue !== null &&
        item.confidence >= 0.8
    )
    .sort((left, right) =>
      (right.asOfDate ?? right.periodEnd ?? "").localeCompare(
        left.asOfDate ?? left.periodEnd ?? ""
      )
    )[0]
  if (!observation) return null
  return {
    sourceId: observation.sourceId,
    sourceIds: observation.sourceIds ?? [observation.sourceId],
    evidenceLabel: observation.textValue ?? "官方材料确认存在境外采购暴露",
  }
}

function scoreMetric(
  dataset: IndustryRiskDataset,
  companyId: string,
  definition: IndustryRiskMetricDefinition,
  benchmarkCompanyIds: readonly string[],
  industryRisk: number,
  alpha: number,
  beta: number
): IndustryRiskMetricScore {
  const resolved = resolveMetricValue(dataset, companyId, definition)
  const r17ConfirmedExposure =
    definition.indicatorId === "R17" && resolved === null
      ? resolveR17ConfirmedExposureEvidence(dataset, companyId)
      : null
  const r17FloorEvidence =
    definition.indicatorId === "R17" &&
    resolved === null &&
    r17ConfirmedExposure === null
      ? resolveR17LowRiskFloorEvidence(dataset, companyId)
      : null
  if (r17FloorEvidence) {
    const riskPercentile = 0
    const riskScore = calculateMvpRiskScore(
      riskPercentile,
      industryRisk,
      alpha,
      beta
    )
    return {
      indicatorId: definition.indicatorId,
      metricName: "no_identified_external_supplier_floor",
      comparableGroup: "r17-no-external-supplier-floor",
      label: definition.label,
      unit: "家（代理）",
      rawValue: 0,
      riskPercentile,
      riskScore,
      centeredRiskScore: round(riskScore - 50, 2),
      sampleSize: 0,
      sourceId: r17FloorEvidence.sourceId,
      sourceIds: r17FloorEvidence.sourceIds,
      status: "scored",
      direction: definition.direction,
      kind: definition.kind,
      dimensionId: definition.dimensionId,
      formulaTrace: `${r17FloorEvidence.evidenceLabel}，启用低风险保底；r_rel=0；r=100×(${round(alpha)}×${round(industryRisk)}+${round(beta)}×0)=${riskScore}`,
      limitation: `${definition.limitation.replace(/。$/, "")}；保底分只适用于有明确零值证据的企业。未识别到供应商不等于证明实际进口依赖为零；后续出现境外采购证据时必须撤销并重算。`,
      missingReason: null,
    }
  }
  const sample = resolved
    ? benchmarkCompanyIds
        .map((peerId) => resolveMetricValue(dataset, peerId, definition))
        .filter(
          (item): item is ResolvedMetricValue =>
            item !== null && item.comparableGroup === resolved.comparableGroup
        )
        .map((item) => item.value)
    : []
  const isScoreReady = definition.kind === "weighted"
  const percentile =
    resolved && isScoreReady
      ? calculateRiskPercentile(resolved.value, sample, definition.direction)
      : null
  const riskScore =
    percentile === null
      ? null
      : calculateMvpRiskScore(percentile, industryRisk, alpha, beta)
  return {
    indicatorId: definition.indicatorId,
    metricName:
      resolved?.metricName ??
      (r17ConfirmedExposure
        ? "verified_external_procurement_disclosure"
        : definition.metricName),
    comparableGroup:
      resolved?.comparableGroup ??
      definition.metricCandidates[0]?.comparableGroup ??
      definition.indicatorId,
    label: definition.label,
    unit: resolved?.unit ?? definition.unit,
    rawValue: resolved?.value ?? null,
    riskPercentile: percentile,
    riskScore,
    centeredRiskScore: riskScore === null ? null : round(riskScore - 50, 2),
    sampleSize: sample.length,
    sourceId: resolved?.sourceId ?? r17ConfirmedExposure?.sourceId ?? null,
    sourceIds: resolved?.sourceIds ?? r17ConfirmedExposure?.sourceIds ?? [],
    status:
      definition.kind === "narrative"
        ? "not-score-ready"
        : riskScore === null
          ? "missing"
          : "scored",
    direction: definition.direction,
    kind: definition.kind,
    dimensionId: definition.dimensionId,
    formulaTrace:
      definition.kind === "narrative"
        ? resolved
          ? "已取得叙事观察代理值；依据当前会议结论，该值只用于可视化观察，不计算风险分位或 NRI。"
          : "当前没有叙事观察数据；不补零，也不生成叙事风险分。"
        : r17ConfirmedExposure
          ? "官方材料已确认存在境外采购暴露；因缺少境外采购金额与总采购金额，暂不生成正式同业分位和风险分。"
          : riskScore === null
          ? resolved
            ? `已取得原值，但同口径同业样本仅 ${sample.length} 家，无法形成风险分位。`
            : "当前企业缺少可用数值；不补零，其他指标仍参与基准计算。"
          : `r_rel=${round(percentile ?? 0)}；r=100×(${round(alpha)}×${round(industryRisk)}+${round(beta)}×${round(percentile ?? 0)})=${riskScore}`,
    limitation: r17ConfirmedExposure
      ? `${definition.limitation.replace(/。$/, "")}；已确认存在境外采购暴露；取得金额分子与分母前不进入正式评分。`
      : definition.limitation,
    missingReason:
      definition.kind === "narrative"
        ? "新闻与旧叙事代理不进入财报叙事评分。"
        : r17ConfirmedExposure
          ? "已确认境外采购暴露，但缺少境外采购金额与总采购金额，暂不能计算进口依赖度。"
          : riskScore === null
          ? resolved
            ? `同口径同业样本仅 ${sample.length} 家，暂不能形成风险分位。`
            : "当前企业缺少可用数值。"
          : null,
  }
}

function weightedAverage(
  metrics: readonly IndustryRiskMetricScore[],
  weights: readonly number[]
) {
  const scored = metrics.flatMap((item, index) =>
    item.riskScore === null
      ? []
      : [{ score: item.riskScore / 100, weight: weights[index] ?? 0 }]
  )
  if (!scored.length) return null
  const weighted = scored.filter((item) => item.weight > 0)
  const weightTotal = weighted.reduce((sum, item) => sum + item.weight, 0)
  if (weightTotal <= 0) {
    return round(100 * mean(scored.map((item) => item.score)), 2)
  }
  return round(
    100 *
      (weighted.reduce((sum, item) => sum + item.score * item.weight, 0) /
        weightTotal),
    2
  )
}

function financialReportNarrativeRisk(): IndustryFinancialReportNarrativeRisk {
  return {
    methodVersion: INDUSTRY_FINANCIAL_NARRATIVE_METHOD_VERSION,
    corpus: "annual-report",
    status: "data-pending",
    score: null,
    dimensions: INDUSTRY_FINANCIAL_NARRATIVE_DIMENSIONS.map((dimension) => ({
      ...dimension,
      score: null,
      status: "data-pending",
      missingReason: "当前企业财报语料与计算结果尚未接入。",
    })),
    newsExcludedFromScore: true,
    affectsObjectiveScore: false,
    note: "财报叙事按管理层语调、创新“多言寡行”、有效信息与不确定性三维度独立评估；新闻资讯不进入该评分，也不影响 R05–R22 客观风险总分。",
  }
}

function buildMethodResults(
  assessments: readonly {
    companyId: string
    metrics: IndustryRiskMetricScore[]
  }[],
  method: IndustryRiskWeightMethod
) {
  const weightedDefinitions = INDUSTRY_RISK_BENCHMARK_METRICS.filter(
    (item) => item.kind === "weighted"
  )
  const metricMatrix = assessments.map((assessment) =>
    weightedDefinitions.map((definition) => {
      const score = assessment.metrics.find(
        (item) => item.indicatorId === definition.indicatorId
      )?.riskScore
      return score === null || score === undefined ? null : score / 100
    })
  )
  const indicatorWeights = calculateObjectiveWeightsWithMissing(
    metricMatrix,
    method
  )
  const dimensionScoresByCompany = assessments.map((assessment) =>
    INDUSTRY_RISK_WEIGHTED_DIMENSIONS.map((dimension) => {
      const metrics = dimension.indicatorIds.map((indicatorId) =>
        assessment.metrics.find((item) => item.indicatorId === indicatorId)!
      )
      const weights = dimension.indicatorIds.map((indicatorId) => {
        const index = weightedDefinitions.findIndex(
          (item) => item.indicatorId === indicatorId
        )
        return indicatorWeights[index] ?? 0
      })
      return weightedAverage(metrics, weights)
    })
  )
  const dimensionWeights = calculateObjectiveWeightsWithMissing(
    dimensionScoresByCompany.map((row) =>
      row.map((score) => (score === null ? null : score / 100))
    ),
    method
  )
  const totalScores = dimensionScoresByCompany.map((scores) => {
    const scored = scores.flatMap((score, index) =>
      score === null ? [] : [{ score, weight: dimensionWeights[index] ?? 0 }]
    )
    if (!scored.length) return null
    const weighted = scored.filter((item) => item.weight > 0)
    const totalWeight = weighted.reduce((sum, item) => sum + item.weight, 0)
    return totalWeight <= 0
      ? round(mean(scored.map((item) => item.score)), 2)
      : round(
          weighted.reduce((sum, item) => sum + item.score * item.weight, 0) /
            totalWeight,
          2
        )
  })
  return {
    weightedDefinitions,
    indicatorWeights,
    dimensionScoresByCompany,
    dimensionWeights,
    totalScores,
  }
}

export function scoreIndustryRiskDataset(
  dataset: IndustryRiskDataset,
  options: IndustryRiskScoringOptions | number = {}
): IndustryRiskCompanyAssessment[] {
  const normalizedOptions =
    typeof options === "number" ? { industryRisk: options } : options
  const industryRisk = clamp01(normalizedOptions.industryRisk ?? 0.5)
  const suppliedAlpha = Math.max(0, normalizedOptions.alpha ?? 0.5)
  const suppliedBeta = Math.max(0, normalizedOptions.beta ?? 0.5)
  const coefficientTotal = suppliedAlpha + suppliedBeta
  const alpha = coefficientTotal > 0 ? suppliedAlpha / coefficientTotal : 0.5
  const beta = coefficientTotal > 0 ? suppliedBeta / coefficientTotal : 0.5
  const companiesByBenchmark = new Map<string, string[]>()
  for (const company of dataset.companies) {
    const groupId = resolveIndustryRiskBenchmarkGroupId(company)
    companiesByBenchmark.set(groupId, [
      ...(companiesByBenchmark.get(groupId) ?? []),
      company.id,
    ])
  }
  const baseAssessments = dataset.companies.map((company) => {
    const peerGroup = dataset.metadata.peerGroups?.find(
      (item) => item.id === company.peerGroupId
    )
    const benchmark = resolveIndustryRiskBenchmarkGroup(company)
    const benchmarkCompanyIds = companiesByBenchmark.get(benchmark.id) ?? [
      company.id,
    ]
    const metrics = INDUSTRY_RISK_BENCHMARK_METRICS.map((definition) =>
      scoreMetric(
        dataset,
        company.id,
        definition,
        benchmarkCompanyIds,
        industryRisk,
        alpha,
        beta
      )
    )
    const weightedScoredIndicatorCount = metrics.filter(
      (item) => item.kind === "weighted" && item.riskScore !== null
    ).length
    return {
      companyId: company.id,
      companyName: company.shortName,
      stockCode: company.stockCode,
      peerGroupId: company.peerGroupId ?? "default",
      benchmarkGroupId: benchmark.id,
      benchmarkGroupLabel: benchmark.label,
      benchmarkSampleSize: benchmarkCompanyIds.length,
      methodVersion: INDUSTRY_RISK_MVP_METHOD_VERSION,
      reportingPeriod:
        peerGroup?.reportingPeriod ?? dataset.metadata.reportingPeriod,
      sectorLabel: benchmark.label,
      industryRisk,
      industryRiskStatus: "fixed-anchor" as const,
      alpha: round(alpha),
      beta: round(beta),
      metrics,
      financialReportNarrativeRisk: financialReportNarrativeRisk(),
      scoredIndicatorCount: metrics.filter((item) => item.riskScore !== null)
        .length,
      weightedScoredIndicatorCount,
      totalIndicatorCount: INDUSTRY_RISK_INDICATOR_IDS.length,
      weightedDataCoverage: round(
        weightedScoredIndicatorCount /
          INDUSTRY_RISK_WEIGHTED_INDICATOR_IDS.length,
        4
      ),
      isOfficialTotalScore: false as const,
    }
  })
  const resultByCompany = new Map<string, IndustryRiskCompanyAssessment>()
  for (const [benchmarkGroupId, companyIds] of companiesByBenchmark) {
    const groupAssessments = companyIds.map((companyId) =>
      baseAssessments.find((item) => item.companyId === companyId)!
    )
    const methodResults = Object.fromEntries(
      (["critic", "entropy"] as const).map((method) => [
        method,
        buildMethodResults(groupAssessments, method),
      ])
    ) as Record<IndustryRiskWeightMethod, ReturnType<typeof buildMethodResults>>
    groupAssessments.forEach((assessment, companyIndex) => {
      const critic = methodResults.critic
      const dimensionScores: IndustryRiskDimensionScore[] =
        INDUSTRY_RISK_WEIGHTED_DIMENSIONS.map((dimension, dimensionIndex) => {
          const score =
            critic.dimensionScoresByCompany[companyIndex][dimensionIndex]
          const availableIndicatorIds = dimension.indicatorIds.filter(
            (indicatorId) =>
              assessment.metrics.find(
                (item) => item.indicatorId === indicatorId
              )?.riskScore !== null
          )
          return {
            id: dimension.id,
            label: dimension.label,
            score,
            weight: critic.dimensionWeights[dimensionIndex] ?? 0,
            availableIndicatorCount: availableIndicatorIds.length,
            totalIndicatorCount: dimension.indicatorIds.length,
            indicatorIds: [...availableIndicatorIds],
            indicatorWeights: Object.fromEntries(
              dimension.indicatorIds.map((indicatorId) => {
                const index = critic.weightedDefinitions.findIndex(
                  (item) => item.indicatorId === indicatorId
                )
                return [indicatorId, critic.indicatorWeights[index] ?? 0]
              })
            ),
            status: score === null ? "missing" : "scored",
          }
        })
      const candidateAggregates = (["critic", "entropy"] as const).map(
        (method): IndustryRiskCandidateAggregate => {
          const result = methodResults[method]
          const score = result.totalScores[companyIndex]
          return {
            method,
            score,
            weights: Object.fromEntries(
              INDUSTRY_RISK_WEIGHTED_DIMENSIONS.map((dimension, index) => [
                dimension.id,
                result.dimensionWeights[index] ?? 0,
              ])
            ),
            status:
              score === null
                ? "unavailable"
                : method === "critic"
                  ? "usable-benchmark"
                  : "partial-candidate",
            note:
              score === null
                ? "当前企业没有可形成维度分的数值观测。"
                : `${method === "critic" ? "CRITIC可用基准" : "稳健性对照"}：按现有 ${assessment.weightedScoredIndicatorCount}/18 项加权指标计算，缺失不补零，权重在可用指标和维度内重新归一化。${assessment.benchmarkSampleSize < 5 ? ` 当前行业样本仅${assessment.benchmarkSampleSize}家，结果只宜作方向性参考。` : ""}`,
          }
        }
      )
      const totalRiskScore = critic.totalScores[companyIndex]
      resultByCompany.set(assessment.companyId, {
        ...assessment,
        benchmarkGroupId,
        dimensionScores,
        totalRiskScore,
        totalRiskStatus:
          totalRiskScore === null ? "unavailable" : "usable-benchmark",
        candidateAggregates,
      })
    })
  }
  return dataset.companies.map((company) => resultByCompany.get(company.id)!)
}
