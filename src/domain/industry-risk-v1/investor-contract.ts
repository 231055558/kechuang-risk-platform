import type { IndustryRiskIndicatorId } from "./model.ts"

export const INDUSTRY_RISK_INVESTOR_CONTRACT_VERSION =
  "KCR-INVESTOR-RISK-2026.08-v1" as const

export const INDUSTRY_RISK_OBJECTIVE_INDICATOR_IDS = [
  "R05",
  "R06",
  "R07",
  "R08",
  "R09",
  "R10",
  "R11",
  "R12",
  "R13",
  "R14",
  "R15",
  "R16",
  "R17",
  "R18",
  "R19",
  "R20",
  "R21",
  "R22",
] as const satisfies readonly IndustryRiskIndicatorId[]

/**
 * This object is returned by the assessment API and acts as a runtime boundary,
 * not merely product copy. Frontend, backend and data importers must agree on it.
 */
export const INDUSTRY_RISK_INVESTOR_SEMANTICS = {
  audience: "investor",
  objectiveIndicators: INDUSTRY_RISK_OBJECTIVE_INDICATOR_IDS,
  newsUsage: "information-only",
  financialNarrativeCorpus: "annual-report-only",
  financialNarrativeScoreStatus: "method-trial-unavailable",
  missingValue: "null-with-reason",
  heatEncoding: "peer-risk-percentile",
  recommendationScope: "risk-research-not-trade-instruction",
  graphContract: "external-temporal-graph-pending",
} as const

export interface IndustryRiskInvestorContract {
  version: typeof INDUSTRY_RISK_INVESTOR_CONTRACT_VERSION
  audience: typeof INDUSTRY_RISK_INVESTOR_SEMANTICS.audience
  newsUsage: typeof INDUSTRY_RISK_INVESTOR_SEMANTICS.newsUsage
  financialNarrativeCorpus: typeof INDUSTRY_RISK_INVESTOR_SEMANTICS.financialNarrativeCorpus
  financialNarrativeScoreStatus: typeof INDUSTRY_RISK_INVESTOR_SEMANTICS.financialNarrativeScoreStatus
  missingValue: typeof INDUSTRY_RISK_INVESTOR_SEMANTICS.missingValue
  heatEncoding: typeof INDUSTRY_RISK_INVESTOR_SEMANTICS.heatEncoding
  recommendationScope: typeof INDUSTRY_RISK_INVESTOR_SEMANTICS.recommendationScope
  graphContract: typeof INDUSTRY_RISK_INVESTOR_SEMANTICS.graphContract
}

export function getIndustryRiskInvestorContract(): IndustryRiskInvestorContract {
  return {
    version: INDUSTRY_RISK_INVESTOR_CONTRACT_VERSION,
    audience: INDUSTRY_RISK_INVESTOR_SEMANTICS.audience,
    newsUsage: INDUSTRY_RISK_INVESTOR_SEMANTICS.newsUsage,
    financialNarrativeCorpus:
      INDUSTRY_RISK_INVESTOR_SEMANTICS.financialNarrativeCorpus,
    financialNarrativeScoreStatus:
      INDUSTRY_RISK_INVESTOR_SEMANTICS.financialNarrativeScoreStatus,
    missingValue: INDUSTRY_RISK_INVESTOR_SEMANTICS.missingValue,
    heatEncoding: INDUSTRY_RISK_INVESTOR_SEMANTICS.heatEncoding,
    recommendationScope: INDUSTRY_RISK_INVESTOR_SEMANTICS.recommendationScope,
    graphContract: INDUSTRY_RISK_INVESTOR_SEMANTICS.graphContract,
  }
}
