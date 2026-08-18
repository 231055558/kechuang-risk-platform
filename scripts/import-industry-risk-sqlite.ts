import { writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { DatabaseSync } from "node:sqlite"

import {
  INDUSTRY_RISK_DATA_SCHEMA_VERSION,
  INDUSTRY_RISK_NARRATIVE_INDICATOR_IDS,
  assertIndustryRiskDataset,
  type IndustryRiskDataset,
  type IndustryRiskIndicatorId,
  type IndustryRiskRedistribution,
} from "../src/domain/industry-risk-v1/index.ts"

type SqlValue = string | number | null
type SqlRow = Record<string, SqlValue>

function text(value: SqlValue) {
  return value === null ? "" : String(value)
}

function nullableText(value: SqlValue) {
  const normalized = text(value).trim()
  return normalized || null
}

function number(value: SqlValue) {
  return typeof value === "number" ? value : Number(value)
}

function nullableNumber(value: SqlValue) {
  return value === null ? null : number(value)
}

function rows(database: DatabaseSync, sql: string) {
  return database.prepare(sql).all() as SqlRow[]
}

function metadata(database: DatabaseSync) {
  return Object.fromEntries(
    rows(database, "SELECT key, value FROM metadata ORDER BY key").map(
      (row) => [text(row.key), text(row.value)]
    )
  )
}

function companyId(stockCode: SqlValue) {
  return `star-${text(stockCode)}`
}

function sourceId(value: SqlValue) {
  return `source-${number(value)}`
}

function redistribution(row: SqlRow): IndustryRiskRedistribution {
  const sourceType = text(row.source_type)
  const institution = text(row.institution)
  if (sourceType.includes("天眼查") || institution.includes("天眼查")) {
    return "licensed-derived"
  }
  if (sourceType.includes("用户提供")) return "manual"
  return "public-link-only"
}

export function importIndustryRiskSqlite(
  inputPath: string
): IndustryRiskDataset {
  const database = new DatabaseSync(resolve(inputPath), { readOnly: true })
  try {
    const meta = metadata(database)
    const companies = rows(
      database,
      "SELECT * FROM companies ORDER BY stock_code"
    ).map((row) => ({
      id: companyId(row.stock_code),
      sourceCompanyId: number(row.company_id),
      stockCode: text(row.stock_code),
      shortName: text(row.short_name),
      exchangeName: text(row.current_sse_name),
      fullName: text(row.full_name),
      aliases: text(row.aliases)
        .split(";")
        .map((alias) => alias.trim())
        .filter(Boolean),
      chainSegment: text(row.chain_segment),
      board: text(row.board),
      exchange: text(row.exchange),
      listDate: nullableText(row.list_date),
      industry: text(row.sse_industry),
      selectionReason: text(row.selection_reason),
      sourceUrl: nullableText(row.source_url),
      confidenceLabel: text(row.confidence),
      confidence: number(row.confidence_score),
    }))
    const companyIds = new Map(
      companies.map((company) => [company.sourceCompanyId, company.id])
    )

    const narrativeIds = new Set<string>(INDUSTRY_RISK_NARRATIVE_INDICATOR_IDS)
    const indicators = rows(
      database,
      "SELECT * FROM indicator_catalog ORDER BY indicator_id"
    ).map((row) => {
      const id = text(row.indicator_id) as IndustryRiskIndicatorId
      return {
        id,
        kind: narrativeIds.has(id)
          ? ("narrative-validation" as const)
          : ("weighted" as const),
        primaryCategory: text(row.primary_category),
        label: text(row.secondary_indicator),
        definition: text(row.definition),
        rawValueFormula: text(row.calculation_rule),
        updateFrequency: text(row.update_frequency),
        academicSource: text(row.academic_source),
        entityType: text(row.entity_type),
        relation: text(row.relation),
        sourceRow: number(row.source_row),
      }
    })

    const sources = rows(
      database,
      "SELECT * FROM sources ORDER BY source_id"
    ).map((row) => ({
      id: sourceId(row.source_id),
      sourceType: text(row.source_type),
      institution: text(row.institution),
      title: text(row.title),
      publicationDate: nullableText(row.publication_date),
      url: nullableText(row.url),
      accessedAt: nullableText(row.accessed_at),
      notes: text(row.notes),
      redistribution: redistribution(row),
    }))

    const observations = rows(
      database,
      "SELECT * FROM observations ORDER BY observation_id"
    ).map((row) => ({
      id: `observation-${number(row.observation_id)}`,
      companyId: companyIds.get(number(row.company_id)) ?? "",
      indicatorId: text(row.indicator_id) as IndustryRiskIndicatorId,
      metricName: text(row.metric_name),
      periodStart: nullableText(row.period_start),
      periodEnd: nullableText(row.period_end),
      asOfDate: nullableText(row.as_of_date),
      numericValue: nullableNumber(row.numeric_value),
      textValue: nullableText(row.text_value),
      unit: nullableText(row.unit),
      status: text(row.status),
      derived: number(row.is_derived) === 1,
      formula: nullableText(row.formula),
      sourceId: sourceId(row.source_id),
      sourcePage: nullableNumber(row.source_page),
      confidenceLabel: text(row.confidence),
      confidence: number(row.confidence_score),
      confidenceReason: text(row.confidence_reason),
      limitations: text(row.limitations),
    }))

    const coverage = rows(
      database,
      "SELECT * FROM indicator_coverage ORDER BY company_id, indicator_id"
    ).map((row) => ({
      companyId: companyIds.get(number(row.company_id)) ?? "",
      indicatorId: text(row.indicator_id) as IndustryRiskIndicatorId,
      status: text(row.coverage_status),
      usableForScoring: number(row.usable_for_scoring) === 1,
      confidenceLabel: text(row.confidence),
      confidence: number(row.confidence_score),
      reason: text(row.reason),
      recommendedNextSource: text(row.recommended_next_source),
    }))

    const scoreReadyIndicatorIds = rows(
      database,
      `SELECT indicator_id
       FROM indicator_coverage
       WHERE usable_for_scoring = 1
       GROUP BY indicator_id
       HAVING COUNT(*) = (SELECT COUNT(*) FROM companies)
       ORDER BY indicator_id`
    ).map((row) => text(row.indicator_id) as IndustryRiskIndicatorId)

    const dataset: IndustryRiskDataset = {
      metadata: {
        schemaVersion: INDUSTRY_RISK_DATA_SCHEMA_VERSION,
        dataVersion: meta.data_version,
        sourceDate: meta.created_at,
        reportingPeriod: meta.reporting_period,
        sectorLabel: "科创板芯片产业链",
        board: "科创板",
        sampleSize: companies.length,
        indicatorCount: indicators.length,
        sourceAttribution: "团队提供的科创板芯片企业风险指标数据库",
        scopeNote: meta.scope_note,
        scoreReadyIndicatorIds,
      },
      companies,
      indicators,
      sources,
      observations,
      coverage,
      screeningHits: rows(
        database,
        "SELECT * FROM screening_hits ORDER BY hit_id"
      ).map((row) => ({
        id: `screening-${number(row.hit_id)}`,
        companyId: companyIds.get(number(row.company_id)) ?? "",
        sourceList: text(row.source_list),
        listedName: text(row.listed_name),
        alternativeNames: text(row.alt_names),
        startDate: nullableText(row.start_date),
        noticeUrl: nullableText(row.federal_register_notice),
        sourceListUrl: nullableText(row.source_list_url),
        sourceInformationUrl: nullableText(row.source_information_url),
        matchScope: text(row.match_scope),
        confidenceLabel: text(row.confidence),
        confidence: number(row.confidence_score),
        confidenceReason: text(row.confidence_reason),
      })),
      inquiryEvidence: rows(
        database,
        "SELECT * FROM inquiry_evidence ORDER BY evidence_id"
      ).map((row) => ({
        id: `inquiry-${number(row.evidence_id)}`,
        companyId: companyIds.get(number(row.company_id)) ?? "",
        announcementDate: nullableText(row.announcement_date),
        title: text(row.announcement_title),
        url: nullableText(row.announcement_url),
        topicKey: text(row.inquiry_topic_key),
        countedAsInquiry: number(row.counted_as_inquiry) === 1,
        confidenceLabel: text(row.confidence),
        confidence: number(row.confidence_score),
        notes: text(row.notes),
      })),
      litigationEvidence: rows(
        database,
        "SELECT * FROM litigation_evidence ORDER BY evidence_id"
      ).map((row) => ({
        id: `litigation-${number(row.evidence_id)}`,
        companyId: companyIds.get(number(row.company_id)) ?? "",
        cause: text(row.cause),
        court: text(row.court),
        hearingTime: nullableText(row.hearing_time),
        role: text(row.role),
        sourceUrl: nullableText(row.source_url),
        confidenceLabel: text(row.confidence),
        confidence: number(row.confidence_score),
        limitations: text(row.limitations),
        redistribution: "licensed-derived" as const,
      })),
    }
    return assertIndustryRiskDataset(dataset)
  } finally {
    database.close()
  }
}

function main() {
  const [inputPath, outputPath] = process.argv.slice(2)
  if (!inputPath || !outputPath) {
    console.error(
      "用法：npm run import:industry-risk -- input.sqlite output.json"
    )
    process.exitCode = 1
    return
  }
  const dataset = importIndustryRiskSqlite(inputPath)
  writeFileSync(resolve(outputPath), `${JSON.stringify(dataset, null, 2)}\n`)
  console.log(
    `已导入 ${dataset.companies.length} 家企业、${dataset.indicators.length} 项指标、${dataset.observations.length} 条观测。`
  )
}

if (
  process.argv[1] &&
  import.meta.url === new URL(process.argv[1], "file:").href
) {
  main()
}
