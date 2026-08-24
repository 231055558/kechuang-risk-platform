import { readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { DatabaseSync } from "node:sqlite"

import {
  assertIndustryRiskDataset,
  type IndustryRiskDataset,
  type IndustryRiskNarrativeNewsEvidence,
  type IndustryRiskNarrativeNewsMetric,
} from "../src/domain/industry-risk-v1/index.ts"

type SqlValue = string | number | null
type SqlRow = Record<string, SqlValue>

const text = (value: SqlValue) => (value === null ? "" : String(value))
const nullableText = (value: SqlValue) => text(value).trim() || null
const number = (value: SqlValue) =>
  typeof value === "number" ? value : Number(value)
const nullableNumber = (value: SqlValue) =>
  value === null ? null : number(value)

function runtimeSourceId(row: SqlRow, peerGroupId: string) {
  const sourcePeerGroup = nullableText(row.source_peer_group_id) ?? peerGroupId
  return `${sourcePeerGroup}:source-${number(row.source_id)}`
}

export function importNarrativeNewsRuntime(
  dataset: IndustryRiskDataset,
  sqlitePath: string,
  maximumPerCompany = 50
) {
  const database = new DatabaseSync(resolve(sqlitePath), { readOnly: true })
  try {
    const companyByStockCode = new Map(
      dataset.companies.map((company) => [company.stockCode, company])
    )
    const sourceIds = new Set(dataset.sources.map((source) => source.id))
    const usedByCompany = new Map<string, number>()
    const narrativeNewsEvidence = (
      database
        .prepare(
          `SELECT n.*, c.stock_code, s.peer_group_id AS source_peer_group_id
           FROM narrative_news_evidence n
           JOIN companies c USING(company_id)
           JOIN sources s USING(source_id)
           ORDER BY c.stock_code, n.published_at DESC, n.news_id DESC`
        )
        .all() as SqlRow[]
    ).flatMap((row): IndustryRiskNarrativeNewsEvidence[] => {
      const company = companyByStockCode.get(text(row.stock_code))
      if (!company) return []
      const used = usedByCompany.get(company.id) ?? 0
      if (used >= maximumPerCompany) return []
      const sourceId = runtimeSourceId(
        row,
        company.peerGroupId ?? "digital-chip"
      )
      if (!sourceIds.has(sourceId)) return []
      usedByCompany.set(company.id, used + 1)
      return [
        {
          id: `${company.peerGroupId ?? "digital-chip"}:narrative-news-${number(row.news_id)}`,
          companyId: company.id,
          publishedAt: nullableText(row.published_at),
          title: text(row.title),
          summary: text(row.summary),
          mediaName: text(row.media_name),
          url: text(row.url),
          positive: number(row.positive_flag) === 1,
          negative: number(row.negative_flag) === 1,
          concept: number(row.concept_flag) === 1,
          conceptKeywords: text(row.concept_keywords)
            .split(";")
            .map((keyword) => keyword.trim())
            .filter(Boolean),
          sourceId,
          accessedAt: nullableText(row.accessed_at),
        },
      ]
    })

    const narrativeNewsMetrics = (
      database
        .prepare(
          `SELECT m.*, c.stock_code, s.peer_group_id AS source_peer_group_id
           FROM narrative_news_metrics m
           JOIN companies c USING(company_id)
           JOIN sources s USING(source_id)
           ORDER BY c.stock_code`
        )
        .all() as SqlRow[]
    ).flatMap((row): IndustryRiskNarrativeNewsMetric[] => {
      const company = companyByStockCode.get(text(row.stock_code))
      if (!company) return []
      const sourceId = runtimeSourceId(
        row,
        company.peerGroupId ?? "digital-chip"
      )
      if (!sourceIds.has(sourceId)) return []
      return [
        {
          companyId: company.id,
          cutoffDate: text(row.cutoff_date),
          newestDate: nullableText(row.newest_date),
          oldestDate: nullableText(row.oldest_date),
          hitsTotal: nullableNumber(row.hits_total),
          retrievedCount: number(row.retrieved_count),
          mediaCount: number(row.media_count),
          positiveCount: number(row.positive_count),
          negativeCount: number(row.negative_count),
          conceptCount: number(row.concept_count),
          positiveSharePercent: number(row.positive_share_pct),
          negativeSharePercent: number(row.negative_share_pct),
          toneBalancePercent: number(row.tone_balance_pct),
          conceptSharePercent: number(row.concept_share_pct),
          pagesFetched: number(row.pages_fetched),
          truncated: number(row.truncated) === 1,
          sourceId,
          limitations: text(row.limitations),
        },
      ]
    })

    return assertIndustryRiskDataset({
      ...dataset,
      narrativeNewsEvidence,
      narrativeNewsMetrics,
    })
  } finally {
    database.close()
  }
}

function main() {
  const [inputJson, inputSqlite, outputJson = inputJson, maximum = "50"] =
    process.argv.slice(2)
  if (!inputJson || !inputSqlite || !outputJson) {
    console.error(
      "用法：npm run import:narrative-news-runtime -- input.json master.sqlite [output.json] [每企业最大新闻数]"
    )
    process.exitCode = 1
    return
  }
  const dataset = JSON.parse(
    readFileSync(resolve(inputJson), "utf8")
  ) as IndustryRiskDataset
  const enriched = importNarrativeNewsRuntime(
    dataset,
    inputSqlite,
    Math.max(1, Number(maximum) || 50)
  )
  writeFileSync(resolve(outputJson), `${JSON.stringify(enriched, null, 2)}\n`)
  console.log(
    `已接入 ${enriched.narrativeNewsMetrics?.length ?? 0} 家企业叙事汇总、${enriched.narrativeNewsEvidence?.length ?? 0} 条最新新闻样本。`
  )
}

if (
  process.argv[1] &&
  import.meta.url === new URL(process.argv[1], "file:").href
) {
  main()
}
