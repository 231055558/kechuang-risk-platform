import type {
  IndustryRiskDataset,
  IndustryRiskIndicatorId,
  IndustryRiskObservation,
} from "./model.ts"

export const INDUSTRY_RISK_MVP_METHOD_VERSION =
  "IRAWC-MISSING-AWARE-2026.08-v3" as const
export const INDUSTRY_RISK_MINIMUM_COMPARABLE_SAMPLE_SIZE = 2

export type IndustryRiskDirection = "higher-is-riskier" | "lower-is-riskier"
export type IndustryRiskMetricBasis =
  | "source-formula"
  | "partial-proxy"
  | "unavailable"

export interface IndustryRiskMetricDefinition {
  indicatorId: IndustryRiskIndicatorId
  metricName: string | null
  label: string
  unit: string
  direction: IndustryRiskDirection
  basis: IndustryRiskMetricBasis
  limitation: string
}

/**
 * R05–R22 are the weighted indicators supplied by Mao's dataset. Each entry
 * selects the closest numeric observation currently present in that dataset.
 * A null metricName means that the agreed indicator remains visible, but the
 * source data still cannot support a numeric score.
 */
export const INDUSTRY_RISK_SCORING_METRICS: readonly IndustryRiskMetricDefinition[] =
  [
    {
      indicatorId: "R05",
      metricName: "patent_authorized_count_proxy",
      label: "技术先进性—专利质量",
      unit: "项",
      direction: "lower-is-riskier",
      basis: "partial-proxy",
      limitation: "现有值是授权专利数量代理，不是原公式要求的去自引前向被引质量指数。",
    },
    {
      indicatorId: "R06",
      metricName: "rd_personnel_ratio_pct",
      label: "核心技术人员占比",
      unit: "%",
      direction: "lower-is-riskier",
      basis: "source-formula",
      limitation: "当前按最近一期横截面比较，尚未计算原定义要求的近三年趋势。",
    },
    {
      indicatorId: "R07",
      metricName: "rd_intensity_pct",
      label: "研发投入强度与趋势",
      unit: "%",
      direction: "lower-is-riskier",
      basis: "source-formula",
      limitation: "当前使用最近一期研发强度；高投入但里程碑未兑现需与 R08 联合解释。",
    },
    {
      indicatorId: "R08",
      metricName: "fundraising_project_delay_event_count",
      label: "研发/募投里程碑兑现度",
      unit: "个事件",
      direction: "higher-is-riskier",
      basis: "partial-proxy",
      limitation: "现有值是公开披露的延期事件数，不是原公式的加权到期里程碑兑现率。",
    },
    {
      indicatorId: "R09",
      metricName: null,
      label: "重大技术与知识产权事件",
      unit: "—",
      direction: "higher-is-riskier",
      basis: "unavailable",
      limitation: "当前没有可按严重度、责任和时间系数统一计算的数值观测。",
    },
    {
      indicatorId: "R10",
      metricName: "tyc_visible_admin_penalty_total_asof",
      label: "监管处罚次数",
      unit: "条",
      direction: "higher-is-riskier",
      basis: "partial-proxy",
      limitation: "现有值是许可渠道的可见累计数，不等于原公式的一季度统一口径处罚次数。",
    },
    {
      indicatorId: "R11",
      metricName: "exchange_inquiry_topic_count",
      label: "交易所问询次数",
      unit: "个主题",
      direction: "higher-is-riskier",
      basis: "source-formula",
      limitation: "按公开材料主题去重；关注函只作证据，不与问询函混计。",
    },
    {
      indicatorId: "R12",
      metricName: "major_litigation_disclosure",
      label: "诉讼风险",
      unit: "件",
      direction: "higher-is-riskier",
      basis: "partial-proxy",
      limitation: "当前使用重大诉讼披露件数，尚未完整合并被告案件数与涉诉金额占营收比例。",
    },
    {
      indicatorId: "R13",
      metricName: "revenue_growth_pct",
      label: "营业收入增长率",
      unit: "%",
      direction: "lower-is-riskier",
      basis: "source-formula",
      limitation: "当前按最近一期同比横截面比较，持续负增长和增速骤降仍需趋势数据。",
    },
    {
      indicatorId: "R14",
      metricName: "intangible_assets_ratio_change_pp",
      label: "无形资产减值风险",
      unit: "百分点",
      direction: "higher-is-riskier",
      basis: "source-formula",
      limitation: "反映无形资产占比变动，不代表已发生减值损失。",
    },
    {
      indicatorId: "R15",
      metricName: "debt_financing_cost_ending_debt_proxy_pct",
      label: "融资成本",
      unit: "%",
      direction: "higher-is-riskier",
      basis: "partial-proxy",
      limitation: "以期末债务估算债务融资成本，不是平均有息负债口径，也不是完整 WACC。",
    },
    {
      indicatorId: "R16",
      metricName: "ocf_short_debt_coverage",
      label: "经营现金流与短期偿债压力",
      unit: "倍",
      direction: "lower-is-riskier",
      basis: "source-formula",
      limitation: "当前使用最近一期经营现金流覆盖率，尚未接入近八季度趋势。",
    },
    {
      indicatorId: "R17",
      metricName: null,
      label: "关键供应链进口依赖度",
      unit: "—",
      direction: "higher-is-riskier",
      basis: "unavailable",
      limitation: "深搜版补充了叙事线索，但没有形成境外采购金额占比的统一数值。",
    },
    {
      indicatorId: "R18",
      metricName: "overseas_revenue_ratio_pct",
      label: "海外业务收入占比",
      unit: "%",
      direction: "higher-is-riskier",
      basis: "source-formula",
      limitation: "收入暴露不等于实际损失，应与 R19 管制清单命中联合解释。",
    },
    {
      indicatorId: "R19",
      metricName: "us_csl_distinct_list_hit_count",
      label: "出口管制与制裁暴露度",
      unit: "类清单",
      direction: "higher-is-riskier",
      basis: "partial-proxy",
      limitation: "当前覆盖美国综合筛查清单命中，不等于原定义要求的全球清单与受管制技术影响度。",
    },
    {
      indicatorId: "R20",
      metricName: null,
      label: "控制权稀释与稳定性",
      unit: "—",
      direction: "higher-is-riskier",
      basis: "unavailable",
      limitation: "当前没有统一的创始人或实控人持股数值观测。",
    },
    {
      indicatorId: "R21",
      metricName: null,
      label: "高管关联风险暴露度",
      unit: "—",
      direction: "higher-is-riskier",
      basis: "unavailable",
      limitation: "当前没有可统一计算高管本人及其关联实体风险事件的数值观测。",
    },
    {
      indicatorId: "R22",
      metricName: "core_tech_departure_event_count",
      label: "关键管理与技术人员稳定性",
      unit: "人/事件",
      direction: "higher-is-riskier",
      basis: "partial-proxy",
      limitation: "以公开披露的核心技术人员离职事件计数，尚未除以期初核心人员总数；未披露也不等同于零流失。",
    },
  ]

