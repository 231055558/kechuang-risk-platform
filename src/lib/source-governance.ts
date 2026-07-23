import type { EvidenceItem, EvidenceSupportStrength } from "@/types/risk"

const CANDIDATE_SOURCE_NAMES = [
  "Wind",
  "同花顺",
  "天眼查",
  "企查查",
  "智慧芽",
  "PatSnap",
  "incoPat",
  "IT桔子",
  "IT 桔子",
  "烯牛",
  "慧博",
]

export function isCandidateDataSource(source: string) {
  return CANDIDATE_SOURCE_NAMES.some((name) => source.includes(name))
}

export function formatDataSourceLabel(source: string) {
  return isCandidateDataSource(source)
    ? `待授权候选数据源 · ${source}`
    : `公开或企业自有来源 · ${source}`
}

export function isEffectiveEvidence(evidence: EvidenceItem) {
  if (isCandidateDataSource(evidence.sourceName)) {
    return false
  }

  return (
    evidence.supportStrength === "direct" ||
    (evidence.supportStrength === "inferred" &&
      Boolean(evidence.inferenceBasis?.trim()))
  )
}

export function formatEvidenceSupport(
  supportStrength: EvidenceSupportStrength | undefined
) {
  const labels: Record<EvidenceSupportStrength, string> = {
    direct: "直接披露",
    inferred: "推导支持",
    background: "背景材料",
    pending: "待核验",
  }

  return supportStrength ? labels[supportStrength] : "待治理"
}

export function summarizeEvidenceGovernance(evidence: EvidenceItem[]) {
  const uniqueUrls = new Set(
    evidence.map((item) => item.sourceUrl).filter(Boolean)
  )
  const effective = evidence.filter(isEffectiveEvidence)
  const effectiveUrls = new Set(
    effective.map((item) => item.sourceUrl).filter(Boolean)
  )
  const formalPublicUrls = new Set(
    effective
      .filter((item) => !isCandidateDataSource(item.sourceName))
      .map((item) => item.sourceUrl)
      .filter(Boolean)
  )
  const candidateUrls = new Set(
    evidence
      .filter((item) => isCandidateDataSource(item.sourceName))
      .map((item) => item.sourceUrl)
      .filter(Boolean)
  )

  return {
    evidenceRecordCount: evidence.length,
    uniqueSourceUrlCount: uniqueUrls.size,
    effectiveEvidenceCount: effective.length,
    effectiveUniqueUrlCount: effectiveUrls.size,
    formalPublicSourceCount: formalPublicUrls.size,
    candidateSourceCount: candidateUrls.size,
    coverage:
      uniqueUrls.size === 0
        ? 0
        : Math.round((effectiveUrls.size / uniqueUrls.size) * 100),
  }
}
