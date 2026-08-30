import type { IndustryRiskCompanySummary } from "@/domain/industry-risk-v1/index.ts"

export type PeerRiskMatrixRow =
  | {
      kind: "company"
      company: IndustryRiskCompanySummary
      rank: number
    }
  | {
      kind: "gap"
      fromRank: number
      toRank: number
      count: number
    }

export function selectPeerRiskContext(
  companies: readonly IndustryRiskCompanySummary[],
  companyId: string,
  edgeCount = 4,
  neighborRadius = 2
) {
  const ranked = companies
    .filter((company) => company.totalRiskScore !== null)
    .sort(
      (left, right) =>
        (left.totalRiskScore ?? 0) - (right.totalRiskScore ?? 0) ||
        left.stockCode.localeCompare(right.stockCode)
    )
  const currentIndex = ranked.findIndex(
    (company) => company.companyId === companyId
  )

  const visibleIndices = new Set<number>()
  for (let index = 0; index < Math.min(edgeCount, ranked.length); index += 1) {
    visibleIndices.add(index)
  }
  for (
    let index = Math.max(0, ranked.length - edgeCount);
    index < ranked.length;
    index += 1
  ) {
    visibleIndices.add(index)
  }
  if (currentIndex >= 0) {
    for (
      let index = Math.max(0, currentIndex - neighborRadius);
      index <= Math.min(ranked.length - 1, currentIndex + neighborRadius);
      index += 1
    ) {
      visibleIndices.add(index)
    }
  }

  const sortedIndices = [...visibleIndices].sort((left, right) => left - right)
  const collapsedRows: PeerRiskMatrixRow[] = []
  sortedIndices.forEach((index, position) => {
    const previousIndex = sortedIndices[position - 1]
    if (position > 0 && index - previousIndex > 1) {
      collapsedRows.push({
        kind: "gap",
        fromRank: previousIndex + 2,
        toRank: index,
        count: index - previousIndex - 1,
      })
    }
    collapsedRows.push({
      kind: "company",
      company: ranked[index],
      rank: index + 1,
    })
  })

  return {
    ranked,
    currentRank: currentIndex < 0 ? null : currentIndex + 1,
    collapsedRows,
    expandedRows: ranked.map((company, index) => ({
      kind: "company" as const,
      company,
      rank: index + 1,
    })),
  }
}

export function riskPercentileFromAscendingRank(
  rank: number,
  sampleSize: number
) {
  if (rank <= 0 || sampleSize <= 0) return null
  if (sampleSize === 1) return 0.5
  return Math.min(1, Math.max(0, (rank - 1) / (sampleSize - 1)))
}

export function indicatorRankFromRiskPercentile(
  percentile: number | null,
  sampleSize: number
) {
  if (percentile === null || sampleSize <= 0) return null
  if (sampleSize === 1) return 1
  return Math.min(
    sampleSize,
    Math.max(1, Math.round(percentile * (sampleSize - 1)) + 1)
  )
}

export function indicatorRankAssessment(
  rank: number | null,
  sampleSize: number
) {
  if (rank === null || sampleSize <= 0) return "缺失"
  if (sampleSize < 5) return "样本有限"
  const percentile = riskPercentileFromAscendingRank(rank, sampleSize) ?? 0.5
  if (percentile <= 0.2) return "同业较优"
  if (percentile <= 0.4) return "同业偏优"
  if (percentile <= 0.6) return "同业中位"
  if (percentile <= 0.8) return "同业偏弱"
  return "同业较弱"
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
