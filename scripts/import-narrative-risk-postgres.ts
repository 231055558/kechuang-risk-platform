import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { basename, resolve } from "node:path"

import { Client, type ClientConfig } from "pg"

type JsonRecord = Record<string, unknown>

interface NarrativePayload {
  run: JsonRecord
  scopes: JsonRecord[]
  companies: JsonRecord[]
  scopeCompanies: JsonRecord[]
  assessments: JsonRecord[]
  sources: JsonRecord[]
  metrics: JsonRecord[]
  metricSourceLinks: JsonRecord[]
  coverage: JsonRecord[]
  events: JsonRecord[]
  auditFindings: JsonRecord[]
  browserValidations: JsonRecord[]
  stats: Record<string, number>
}

const DEFAULT_PAYLOAD =
  "outputs/01a033a3-81ea-7421-a89c-2fa13333c648/narrative-risk-postgres-payload_2026-08-26.json"
const MIGRATION_PATH = resolve("db/migrations/002_narrative_risk.sql")
const MAX_QUERY_PARAMETERS = 60_000

function clientConfig(): ClientConfig {
  if (process.env.DATABASE_URL) {
    return {
      application_name: "kechuang-narrative-risk-import",
      connectionString: process.env.DATABASE_URL,
    }
  }
  return {
    application_name: "kechuang-narrative-risk-import",
    database: process.env.PGDATABASE ?? "kechuang_risk",
    host: process.env.PGHOST ?? "/tmp",
    password: process.env.PGPASSWORD,
    port: Number(process.env.PGPORT ?? "5432"),
    user: process.env.PGUSER ?? process.env.USER,
  }
}

function quoteIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`
}

function payloadSha256(raw: string) {
  return createHash("sha256").update(raw).digest("hex")
}

function json(value: unknown) {
  return JSON.stringify(value ?? null)
}

function isoDate(value: unknown) {
  if (typeof value !== "string") return value ?? null
  const match = value.match(/^\d{4}-\d{2}-\d{2}/)
  return match?.[0] ?? null
}

function timestamp(value: unknown) {
  if (typeof value !== "string" || value.length === 0) return value ?? null
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value}T00:00:00+08:00`
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(value)) {
    return `${value.replace(" ", "T")}:00+08:00`
  }
  return value
}

async function applyMigration(client: Client) {
  const migrationName = basename(MIGRATION_PATH)
  const sql = readFileSync(MIGRATION_PATH, "utf8")
  const checksum = createHash("sha256").update(sql).digest("hex")
  const existing = await client.query<{ sha256: string }>(
    "SELECT sha256 FROM platform.schema_migrations WHERE migration_name = $1",
    [migrationName]
  )
  if (existing.rows[0]) {
    if (existing.rows[0].sha256 !== checksum) {
      throw new Error(`已应用迁移 ${migrationName} 的校验和发生变化。`)
    }
    return { migrationName, applied: false }
  }

  await client.query("BEGIN")
  try {
    await client.query(sql)
    await client.query(
      "INSERT INTO platform.schema_migrations(migration_name, sha256) VALUES ($1, $2)",
      [migrationName, checksum]
    )
    await client.query("COMMIT")
    return { migrationName, applied: true }
  } catch (error) {
    await client.query("ROLLBACK")
    throw error
  }
}

interface UpsertSpec {
  table: string
  columns: Array<[payloadKey: string, databaseColumn: string]>
  conflict: string[]
  jsonColumns?: string[]
  dateColumns?: string[]
  timestampColumns?: string[]
}

