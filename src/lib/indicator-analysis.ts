import type { IndustryRiskCompanySummary } from "@/domain/industry-risk-v1/index.ts"

export function selectPeerRiskContext(
  companies: readonly IndustryRiskCompanySummary[],
  companyId: string,
  lowestRiskCount = 4,
  neighborRadius = 2
) {
  const ranked = companies
    .filter((company) => company.totalRiskScore !== null)
    .sort(
      (left, right) =>
        (right.totalRiskScore ?? 0) - (left.totalRiskScore ?? 0) ||
        left.stockCode.localeCompare(right.stockCode)
    )
  const lowestRisk = ranked.slice(-lowestRiskCount).reverse()
  const lowestRiskIds = new Set(lowestRisk.map((company) => company.companyId))
  const currentIndex = ranked.findIndex(
    (company) => company.companyId === companyId
  )
  let neighborCandidates: IndustryRiskCompanySummary[] = []
  if (currentIndex >= 0) {
    const start = Math.max(0, currentIndex - neighborRadius)
    const end = Math.min(ranked.length, currentIndex + neighborRadius + 1)
    neighborCandidates = ranked.slice(start, end)
  } else {
    const selectedCompany = companies.find(
      (company) => company.companyId === companyId
    )
    if (selectedCompany) neighborCandidates = [selectedCompany]
  }
  const neighbors = neighborCandidates.filter(
    (company) => !lowestRiskIds.has(company.companyId)
  )
  return {
    ranked,
    lowestRisk,
    neighbors,
    visible: [...lowestRisk, ...neighbors],
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
