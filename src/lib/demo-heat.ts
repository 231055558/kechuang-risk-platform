const clampPercentile = (value: number) => Math.min(0.98, Math.max(0.02, value))

function stableUnitInterval(value: string) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0) / 0xffffffff
}

export function demoPercentileForMissingHeat(
  companyId: string,
  indicatorId: string,
  observedPercentiles: readonly (number | null)[]
) {
  const observed = observedPercentiles.filter(
    (value): value is number => value !== null && Number.isFinite(value)
  )
  const baseline = observed.length
    ? observed.reduce((sum, value) => sum + value, 0) / observed.length
    : 0.5
  const jitter =
    (stableUnitInterval(`${companyId}:${indicatorId}`) * 2 - 1) * 0.08
  return Number(clampPercentile(baseline + jitter).toFixed(4))
}
