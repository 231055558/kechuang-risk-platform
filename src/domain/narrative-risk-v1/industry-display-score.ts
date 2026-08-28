import type {
  NarrativeIndustryCompany,
  NarrativeIndustryObservation,
  NarrativeIndustryTrendResponse,
} from "./model"

const RISK_DIRECTION: Record<string, "higher" | "lower"> = {
  risk_context_ambiguity: "higher",
  innovation_divergence: "higher",
  information_sufficiency: "lower",
}

export interface NarrativeAnnualDisplayScore {
  year: number
  score: number
  weight: number
  sampleSize: number
}

export interface NarrativeCompanyDisplayScore {
  score: number
  metricScores: Record<string, number>
}

const COMPOSITE_METRIC_KEYS = [
  "risk_context_ambiguity",
  "innovation_divergence",
  "information_sufficiency",
] as const

function isFiniteNumber(value: number | null): value is number {
  return value !== null && Number.isFinite(value)
}

export function calculateIndustryPercentileRiskScore(
  value: number,
  peerValues: number[],
  higherIsRiskier: boolean
) {
  const values = peerValues.filter(Number.isFinite)
  if (!values.includes(value)) values.push(value)
  if (values.length <= 1) return 50

  const riskValues = values.map((item) => (higherIsRiskier ? item : -item))
  const selectedRiskValue = higherIsRiskier ? value : -value
  const lowerCount = riskValues.filter((item) => item < selectedRiskValue).length
  const tiedCount = riskValues.filter((item) => item === selectedRiskValue).length
  const averageZeroBasedRank = lowerCount + (tiedCount - 1) / 2

  return (averageZeroBasedRank / (values.length - 1)) * 100
}

export function calculateNarrativeAnnualDisplayScores({
  company,
  metricKey,
  companies,
  observations,
}: {
  company: NarrativeIndustryCompany
  metricKey: string
  companies: NarrativeIndustryCompany[]
  observations: NarrativeIndustryObservation[]
}): NarrativeAnnualDisplayScore[] {
  const direction = RISK_DIRECTION[metricKey]
  if (!direction) return []

  const industryCompanyIds = new Set(
    companies
      .filter((item) => item.industryGroupId === company.industryGroupId)
      .map((item) => item.companyId)
  )
  const companyObservations = observations.filter(
    (item) =>
      item.companyId === company.companyId &&
      item.metricKey === metricKey &&
      isFiniteNumber(item.value)
  )
  const latestYear = Math.max(...companyObservations.map((item) => item.year))

  if (!Number.isFinite(latestYear)) return []

  return companyObservations
    .map((item) => {
      const peers = observations.filter(
        (peer) =>
          industryCompanyIds.has(peer.companyId) &&
          peer.year === item.year &&
          peer.metricKey === metricKey &&
          isFiniteNumber(peer.value)
      )
      return {
        year: item.year,
        score: calculateIndustryPercentileRiskScore(
          item.value!,
          peers.map((peer) => peer.value!),
          direction === "higher"
        ),
        weight: Math.max(1, 5 - (latestYear - item.year)),
        sampleSize: peers.length,
      }
    })
    .sort((left, right) => left.year - right.year)
}

export function calculateWeightedNarrativeDisplayScore(
  annualScores: NarrativeAnnualDisplayScore[]
) {
  const validScores = annualScores.filter(
    (item) => Number.isFinite(item.score) && item.weight > 0
  )
  const weightTotal = validScores.reduce((sum, item) => sum + item.weight, 0)
  if (weightTotal === 0) return null

  return (
    validScores.reduce((sum, item) => sum + item.score * item.weight, 0) /
    weightTotal
  )
}

export function calculateNarrativeCompanyDisplayScore(
  data: NarrativeIndustryTrendResponse,
  stockCode: string
): NarrativeCompanyDisplayScore | null {
  const company = data.companies.find((item) => item.stockCode === stockCode)
  if (!company) return null

  const metricScores: Record<string, number> = {}
  for (const metricKey of COMPOSITE_METRIC_KEYS) {
    const annualScores = calculateNarrativeAnnualDisplayScores({
      company,
      metricKey,
      companies: data.companies,
      observations: data.observations,
    })
    const score = calculateWeightedNarrativeDisplayScore(annualScores)
    if (score === null) return null
    metricScores[metricKey] = score
  }

  const score =
    COMPOSITE_METRIC_KEYS.reduce(
      (sum, metricKey) => sum + metricScores[metricKey],
      0
    ) / COMPOSITE_METRIC_KEYS.length

  return {
    score: Math.round(score * 100) / 100,
    metricScores,
  }
}
