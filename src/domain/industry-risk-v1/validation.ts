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
    if (
      observation.numericValue === null &&
      observation.textValue === null &&
      !observation.status.trim()
    ) {
      issues.push(`观测 ${observation.id} 没有值或缺失状态。`)
    }
    for (const linkedSourceId of observation.sourceIds ?? []) {
      if (!sourceIds.has(linkedSourceId)) {
        issues.push(`观测 ${observation.id} 引用了未知补充来源。`)
      }
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

  const peerGroups = dataset.metadata.peerGroups ?? []
  const peerGroupIds = new Set(peerGroups.map((group) => group.id))
  if (peerGroupIds.size !== peerGroups.length) {
    issues.push("同业组 ID 存在重复。")
  }
  for (const company of dataset.companies) {
    if (company.peerGroupId && !peerGroupIds.has(company.peerGroupId)) {
      issues.push(`企业 ${company.id} 引用了未知同业组。`)
    }
  }
  for (const group of peerGroups) {
    if (group.companyIds.some((id) => !companyIds.has(id))) {
      issues.push(`同业组 ${group.id} 引用了未知企业。`)
    }
  }

  for (const item of dataset.supplementaryObservations ?? []) {
    if (!companyIds.has(item.companyId)) {
      issues.push(`补充观测 ${item.id} 引用了未知企业。`)
    }
    if (item.sourceId && !sourceIds.has(item.sourceId)) {
      issues.push(`补充观测 ${item.id} 引用了未知来源。`)
    }
  }
  for (const event of dataset.deepSearchEvents ?? []) {
    if (!companyIds.has(event.companyId)) {
      issues.push(`深搜事件 ${event.id} 引用了未知企业。`)
    }
  }

  // Local deployments read an operator-selected SQLite path via environment
  // variables.  Validate data payloads, not the deployment path itself.
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