// Kept as an alias for callers that imported the earlier name.
export const INDUSTRY_RISK_PILOT_METRICS = INDUSTRY_RISK_SCORING_METRICS

export interface IndustryRiskMetricScore {
  indicatorId: IndustryRiskIndicatorId
  metricName: string | null
  label: string
  unit: string
  rawValue: number | null
  riskPercentile: number | null
  riskScore: number | null
  sampleSize: number
  sourceId: string | null
  asOfDate: string | null
  coverageStatus: string
  sourceMarkedUsableForScoring: boolean
  status: "scored" | "missing" | "insufficient-sample" | "unavailable"
  direction: IndustryRiskDirection
  basis: IndustryRiskMetricBasis
  formulaTrace: string
  limitation: string
}

export interface IndustryRiskCandidateAggregate {
  method: "available-equal"
  score: number | null
  weights: Record<string, number>
  availableIndicatorCount: number
  totalIndicatorCount: number
  coverageRate: number
  status: "partial-candidate" | "unavailable"
  note: string
}

export interface IndustryRiskMetricReadiness {
  indicatorId: IndustryRiskIndicatorId
  metricName: string | null
  sampleSize: number
  minimumSampleSize: number
  scoreReady: boolean
  basis: IndustryRiskMetricBasis
}

export interface IndustryRiskCompanyAssessment {
  companyId: string
  companyName: string
  stockCode: string
  methodVersion: typeof INDUSTRY_RISK_MVP_METHOD_VERSION
  reportingPeriod: string
  sectorLabel: string
  metrics: IndustryRiskMetricScore[]
  candidateAggregate: IndustryRiskCandidateAggregate
  scoredIndicatorCount: number
  totalIndicatorCount: number
  narrativeIndicatorCount: number
  isOfficialTotalScore: false
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value))
const round = (value: number, digits = 4) => Number(value.toFixed(digits))

