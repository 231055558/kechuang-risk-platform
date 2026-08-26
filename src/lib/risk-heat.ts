export function clampRiskPercentile(value: number | null) {
  if (value === null || !Number.isFinite(value)) return null
  return Math.min(1, Math.max(0, value))
}

export function riskPercentileFromRank(rank: number, sampleSize: number) {
  if (rank <= 0 || sampleSize <= 0) return null
  if (sampleSize === 1) return 0.5
  return clampRiskPercentile(1 - (rank - 1) / (sampleSize - 1))
}

export function riskHeatColor(percentile: number | null) {
  const value = clampRiskPercentile(percentile)
  if (value === null) return "#8b93a3"

  // A fixed global scale: cool teal → yellow → orange → red.
  // It is intentionally never re-normalized within one company.
  const hue = 168 - value * 164
  const saturation = 64 + value * 14
  const lightness = 37 + (1 - Math.abs(value - 0.58) * 2) * 4
  return `hsl(${hue.toFixed(1)} ${saturation.toFixed(1)}% ${lightness.toFixed(1)}%)`
}

export function riskHeatLabel(percentile: number | null) {
  const value = clampRiskPercentile(percentile)
  if (value === null) return "缺失"
  if (value >= 0.9) return "同业极高"
  if (value >= 0.75) return "同业偏高"
  if (value >= 0.5) return "同业中位"
  if (value >= 0.25) return "同业偏低"
  return "同业较低"
}
