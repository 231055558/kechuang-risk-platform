import type {
  IndustryRiskDataset,
  IndustryRiskObservation,
  IndustryRiskSource,
} from "./model.ts"
import { assertIndustryRiskDataset } from "./validation.ts"

export const R17_EXPOSURE_ENRICHMENT_SCHEMA_VERSION =
  "KCR-R17-EXPOSURE-2026.08-v1" as const

export interface R17ExposureEnrichmentRecord {
  companyId: string
  stockCode: string
  evidenceDate: string
  sourceTitle: string
  sourceUrl: string
  excerpt: string
  confidence: number
}

export interface R17ExposureEnrichment {
  schemaVersion: typeof R17_EXPOSURE_ENRICHMENT_SCHEMA_VERSION
  dataVersion: string
  asOfDate: string
  method: string
  audit: {
    targetCompanyCount: number
    archivedAnnualReportCount: number
    exchangeFullTextDocumentsScreened: number
    exchangeFullTextMatchedCompanyCount: number
    confirmedExposureCount: number
    conditionalExposureExcludedCount: number
    contextOnlyExcludedCount: number
    explicitZeroCount: number
    paidApiCallCount: number
  }
  records: R17ExposureEnrichmentRecord[]
}

const ENRICHMENT_PREFIX = "r17-exposure:"

function sourceId(stockCode: string) {
  return `${ENRICHMENT_PREFIX}source:${stockCode}`
}

function observationId(stockCode: string) {
  return `${ENRICHMENT_PREFIX}observation:${stockCode}`
}

function assertEnrichment(
  dataset: IndustryRiskDataset,
  enrichment: R17ExposureEnrichment
) {
  if (enrichment.schemaVersion !== R17_EXPOSURE_ENRICHMENT_SCHEMA_VERSION) {
    throw new Error("R17 境外采购暴露补充数据版本不受支持。")
  }
  if (
    enrichment.records.length !== enrichment.audit.confirmedExposureCount ||
    enrichment.audit.targetCompanyCount !== dataset.companies.length ||
    enrichment.audit.explicitZeroCount !== 0 ||
    enrichment.audit.paidApiCallCount !== 0
  ) {
    throw new Error("R17 境外采购暴露补充数据的审计计数不一致。")
  }

  const companies = new Map(dataset.companies.map((item) => [item.id, item]))
  const seen = new Set<string>()
  for (const record of enrichment.records) {
    const company = companies.get(record.companyId)
    if (
      seen.has(record.companyId) ||
      !company ||
      company.stockCode !== record.stockCode ||
      !/^https:\/\/www\.sse\.com\.cn\//.test(record.sourceUrl) ||
      record.excerpt.length < 8 ||
      record.excerpt.length > 360 ||
      record.confidence < 0.8 ||
      record.confidence > 1
    ) {
      throw new Error(`R17 境外采购暴露记录无效：${record.companyId}。`)
    }
    seen.add(record.companyId)
  }
}

function buildSource(
  dataset: IndustryRiskDataset,
  enrichment: R17ExposureEnrichment,
  record: R17ExposureEnrichmentRecord
): IndustryRiskSource {
  const company = dataset.companies.find((item) => item.id === record.companyId)
  return {
    id: sourceId(record.stockCode),
    sourceType: "上交所公告正文与已归档年报定向复核",
    institution: "上海证券交易所",
    title: record.sourceTitle,
    publicationDate: record.evidenceDate,
    url: record.sourceUrl,
    accessedAt: enrichment.asOfDate,
    notes: `${record.stockCode} ${company?.shortName ?? record.companyId}：官方材料确认存在境外采购、境外供应商或进口原材料暴露；未披露可用于正式公式的境外采购金额占比。`,
    redistribution: "public-link-only",
    peerGroupId: company?.peerGroupId,
  }
}

function buildObservation(
  record: R17ExposureEnrichmentRecord
): IndustryRiskObservation {
  return {
    id: observationId(record.stockCode),
    companyId: record.companyId,
    indicatorId: "R17",
    metricName: "verified_external_procurement_disclosure",
    periodStart: null,
    periodEnd: null,
    asOfDate: record.evidenceDate,
    numericValue: null,
    textValue: record.excerpt,
    unit: null,
    status: "available-unquantified",
    derived: false,
    formula: null,
    sourceId: sourceId(record.stockCode),
    sourcePage: null,
    confidenceLabel: record.confidence >= 0.9 ? "高" : "中高",
    confidence: record.confidence,
    confidenceReason:
      "Ego 对上交所标题与正文全文索引进行全样本筛查，并与已归档正式年报交叉复核。",
    limitations:
      "只能确认存在境外采购暴露；缺少境外供应商采购金额与总采购金额，不能形成正式进口依赖度或同业分位。",
    sourceIds: [sourceId(record.stockCode)],
  }
}

export function attachIndustryRiskR17ExposureEnrichment(
  dataset: IndustryRiskDataset,
  enrichment: R17ExposureEnrichment
) {
  assertEnrichment(dataset, enrichment)
  const companyIds = new Set(enrichment.records.map((item) => item.companyId))
  const versionSuffix = `+${enrichment.dataVersion}`
  const attributionSuffix =
    "；R17 使用上交所公告正文与已归档年报确认境外采购暴露"

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
      scopeNote: `${dataset.metadata.scopeNote} R17 已确认境外采购暴露的企业不再适用明确零值规则；未取得采购金额占比前仍不进入正式评分。`,
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
        (item) => !item.id.startsWith(`${ENRICHMENT_PREFIX}observation:`)
      ),
      ...enrichment.records.map(buildObservation),
    ],
    coverage: dataset.coverage.map((item) =>
      item.indicatorId === "R17" && companyIds.has(item.companyId)
        ? {
            ...item,
            status: "部分覆盖-确认境外暴露",
            usableForScoring: false,
            confidenceLabel: "中高",
            confidence: 0.88,
            reason:
              "官方材料已确认存在境外采购、境外供应商或进口原材料暴露，但缺少可计算进口依赖度的金额分子与分母。",
            recommendedNextSource:
              "采购明细、供应商国别台账、海关付汇记录或可核验的境外采购金额占比。",
          }
        : item
    ),
  })
}