/** Excel PERCENTRANK.INC-style rank with average ranks for ties. */
export function calculateRiskPercentile(
  value: number,
  sample: readonly number[],
  direction: IndustryRiskDirection
): number | null {
  if (!Number.isFinite(value)) return null
  const comparable = sample.filter(Number.isFinite)
  if (comparable.length < INDUSTRY_RISK_MINIMUM_COMPARABLE_SAMPLE_SIZE)
    return null

  const toRiskDirection = (item: number) =>
    direction === "higher-is-riskier" ? item : -item
  const target = toRiskDirection(value)
  const sorted = comparable.map(toRiskDirection).sort((a, b) => a - b)
  const first = sorted.findIndex((item) => item === target)
  if (first === -1) return null
  const last = sorted.findLastIndex((item) => item === target)
  return round(((first + last) / 2) / (sorted.length - 1))
}

function observationDate(observation: IndustryRiskObservation) {
  return observation.asOfDate ?? observation.periodEnd ?? observation.periodStart ?? ""
}

function compareObservationRecency(
  left: IndustryRiskObservation,
  right: IndustryRiskObservation
) {
  const dateOrder = observationDate(left).localeCompare(observationDate(right))
  if (dateOrder !== 0) return dateOrder
  return left.id.localeCompare(right.id, undefined, { numeric: true })
}

export function findLatestMetricObservation(
  dataset: IndustryRiskDataset,
  companyId: string,
  metric: IndustryRiskMetricDefinition
) {
  if (metric.metricName === null) return undefined
  return dataset.observations
    .filter(
      (item) =>
        item.companyId === companyId &&
        item.indicatorId === metric.indicatorId &&
        item.metricName === metric.metricName
    )
    .reduce<IndustryRiskObservation | undefined>(
      (latest, item) =>
        !latest || compareObservationRecency(item, latest) > 0 ? item : latest,
      undefined
    )
}

function coverageForMetric(
  dataset: IndustryRiskDataset,
  companyId: string,
  indicatorId: IndustryRiskIndicatorId
) {
  return dataset.coverage.find(
    (item) => item.companyId === companyId && item.indicatorId === indicatorId
  )
}

function numericValue(observation: IndustryRiskObservation | undefined) {
  return observation?.numericValue !== null &&
    observation?.numericValue !== undefined &&
    Number.isFinite(observation.numericValue)
    ? observation.numericValue
    : null
}

function buildMetricSample(
  dataset: IndustryRiskDataset,
  metric: IndustryRiskMetricDefinition
) {
  if (metric.metricName === null) return []
  return dataset.companies.flatMap((company) => {
    const observation = findLatestMetricObservation(dataset, company.id, metric)
    const value = numericValue(observation)
    return value === null ? [] : [{ companyId: company.id, observation, value }]
  })
}

export function getIndustryRiskPilotMetricReadiness(
  dataset: IndustryRiskDataset
): IndustryRiskMetricReadiness[] {
  return INDUSTRY_RISK_SCORING_METRICS.map((metric) => {
    const sampleSize = buildMetricSample(dataset, metric).length
    return {
      indicatorId: metric.indicatorId,
      metricName: metric.metricName,
      sampleSize,
      minimumSampleSize: INDUSTRY_RISK_MINIMUM_COMPARABLE_SAMPLE_SIZE,
      scoreReady:
        metric.metricName !== null &&
        sampleSize >= INDUSTRY_RISK_MINIMUM_COMPARABLE_SAMPLE_SIZE,
      basis: metric.basis,
    }
  })
}

