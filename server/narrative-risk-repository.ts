import type { QueryResultRow } from "pg"

import type { NarrativeRiskSourceMode } from "../src/domain/narrative-risk-v1/index.ts"

export interface Queryable {
  query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[]
  ): Promise<{ rows: Row[] }>
}

export interface NarrativeRuntimeSnapshot {
  schemaVersion: "KCR-NARRATIVE-RISK-2026.08-v1"
  dataVersion: string
  asOfDate: string
  sourceMode: NarrativeRiskSourceMode
  scopes: Array<Record<string, unknown>>
  companies: Array<Record<string, unknown>>
  scopeCompanies: Array<Record<string, unknown>>
  assessments: Array<Record<string, unknown>>
  metrics: Array<Record<string, unknown>>
  coverage: Array<Record<string, unknown>>
  events: Array<Record<string, unknown>>
  sources: Array<Record<string, unknown>>
  auditFindings: Array<Record<string, unknown>>
  latestRun: Record<string, unknown> | null
}

export interface NarrativeAnnualRuntimeSnapshot {
  schemaVersion: "KCR-NARRATIVE-RISK-2026.08-v1"
  dataVersion: string
  asOfDate: string
  sourceMode: NarrativeRiskSourceMode
  methodVersion: Record<string, unknown>
  companies: Array<Record<string, unknown>>
  methodology: Array<Record<string, unknown>>
  documents: Array<Record<string, unknown>>
  observations: Array<Record<string, unknown>>
  peerBenchmarks: Array<Record<string, unknown>>
  toneAudits: Array<Record<string, unknown>>
  audit: Record<string, unknown>
}

export interface NarrativeIndustryRuntimeSnapshot {
  schemaVersion: "KCR-NARRATIVE-RISK-2026.08-v1"
  dataVersion: string
  asOfDate: string
  sourceMode: NarrativeRiskSourceMode
  companies: Array<Record<string, unknown>>
  industryGroups: Array<Record<string, unknown>>
  methodology: Array<Record<string, unknown>>
  documents: Array<Record<string, unknown>>
  observations: Array<Record<string, unknown>>
  industryStatistics: Array<Record<string, unknown>>
  audit: Record<string, unknown>
}

