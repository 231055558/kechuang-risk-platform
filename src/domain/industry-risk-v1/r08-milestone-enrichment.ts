import type {
  IndustryRiskDataset,
  IndustryRiskObservation,
  IndustryRiskSource,
} from "./model.ts"
import { assertIndustryRiskDataset } from "./validation.ts"

export const R08_MILESTONE_ENRICHMENT_SCHEMA_VERSION =
  "KCR-R08-MILESTONE-2026.08-v1" as const

export interface R08MilestoneEnrichmentRecord {
  companyId: string
  stockCode: string
  delayEventCount: number
}

export interface R08MilestoneEnrichment {
  schemaVersion: typeof R08_MILESTONE_ENRICHMENT_SCHEMA_VERSION
  dataVersion: string
  asOfDate: string
  windowStart: string
  windowEnd: string
  method: string
  limitations: string
  audit: {
    targetCompanyCount: number
    scannedCompanyCount: number
    nonzeroCompanyCount: number
    zeroCompanyCount: number
    totalDelayEventCount: number
    digitalNonzeroCompanyCount: number
    analogNonzeroCompanyCount: number
    supplementNonzeroCompanyCount: number
    primaryAnnouncementOnly: boolean
    zeroRequiresCompleteScan: boolean
    formalWeightedFulfillmentRateAvailable: boolean
  }
  records: R08MilestoneEnrichmentRecord[]
}

const ENRICHMENT_PREFIX = "r08-enrichment:"

function sourceId(stockCode: string) {
  return `${ENRICHMENT_PREFIX}source:${stockCode}`
}

function observationId(stockCode: string) {
  return `${ENRICHMENT_PREFIX}observation:${stockCode}`
}

function queryUrl(stockCode: string, enrichment: R08MilestoneEnrichment) {
  const parameters = new URLSearchParams({
    jsonCallBack: "callback",
    isPagination: "true",
    "pageHelp.pageSize": "100",
    "pageHelp.pageNo": "1",
    "pageHelp.beginPage": "1",
    "pageHelp.endPage": "1",
    START_DATE: enrichment.windowStart,
    END_DATE: enrichment.windowEnd,
    SECURITY_CODE: stockCode,
    TITLE: "延期",
    BULLETIN_TYPE: "",
  })
  return `https://query.sse.com.cn/security/stock/queryCompanyBulletinNew.do?${parameters}`
}

function assertR08MilestoneEnrichment(
  dataset: IndustryRiskDataset,
  enrichment: R08MilestoneEnrichment
) {
  if (enrichment.schemaVersion !== R08_MILESTONE_ENRICHMENT_SCHEMA_VERSION) {
    throw new Error("R08 里程碑补充数据版本不受支持。")
  }
  if (
    !enrichment.audit.primaryAnnouncementOnly ||
    !enrichment.audit.zeroRequiresCompleteScan ||
    enrichment.audit.formalWeightedFulfillmentRateAvailable
  ) {
    throw new Error("R08 里程碑补充数据的代理边界不完整。")
  }
  if (
    enrichment.records.length !== enrichment.audit.targetCompanyCount ||
    enrichment.records.length !== enrichment.audit.scannedCompanyCount
  ) {
    throw new Error("R08 里程碑补充数据没有覆盖全部目标企业。")
  }
  const nonzero = enrichment.records.filter((item) => item.delayEventCount > 0)
  const total = enrichment.records.reduce(
    (sum, item) => sum + item.delayEventCount,
    0
  )
  if (
    nonzero.length !== enrichment.audit.nonzeroCompanyCount ||
    enrichment.records.length - nonzero.length !==
      enrichment.audit.zeroCompanyCount ||
    total !== enrichment.audit.totalDelayEventCount
  ) {
    throw new Error("R08 里程碑补充数据的审计计数不一致。")
  }

  const companies = new Map(dataset.companies.map((item) => [item.id, item]))
  const seen = new Set<string>()
  for (const item of enrichment.records) {
    const company = companies.get(item.companyId)
    if (
      seen.has(item.companyId) ||
      !company ||
      company.stockCode !== item.stockCode ||
      !["digital-chip", "analog-chip", "semiconductor-supplement"].includes(
        company.peerGroupId ?? ""
      ) ||
      !Number.isInteger(item.delayEventCount) ||
      item.delayEventCount < 0
    ) {
      throw new Error(`R08 里程碑补充记录无效：${item.companyId}。`)
    }
    seen.add(item.companyId)
  }
}