async function upsertRows(
  client: Client,
  rows: JsonRecord[],
  spec: UpsertSpec
) {
  if (rows.length === 0) return 0
  const databaseColumns = spec.columns.map(([, column]) => column)
  const jsonColumns = new Set(spec.jsonColumns ?? [])
  const dateColumns = new Set(spec.dateColumns ?? [])
  const timestampColumns = new Set(spec.timestampColumns ?? [])
  const batchSize = Math.max(
    1,
    Math.min(500, Math.floor(MAX_QUERY_PARAMETERS / databaseColumns.length))
  )
  const updateColumns = databaseColumns.filter(
    (column) => !spec.conflict.includes(column)
  )

  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const batch = rows.slice(offset, offset + batchSize)
    const values: unknown[] = []
    const tuples = batch.map((row, rowIndex) => {
      const placeholders = spec.columns.map(([payloadKey, databaseColumn], columnIndex) => {
        let value = row[payloadKey]
        if (jsonColumns.has(databaseColumn)) value = json(value)
        if (dateColumns.has(databaseColumn)) value = isoDate(value)
        if (timestampColumns.has(databaseColumn)) value = timestamp(value)
        values.push(value ?? null)
        return `$${rowIndex * databaseColumns.length + columnIndex + 1}`
      })
      return `(${placeholders.join(", ")})`
    })
    const update = updateColumns
      .map(
        (column) =>
          `${quoteIdentifier(column)} = EXCLUDED.${quoteIdentifier(column)}`
      )
      .join(", ")
    await client.query(
      `INSERT INTO ${quoteIdentifier("narrative_risk")}.${quoteIdentifier(spec.table)}
       (${databaseColumns.map(quoteIdentifier).join(", ")})
       VALUES ${tuples.join(", ")}
       ON CONFLICT (${spec.conflict.map(quoteIdentifier).join(", ")})
       DO UPDATE SET ${update}`,
      values
    )
  }
  return rows.length
}

