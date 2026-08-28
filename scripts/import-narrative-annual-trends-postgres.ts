import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { basename, resolve } from "node:path"

import { Client, type ClientConfig } from "pg"

type JsonRecord = Record<string, unknown>

const MIGRATION_PATHS = [
  resolve("db/migrations/004_narrative_risk_annual_trends.sql"),
  resolve("db/migrations/005_narrative_annual_risk_scores.sql"),
]
const SNAPSHOT_PATH = resolve(
  "src/data/industry/narrative-risk-annual-trends.json"
)

function clientConfig(): ClientConfig {
  if (process.env.DATABASE_URL) {
    return {
      application_name: "kechuang-narrative-annual-import",
      connectionString: process.env.DATABASE_URL,
    }
  }
  return {
    application_name: "kechuang-narrative-annual-import",
    database: process.env.PGDATABASE ?? "kechuang_risk",
    host: process.env.PGHOST ?? "/tmp",
    password: process.env.PGPASSWORD,
    port: Number(process.env.PGPORT ?? "5432"),
    user: process.env.PGUSER ?? process.env.USER,
  }
}

async function applyMigration(client: Client, migrationPath: string) {
  const sql = await readFile(migrationPath, "utf8")
  const migrationName = basename(migrationPath)
  const sha256 = createHash("sha256").update(sql).digest("hex")
  const existing = await client.query<{ sha256: string }>(
    "SELECT sha256 FROM platform.schema_migrations WHERE migration_name = $1",
    [migrationName]
  )
  if (existing.rows[0]) {
    if (existing.rows[0].sha256 !== sha256) {
      throw new Error(`已应用迁移 ${migrationName} 的校验和发生变化。`)
    }
    return false
  }
  await client.query(sql)
  await client.query(
    "INSERT INTO platform.schema_migrations(migration_name, sha256) VALUES ($1, $2)",
    [migrationName, sha256]
  )
  return true
}

function record(value: unknown): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("年度趋势快照结构无效。")
  }
  return value as JsonRecord
}

