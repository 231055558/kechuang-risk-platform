import { createHash } from "node:crypto"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { basename, resolve } from "node:path"

import { Client, Pool, type ClientConfig } from "pg"

import { readNarrativeRuntimeSnapshot } from "../server/narrative-risk-repository.ts"

type ArtifactStatus =
  | "archived"
  | "unavailable"
  | "not-required"
  | "pending-review"

interface EnrichmentArtifact {
  artifactId: string
  sourceKey: string
  status: ArtifactStatus
  artifactKind: "pdf" | "html" | "local-source" | "metadata-only"
  canonicalUrl?: string | null
  finalUrl?: string | null
  httpStatus?: number | null
  contentType?: string | null
  byteSize?: number | null
  contentSha256?: string | null
  storageKey?: string | null
  publicExcerpt?: string | null
  fetchedAt?: string | null
  errorMessage?: string | null
  metadata?: Record<string, unknown>
}

interface UrlRepair {
  sourceKey: string
  canonicalUrl: string
  validationStatus: string
}

interface MetricUpdate {
  metricId: string
  validatedNumericValue: number | null
  metricClass: "proxy" | "invalid" | "missing"
  validationStatus: string
  scoreExclusionReason: string
  metricVariant?: string | null
  status?: string | null
  limitation?: string | null
}

interface AssessmentUpdate {
  scopeId: string
  companyKey: string
  toneValue: number | null
  toneVariant: string | null
  validationStatus?: string | null
  conclusion?: string | null
}

interface CoverageUpdate {
  scopeId: string
  companyKey: string
  indicatorId: string
  coverageStatus: string
  originalDefinitionUsable: boolean | null
  documentMethodUsable?: boolean | null
  limitation?: string | null
}

interface EnrichmentManifest {
  schemaVersion: "NARRATIVE-RISK-ENRICHMENT-2026.08-v1"
  manifestRunId: string
  asOfDate: string
  artifacts: EnrichmentArtifact[]
  urlRepairs: UrlRepair[]
  metricUpdates: MetricUpdate[]
  assessmentUpdates?: AssessmentUpdate[]
  coverageUpdates?: CoverageUpdate[]
  browserSummary: Record<string, unknown>
}

const MIGRATION_PATH = resolve("db/migrations/003_narrative_risk_runtime.sql")
const DEFAULT_MANIFEST = resolve(
  "private/narrative-risk/enrichment-manifest-2026-08-26.json"
)
const SNAPSHOT_PATH = resolve(
  "src/data/industry/narrative-risk-runtime.json"
)

function clientConfig(): ClientConfig {
  if (process.env.DATABASE_URL) {
    return {
      application_name: "kechuang-narrative-risk-runtime-sync",
      connectionString: process.env.DATABASE_URL,
    }
  }
  return {
    application_name: "kechuang-narrative-risk-runtime-sync",
    database: process.env.PGDATABASE ?? "kechuang_risk",
    host: process.env.PGHOST ?? "/tmp",
    password: process.env.PGPASSWORD,
    port: Number(process.env.PGPORT ?? "5432"),
    user: process.env.PGUSER ?? process.env.USER,
  }
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex")
}

function readManifest(path: string) {
  const raw = readFileSync(path, "utf8")
  const value = JSON.parse(raw) as EnrichmentManifest
  if (value.schemaVersion !== "NARRATIVE-RISK-ENRICHMENT-2026.08-v1") {
    throw new Error("叙事风险补齐清单版本不受支持。")
  }
  const sourceKeys = new Set<string>()
  for (const artifact of value.artifacts) {
    if (sourceKeys.has(artifact.sourceKey)) {
      throw new Error(`来源 ${artifact.sourceKey} 在补齐清单中重复。`)
    }
    sourceKeys.add(artifact.sourceKey)
    if (artifact.contentSha256 && artifact.contentSha256.length !== 64) {
      throw new Error(`来源 ${artifact.sourceKey} 的SHA-256无效。`)
    }
    if (artifact.storageKey) {
      if (
        artifact.storageKey.startsWith("/") ||
        artifact.storageKey.includes("..") ||
        !artifact.storageKey.startsWith("narrative-risk/")
      ) {
        throw new Error(`来源 ${artifact.sourceKey} 的私有存储键无效。`)
      }
    }
    if ((artifact.publicExcerpt?.length ?? 0) > 240) {
      throw new Error(`来源 ${artifact.sourceKey} 的公开摘录超过240字符。`)
    }
  }
  return { raw, value }
}

