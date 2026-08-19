import {
  INDUSTRY_RISK_DATA_SCHEMA_VERSION,
  INDUSTRY_RISK_INDICATOR_IDS,
  INDUSTRY_RISK_NARRATIVE_INDICATOR_IDS,
  INDUSTRY_RISK_WEIGHTED_INDICATOR_IDS,
  type IndustryRiskDataset,
} from "./model.ts"

const localPathPatterns = [
  /(?:^|["'\s])\/Users\//,
  /(?:^|["'\s])\/home\//,
  /(?:^|["'\s])[A-Za-z]:\\/,
  /file:\/\//i,
]

export function collectIndustryRiskDatasetIssues(dataset: IndustryRiskDataset) {
  const issues: string[] = []
  if (dataset.metadata.schemaVersion !== INDUSTRY_RISK_DATA_SCHEMA_VERSION) {
    issues.push(`数据版本必须为 ${INDUSTRY_RISK_DATA_SCHEMA_VERSION}。`)
  }
  if (dataset.companies.length !== dataset.metadata.sampleSize) {
    issues.push("样本企业数与元数据不一致。")
  }
  if (dataset.indicators.length !== dataset.metadata.indicatorCount) {
    issues.push("指标数与元数据不一致。")
  }

  const companyIds = new Set(dataset.companies.map((company) => company.id))
  const sourceIds = new Set(dataset.sources.map((source) => source.id))
  const indicatorIds = new Set(
    dataset.indicators.map((indicator) => indicator.id)
  )
  if (companyIds.size !== dataset.companies.length) {
    issues.push("企业 ID 存在重复。")
  }
  if (sourceIds.size !== dataset.sources.length) {
    issues.push("来源 ID 存在重复。")
  }
  if (indicatorIds.size !== INDUSTRY_RISK_INDICATOR_IDS.length) {
    issues.push("指标 ID 存在重复或缺失。")
  }
  for (const id of INDUSTRY_RISK_INDICATOR_IDS) {
    if (!indicatorIds.has(id)) issues.push(`缺少指标 ${id}。`)
  }

  const expectedNarratives = new Set(INDUSTRY_RISK_NARRATIVE_INDICATOR_IDS)
  const expectedWeighted = new Set(INDUSTRY_RISK_WEIGHTED_INDICATOR_IDS)
  for (const indicator of dataset.indicators) {
    if (
      expectedNarratives.has(
        indicator.id as (typeof INDUSTRY_RISK_NARRATIVE_INDICATOR_IDS)[number]
      ) &&
      indicator.kind !== "narrative-validation"
    ) {
      issues.push(`${indicator.id} 必须是叙事校验项。`)
    }
    if (
      expectedWeighted.has(
        indicator.id as (typeof INDUSTRY_RISK_WEIGHTED_INDICATOR_IDS)[number]
      ) &&
      indicator.kind !== "weighted"
    ) {
      issues.push(`${indicator.id} 必须是加权候选项。`)
    }
  }

  const observationKeys = new Set<string>()
  for (const observation of dataset.observations) {
    if (!companyIds.has(observation.companyId)) {
      issues.push(`观测 ${observation.id} 引用了未知企业。`)
    }
    if (!indicatorIds.has(observation.indicatorId)) {
      issues.push(`观测 ${observation.id} 引用了未知指标。`)
    }
    if (!sourceIds.has(observation.sourceId)) {
      issues.push(`观测 ${observation.id} 缺少有效来源。`)
    }
    if (observation.numericValue === null && observation.textValue === null) {
      issues.push(`观测 ${observation.id} 没有数值或文本值。`)
    }
    if (observation.confidence < 0 || observation.confidence > 1) {
      issues.push(`观测 ${observation.id} 的置信度越界。`)
    }
    const key = [
      observation.companyId,
      observation.indicatorId,
      observation.metricName,
      observation.asOfDate ?? "",
    ].join("::")
    if (observationKeys.has(key)) issues.push(`观测键重复：${key}。`)
    observationKeys.add(key)
  }

  const coverageKeys = new Set<string>()
  for (const item of dataset.coverage) {
    if (
      !companyIds.has(item.companyId) ||
      !indicatorIds.has(item.indicatorId)
    ) {
      issues.push(`覆盖记录 ${item.companyId}/${item.indicatorId} 引用无效。`)
    }
    const key = `${item.companyId}::${item.indicatorId}`
    if (coverageKeys.has(key)) issues.push(`覆盖记录重复：${key}。`)
    coverageKeys.add(key)
  }
  const expectedCoverageCount = companyIds.size * indicatorIds.size
  if (coverageKeys.size !== expectedCoverageCount) {
    issues.push(`覆盖矩阵应有 ${expectedCoverageCount} 行。`)
  }

  const supplementaryIds = new Set<string>()
  for (const item of dataset.supplementaryObservations) {
    if (supplementaryIds.has(item.id)) {
      issues.push(`补充事实 ID 重复：${item.id}。`)
    }
    supplementaryIds.add(item.id)
    if (!companyIds.has(item.companyId)) {
      issues.push(`补充事实 ${item.id} 引用了未知企业。`)
    }
    if (
      item.relatedIndicatorId !== null &&
      !indicatorIds.has(item.relatedIndicatorId)
    ) {
      issues.push(`补充事实 ${item.id} 引用了未知指标。`)
    }
    if (item.sourceId !== null && !sourceIds.has(item.sourceId)) {
      issues.push(`补充事实 ${item.id} 引用了未知来源。`)
    }
    if (item.numericValue === null && item.textValue === null) {
      issues.push(`补充事实 ${item.id} 没有数值或文本值。`)
    }
    if (item.confidence < 0 || item.confidence > 1) {
      issues.push(`补充事实 ${item.id} 的置信度越界。`)
    }
    if (item.affectsScore !== false) {
      issues.push(`补充事实 ${item.id} 不得参与评分。`)
    }
  }

  const reportCompanyIds = new Set<string>()
  for (const report of dataset.reportAvailability) {
    if (!companyIds.has(report.companyId)) {
      issues.push(`报告可得性记录引用了未知企业 ${report.companyId}。`)
    }
    if (reportCompanyIds.has(report.companyId)) {
      issues.push(`企业 ${report.companyId} 的报告可得性记录重复。`)
    }
    reportCompanyIds.add(report.companyId)
  }
  if (
    dataset.reportAvailability.length > 0 &&
    reportCompanyIds.size !== companyIds.size
  ) {
    issues.push("报告可得性记录必须覆盖整个样本。")
  }

  const bonusIds = new Set<string>()
  for (const bonus of dataset.bonusDefinitions) {
    if (bonusIds.has(bonus.id)) issues.push(`加分项 ID 重复：${bonus.id}。`)
    bonusIds.add(bonus.id)
    if (bonus.affectsScore !== false || bonus.status !== "definition-only") {
      issues.push(`加分项 ${bonus.id} 只能作为未启用定义。`)
    }
  }

  if (!dataset.metadata.reportingPeriod || !dataset.metadata.scopeNote) {
    issues.push("数据集必须说明报告期和样本边界。")
  }

  const serialized = JSON.stringify(dataset)
  for (const pattern of localPathPatterns) {
    if (pattern.test(serialized)) issues.push("公开数据包含本机绝对路径。")
  }
  return issues
}

export function assertIndustryRiskDataset(dataset: IndustryRiskDataset) {
  const issues = collectIndustryRiskDatasetIssues(dataset)
  if (issues.length > 0) {
    throw new Error(`行业风险数据无效：${issues.join("；")}`)
  }
  return dataset
}