async function main() {
  const payload = record(JSON.parse(await readFile(SNAPSHOT_PATH, "utf8")))
  const method = record(payload.methodVersion)
  const documents = payload.documents as JsonRecord[]
  const observations = payload.observations as JsonRecord[]
  const toneAudits = payload.toneAudits as JsonRecord[]
  const methodVersion = String(method.methodVersion)
  const client = new Client(clientConfig())
  await client.connect()
  try {
    await client.query("BEGIN")
    const migrationsApplied: string[] = []
    for (const migrationPath of MIGRATION_PATHS) {
      if (await applyMigration(client, migrationPath)) {
        migrationsApplied.push(basename(migrationPath))
      }
    }
    await client.query(
      `INSERT INTO narrative_risk.method_versions (
         method_version, method_name, effective_date, source_document_sha256,
         innovation_lexicon_status, innovation_lexicon_size,
         innovation_lexicon_sha256, stopword_list_sha256,
         sentiment_dictionary_name, sentiment_dictionary_sha256,
         sentiment_dictionary_source, peer_benchmark_status, methodology, notes
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::jsonb)
       ON CONFLICT (method_version) DO UPDATE SET
         method_name=EXCLUDED.method_name, effective_date=EXCLUDED.effective_date,
         source_document_sha256=EXCLUDED.source_document_sha256,
         innovation_lexicon_status=EXCLUDED.innovation_lexicon_status,
         innovation_lexicon_size=EXCLUDED.innovation_lexicon_size,
         innovation_lexicon_sha256=EXCLUDED.innovation_lexicon_sha256,
         stopword_list_sha256=EXCLUDED.stopword_list_sha256,
         sentiment_dictionary_name=EXCLUDED.sentiment_dictionary_name,
         sentiment_dictionary_sha256=EXCLUDED.sentiment_dictionary_sha256,
         sentiment_dictionary_source=EXCLUDED.sentiment_dictionary_source,
         peer_benchmark_status=EXCLUDED.peer_benchmark_status,
         methodology=EXCLUDED.methodology, notes=EXCLUDED.notes,
         updated_at=CURRENT_TIMESTAMP`,
      [
        methodVersion,
        method.name,
        method.effectiveDate,
        method.sourceDocumentSha256,
        method.innovationLexiconStatus,
        method.innovationLexiconSize,
        method.innovationLexiconSha256,
        method.stopwordListSha256,
        method.sentimentDictionaryName,
        method.sentimentDictionarySha256,
        method.sentimentDictionarySource,
        method.peerBenchmarkStatus,
        JSON.stringify(payload.methodology ?? []),
        JSON.stringify(method.notes ?? []),
      ]
    )

    for (const item of documents) {
      await client.query(
        `INSERT INTO narrative_risk.annual_documents (
           document_id, company_key, report_year, method_version, title,
           official_url, publication_date, archive_status, parse_status,
           file_sha256, byte_size, page_count, section_coverage, browser_validation
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14)
         ON CONFLICT (company_key, report_year, method_version) DO UPDATE SET
           document_id=EXCLUDED.document_id, title=EXCLUDED.title,
           official_url=EXCLUDED.official_url, publication_date=EXCLUDED.publication_date,
           archive_status=EXCLUDED.archive_status, parse_status=EXCLUDED.parse_status,
           file_sha256=EXCLUDED.file_sha256, byte_size=EXCLUDED.byte_size,
           page_count=EXCLUDED.page_count, section_coverage=EXCLUDED.section_coverage,
           browser_validation=EXCLUDED.browser_validation,
           updated_at=CURRENT_TIMESTAMP`,
        [
          item.documentId,
          item.companyKey,
          item.year,
          methodVersion,
          item.title,
          item.officialUrl,
          item.publicationDate,
          item.archiveStatus,
          item.parseStatus,
          item.fileSha256,
          item.byteSize,
          item.pageCount,
          JSON.stringify(item.sectionCoverage ?? {}),
          item.browserValidation,
        ]
      )
    }

    for (const item of observations) {
      await client.query(
        `INSERT INTO narrative_risk.annual_metric_observations (
           company_key, report_year, metric_key, method_version, numeric_value,
           annual_change_rate, risk_score, risk_score_change, status,
           missing_reason, document_id, details
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
           CASE WHEN $11::text LIKE 'annual-report:%' THEN $11 ELSE NULL END,
           $12::jsonb)
         ON CONFLICT (company_key, report_year, metric_key, method_version)
         DO UPDATE SET numeric_value=EXCLUDED.numeric_value,
           annual_change_rate=EXCLUDED.annual_change_rate,
           risk_score=EXCLUDED.risk_score,
           risk_score_change=EXCLUDED.risk_score_change,
           status=EXCLUDED.status,
           missing_reason=EXCLUDED.missing_reason, document_id=EXCLUDED.document_id,
           details=EXCLUDED.details, updated_at=CURRENT_TIMESTAMP`,
        [
          item.companyKey,
          item.year,
          item.metricKey,
          methodVersion,
          item.value,
          item.changeRate,
          item.riskScore,
          item.riskScoreChange,
          item.status,
          item.missingReason,
          item.documentId,
          JSON.stringify(item.details ?? {}),
        ]
      )
    }

    for (const item of toneAudits) {
      await client.query(
        `INSERT INTO narrative_risk.tone_audits (
           company_key, report_year, method_version, source_url, answer_count,
           dictionary_review, model_review, model_review_reason
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (company_key, report_year, method_version) DO UPDATE SET
           source_url=EXCLUDED.source_url, answer_count=EXCLUDED.answer_count,
           dictionary_review=EXCLUDED.dictionary_review,
           model_review=EXCLUDED.model_review,
           model_review_reason=EXCLUDED.model_review_reason,
           updated_at=CURRENT_TIMESTAMP`,
        [
          item.companyKey,
          item.year,
          methodVersion,
          item.sourceUrl,
          item.answerCount,
          item.dictionaryReview,
          item.modelReview,
          item.modelReviewReason,
        ]
      )
    }

    await client.query("COMMIT")
    console.log(
      JSON.stringify({
        methodVersion,
        migrationsApplied,
        documents: documents.length,
        observations: observations.length,
        toneAudits: toneAudits.length,
      })
    )
  } catch (error) {
    await client.query("ROLLBACK")
    throw error
  } finally {
    await client.end()
  }
}

await main()