const specs = {
  scopes: {
    table: "scopes",
    columns: [
      ["scopeId", "scope_id"], ["runId", "run_id"], ["label", "label"],
      ["methodology", "methodology"], ["asOfDate", "as_of_date"],
      ["companyCount", "company_count"], ["notes", "notes"],
    ],
    conflict: ["scope_id"], jsonColumns: ["notes"], dateColumns: ["as_of_date"],
  },
  companies: {
    table: "companies",
    columns: [
      ["companyKey", "company_key"], ["shortName", "short_name"],
      ["fullName", "full_name"], ["stockCode", "stock_code"],
      ["aliases", "aliases"], ["masterCompanyId", "master_company_id"],
      ["metadata", "metadata"],
    ],
    conflict: ["company_key"], jsonColumns: ["aliases", "metadata"],
  },
  scopeCompanies: {
    table: "scope_companies",
    columns: [
      ["scopeId", "scope_id"], ["companyKey", "company_key"],
      ["sampleRole", "sample_role"], ["windowStart", "window_start"],
      ["windowEnd", "window_end"], ["dataCutoff", "data_cutoff"],
      ["conceptLabel", "concept_label"], ["sampleStatus", "sample_status"],
      ["metadata", "metadata"],
    ],
    conflict: ["scope_id", "company_key"], jsonColumns: ["metadata"],
    dateColumns: ["data_cutoff"], timestampColumns: ["window_start", "window_end"],
  },
  assessments: {
    table: "assessments",
    columns: [
      ["scopeId", "scope_id"], ["companyKey", "company_key"],
      ["objectiveRiskScore", "objective_risk_score"],
      ["weightedCoverage", "weighted_coverage"], ["pdqiValue", "pdqi_value"],
      ["pdqiVariant", "pdqi_variant"], ["pdqiRiskPct", "pdqi_risk_pct"],
      ["itagValue", "itag_value"], ["itagVariant", "itag_variant"],
      ["toneValue", "tone_value"], ["toneVariant", "tone_variant"],
      ["financeDimensionScore", "finance_dimension_score"],
      ["jointRiskLevel", "joint_risk_level"], ["conclusion", "conclusion"],
      ["validationStatus", "validation_status"], ["metadata", "metadata"],
    ],
    conflict: ["scope_id", "company_key"], jsonColumns: ["metadata"],
  },
  sources: {
    table: "sources",
    columns: [
      ["sourceKey", "source_key"], ["scopeId", "scope_id"],
      ["sourceId", "source_id"], ["companyKey", "company_key"],
      ["channel", "channel"], ["title", "title"],
      ["institution", "institution"], ["normalizedMedia", "normalized_media"],
      ["author", "author"], ["publicationDate", "publication_date"],
      ["url", "url"], ["validatedUrl", "validated_url"],
      ["localPath", "local_path"], ["sha256", "sha256"],
      ["effectiveWordCount", "effective_word_count"],
      ["cutoffClass", "cutoff_class"], ["evidenceRole", "evidence_role"],
      ["formalEligible", "formal_eligible"], ["exclusionReason", "exclusion_reason"],
      ["rawOccurrenceCount", "raw_occurrence_count"],
      ["rawRowNumbers", "raw_row_numbers"], ["localFileStatus", "local_file_status"],
      ["validationStatus", "validation_status"], ["metadata", "metadata"],
    ],
    conflict: ["source_key"], jsonColumns: ["raw_row_numbers", "metadata"],
    dateColumns: ["publication_date"],
  },
  metrics: {
    table: "metrics",
    columns: [
      ["metricId", "metric_id"], ["scopeId", "scope_id"],
      ["companyKey", "company_key"], ["indicatorId", "indicator_id"],
      ["metricName", "metric_name"], ["metricVariant", "metric_variant"],
      ["rawNumericValue", "raw_numeric_value"],
      ["validatedNumericValue", "validated_numeric_value"],
      ["textValue", "text_value"], ["unit", "unit"], ["status", "status"],
      ["validationStatus", "validation_status"],
      ["confidenceScore", "confidence_score"], ["confidenceLevel", "confidence_level"],
      ["formula", "formula"], ["asOfDate", "as_of_date"],
      ["limitation", "limitation"], ["isScoreEligible", "is_score_eligible"],
      ["metadata", "metadata"],
    ],
    conflict: ["metric_id"], jsonColumns: ["text_value", "metadata"],
    dateColumns: ["as_of_date"],
  },
  metricSourceLinks: {
    table: "metric_source_links",
    columns: [
      ["metricId", "metric_id"], ["sourceKey", "source_key"],
      ["rawOccurrenceCount", "raw_occurrence_count"],
    ],
    conflict: ["metric_id", "source_key"],
  },
  coverage: {
    table: "coverage",
    columns: [
      ["scopeId", "scope_id"], ["companyKey", "company_key"],
      ["indicatorId", "indicator_id"], ["coverageStatus", "coverage_status"],
      ["originalDefinitionUsable", "original_definition_usable"],
      ["documentMethodUsable", "document_method_usable"],
      ["confidenceScore", "confidence_score"], ["confidenceLevel", "confidence_level"],
      ["observationCount", "observation_count"],
      ["numericObservationCount", "numeric_observation_count"],
      ["limitation", "limitation"], ["metadata", "metadata"],
    ],
    conflict: ["scope_id", "company_key", "indicator_id"], jsonColumns: ["metadata"],
  },
  events: {
    table: "events",
    columns: [
      ["eventId", "event_id"], ["scopeId", "scope_id"],
      ["companyKey", "company_key"], ["eventDate", "event_date"],
      ["eventTitle", "event_title"], ["eventType", "event_type"],
      ["firstPublicTime", "first_public_time"], ["featureRole", "feature_role"],
      ["labelRole", "label_role"], ["severity", "severity"],
      ["sourceId", "source_id"], ["notes", "notes"], ["metadata", "metadata"],
    ],
    conflict: ["event_id"], jsonColumns: ["metadata"],
  },
  auditFindings: {
    table: "audit_findings",
    columns: [
      ["findingId", "finding_id"], ["runId", "run_id"],
      ["scopeId", "scope_id"], ["companyKey", "company_key"],
      ["sourceId", "source_id"], ["metricId", "metric_id"],
      ["severity", "severity"], ["status", "status"],
      ["title", "title"], ["detail", "detail"], ["metadata", "metadata"],
    ],
    conflict: ["finding_id"], jsonColumns: ["metadata"],
  },
  browserValidations: {
    table: "browser_validations",
    columns: [
      ["validationId", "validation_id"], ["runId", "run_id"],
      ["sourceId", "source_id"], ["metricId", "metric_id"],
      ["url", "url"], ["validationType", "validation_type"],
      ["status", "status"], ["checkedAt", "checked_at"],
      ["details", "details"],
    ],
    conflict: ["validation_id"], jsonColumns: ["details"],
    timestampColumns: ["checked_at"],
  },
} satisfies Record<string, UpsertSpec>

