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

const localPathPattern = /(?:[A-Za-z]:\\|\/Users\/|\/home\/|file:\/\/)/i

function isPublicUrl(value: SqlValue) {
  const normalized = nullableText(value)
  return normalized?.startsWith("https://") || normalized?.startsWith("http://")
    ? normalized
    : null
}

function publicText(value: SqlValue) {
  const normalized = text(value)
  return localPathPattern.test(normalized) ? "本地受限证据（路径已隐藏）" : normalized
}

function rows(database: DatabaseSync, sql: string) {
  return database.prepare(sql).all() as SqlRow[]
}

function tableExists(database: DatabaseSync, tableName: string) {
  return Boolean(
    database
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?"
      )
      .get(tableName)
  )
}

function optionalRows(database: DatabaseSync, tableName: string, sql: string) {
  return tableExists(database, tableName) ? rows(database, sql) : []
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

function nullableSourceId(value: SqlValue) {
  return value === null ? null : sourceId(value)
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
      sourceUrl: isPublicUrl(row.source_url),
      confidenceLabel: text(row.confidence),
      confidence: number(row.confidence_score),
    }))
    const companyIds = new Map(
      companies.map((company) => [company.sourceCompanyId, company.id])
    )
    const segmentNames = new Set(
      companies.map((company) => company.chainSegment).filter(Boolean)
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
      title: publicText(row.title),
      publicationDate: nullableText(row.publication_date),
      url: isPublicUrl(row.url),
      accessedAt: nullableText(row.accessed_at),
      notes: publicText(row.notes),
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
      textValue: localPathPattern.test(text(row.text_value)) ? "本地受限证据（路径已隐藏）" : nullableText(row.text_value),
      unit: nullableText(row.unit),
      status: text(row.status),
      derived: number(row.is_derived) === 1,
      formula: localPathPattern.test(text(row.formula)) ? "本地受限计算说明（路径已隐藏）" : nullableText(row.formula),
      sourceId: sourceId(row.source_id),
      sourcePage: nullableNumber(row.source_page),
      confidenceLabel: text(row.confidence),
      confidence: number(row.confidence_score),
      confidenceReason: text(row.confidence_reason),
      limitations: publicText(row.limitations),
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

    const observationKeys = new Set<string>()
    const normalizedObservations = [...observations]
      .sort((left, right) =>
        right.confidence - left.confidence ||
        (right.asOfDate ?? "").localeCompare(left.asOfDate ?? "") ||
        right.id.localeCompare(left.id)
      )
      .filter((item) => {
        const key = [item.companyId, item.indicatorId, item.metricName, item.asOfDate ?? ""].join("::")
        if (observationKeys.has(key)) return false
        observationKeys.add(key)
        return true
      })
    const coverageByKey = new Map<string, (typeof coverage)[number]>()
    for (const item of coverage) {
      const key = `${item.companyId}::${item.indicatorId}`
      const current = coverageByKey.get(key)
      if (!current || Number(item.usableForScoring) > Number(current.usableForScoring) || item.confidence > current.confidence) {
        coverageByKey.set(key, item)
      }
    }
    for (const company of companies) {
      for (const indicator of indicators) {
        const key = `${company.id}::${indicator.id}`
        if (!coverageByKey.has(key)) {
          coverageByKey.set(key, {
            companyId: company.id,
            indicatorId: indicator.id,
            status: "missing",
            usableForScoring: false,
            confidenceLabel: "低",
            confidence: 0,
            reason: "主数据库尚未生成该企业指标的覆盖记录。",
            recommendedNextSource: "按指标数据需求补充可核验来源。",
          })
        }
      }
    }

    const dataset: IndustryRiskDataset = {
      metadata: {
        schemaVersion: INDUSTRY_RISK_DATA_SCHEMA_VERSION,
        dataVersion: meta.data_version,
        sourceDate: meta.created_at,
        reportingPeriod:
          meta.reporting_period || `截至 ${meta.created_at || "未知日期"}`,
        sectorLabel:
          segmentNames.size === 1
            ? `科创板${[...segmentNames][0]}企业`
            : "科创板芯片产业链",
        board: "科创板",
        sampleSize: companies.length,
        indicatorCount: indicators.length,
        sourceAttribution: "团队提供的科创板芯片企业风险指标数据库",
        scopeNote:
          meta.scope_note ||
          meta.report_scope ||
          "团队行业风险样本快照；不同企业使用各自最新可得正式报告。",
        scoreReadyIndicatorIds,
      },
      companies,
      indicators,
      sources,
      observations: normalizedObservations,
      coverage: [...coverageByKey.values()],
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
        url: isPublicUrl(row.announcement_url),
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
        sourceUrl: isPublicUrl(row.source_url),
        confidenceLabel: text(row.confidence),
        confidence: number(row.confidence_score),
        limitations: text(row.limitations),
        redistribution: "licensed-derived" as const,
      })),
      deepSearchEvents: optionalRows(
        database,
        "deep_search_events",
        "SELECT * FROM deep_search_events ORDER BY event_id"
      ).map((row) => ({
        id: `deep-event-${number(row.event_id)}`,
        companyId: companyIds.get(number(row.company_id)) ?? "",
        eventType: text(row.event_type),
        eventDate: nullableText(row.event_date),
        title: text(row.title),
        url: isPublicUrl(row.url),
        sourceChannel: text(row.source_channel),
        confidenceLabel: text(row.confidence),
        confidence: number(row.confidence_score),
        relatedIndicatorId: nullableText(
          row.related_indicator_id
        ) as IndustryRiskIndicatorId | null,
        notes: text(row.notes),
      })),
      externalSubjectEvidence: optionalRows(
        database,
        "external_subject_evidence",
        "SELECT * FROM external_subject_evidence ORDER BY evidence_id"
      ).map((row) => ({
        id: `external-subject-${number(row.evidence_id)}`,
        companyId: companyIds.get(number(row.company_id)) ?? "",
        eventId: row.event_id === null ? null : String(number(row.event_id)),
        subjectName: text(row.subject_name),
        subjectType: text(row.subject_type),
        relationType: text(row.relation_type),
        eventDate: nullableText(row.event_date),
        sourceTitle: publicText(row.source_title),
        sourceUrl: isPublicUrl(row.source_url),
        sourceInstitution: text(row.source_institution),
        evidenceQuote: publicText(row.evidence_quote),
        confidence: number(row.confidence_score),
        reviewStatus: text(row.review_status),
      })),
      supplementaryObservations: optionalRows(
        database,
        "supplementary_observations",
        "SELECT * FROM supplementary_observations ORDER BY supplementary_id"
      ).map((row) => ({
        id: `supplementary-${number(row.supplementary_id)}`,
        companyId: companyIds.get(number(row.company_id)) ?? "",
        factName: text(row.fact_name),
        period: nullableText(row.period),
        asOfDate: nullableText(row.as_of_date),
        numericValue: nullableNumber(row.numeric_value),
        textValue: nullableText(row.text_value),
        unit: nullableText(row.unit),
        relatedIndicatorId: nullableText(
          row.related_indicator_id
        ) as IndustryRiskIndicatorId | null,
        sourceId: nullableSourceId(row.source_id),
        sourcePage: nullableNumber(row.source_page),
        confidenceLabel: text(row.confidence),
        confidence: number(row.confidence_score),
        confidenceReason: text(row.confidence_reason),
        limitations: text(row.limitations),
        affectsScore: false as const,
      })),
      reportAvailability: optionalRows(
        database,
        "report_availability",
        "SELECT * FROM report_availability ORDER BY company_id"
      ).map((row) => ({
        companyId: companyIds.get(number(row.company_id)) ?? "",
        annual2025Status: text(row.annual_2025_status),
        latestPeriod: text(row.latest_period),
        latestReportDate: nullableText(row.latest_report_date),
        latestReportTitle: text(row.latest_report_title),
        latestReportUrl: nullableText(row.latest_report_url),
        notes: text(row.notes),
      })),
      bonusDefinitions: optionalRows(
        database,
        "bonus_catalog",
        "SELECT * FROM bonus_catalog ORDER BY bonus_id"
      ).map((row) => ({
        id: text(row.bonus_id),
        name: text(row.name),
        definition: text(row.definition),
        scoringRule: text(row.scoring_rule),
        maxScore: number(row.max_score),
        dataSource: text(row.data_source),
        basis: text(row.basis),
        affectsScore: false as const,
        status: "definition-only" as const,
      })),
    }
    // The crawler master contains internal provenance paths.  This adapter is
    // read-only and must not leak them into the web API, including less common
    // auxiliary fields added by future collectors.
    const safeDataset = JSON.parse(
      JSON.stringify(dataset),
      (_key, value: unknown) =>
        typeof value === "string" && localPathPattern.test(value)
          ? "本地受限证据（路径已隐藏）"
          : value
    ) as IndustryRiskDataset
    return assertIndustryRiskDataset(safeDataset)
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