function buildSource(
  dataset: IndustryRiskDataset,
  enrichment: R08MilestoneEnrichment,
  record: R08MilestoneEnrichmentRecord
): IndustryRiskSource {
  const company = dataset.companies.find((item) => item.id === record.companyId)
  return {
    id: sourceId(record.stockCode),
    sourceType: "官方交易所公告标题完整检索",
    institution: "上海证券交易所",
    title: `${record.stockCode} ${company?.shortName ?? record.companyId} R08 募投延期公告检索`,
    publicationDate: null,
    url: queryUrl(record.stockCode, enrichment),
    accessedAt: enrichment.asOfDate,
    notes: `${enrichment.windowStart}至${enrichment.windowEnd}统一窗口；仅统计上交所主公告文件，排除核查意见和附件。命中 ${record.delayEventCount} 次。`,
    redistribution: "public-link-only",
    peerGroupId: company?.peerGroupId,
  }
}

function buildObservation(
  enrichment: R08MilestoneEnrichment,
  record: R08MilestoneEnrichmentRecord
): IndustryRiskObservation {
  const isZero = record.delayEventCount === 0
  return {
    id: observationId(record.stockCode),
    companyId: record.companyId,
    indicatorId: "R08",
    metricName: "fundraising_project_delay_event_count",
    periodStart: enrichment.windowStart,
    periodEnd: enrichment.windowEnd,
    asOfDate: enrichment.windowEnd,
    numericValue: record.delayEventCount,
    textValue: null,
    unit: "次",
    status: "available",
    derived: true,
    formula: "统一窗口内上交所主公告中募投/募集资金投资项目延期公告去重计数",
    sourceId: sourceId(record.stockCode),
    sourcePage: null,
    confidenceLabel: isZero ? "中高" : "高",
    confidence: isZero ? 0.86 : 0.92,
    confidenceReason: isZero
      ? "按股票代码和延期关键词完成统一窗口公告扫描，未发现符合口径的主公告，写入显式零。"
      : `按股票代码和延期关键词完成统一窗口公告扫描，发现 ${record.delayEventCount} 条符合口径的主公告。`,
    limitations: enrichment.limitations,
    sourceIds: [sourceId(record.stockCode)],
  }
}

export function attachIndustryRiskR08MilestoneEnrichment(
  dataset: IndustryRiskDataset,
  enrichment: R08MilestoneEnrichment
) {
  assertR08MilestoneEnrichment(dataset, enrichment)
  const companyIds = new Set(enrichment.records.map((item) => item.companyId))
  const versionSuffix = `+${enrichment.dataVersion}`
  const attributionSuffix = "；R08 使用上交所募投延期主公告统一窗口检索"

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
        attributionSuffix
      )
        ? dataset.metadata.sourceAttribution
        : `${dataset.metadata.sourceAttribution}${attributionSuffix}`,
      scopeNote: `${dataset.metadata.scopeNote} R08 当前为统一窗口募投延期主公告次数代理，不等同于正式加权里程碑兑现率。`,
      peerGroups: dataset.metadata.peerGroups?.map((group) =>
        ["digital-chip", "analog-chip", "semiconductor-supplement"].includes(
          group.id
        )
          ? {
              ...group,
              scoreReadyIndicatorIds: [
                ...new Set([...group.scoreReadyIndicatorIds, "R08" as const]),
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
            companyIds.has(item.companyId) &&
            item.metricName === "fundraising_project_delay_event_count"
          )
      ),
      ...enrichment.records.map((item) => buildObservation(enrichment, item)),
    ],
    coverage: dataset.coverage.map((item) =>
      item.indicatorId === "R08" && companyIds.has(item.companyId)
        ? {
            ...item,
            status: "已覆盖-事件代理",
            usableForScoring: true,
            confidenceLabel: "中高",
            confidence: 0.88,
            reason:
              "已完成统一窗口上交所募投延期主公告检索，并取得可比事件计数；正式加权兑现率仍缺项目权重和延期月数。",
            recommendedNextSource:
              "募投计划基线、项目可行性报告和延期公告正文中的原计划/新计划日期。",
          }
        : item
    ),
  })
}