async function verify(client: Client, payload: NarrativePayload) {
  const runId = String(payload.run.runId)
  const expected = payload.stats
  const counts: Record<string, number> = {}
  const queries: Array<[string, string, unknown[]]> = [
    ["scopes", "SELECT COUNT(*)::INT AS count FROM narrative_risk.scopes WHERE run_id = $1", [runId]],
    ["companies", "SELECT COUNT(*)::INT AS count FROM narrative_risk.companies WHERE company_key = ANY($1::TEXT[])", [payload.companies.map((row) => row.companyKey)]],
    ["scopeCompanies", "SELECT COUNT(*)::INT AS count FROM narrative_risk.scope_companies sc JOIN narrative_risk.scopes s USING(scope_id) WHERE s.run_id = $1", [runId]],
    ["assessments", "SELECT COUNT(*)::INT AS count FROM narrative_risk.assessments a JOIN narrative_risk.scopes s USING(scope_id) WHERE s.run_id = $1", [runId]],
    ["sources", "SELECT COUNT(*)::INT AS count FROM narrative_risk.sources src JOIN narrative_risk.scopes s USING(scope_id) WHERE s.run_id = $1", [runId]],
    ["metrics", "SELECT COUNT(*)::INT AS count FROM narrative_risk.metrics m JOIN narrative_risk.scopes s USING(scope_id) WHERE s.run_id = $1", [runId]],
    ["metricSourceLinks", "SELECT COUNT(*)::INT AS count FROM narrative_risk.metric_source_links l JOIN narrative_risk.metrics m USING(metric_id) JOIN narrative_risk.scopes s ON s.scope_id=m.scope_id WHERE s.run_id = $1", [runId]],
    ["coverage", "SELECT COUNT(*)::INT AS count FROM narrative_risk.coverage c JOIN narrative_risk.scopes s USING(scope_id) WHERE s.run_id = $1", [runId]],
    ["events", "SELECT COUNT(*)::INT AS count FROM narrative_risk.events e JOIN narrative_risk.scopes s USING(scope_id) WHERE s.run_id = $1", [runId]],
    ["auditFindings", "SELECT COUNT(*)::INT AS count FROM narrative_risk.audit_findings WHERE run_id = $1", [runId]],
    ["browserValidations", "SELECT COUNT(*)::INT AS count FROM narrative_risk.browser_validations WHERE run_id = $1", [runId]],
  ]
  for (const [key, sql, parameters] of queries) {
    const result = await client.query<{ count: number }>(sql, parameters)
    counts[key] = Number(result.rows[0]?.count ?? 0)
  }
  const differences = Object.entries(expected).filter(
    ([key, count]) => counts[key] !== count
  )
  if (differences.length > 0) {
    throw new Error(
      `导入行数校验失败：${differences
        .map(([key, count]) => `${key} expected=${count} actual=${counts[key]}`)
        .join("; ")}`
    )
  }

  const safeguards = await client.query<{
    duplicate_source_groups: number
    invalidated_metrics: number
    formal_pdqi_missing: number
  }>(`
    SELECT
      (SELECT COUNT(*)::INT FROM narrative_risk.sources
       WHERE scope_id = 'r01-r04-audit-20260826' AND raw_occurrence_count > 1)
        AS duplicate_source_groups,
      (SELECT COUNT(*)::INT FROM narrative_risk.metrics
       WHERE validation_status = 'invalidated-duplicate-source-weighting')
        AS invalidated_metrics,
      (SELECT COUNT(*)::INT FROM narrative_risk.metrics
       WHERE scope_id = 'r01-r04-audit-20260826'
         AND metric_variant = 'formal-industry-year-normalized'
         AND validated_numeric_value IS NULL)
        AS formal_pdqi_missing
  `)
  const safeguard = safeguards.rows[0]
  if (
    safeguard.duplicate_source_groups !== 3 ||
    safeguard.invalidated_metrics !== 2 ||
    safeguard.formal_pdqi_missing !== 3
  ) {
    throw new Error(`口径保护校验失败：${JSON.stringify(safeguard)}`)
  }
  return { counts, safeguards: safeguard }
}