async function applyMigration(client: Client) {
  const migrationName = basename(MIGRATION_PATH)
  const sql = readFileSync(MIGRATION_PATH, "utf8")
  const checksum = sha256(sql)
  const existing = await client.query<{ sha256: string }>(
    "SELECT sha256 FROM platform.schema_migrations WHERE migration_name = $1",
    [migrationName]
  )
  if (existing.rows[0]) {
    if (existing.rows[0].sha256 !== checksum) {
      throw new Error(`已应用迁移 ${migrationName} 的校验和发生变化。`)
    }
    return false
  }

  await client.query("BEGIN")
  try {
    await client.query(sql)
    await client.query(
      "INSERT INTO platform.schema_migrations(migration_name, sha256) VALUES ($1, $2)",
      [migrationName, checksum]
    )
    await client.query("COMMIT")
    return true
  } catch (error) {
    await client.query("ROLLBACK")
    throw error
  }
}

async function beginUpdateRun(
  client: Client,
  manifest: EnrichmentManifest,
  manifestSha256: string
) {
  const existing = await client.query<{ update_run_id: number }>(
    `SELECT update_run_id
     FROM platform.data_update_runs
     WHERE job_name = 'narrative-risk-enrichment'
       AND summary->>'manifestRunId' = $1
     ORDER BY update_run_id DESC LIMIT 1`,
    [manifest.manifestRunId]
  )
  if (existing.rows[0]) {
    await client.query(
      `UPDATE platform.data_update_runs
       SET status = 'running', summary = $2::JSONB,
           started_at = CURRENT_TIMESTAMP, completed_at = NULL,
           error_message = NULL
       WHERE update_run_id = $1`,
      [
        existing.rows[0].update_run_id,
        JSON.stringify({
          manifestRunId: manifest.manifestRunId,
          manifestSha256,
          asOfDate: manifest.asOfDate,
        }),
      ]
    )
    return existing.rows[0].update_run_id
  }
  const inserted = await client.query<{ update_run_id: number }>(
    `INSERT INTO platform.data_update_runs(
       job_name, status, watermark_to, summary
     ) VALUES ('narrative-risk-enrichment', 'running', $1, $2::JSONB)
     RETURNING update_run_id`,
    [
      `${manifest.asOfDate}T23:59:59+08:00`,
      JSON.stringify({
        manifestRunId: manifest.manifestRunId,
        manifestSha256,
        asOfDate: manifest.asOfDate,
      }),
    ]
  )
  return inserted.rows[0].update_run_id
}

