import {
  ENTERPRISE_EVIDENCE_CATALOG_SCHEMA_VERSION,
  ENTERPRISE_EVIDENCE_CATEGORIES,
  type EnterpriseEvidenceCatalog,
} from "./model.ts"

export function collectEnterpriseEvidenceCatalogIssues(
  catalog: EnterpriseEvidenceCatalog
) {
  const issues: string[] = []
  if (catalog.schemaVersion !== ENTERPRISE_EVIDENCE_CATALOG_SCHEMA_VERSION) {
    issues.push("证据目录版本不正确。")
  }
  if (catalog.companyCount !== catalog.companies.length) {
    issues.push("企业总数与企业摘要不一致。")
  }
  if (catalog.artifactCount !== catalog.artifacts.length) {
    issues.push("材料总数与材料目录不一致。")
  }
  const ids = new Set<string>()
  const companyIds = new Set(
    catalog.companies.map((company) => company.companyId)
  )
  for (const artifact of catalog.artifacts) {
    if (ids.has(artifact.id)) issues.push(`材料编号重复：${artifact.id}。`)
    ids.add(artifact.id)
    if (!companyIds.has(artifact.companyId)) {
      issues.push(`材料 ${artifact.id} 引用了未知企业。`)
    }
    if (!ENTERPRISE_EVIDENCE_CATEGORIES.includes(artifact.category)) {
      issues.push(`材料 ${artifact.id} 的类别不受支持。`)
    }
    if (artifact.redistribution !== "private-metadata-only") {
      issues.push(`材料 ${artifact.id} 不得携带可再分发内容。`)
    }
  }
  const workbookCount = catalog.artifacts.filter(
    (artifact) => artifact.format === "xlsx"
  ).length
  const pdfCount = catalog.artifacts.filter(
    (artifact) => artifact.format === "pdf"
  ).length
  const archiveCount = catalog.artifacts.filter(
    (artifact) => artifact.format === "zip"
  ).length
  if (
    workbookCount !== catalog.workbookCount ||
    pdfCount !== catalog.pdfCount ||
    archiveCount !== catalog.archiveCount
  ) {
    issues.push("材料格式统计与目录不一致。")
  }
  for (const company of catalog.companies) {
    const artifacts = catalog.artifacts.filter(
      (artifact) => artifact.companyId === company.companyId
    )
    if (company.artifactCount !== artifacts.length) {
      issues.push(`企业 ${company.companyId} 的材料计数不一致。`)
    }
    if (
      company.workbookCount !==
      artifacts.filter((artifact) => artifact.format === "xlsx").length
    ) {
      issues.push(`企业 ${company.companyId} 的工作簿计数不一致。`)
    }
  }
  return issues
}

export function assertEnterpriseEvidenceCatalog(
  catalog: EnterpriseEvidenceCatalog
) {
  const issues = collectEnterpriseEvidenceCatalogIssues(catalog)
  if (issues.length > 0) {
    throw new TypeError(`企业证据目录校验失败：${issues.join("；")}`)
  }
}