async function main() {
  const payloadPath = resolve(process.argv[2] ?? DEFAULT_PAYLOAD)
  const raw = readFileSync(payloadPath, "utf8")
  const payload = JSON.parse(raw) as NarrativePayload
  const sha256 = payloadSha256(raw)
  const runId = String(payload.run.runId)
  const client = new Client(clientConfig())
  await client.connect()
  try {
    const migration = await applyMigration(client)
    const existing = await client.query<{ payload_sha256: string }>(
      "SELECT payload_sha256 FROM narrative_risk.import_runs WHERE run_id = $1",
      [runId]
    )
    if (existing.rows[0] && existing.rows[0].payload_sha256 !== sha256) {
      throw new Error(`run_id ${runId} 已存在但payload校验和不同；请使用新run_id。`)
    }

    await client.query("BEGIN")
    await client.query("SET LOCAL lock_timeout = '10s'")
    await client.query(
      `INSERT INTO narrative_risk.import_runs(
         run_id, status, payload_sha256, source_files,
         validation_summary, ego_validation_summary, started_at,
         completed_at, error_message
       ) VALUES ($1, 'running', $2, $3::JSONB, $4::JSONB, $5::JSONB,
                 CURRENT_TIMESTAMP, NULL, NULL)
       ON CONFLICT (run_id) DO UPDATE SET
         status = 'running', source_files = EXCLUDED.source_files,
         validation_summary = EXCLUDED.validation_summary,
         ego_validation_summary = EXCLUDED.ego_validation_summary,
         started_at = CURRENT_TIMESTAMP, completed_at = NULL,
         error_message = NULL`,
      [
        runId,
        sha256,
        json(payload.run.sourceFiles),
        json(payload.run.validationSummary),
        json(payload.run.egoValidationSummary),
      ]
    )

    await upsertRows(client, payload.scopes, specs.scopes)
    await upsertRows(client, payload.companies, specs.companies)
    await client.query(`
      UPDATE narrative_risk.companies AS target
      SET master_company_id = master.company_id
      FROM risk_data.companies AS master
      WHERE target.stock_code IS NOT NULL
        AND master.stock_code = target.stock_code
    `)
    await upsertRows(client, payload.scopeCompanies, specs.scopeCompanies)
    await upsertRows(client, payload.assessments, specs.assessments)
    await upsertRows(client, payload.sources, specs.sources)
    await upsertRows(client, payload.metrics, specs.metrics)
    await upsertRows(client, payload.metricSourceLinks, specs.metricSourceLinks)
    await upsertRows(client, payload.coverage, specs.coverage)
    await upsertRows(client, payload.events, specs.events)
    await upsertRows(client, payload.auditFindings, specs.auditFindings)
    await upsertRows(client, payload.browserValidations, specs.browserValidations)
    await client.query(
      `UPDATE narrative_risk.import_runs
       SET status = 'succeeded', completed_at = CURRENT_TIMESTAMP
       WHERE run_id = $1`,
      [runId]
    )
    await client.query("COMMIT")

    const verification = await verify(client, payload)
    process.stdout.write(
      `${JSON.stringify(
        {
          input: payloadPath,
          runId,
          payloadSha256: sha256,
          migration,
          ...verification,
        },
        null,
        2
      )}\n`
    )
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined)
    const message = error instanceof Error ? error.message : String(error)
    await client.query(
      `INSERT INTO narrative_risk.import_runs(
         run_id, status, payload_sha256, source_files,
         validation_summary, ego_validation_summary, completed_at, error_message
       ) VALUES ($1, 'failed', $2, $3::JSONB, $4::JSONB, $5::JSONB,
                 CURRENT_TIMESTAMP, $6)
       ON CONFLICT (run_id) DO UPDATE SET
         status = 'failed', completed_at = CURRENT_TIMESTAMP,
         error_message = EXCLUDED.error_message`,
      [
        runId,
        sha256,
        json(payload.run.sourceFiles),
        json(payload.run.validationSummary),
        json(payload.run.egoValidationSummary),
        message,
      ]
    ).catch(() => undefined)
    throw error
  } finally {
    await client.end()
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
