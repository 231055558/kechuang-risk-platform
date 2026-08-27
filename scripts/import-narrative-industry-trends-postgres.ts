import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { basename, resolve } from "node:path"

import { Client, type ClientConfig } from "pg"

const MIGRATION_PATH = resolve(
  "db/migrations/006_narrative_industry_annual_trends.sql"
)
const SNAPSHOT_PATH = resolve(
  "src/data/industry/narrative-risk-industry-trends.json"
)

function clientConfig(): ClientConfig {
  if (process.env.DATABASE_URL) {
    return {
      application_name: "kechuang-narrative-industry-import",
      connectionString: process.env.DATABASE_URL,
    }
  }
  return {
    application_name: "kechuang-narrative-industry-import",
    database: process.env.PGDATABASE ?? "kechuang_risk",
    host: process.env.PGHOST ?? "/tmp",
    password: process.env.PGPASSWORD,
    port: Number(process.env.PGPORT ?? "5432"),
    user: process.env.PGUSER ?? process.env.USER,
  }
}

async function applyMigration(client: Client) {
  const sql = await readFile(MIGRATION_PATH, "utf8")
  const migrationName = basename(MIGRATION_PATH)
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

async function main() {
  const payload = JSON.parse(await readFile(SNAPSHOT_PATH, "utf8"))
  const dataVersion = String(payload.dataVersion)
  const client = new Client(clientConfig())
  await client.connect()
  try {
    await client.query("BEGIN")
    const migrationApplied = await applyMigration(client)
    await client.query(
      `INSERT INTO narrative_risk.industry_annual_runs(
         data_version, as_of_date, methodology, industry_groups, audit
       ) VALUES ($1,$2,$3::jsonb,$4::jsonb,$5::jsonb)
       ON CONFLICT (data_version) DO UPDATE SET
         as_of_date=EXCLUDED.as_of_date,
         methodology=EXCLUDED.methodology,
         industry_groups=EXCLUDED.industry_groups,
         audit=EXCLUDED.audit,
         imported_at=CURRENT_TIMESTAMP`,
      [
        dataVersion,
        payload.asOfDate,
        JSON.stringify(payload.methodology),
        JSON.stringify(payload.industryGroups),
        JSON.stringify(payload.audit),
      ]
    )

    await client.query(
      "DELETE FROM narrative_risk.industry_annual_companies WHERE data_version=$1",
      [dataVersion]
    )
    await client.query(
      "DELETE FROM narrative_risk.industry_annual_documents WHERE data_version=$1",
      [dataVersion]
    )
    await client.query(
      "DELETE FROM narrative_risk.industry_annual_observations WHERE data_version=$1",
      [dataVersion]
    )
    await client.query(
      "DELETE FROM narrative_risk.industry_annual_statistics WHERE data_version=$1",
      [dataVersion]
    )

    for (const item of payload.companies) {
      await client.query(
        `INSERT INTO narrative_risk.industry_annual_companies(
           data_version,company_id,company_name,stock_code,peer_group_id,
           industry_group_id,included_years
         ) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)`,
        [
          dataVersion,
          item.companyId,
          item.companyName,
          item.stockCode,
          item.peerGroupId,
          item.industryGroupId,
          JSON.stringify(item.includedYears),
        ]
      )
    }
    for (const item of payload.documents) {
      await client.query(
        `INSERT INTO narrative_risk.industry_annual_documents(
           data_version,document_id,company_id,report_year,title,official_url,
           publication_date,archive_status,parse_status,file_sha256,byte_size,
           page_count,section_coverage
         ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)`,
        [
          dataVersion,
          item.documentId,
          item.companyId,
          item.year,
          item.title,
          item.officialUrl,
          item.publicationDate,
          item.archiveStatus,
          item.parseStatus,
          item.sha256,
          item.byteSize,
          item.pageCount,
          JSON.stringify(item.sectionCoverage ?? {}),
        ]
      )
    }
    for (const item of payload.observations) {
      await client.query(
        `INSERT INTO narrative_risk.industry_annual_observations(
           data_version,company_id,report_year,metric_key,numeric_value,status,
           missing_reason,document_id,details
         ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
        [
          dataVersion,
          item.companyId,
          item.year,
          item.metricKey,
          item.value,
          item.status,
          item.missingReason,
          item.documentId,
          JSON.stringify(item.details ?? {}),
        ]
      )
    }
    for (const item of payload.industryStatistics) {
      await client.query(
        `INSERT INTO narrative_risk.industry_annual_statistics(
           data_version,industry_group_id,report_year,metric_key,sample_size,
           mean_value,minimum_value,maximum_value,standard_deviation,
           domain_minimum,domain_maximum
         ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          dataVersion,
          item.industryGroupId,
          item.year,
          item.metricKey,
          item.sampleSize,
          item.mean,
          item.minimum,
          item.maximum,
          item.standardDeviation,
          item.domainMinimum,
          item.domainMaximum,
        ]
      )
    }
    await client.query("COMMIT")
    console.log(
      JSON.stringify({
        dataVersion,
        migrationApplied,
        companies: payload.companies.length,
        documents: payload.documents.length,
        observations: payload.observations.length,
        statistics: payload.industryStatistics.length,
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