async function importManifest(
  client: Client,
  manifest: EnrichmentManifest,
  manifestSha256: string
) {
  await client.query("BEGIN")
  try {
    await client.query("SET LOCAL lock_timeout = '10s'")
    const updateRunId = await beginUpdateRun(client, manifest, manifestSha256)

    for (const repair of manifest.urlRepairs) {
      const result = await client.query(
        `UPDATE narrative_risk.sources
         SET validated_url = $2, validation_status = $3
         WHERE source_key = $1`,
        [repair.sourceKey, repair.canonicalUrl, repair.validationStatus]
      )
      if (result.rowCount !== 1) {
        throw new Error(`URL补齐未匹配唯一来源：${repair.sourceKey}`)
      }
    }

    for (const artifact of manifest.artifacts) {
      await client.query(
        `INSERT INTO narrative_risk.source_artifacts(
           artifact_id, source_key, update_run_id, status, artifact_kind,
           canonical_url, final_url, http_status, content_type, byte_size,
           content_sha256, storage_key, visibility, public_excerpt,
           fetched_at, error_message, metadata, updated_at
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
           $13, $14, $15, $16, $17::JSONB, CURRENT_TIMESTAMP
         )
         ON CONFLICT (source_key) DO UPDATE SET
           artifact_id = EXCLUDED.artifact_id,
           update_run_id = EXCLUDED.update_run_id,
           status = EXCLUDED.status,
           artifact_kind = EXCLUDED.artifact_kind,
           canonical_url = EXCLUDED.canonical_url,
           final_url = EXCLUDED.final_url,
           http_status = EXCLUDED.http_status,
           content_type = EXCLUDED.content_type,
           byte_size = EXCLUDED.byte_size,
           content_sha256 = EXCLUDED.content_sha256,
           storage_key = EXCLUDED.storage_key,
           visibility = EXCLUDED.visibility,
           public_excerpt = EXCLUDED.public_excerpt,
           fetched_at = EXCLUDED.fetched_at,
           error_message = EXCLUDED.error_message,
           metadata = EXCLUDED.metadata,
           updated_at = CURRENT_TIMESTAMP`,
        [
          artifact.artifactId,
          artifact.sourceKey,
          updateRunId,
          artifact.status,
          artifact.artifactKind,
          artifact.canonicalUrl ?? null,
          artifact.finalUrl ?? null,
          artifact.httpStatus ?? null,
          artifact.contentType ?? null,
          artifact.byteSize ?? null,
          artifact.contentSha256 ?? null,
          artifact.storageKey ?? null,
          artifact.status === "archived" ? "private" : "metadata-only",
          artifact.publicExcerpt ?? null,
          artifact.fetchedAt ?? null,
          artifact.errorMessage ?? null,
          JSON.stringify(artifact.metadata ?? {}),
        ]
      )

      if (artifact.status === "pending-review") {
        await client.query(
          `INSERT INTO platform.review_queue(
             update_run_id, item_type, company_key, source_url,
             payload, reason, status
           )
           SELECT $1, 'narrative-source', s.company_key, $3,
                  $4::JSONB, $5, 'pending'
           FROM narrative_risk.sources s
           WHERE s.source_key = $2
             AND NOT EXISTS (
               SELECT 1 FROM platform.review_queue q
               WHERE q.update_run_id = $1
                 AND q.item_type = 'narrative-source'
                 AND q.payload->>'sourceKey' = $2
             )`,
          [
            updateRunId,
            artifact.sourceKey,
            artifact.canonicalUrl ?? null,
            JSON.stringify({ sourceKey: artifact.sourceKey }),
            artifact.errorMessage ?? "浏览器未找到可独立核验的正式来源",
          ]
        )
      }
    }

    for (const metric of manifest.metricUpdates) {
      const result = await client.query(
        `UPDATE narrative_risk.metrics
         SET validated_numeric_value = $2, metric_class = $3,
             validation_status = $4, score_exclusion_reason = $5,
             limitation = COALESCE($6, limitation), is_score_eligible = FALSE,
             metric_variant = COALESCE($7, metric_variant),
             status = COALESCE($8, status)
         WHERE metric_id = $1`,
        [
          metric.metricId,
          metric.validatedNumericValue,
          metric.metricClass,
          metric.validationStatus,
          metric.scoreExclusionReason,
          metric.limitation ?? null,
          metric.metricVariant ?? null,
          metric.status ?? null,
        ]
      )
      if (result.rowCount !== 1) {
        throw new Error(`指标更新未匹配唯一记录：${metric.metricId}`)
      }
    }

    for (const assessment of manifest.assessmentUpdates ?? []) {
      const result = await client.query(
        `UPDATE narrative_risk.assessments
         SET tone_value = $3, tone_variant = $4,
             validation_status = COALESCE($5, validation_status),
             conclusion = COALESCE($6, conclusion)
         WHERE scope_id = $1 AND company_key = $2`,
        [
          assessment.scopeId,
          assessment.companyKey,
          assessment.toneValue,
          assessment.toneVariant,
          assessment.validationStatus ?? null,
          assessment.conclusion ?? null,
        ]
      )
      if (result.rowCount !== 1) {
        throw new Error(
          `评估更新未匹配唯一记录：${assessment.scopeId}/${assessment.companyKey}`
        )
      }
    }

    for (const coverage of manifest.coverageUpdates ?? []) {
      const result = await client.query(
        `UPDATE narrative_risk.coverage
         SET coverage_status = $4, original_definition_usable = $5,
             document_method_usable = $6,
             limitation = COALESCE($7, limitation)
         WHERE scope_id = $1 AND company_key = $2 AND indicator_id = $3`,
        [
          coverage.scopeId,
          coverage.companyKey,
          coverage.indicatorId,
          coverage.coverageStatus,
          coverage.originalDefinitionUsable,
          coverage.documentMethodUsable ?? null,
          coverage.limitation ?? null,
        ]
      )
      if (result.rowCount !== 1) {
        throw new Error(
          `覆盖更新未匹配唯一记录：${coverage.scopeId}/${coverage.companyKey}/${coverage.indicatorId}`
        )
      }
    }

    await client.query(
      "UPDATE narrative_risk.scopes SET as_of_date = $1 WHERE as_of_date < $1",
      [manifest.asOfDate]
    )

    await client.query(`
      UPDATE narrative_risk.metrics
      SET
        metric_class = CASE
          WHEN validation_status LIKE 'missing%' OR raw_numeric_value IS NULL
            THEN 'missing'
          WHEN validation_status LIKE 'invalidated%'
            OR validation_status LIKE 'superseded%'
            THEN 'invalid'
          WHEN is_score_eligible THEN 'formal'
          ELSE 'proxy'
        END,
        score_exclusion_reason = CASE
          WHEN is_score_eligible THEN NULL
          WHEN validation_status LIKE 'missing%' OR raw_numeric_value IS NULL
            THEN COALESCE(limitation, '缺少可验证数值')
          WHEN validation_status LIKE 'invalidated%'
            OR validation_status LIKE 'superseded%'
            THEN validation_status
          ELSE COALESCE(score_exclusion_reason, '代理口径仅供观察，不进入总分')
        END
    `)

    const linked = await client.query<{ count: number }>(`
      SELECT COUNT(DISTINCT source_key)::INT AS count
      FROM narrative_risk.metric_source_links
    `)
    const classified = await client.query<{ count: number }>(`
      SELECT COUNT(*)::INT AS count
      FROM narrative_risk.source_artifacts a
      WHERE EXISTS (
        SELECT 1 FROM narrative_risk.metric_source_links l
        WHERE l.source_key = a.source_key
      )
    `)
    if (linked.rows[0].count !== classified.rows[0].count) {
      throw new Error(
        `来源归档状态不完整：linked=${linked.rows[0].count} classified=${classified.rows[0].count}`
      )
    }

    const statusCounts = await client.query<{ status: string; count: number }>(`
      SELECT status, COUNT(*)::INT AS count
      FROM narrative_risk.source_artifacts GROUP BY status ORDER BY status
    `)
    await client.query(
      `UPDATE platform.data_update_runs
       SET status = 'succeeded', completed_at = CURRENT_TIMESTAMP,
           summary = summary || $2::JSONB
       WHERE update_run_id = $1`,
      [
        updateRunId,
        JSON.stringify({
          artifactCount: manifest.artifacts.length,
          urlRepairCount: manifest.urlRepairs.length,
          metricUpdateCount: manifest.metricUpdates.length,
          assessmentUpdateCount: manifest.assessmentUpdates?.length ?? 0,
          coverageUpdateCount: manifest.coverageUpdates?.length ?? 0,
          browserSummary: manifest.browserSummary,
          statusCounts: Object.fromEntries(
            statusCounts.rows.map((row) => [row.status, row.count])
          ),
        }),
      ]
    )
    await client.query("COMMIT")
    return { updateRunId, statusCounts: statusCounts.rows }
  } catch (error) {
    await client.query("ROLLBACK")
    throw error
  }
}

