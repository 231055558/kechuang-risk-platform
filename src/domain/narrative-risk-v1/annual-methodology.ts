export const REVISED_NARRATIVE_METHOD_VERSION =
  "narrative-method-revised-2026-08-26-v1" as const

const EPSILON = 1e-6

export function clamp(value: number, lower = 0, upper = 1) {
  return Math.min(upper, Math.max(lower, value))
}

export function normalizeInformationSufficiency(value: number) {
  return clamp((value - 0.5) / 0.5)
}

export function calculateDisclosureQuality(
  informationSufficiency: number,
  riskContextAmbiguity: number,
  dataSupportRatio: number
) {
  return (
    (normalizeInformationSufficiency(informationSufficiency) +
      (1 - clamp(riskContextAmbiguity)) +
      clamp(dataSupportRatio)) /
    3
  )
}

export function calculateAnnualChange(
  current: number | null,
  previous: number | null
) {
  if (current === null || previous === null) return null
  return (current - previous) / (Math.abs(previous) + EPSILON)
}

export function winsorize(
  values: number[],
  lowerQuantile = 0.01,
  upperQuantile = 0.99
) {
  if (values.length === 0) return []
  const sorted = [...values].sort((left, right) => left - right)
  const quantile = (probability: number) => {
    const position = (sorted.length - 1) * probability
    const lower = Math.floor(position)
    const upper = Math.ceil(position)
    const weight = position - lower
    return sorted[lower] * (1 - weight) + sorted[upper] * weight
  }
  const lower = quantile(lowerQuantile)
  const upper = quantile(upperQuantile)
  return values.map((value) => clamp(value, lower, upper))
}

export function zScores(values: number[]) {
  if (values.length === 0) return null
  const mean = values.reduce((total, value) => total + value, 0) / values.length
  const variance =
    values.reduce((total, value) => total + (value - mean) ** 2, 0) /
    values.length
  const standardDeviation = Math.sqrt(variance)
  if (standardDeviation === 0) return null
  return values.map((value) => (value - mean) / standardDeviation)
}

export function minMaxMap(values: number[]) {
  if (values.length === 0) return null
  const minimum = Math.min(...values)
  const maximum = Math.max(...values)
  if (maximum === minimum) return null
  return values.map((value) => (value - minimum) / (maximum - minimum))
}

export function calculateInnovationActionStrength(
  annualInventionApplications: number
) {
  if (
    !Number.isInteger(annualInventionApplications) ||
    annualInventionApplications < 0
  ) {
    throw new RangeError("当年发明专利申请数必须为非负整数。")
  }
  return Math.log1p(annualInventionApplications)
}

export function calculateTone(
  positiveWordCount: number,
  negativeWordCount: number,
  effectiveWordCount: number
) {
  if (effectiveWordCount <= 0) {
    return {
      positiveIntensity: null,
      negativeIntensity: null,
      netPositiveTone: null,
      riskLabel: null,
    }
  }
  const positiveIntensity = positiveWordCount / effectiveWordCount
  const negativeIntensity = negativeWordCount / effectiveWordCount
  const sentimentTotal = positiveWordCount + negativeWordCount
  const netPositiveTone =
    sentimentTotal === 0
      ? null
      : (positiveWordCount - negativeWordCount) / sentimentTotal
  return {
    positiveIntensity,
    negativeIntensity,
    netPositiveTone,
    riskLabel:
      netPositiveTone === null
        ? null
        : netPositiveTone < 0
          ? "高风险"
          : netPositiveTone < 0.4
            ? "中风险"
            : "低风险",
  }
}
