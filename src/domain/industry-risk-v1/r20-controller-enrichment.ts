import type {
  IndustryRiskDataset,
  IndustryRiskObservation,
  IndustryRiskSource,
} from "./model.ts"
import { assertIndustryRiskDataset } from "./validation.ts"

export const R20_CONTROLLER_ENRICHMENT_SCHEMA_VERSION =
  "KCR-R20-CONTROLLER-2026.08-v1" as const

export interface R20ControllerEnrichmentRecord {
  companyId: string
  stockCode: string
  controllerNames: string[]
  valuePct: number
  asOfDate: string
  sourceKind: "public-shareholder-page" | "paid-api-1123"
  companyPageUrl: string
}

export interface R20ControllerUnresolvedRecord {
  companyId: string
  stockCode: string
  reason: string
}

export interface R20ControllerEnrichment {
  schemaVersion: typeof R20_CONTROLLER_ENRICHMENT_SCHEMA_VERSION
  dataVersion: string
  asOfDate: string
  method: string
  audit: {
    publicPageCompanyCount: number
    publicPageControllerTaggedCount: number
    acceptedPublicPageCount: number
    paidApiId: number
    paidApiName: string
    paidApiUnitPriceCny: number
    paidApiAuthorizedCapCny: number
    paidApiRequestCount: number
    paidApiSuccessCount: number
    paidApiNoResultCount: number
    paidApiAcceptedCount: number
    paidApiRejectedCount: number
    actualCostCny: number
    balanceBeforeCny: number
    balanceAfterCny: number
    acceptedObservationCount: number
    unresolvedCompanyCount: number
    rawApiResponseRedistributed: boolean
    credentialStored: boolean
  }
  records: R20ControllerEnrichmentRecord[]
  unresolved: R20ControllerUnresolvedRecord[]
}

const ENRICHMENT_PREFIX = "r20-enrichment:"

function sourceId(stockCode: string) {
  return `${ENRICHMENT_PREFIX}source:${stockCode}`
}

function observationId(stockCode: string) {
  return `${ENRICHMENT_PREFIX}observation:${stockCode}`
}

function assertR20ControllerEnrichment(
  dataset: IndustryRiskDataset,
  enrichment: R20ControllerEnrichment
) {
  if (enrichment.schemaVersion !== R20_CONTROLLER_ENRICHMENT_SCHEMA_VERSION) {
    throw new Error("R20 控制权补充数据版本不受支持。")
  }
  if (
    enrichment.audit.actualCostCny > enrichment.audit.paidApiAuthorizedCapCny
  ) {
    throw new Error("R20 控制权补充数据的实际费用超过授权上限。")
  }
  if (
    enrichment.audit.rawApiResponseRedistributed ||
    enrichment.audit.credentialStored
  ) {
    throw new Error("R20 控制权公开派生数据不得包含原始付费响应或凭证。")
  }
  if (
    enrichment.records.length !== enrichment.audit.acceptedObservationCount ||
    enrichment.unresolved.length !== enrichment.audit.unresolvedCompanyCount
  ) {
    throw new Error("R20 控制权补充数据的审计计数不一致。")
  }
  if (
    enrichment.records.length + enrichment.unresolved.length !==
    enrichment.audit.publicPageCompanyCount
  ) {
    throw new Error("R20 控制权补充数据没有覆盖全部目标芯片公司。")
  }

  const companies = new Map(dataset.companies.map((item) => [item.id, item]))
  const seen = new Set<string>()
  for (const item of [...enrichment.records, ...enrichment.unresolved]) {
    if (seen.has(item.companyId)) {
      throw new Error(`R20 控制权补充企业重复：${item.companyId}。`)
    }
    seen.add(item.companyId)
    const company = companies.get(item.companyId)
    if (!company || company.stockCode !== item.stockCode) {
      throw new Error(`R20 控制权补充企业无法匹配：${item.companyId}。`)
    }
    if (!["digital-chip", "analog-chip"].includes(company.peerGroupId ?? "")) {
      throw new Error(
        `R20 控制权补充企业不属于目标芯片同业：${item.companyId}。`
      )
    }
  }
  for (const item of enrichment.records) {
    if (
      !Number.isFinite(item.valuePct) ||
      item.valuePct <= 0 ||
      item.valuePct > 100 ||
      item.controllerNames.length === 0 ||
      !/^https:\/\/www\.tianyancha\.com\/company\/\d+$/.test(
        item.companyPageUrl
      )
    ) {
      throw new Error(`R20 控制权补充记录无效：${item.companyId}。`)
    }
  }
}

function buildSource(
  dataset: IndustryRiskDataset,
  enrichment: R20ControllerEnrichment,
  record: R20ControllerEnrichmentRecord
): IndustryRiskSource {
  const company = dataset.companies.find((item) => item.id === record.companyId)
  const apiDerived = record.sourceKind === "paid-api-1123"
  return {
    id: sourceId(record.stockCode),
    sourceType: apiDerived
      ? "授权商业数据接口派生事实"
      : "商业查询平台公开股东表派生事实",
    institution: apiDerived ? "天眼数据" : "天眼查",
    title: `${record.stockCode} ${company?.shortName ?? record.companyId} R20 控制权持股比例核验`,
    publicationDate: record.asOfDate,
    url: record.companyPageUrl,
    accessedAt: enrichment.asOfDate,
    notes: apiDerived
      ? `经用户授权调用天眼数据接口1123；仅保留控制人名称与比例派生事实，不再分发原始响应。控制人：${record.controllerNames.join("、")}。`
      : `依据网页主要股东表的实际控制人标签及直接、间接持股比例派生；控制人：${record.controllerNames.join("、")}。`,
    redistribution: "licensed-derived",
    peerGroupId: company?.peerGroupId,
  }
}