function dateOnly(value: unknown) {
  if (value instanceof Date) {
    const pad = (part: number) => String(part).padStart(2, "0")
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`
  }
  if (typeof value === "string") return value.slice(0, 10)
  return null
}

function iso(value: unknown) {
  if (value instanceof Date) return value.toISOString()
  return typeof value === "string" ? value : null
}

export async function readNarrativeRuntimeSnapshot(
  client: Queryable,
  sourceMode: NarrativeRiskSourceMode
): Promise<NarrativeRuntimeSnapshot> {
  const [
    scopesResult,
    companiesResult,
    scopeCompaniesResult,
    assessmentsResult,
    metricsResult,
    coverageResult,
    eventsResult,
    sourcesResult,
    findingsResult,
    runResult,
    enrichmentResult,
  ] = await Promise.all([
    client.query(`
      SELECT scope_id AS "scopeId", label, methodology,
             as_of_date AS "asOfDate", company_count AS "companyCount"
      FROM narrative_risk.scopes ORDER BY scope_id
    `),
    client.query(`
      SELECT company_key AS "companyKey", short_name AS "shortName",
             full_name AS "fullName", stock_code AS "stockCode", aliases
      FROM narrative_risk.companies ORDER BY short_name, company_key
    `),
    client.query(`
      SELECT scope_id AS "scopeId", company_key AS "companyKey",
             sample_role AS "sampleRole", window_start AS "windowStart",
             window_end AS "windowEnd", data_cutoff AS "dataCutoff",
             sample_status AS "sampleStatus"
      FROM narrative_risk.scope_companies ORDER BY scope_id, company_key
    `),
    client.query(`
      SELECT scope_id AS "scopeId", company_key AS "companyKey",
             objective_risk_score AS "objectiveRiskScore",
             weighted_coverage AS "weightedCoverage", pdqi_value AS "pdqiValue",
             pdqi_variant AS "pdqiVariant", itag_value AS "itagValue",
             itag_variant AS "itagVariant", tone_value AS "toneValue",
             tone_variant AS "toneVariant", joint_risk_level AS "jointRiskLevel",
             conclusion, validation_status AS "validationStatus"
      FROM narrative_risk.assessments ORDER BY scope_id, company_key
    `),
    client.query(`
      SELECT m.metric_id AS "metricId", m.scope_id AS "scopeId",
             m.company_key AS "companyKey", m.indicator_id AS "indicatorId",
             m.metric_name AS "metricName", m.metric_variant AS "metricVariant",
             m.metric_class AS "metricClass",
             m.raw_numeric_value AS "rawNumericValue",
             m.validated_numeric_value AS "validatedNumericValue",
             m.unit, m.status, m.validation_status AS "validationStatus",
             m.confidence_score AS "confidenceScore",
             m.confidence_level AS "confidenceLevel", m.formula,
             m.as_of_date AS "asOfDate", m.limitation,
             m.is_score_eligible AS "scoreEligible",
             m.score_exclusion_reason AS "scoreExclusionReason",
             COUNT(l.source_key)::INT AS "sourceCount"
      FROM narrative_risk.metrics m
      LEFT JOIN narrative_risk.metric_source_links l USING(metric_id)
      GROUP BY m.metric_id
      ORDER BY m.company_key, m.scope_id, m.indicator_id, m.metric_id
    `),
    client.query(`
      SELECT scope_id AS "scopeId", company_key AS "companyKey",
             indicator_id AS "indicatorId", coverage_status AS "coverageStatus",
             original_definition_usable AS "originalDefinitionUsable",
             document_method_usable AS "documentMethodUsable",
             confidence_score AS "confidenceScore",
             confidence_level AS "confidenceLevel",
             observation_count AS "observationCount",
             numeric_observation_count AS "numericObservationCount", limitation
      FROM narrative_risk.coverage ORDER BY company_key, scope_id, indicator_id
    `),
    client.query(`
      SELECT event_id AS "eventId", scope_id AS "scopeId",
             company_key AS "companyKey", event_date AS "eventDate",
             event_title AS "eventTitle", event_type AS "eventType",
             feature_role AS "featureRole", label_role AS "labelRole",
             severity, source_id AS "sourceId", notes
      FROM narrative_risk.events ORDER BY company_key, event_date DESC, event_id
    `),
    client.query(`
      SELECT s.source_key AS "sourceKey", s.source_id AS "sourceId",
             s.scope_id AS "scopeId", s.company_key AS "companyKey",
             s.channel, s.title, s.institution,
             s.publication_date AS "publicationDate",
             COALESCE(NULLIF(s.validated_url, ''), NULLIF(s.url, '')) AS "canonicalUrl",
             s.validation_status AS "validationStatus",
             s.raw_occurrence_count AS "rawOccurrenceCount",
             s.web_url_required AS "webUrlRequired",
             EXISTS(
               SELECT 1 FROM narrative_risk.browser_validations b
               WHERE b.source_id = s.source_id AND b.status = 'confirmed'
             ) AS "browserValidated",
             a.status AS "artifactStatus", a.artifact_kind AS "artifactKind",
             a.http_status AS "httpStatus", a.content_type AS "contentType",
             a.byte_size AS "byteSize", a.content_sha256 AS "contentSha256",
             a.fetched_at AS "fetchedAt", a.public_excerpt AS "publicExcerpt"
      FROM narrative_risk.sources s
      LEFT JOIN narrative_risk.source_artifacts a USING(source_key)
      ORDER BY s.company_key NULLS LAST, s.publication_date DESC NULLS LAST, s.source_id
    `),
    client.query(`
      SELECT finding_id AS "findingId", scope_id AS "scopeId",
             company_key AS "companyKey", source_id AS "sourceId",
             metric_id AS "metricId", severity, status, title, detail
      FROM narrative_risk.audit_findings
      ORDER BY created_at DESC, finding_id
    `),
    client.query(`
      SELECT run_id AS "runId", status, completed_at AS "completedAt"
      FROM narrative_risk.import_runs
      WHERE status = 'succeeded'
      ORDER BY completed_at DESC NULLS LAST LIMIT 1
    `),
    client.query(`
      SELECT summary
      FROM platform.data_update_runs
      WHERE job_name = 'narrative-risk-enrichment' AND status = 'succeeded'
      ORDER BY completed_at DESC NULLS LAST, update_run_id DESC LIMIT 1
    `),
  ])

  const latestRun = runResult.rows[0] ?? null
  const enrichment = enrichmentResult.rows[0]?.summary as
    Record<string, unknown> | undefined
  const baseVersion = String(latestRun?.runId ?? "narrative-risk-unversioned")
  const enrichmentVersion =
    typeof enrichment?.manifestRunId === "string"
      ? `+${enrichment.manifestRunId}`
      : ""
  const enrichmentAsOfDate =
    typeof enrichment?.asOfDate === "string" ? enrichment.asOfDate : null
  const scopeDates = scopesResult.rows
    .map((row) => dateOnly(row.asOfDate))
    .filter((value): value is string => value !== null)

  const normalizeDates = (rows: Array<Record<string, unknown>>) =>
    rows.map((row) => {
      const next = { ...row }
      for (const key of ["asOfDate", "dataCutoff", "publicationDate"]) {
        if (key in next) next[key] = dateOnly(next[key])
      }
      for (const key of ["windowStart", "windowEnd", "fetchedAt"]) {
        if (key in next) next[key] = iso(next[key])
      }
      return next
    })

  return {
    schemaVersion: "KCR-NARRATIVE-RISK-2026.08-v1",
    dataVersion: `${baseVersion}${enrichmentVersion}`,
    asOfDate: enrichmentAsOfDate ?? scopeDates.sort().at(-1) ?? "2026-08-26",
    sourceMode,
    scopes: normalizeDates(scopesResult.rows),
    companies: companiesResult.rows,
    scopeCompanies: normalizeDates(scopeCompaniesResult.rows),
    assessments: assessmentsResult.rows,
    metrics: normalizeDates(metricsResult.rows),
    coverage: coverageResult.rows,
    events: eventsResult.rows,
    sources: normalizeDates(sourcesResult.rows),
    auditFindings: findingsResult.rows,
    latestRun: latestRun
      ? { ...latestRun, completedAt: iso(latestRun.completedAt) }
      : null,
  }
}

export async function readNarrativeAnnualRuntimeSnapshot(
  client: Queryable,
  sourceMode: NarrativeRiskSourceMode
): Promise<NarrativeAnnualRuntimeSnapshot> {
  const [
    methodResult,
    companiesResult,
    documentsResult,
    observationsResult,
    peersResult,
    toneResult,
  ] = await Promise.all([
    client.query(`
        SELECT method_version AS "methodVersion", method_name AS name,
               effective_date AS "effectiveDate",
               source_document_sha256 AS "sourceDocumentSha256",
               innovation_lexicon_status AS "innovationLexiconStatus",
               innovation_lexicon_size AS "innovationLexiconSize",
               innovation_lexicon_sha256 AS "innovationLexiconSha256",
               stopword_list_sha256 AS "stopwordListSha256",
               sentiment_dictionary_name AS "sentimentDictionaryName",
               sentiment_dictionary_sha256 AS "sentimentDictionarySha256",
               sentiment_dictionary_source AS "sentimentDictionarySource",
               peer_benchmark_status AS "peerBenchmarkStatus", methodology, notes
        FROM narrative_risk.method_versions
        WHERE method_version = 'narrative-method-revised-2026-08-27-v2'
      `),
    client.query(
      `
        SELECT c.company_key AS "companyKey", c.short_name AS "companyName",
               c.stock_code AS "stockCode",
               CASE
                 WHEN c.company_key IN ('enflame', 'semidrive') THEN '未上市'
                 WHEN c.company_key = 'zuojiang-technology' THEN '已退市'
                 ELSE '上市'
               END AS "listingStatus"
        FROM narrative_risk.companies c
        WHERE c.company_key = ANY($1::TEXT[])
        ORDER BY c.short_name
      `,
      [
        [
          "cambricon",
          "hengrui-pharma",
          "huami-electronics",
          "baili-tianheng",
          "zuojiang-technology",
        ],
      ]
    ),
    client.query(`
        SELECT document_id AS "documentId", company_key AS "companyKey",
               report_year AS year, title, official_url AS "officialUrl",
               publication_date AS "publicationDate", archive_status AS "archiveStatus",
               parse_status AS "parseStatus", file_sha256 AS "fileSha256",
               byte_size AS "byteSize", page_count AS "pageCount",
               section_coverage AS "sectionCoverage",
               browser_validation AS "browserValidation"
        FROM narrative_risk.annual_documents
        WHERE method_version = 'narrative-method-revised-2026-08-27-v2'
        ORDER BY company_key, report_year
      `),
    client.query(`
        SELECT company_key AS "companyKey", report_year AS year,
               metric_key AS "metricKey", numeric_value AS value,
               annual_change_rate AS "changeRate", risk_score AS "riskScore",
               risk_score_change AS "riskScoreChange", status,
               missing_reason AS "missingReason", document_id AS "documentId",
               method_version AS "methodVersion", details
        FROM narrative_risk.annual_metric_observations
        WHERE method_version = 'narrative-method-revised-2026-08-27-v2'
        ORDER BY metric_key, company_key, report_year
      `),
    client.query(`
        SELECT report_year AS year, industry_code AS "industryCode",
               industry_level AS "industryLevel",
               effective_sample_size AS "effectiveSampleSize",
               talk_mean AS "talkMean",
               talk_standard_deviation AS "talkStandardDeviation",
               action_mean AS "actionMean",
               action_standard_deviation AS "actionStandardDeviation",
               divergence_minimum AS "divergenceMinimum",
               divergence_maximum AS "divergenceMaximum",
               fallback_reason AS "fallbackReason", audit
        FROM narrative_risk.peer_benchmarks
        WHERE method_version = 'narrative-method-revised-2026-08-27-v2'
        ORDER BY report_year, industry_level, industry_code
      `),
    client.query(`
        SELECT company_key AS "companyKey", report_year AS year,
               source_url AS "sourceUrl", answer_count AS "answerCount",
               dictionary_review AS "dictionaryReview", model_review AS "modelReview",
               model_review_reason AS "modelReviewReason"
        FROM narrative_risk.tone_audits
        WHERE method_version = 'narrative-method-revised-2026-08-27-v2'
        ORDER BY company_key, report_year
      `),
  ])

  const method = methodResult.rows[0]
  if (!method) throw new Error("新版年度趋势方法版本尚未导入。")
  const yearsByCompany = new Map<string, number[]>()
  for (const document of documentsResult.rows) {
    const key = String(document.companyKey)
    yearsByCompany.set(key, [
      ...(yearsByCompany.get(key) ?? []),
      Number(document.year),
    ])
  }
  const companies = companiesResult.rows.map((company) => {
    const includedYears = (
      yearsByCompany.get(String(company.companyKey)) ?? []
    ).sort()
    return {
      ...company,
      includedYears,
      exclusionReason:
        includedYears.length === 0 ? "未上市，不纳入年报趋势" : null,
    }
  })
  const observations = observationsResult.rows.map((row) => ({
    ...row,
    year: Number(row.year),
    value: row.value === null ? null : Number(row.value),
    changeRate: row.changeRate === null ? null : Number(row.changeRate),
    riskScore: row.riskScore === null ? null : Number(row.riskScore),
    riskScoreChange:
      row.riskScoreChange === null ? null : Number(row.riskScoreChange),
  }))
  const documents: Array<Record<string, unknown>> = documentsResult.rows.map(
    (row) => ({
      ...row,
      year: Number(row.year),
      publicationDate: dateOnly(row.publicationDate),
      byteSize: row.byteSize === null ? null : Number(row.byteSize),
      pageCount: row.pageCount === null ? null : Number(row.pageCount),
    })
  )
  const calculatedObservationCount = observations.filter(
    (row) => row.value !== null
  ).length
  const missingObservationCount =
    observations.length - calculatedObservationCount
  return {
    schemaVersion: "KCR-NARRATIVE-RISK-2026.08-v1",
    dataVersion: String(method.methodVersion),
    asOfDate: dateOnly(method.effectiveDate) ?? "2026-08-27",
    sourceMode,
    methodVersion: {
      ...method,
      effectiveDate: dateOnly(method.effectiveDate),
    },
    companies,
    methodology: Array.isArray(method.methodology)
      ? (method.methodology as Array<Record<string, unknown>>)
      : [],
    documents,
    observations,
    peerBenchmarks: peersResult.rows,
    toneAudits: toneResult.rows,
    audit: {
      generatedAt: new Date().toISOString(),
      targetReportCount: 21,
      archivedReportCount: documents.filter(
        (row) => row["archiveStatus"] === "已归档"
      ).length,
      parsedReportCount: documents.filter(
        (row) => row["parseStatus"] === "已解析"
      ).length,
      partialReportCount: documents.filter(
        (row) => row["parseStatus"] === "部分解析"
      ).length,
      toneYearCount: toneResult.rows.length,
      peerBenchmarkYearCount: peersResult.rows.length,
      missingObservationCount,
      calculatedObservationCount,
      publicPayloadContainsFullText: false,
      publicPayloadContainsPrivatePath: false,
    },
  }
}

export async function readNarrativeIndustryRuntimeSnapshot(
  client: Queryable,
  sourceMode: NarrativeRiskSourceMode
): Promise<NarrativeIndustryRuntimeSnapshot> {
  const runResult = await client.query(`
    SELECT data_version AS "dataVersion", as_of_date AS "asOfDate",
           methodology, industry_groups AS "industryGroups", audit
    FROM narrative_risk.industry_annual_runs
    ORDER BY imported_at DESC LIMIT 1
  `)
  const run = runResult.rows[0]
  if (!run) throw new Error("行业叙事风险年度数据尚未导入。")
  const dataVersion = String(run.dataVersion)
  const [companiesResult, documentsResult, observationsResult, statisticsResult] =
    await Promise.all([
      client.query(
        `SELECT company_id AS "companyId", company_name AS "companyName",
                stock_code AS "stockCode", peer_group_id AS "peerGroupId",
                industry_group_id AS "industryGroupId",
                included_years AS "includedYears"
         FROM narrative_risk.industry_annual_companies
         WHERE data_version=$1 ORDER BY company_name`,
        [dataVersion]
      ),
      client.query(
        `SELECT document_id AS "documentId", company_id AS "companyId",
                report_year AS year, title, official_url AS "officialUrl",
                publication_date AS "publicationDate",
                archive_status AS "archiveStatus", parse_status AS "parseStatus",
                file_sha256 AS sha256, byte_size AS "byteSize",
                page_count AS "pageCount", section_coverage AS "sectionCoverage"
         FROM narrative_risk.industry_annual_documents
         WHERE data_version=$1 ORDER BY company_id, report_year`,
        [dataVersion]
      ),
      client.query(
        `SELECT company_id AS "companyId", report_year AS year,
                metric_key AS "metricKey", numeric_value AS value, status,
                missing_reason AS "missingReason", document_id AS "documentId",
                details
         FROM narrative_risk.industry_annual_observations
         WHERE data_version=$1 ORDER BY metric_key, company_id, report_year`,
        [dataVersion]
      ),
      client.query(
        `SELECT industry_group_id AS "industryGroupId", report_year AS year,
                metric_key AS "metricKey", sample_size AS "sampleSize",
                mean_value AS mean, minimum_value AS minimum,
                maximum_value AS maximum,
                standard_deviation AS "standardDeviation",
                domain_minimum AS "domainMinimum", domain_maximum AS "domainMaximum"
         FROM narrative_risk.industry_annual_statistics
         WHERE data_version=$1 ORDER BY industry_group_id, metric_key, report_year`,
        [dataVersion]
      ),
    ])

  const numeric = (value: unknown) =>
    value === null || value === undefined ? null : Number(value)
  return {
    schemaVersion: "KCR-NARRATIVE-RISK-2026.08-v1",
    dataVersion,
    asOfDate: dateOnly(run.asOfDate) ?? "2026-08-27",
    sourceMode,
    companies: companiesResult.rows,
    industryGroups: Array.isArray(run.industryGroups)
      ? (run.industryGroups as Array<Record<string, unknown>>)
      : [],
    methodology: Array.isArray(run.methodology)
      ? (run.methodology as Array<Record<string, unknown>>)
      : [],
    documents: documentsResult.rows.map((row) => ({
      ...row,
      year: Number(row.year),
      publicationDate: dateOnly(row.publicationDate),
      byteSize: numeric(row.byteSize),
      pageCount: numeric(row.pageCount),
    })),
    observations: observationsResult.rows.map((row) => ({
      ...row,
      year: Number(row.year),
      value: numeric(row.value),
    })),
    industryStatistics: statisticsResult.rows.map((row) => ({
      ...row,
      year: Number(row.year),
      sampleSize: Number(row.sampleSize),
      mean: numeric(row.mean),
      minimum: numeric(row.minimum),
      maximum: numeric(row.maximum),
      standardDeviation: numeric(row.standardDeviation),
      domainMinimum: numeric(row.domainMinimum),
      domainMaximum: numeric(row.domainMaximum),
    })),
    audit: (run.audit ?? {}) as Record<string, unknown>,
  }
}
