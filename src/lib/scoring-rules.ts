import {
  createNormalizationRuleKey,
  type NormalizationRuleRegistry,
} from "./risk-metrics.ts"
import type { IndicatorObservation } from "@/types/risk"

export type ScoringRuleUnit = "%" | "TRL级" | "次" | "个" | "月"

export interface IndicatorScoringRule {
  indicatorId: string
  version: string
  unit: ScoringRuleUnit
  valueLabel: string
  lowRiskDescription: string
  mediumRiskDescription: string
  highRiskDescription: string
  normalize: (value: number) => 25 | 60 | 85
  validate: (value: number) => string | null
}

function percentageValidator(min = 0, max = 100) {
  return (value: number) => {
    if (!Number.isFinite(value)) return "请输入有效数字。"
    if (value < min || value > max) {
      return `百分比须在 ${min}% 至 ${max}% 之间。`
    }
    return null
  }
}

function nonNegativeValidator(label: string) {
  return (value: number) => {
    if (!Number.isFinite(value)) return "请输入有效数字。"
    if (value < 0) return `${label}不能为负数。`
    return null
  }
}

function nonNegativeIntegerValidator(label: string) {
  return (value: number) => {
    const nonNegativeError = nonNegativeValidator(label)(value)
    if (nonNegativeError) return nonNegativeError
    return Number.isInteger(value) ? null : `${label}须为整数。`
  }
}

const rules: IndicatorScoringRule[] = [
  {
    indicatorId: "kci-004",
    version: "kci-004-v1",
    unit: "%",
    valueLabel: "概念相关业务营收占比",
    lowRiskDescription: ">30%",
    mediumRiskDescription: "10%–30%",
    highRiskDescription: "<10%",
    normalize: (value) => (value > 30 ? 25 : value >= 10 ? 60 : 85),
    validate: percentageValidator(),
  },
  {
    indicatorId: "kci-014",
    version: "kci-014-v1",
    unit: "次",
    valueLabel: "近三年监管处罚次数",
    lowRiskDescription: "0 次",
    mediumRiskDescription: "1–2 次",
    highRiskDescription: "≥3 次",
    normalize: (value) => (value === 0 ? 25 : value <= 2 ? 60 : 85),
    validate: nonNegativeIntegerValidator("处罚次数"),
  },
  {
    indicatorId: "kci-015",
    version: "kci-015-v1",
    unit: "次",
    valueLabel: "近三年交易所问询次数",
    lowRiskDescription: "0 次",
    mediumRiskDescription: "1–2 次",
    highRiskDescription: "≥3 次",
    normalize: (value) => (value === 0 ? 25 : value <= 2 ? 60 : 85),
    validate: nonNegativeIntegerValidator("问询次数"),
  },
  {
    indicatorId: "kci-024",
    version: "kci-024-v1",
    unit: "%",
    valueLabel: "已判决案件败诉率",
    lowRiskDescription: "<20%",
    mediumRiskDescription: "20%–50%",
    highRiskDescription: ">50%",
    normalize: (value) => (value < 20 ? 25 : value <= 50 ? 60 : 85),
    validate: percentageValidator(),
  },
  {
    indicatorId: "kci-026",
    version: "kci-026-v1",
    unit: "%",
    valueLabel: "经营性现金流同比变化",
    lowRiskDescription: ">10%",
    mediumRiskDescription: "-10%–10%",
    highRiskDescription: "<-10%",
    normalize: (value) => (value > 10 ? 25 : value >= -10 ? 60 : 85),
    validate: percentageValidator(-1000, 1000),
  },
  {
    indicatorId: "kci-028",
    version: "kci-028-v1",
    unit: "月",
    valueLabel: "现金储备消耗周期",
    lowRiskDescription: ">24 个月",
    mediumRiskDescription: "12–24 个月",
    highRiskDescription: "<12 个月",
    normalize: (value) => (value > 24 ? 25 : value >= 12 ? 60 : 85),
    validate: nonNegativeValidator("月数"),
  },
  {
    indicatorId: "kci-030",
    version: "kci-030-v1",
    unit: "%",
    valueLabel: "当前股价相对发行价",
    lowRiskDescription: ">120%",
    mediumRiskDescription: "100%–120%",
    highRiskDescription: "<100%",
    normalize: (value) => (value > 120 ? 25 : value >= 100 ? 60 : 85),
    validate: percentageValidator(0, 10000),
  },
  {
    indicatorId: "kci-035",
    version: "kci-035-v1",
    unit: "%",
    valueLabel: "前五大供应商采购占比",
    lowRiskDescription: "<30%",
    mediumRiskDescription: "30%–60%",
    highRiskDescription: ">60%",
    normalize: (value) => (value < 30 ? 25 : value <= 60 ? 60 : 85),
    validate: percentageValidator(),
  },
  {
    indicatorId: "kci-038",
    version: "kci-038-v1",
    unit: "%",
    valueLabel: "海外业务收入占比",
    lowRiskDescription: "<10%",
    mediumRiskDescription: "10%–40%",
    highRiskDescription: ">40%",
    normalize: (value) => (value < 10 ? 25 : value <= 40 ? 60 : 85),
    validate: percentageValidator(),
  },
  {
    indicatorId: "kci-039",
    version: "kci-039-v1",
    unit: "个",
    valueLabel: "公开制裁或限制清单命中数",
    lowRiskDescription: "0 个",
    mediumRiskDescription: "1 个",
    highRiskDescription: "≥2 个",
    normalize: (value) => (value === 0 ? 25 : value === 1 ? 60 : 85),
    validate: nonNegativeIntegerValidator("命中数"),
  },
]

export const scoringRuleRegistry = new Map(
  rules.map((rule) => [rule.indicatorId, rule])
)

export const normalizationRuleRegistry: NormalizationRuleRegistry =
  Object.fromEntries(
    rules.map((rule) => [
      createNormalizationRuleKey(rule.indicatorId, rule.version),
      (observation: IndicatorObservation) => {
        if (
          typeof observation.value !== "string" ||
          !observation.value.trim()
        ) {
          return null
        }
        const value = Number(observation.value)
        if (observation.unit !== rule.unit || rule.validate(value) !== null) {
          return null
        }
        return rule.normalize(value)
      },
    ])
  )

export function getScoringRule(indicatorId: string) {
  return scoringRuleRegistry.get(indicatorId) ?? null
}

export function previewObservationScore(indicatorId: string, rawValue: string) {
  const rule = getScoringRule(indicatorId)
  if (!rule) {
    return { score: null, error: "该指标尚未注册评分规则。" }
  }

  if (!rawValue.trim()) {
    return { score: null, error: "请填写观测值。" }
  }

  const value = Number(rawValue)
  const error = rule.validate(value)
  return {
    score: error ? null : rule.normalize(value),
    error,
  }
}