function scoreMetric(
  dataset: IndustryRiskDataset,
  companyId: string,
  metric: IndustryRiskMetricDefinition
): IndustryRiskMetricScore {
  const observation = findLatestMetricObservation(dataset, companyId, metric)
  const value = numericValue(observation)
  const coverage = coverageForMetric(dataset, companyId, metric.indicatorId)
  const sample = buildMetricSample(dataset, metric)
  const scoreReady =
    metric.metricName !== null &&
    sample.length >= INDUSTRY_RISK_MINIMUM_COMPARABLE_SAMPLE_SIZE
  const percentile =
    value === null || !scoreReady
      ? null
      : calculateRiskPercentile(
          value,
          sample.map((item) => item.value),
          metric.direction
        )
  const riskScore = percentile === null ? null : round(100 * clamp01(percentile), 2)
  const status =
    metric.metricName === null
      ? "unavailable"
      : !scoreReady
        ? "insufficient-sample"
        : value === null
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
    asOfDate: observation?.asOfDate ?? observation?.periodEnd ?? null,
    coverageStatus: coverage?.status ?? "未登记",
    sourceMarkedUsableForScoring: coverage?.usableForScoring === true,
    status,
    direction: metric.direction,
    basis: metric.basis,
    formulaTrace:
      status === "unavailable"
        ? "原指标保留，当前没有可用数值，不进入综合分。"
        : status === "insufficient-sample"
          ? `可比样本 ${sample.length} 家，少于最低 ${INDUSTRY_RISK_MINIMUM_COMPARABLE_SAMPLE_SIZE} 家，不评分。`
          : status === "missing"
            ? "该企业缺少此项观测；不补零，并从综合分分母中跳过。"
            : `同业风险分位 ${percentile} × 100 = ${riskScore}`,
    limitation: metric.limitation,
  }
}

function buildCandidateAggregate(
  metrics: readonly IndustryRiskMetricScore[]
): IndustryRiskCandidateAggregate {
  const available = metrics.filter(
    (metric): metric is IndustryRiskMetricScore & { riskScore: number } =>
      metric.status === "scored" && metric.riskScore !== null
  )
  const totalIndicatorCount = INDUSTRY_RISK_SCORING_METRICS.length
  const availableIndicatorCount = available.length
  const coverageRate = round(availableIndicatorCount / totalIndicatorCount)
  if (availableIndicatorCount === 0) {
    return {
      method: "available-equal",
      score: null,
      weights: {},
      availableIndicatorCount,
      totalIndicatorCount,
      coverageRate,
      status: "unavailable",
      note: "当前企业没有可评分数值，未生成候选综合分。",
    }
  }
  const weight = 1 / availableIndicatorCount
  const weights = Object.fromEntries(
    available.map((metric) => [metric.indicatorId, round(weight, 6)])
  )
  const score = round(
    available.reduce((sum, metric) => sum + metric.riskScore * weight, 0),
    2
  )
  return {
    method: "available-equal",
    score,
    weights,
    availableIndicatorCount,
    totalIndicatorCount,
    coverageRate,
    status: "partial-candidate",
    note: `使用 ${availableIndicatorCount}/${totalIndicatorCount} 项现有指标等权平均；缺失项未补零、未插值。该结果是 MVP 候选基线，不是正式评级。`,
  }
}

export function scoreIndustryRiskDataset(
  dataset: IndustryRiskDataset
): IndustryRiskCompanyAssessment[] {
  return dataset.companies.map((company) => {
    const metrics = INDUSTRY_RISK_SCORING_METRICS.map((metric) =>
      scoreMetric(dataset, company.id, metric)
    )
    return {
      companyId: company.id,
      companyName: company.shortName,
      stockCode: company.stockCode,
      methodVersion: INDUSTRY_RISK_MVP_METHOD_VERSION,
      reportingPeriod: dataset.metadata.reportingPeriod,
      sectorLabel: dataset.metadata.sectorLabel,
      metrics,
      candidateAggregate: buildCandidateAggregate(metrics),
      scoredIndicatorCount: metrics.filter((metric) => metric.status === "scored")
        .length,
      totalIndicatorCount: INDUSTRY_RISK_SCORING_METRICS.length,
      narrativeIndicatorCount: dataset.indicators.filter(
        (indicator) => indicator.kind === "narrative-validation"
      ).length,
      isOfficialTotalScore: false as const,
    }
  })
}