function buildObservation(
  record: R20ControllerEnrichmentRecord
): IndustryRiskObservation {
  const apiDerived = record.sourceKind === "paid-api-1123"
  return {
    id: observationId(record.stockCode),
    companyId: record.companyId,
    indicatorId: "R20",
    metricName: "maximum_controller_ratio_pct",
    periodStart: null,
    periodEnd: null,
    asOfDate: record.asOfDate,
    numericValue: record.valuePct,
    textValue: null,
    unit: "%",
    status: "available",
    derived: true,
    formula: "实际控制人中总持股比例最大值（直接持股＋间接持股）",
    sourceId: sourceId(record.stockCode),
    sourcePage: null,
    confidenceLabel: apiDerived ? "中" : "中高",
    confidence: apiDerived ? 0.75 : 0.84,
    confidenceReason: apiDerived
      ? `天眼数据疑似实际控制人接口1123返回姓名和正比例，经网页股东结构合理性复核后准入；控制人：${record.controllerNames.join("、")}。`
      : `天眼查网页主要股东表明确标记实际控制人，并同时返回直接和间接持股比例；控制人：${record.controllerNames.join("、")}。`,
    limitations: apiDerived
      ? "接口结果属于疑似控制人识别；未取得表决权委托和完整一致行动协议，比例用于当前横截面代理。"
      : "第三方股东标签不等同于监管认定；共同控制情形按单一控制人最大比例，不合并控制人团队持股。",
    sourceIds: [sourceId(record.stockCode)],
  }
}

export function attachIndustryRiskR20ControllerEnrichment(
  dataset: IndustryRiskDataset,
  enrichment: R20ControllerEnrichment
) {
  assertR20ControllerEnrichment(dataset, enrichment)
  const recordIds = new Set(enrichment.records.map((item) => item.companyId))
  const unresolvedReasons = new Map(
    enrichment.unresolved.map((item) => [item.companyId, item.reason])
  )
  const versionSuffix = `+${enrichment.dataVersion}`
  const sourceAttributionSuffix =
    "；R20 使用天眼查网页公开股东表及经授权的天眼数据接口1123派生事实"

  return assertIndustryRiskDataset({
    ...dataset,
    metadata: {
      ...dataset.metadata,
      dataVersion: dataset.metadata.dataVersion.includes(versionSuffix)
        ? dataset.metadata.dataVersion
        : `${dataset.metadata.dataVersion}${versionSuffix}`,
      sourceDate:
        dataset.metadata.sourceDate > enrichment.asOfDate
          ? dataset.metadata.sourceDate
          : enrichment.asOfDate,
      sourceAttribution: dataset.metadata.sourceAttribution.includes(
        sourceAttributionSuffix
      )
        ? dataset.metadata.sourceAttribution
        : `${dataset.metadata.sourceAttribution}${sourceAttributionSuffix}`,
      scopeNote: `${dataset.metadata.scopeNote} R20 仅准入姓名非空、比例为正且通过结构合理性复核的派生值；其余企业保持缺失。`,
      peerGroups: dataset.metadata.peerGroups?.map((group) =>
        ["digital-chip", "analog-chip"].includes(group.id)
          ? {
              ...group,
              scoreReadyIndicatorIds: [
                ...new Set([...group.scoreReadyIndicatorIds, "R20" as const]),
              ],
            }
          : group
      ),
    },
    sources: [
      ...dataset.sources.filter(
        (item) => !item.id.startsWith(`${ENRICHMENT_PREFIX}source:`)
      ),
      ...enrichment.records.map((item) =>
        buildSource(dataset, enrichment, item)
      ),
    ],
    observations: [
      ...dataset.observations.filter(
        (item) =>
          !item.id.startsWith(`${ENRICHMENT_PREFIX}observation:`) &&
          !(
            recordIds.has(item.companyId) &&
            item.metricName === "maximum_controller_ratio_pct"
          )
      ),
      ...enrichment.records.map((item) => buildObservation(item)),
    ],
    coverage: dataset.coverage.map((item) => {
      if (item.indicatorId !== "R20") return item
      const record = enrichment.records.find(
        (candidate) => candidate.companyId === item.companyId
      )
      if (record) {
        const apiDerived = record.sourceKind === "paid-api-1123"
        return {
          ...item,
          status: "已覆盖",
          usableForScoring: true,
          confidenceLabel: apiDerived ? "中" : "中高",
          confidence: apiDerived ? 0.75 : 0.84,
          reason:
            "已取得实际控制人姓名和可比持股比例，按单一控制人最大总持股比例进入横截面评分。",
          recommendedNextSource:
            "后续以年度报告实际控制人、一致行动关系和表决权委托章节持续复核。",
        }
      }
      const unresolvedReason = unresolvedReasons.get(item.companyId)
      return unresolvedReason
        ? {
            ...item,
            status: "部分覆盖",
            usableForScoring: false,
            reason: unresolvedReason,
            recommendedNextSource:
              "年度报告实际控制人及一致行动关系章节；必要时人工复核完整控制路径。",
          }
        : item
    }),
  })
}
