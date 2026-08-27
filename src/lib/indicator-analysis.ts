import type { IndustryRiskCompanySummary } from "@/domain/industry-risk-v1/index.ts"

export function selectPeerRiskContext(
  companies: readonly IndustryRiskCompanySummary[],
  companyId: string,
  leadingCount = 4,
  neighborRadius = 2
) {
  const ranked = [...companies].sort(
    (left, right) =>
      (right.totalRiskScore ?? -1) - (left.totalRiskScore ?? -1) ||
      left.stockCode.localeCompare(right.stockCode)
  )
  const selectedIds = new Set(
    ranked.slice(0, leadingCount).map((company) => company.companyId)
  )
  const currentIndex = ranked.findIndex(
    (company) => company.companyId === companyId
  )
  if (currentIndex >= 0) {
    const start = Math.max(0, currentIndex - neighborRadius)
    const end = Math.min(ranked.length, currentIndex + neighborRadius + 1)
    ranked
      .slice(start, end)
      .forEach((company) => selectedIds.add(company.companyId))
  }
  return {
    ranked,
    visible: ranked.filter((company) => selectedIds.has(company.companyId)),
  }
}

export function formatIndicatorRawValue(value: number | null) {
  if (value === null) return "缺失"
  const absolute = Math.abs(value)
  const maximumFractionDigits = absolute >= 1 ? 2 : absolute >= 0.01 ? 3 : 4
  return new Intl.NumberFormat("zh-CN", {
    minimumFractionDigits: 0,
    maximumFractionDigits,
  }).format(value)
}

export function indicatorUnitLabel(unit: string) {
  const normalized = unit.trim()
  if (!normalized) return "无量纲"
  return normalized
}

export function indicatorUnitExplanation(unit: string) {
  if (unit === "%") return "百分比；与“百分点”不是同一单位"
  if (unit === "百分点") return "百分比之间的绝对差值"
  return unit
}
