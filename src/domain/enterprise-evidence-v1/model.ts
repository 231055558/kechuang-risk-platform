export const ENTERPRISE_EVIDENCE_CATALOG_SCHEMA_VERSION =
  "KCR-ENTERPRISE-EVIDENCE-2026.08-v1" as const

export const ENTERPRISE_EVIDENCE_CATEGORIES = [
  "company-profile",
  "annual-reporting",
  "financial-reporting",
  "intellectual-property",
  "commercial-relations",
  "corporate-governance",
  "financing-investment",
  "regulatory-compliance",
  "litigation",
  "risk-workbook",
  "archive",
] as const

export type EnterpriseEvidenceCategory =
  (typeof ENTERPRISE_EVIDENCE_CATEGORIES)[number]

export type EnterpriseEvidenceFormat = "xlsx" | "pdf" | "zip"

export interface EnterpriseEvidenceArtifact {
  id: string
  companyId: string
  category: EnterpriseEvidenceCategory
  format: EnterpriseEvidenceFormat
  sheetCount: number | null
  nonEmptyRowCount: number | null
  sourceClass:
    | "commercial-data-export"
    | "public-filing"
    | "team-workbook"
    | "private-archive"
  redistribution: "private-metadata-only"
  ingestionStatus: "cataloged-not-ingested"
}

export interface EnterpriseEvidenceCompanySummary {
  companyId: string
  displayName: string
  artifactCount: number
  workbookCount: number
  categoryCounts: Partial<Record<EnterpriseEvidenceCategory, number>>
}

export interface EnterpriseEvidenceCatalog {
  schemaVersion: typeof ENTERPRISE_EVIDENCE_CATALOG_SCHEMA_VERSION
  sourceDate: string
  sourceLabel: string
  scopeNote: string
  companyCount: number
  artifactCount: number
  workbookCount: number
  pdfCount: number
  archiveCount: number
  companies: EnterpriseEvidenceCompanySummary[]
  artifacts: EnterpriseEvidenceArtifact[]
}