async function main() {
  const args = new Set(process.argv.slice(2))
  const snapshotOnly = args.has("--snapshot-only")
  const verifyOnly = args.has("--verify")
  const manifestArg = process.argv.find((value) => value.startsWith("--manifest="))
  const manifestPath = resolve(manifestArg?.slice("--manifest=".length) ?? DEFAULT_MANIFEST)
  const client = new Client(clientConfig())
  const snapshotPool = new Pool({ ...clientConfig(), max: 4 })
  await client.connect()
  try {
    const migrationApplied = await applyMigration(client)
    let importResult: Record<string, unknown> | null = null
    if (!snapshotOnly && !verifyOnly) {
      if (!existsSync(manifestPath)) {
        throw new Error(`未找到补齐清单：${manifestPath}`)
      }
      const manifest = readManifest(manifestPath)
      importResult = await importManifest(
        client,
        manifest.value,
        sha256(manifest.raw)
      )
    }

    const snapshot = await readNarrativeRuntimeSnapshot(snapshotPool, "snapshot")
    const serialized = `${JSON.stringify(snapshot, null, 2)}\n`
    if (/\/Users\/|private\/|storageKey|localPath/.test(serialized)) {
      throw new Error("公开快照包含私有路径或内部存储字段。")
    }
    if (!verifyOnly) writeFileSync(SNAPSHOT_PATH, serialized)

    const checks = await client.query<{
      companies: number
      scope_companies: number
      linked_sources: number
      classified_sources: number
      proxy_eligible: number
      formal_pdqi_filled: number
    }>(`
      SELECT
        (SELECT COUNT(*)::INT FROM narrative_risk.companies) AS companies,
        (SELECT COUNT(*)::INT FROM narrative_risk.scope_companies) AS scope_companies,
        (SELECT COUNT(DISTINCT source_key)::INT FROM narrative_risk.metric_source_links)
          AS linked_sources,
        (SELECT COUNT(*)::INT FROM narrative_risk.source_artifacts a
         WHERE EXISTS (SELECT 1 FROM narrative_risk.metric_source_links l
                       WHERE l.source_key = a.source_key)) AS classified_sources,
        (SELECT COUNT(*)::INT FROM narrative_risk.metrics
         WHERE metric_class = 'proxy' AND is_score_eligible) AS proxy_eligible,
        (SELECT COUNT(*)::INT FROM narrative_risk.metrics
         WHERE metric_variant = 'formal-industry-year-normalized'
           AND validated_numeric_value IS NOT NULL) AS formal_pdqi_filled
    `)
    const check = checks.rows[0]
    if (
      check.companies !== 7 ||
      check.scope_companies !== 8 ||
      check.linked_sources !== 83 ||
      check.classified_sources !== 83 ||
      check.proxy_eligible !== 0 ||
      check.formal_pdqi_filled !== 0
    ) {
      throw new Error(`叙事运行库校验失败：${JSON.stringify(check)}`)
    }

    process.stdout.write(
      `${JSON.stringify(
        {
          migrationApplied,
          manifestPath: snapshotOnly || verifyOnly ? null : manifestPath,
          snapshotPath: verifyOnly ? null : SNAPSHOT_PATH,
          snapshotSha256: sha256(serialized),
          importResult,
          checks: check,
        },
        null,
        2
      )}\n`
    )
  } finally {
    await snapshotPool.end()
    await client.end()
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
