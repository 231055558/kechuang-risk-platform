import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { Client } from "pg"

const SCHEMA_VERSION = "KCR-RISK-GRAPH-POSTGRES-2026.08-v1"

type CompanyRecord = {
  companyKey: string
  companyName: string
  runId: string
  stockCode: string
  payload: unknown
}

type SnapshotRecord = {
  companyKey: string
  runId: string
  view: "fee-transmission" | "subject-panorama"
  minWeight: number
  payloadSha256: string
  payload: unknown
}

type ExportBundle = {
  schemaVersion: string
  generatedAt: string
  sourceDatabase: string
  companies: CompanyRecord[]
  snapshots: SnapshotRecord[]
}

function parseBundle(value: unknown): ExportBundle {
  if (typeof value !== "object" || value === null)
    throw new TypeError("图谱导入文件不是对象。")
  const bundle = value as Partial<ExportBundle>
  if (bundle.schemaVersion !== SCHEMA_VERSION)
    throw new TypeError("图谱导入文件版本不受支持。")
  if (!Array.isArray(bundle.companies) || !Array.isArray(bundle.snapshots)) {
    throw new TypeError("图谱导入文件缺少企业或快照。")
  }
  if (bundle.companies.length === 0 || bundle.snapshots.length === 0) {
    throw new TypeError("图谱导入文件不能为空。")
  }
  return bundle as ExportBundle
}

function databaseConfiguration() {
  const connectionString =
    process.env.RISK_GRAPH_DATABASE_URL ?? process.env.DATABASE_URL
  const host = process.env.RISK_GRAPH_PGHOST ?? process.env.PGHOST
  if (!connectionString && !host) {
    throw new Error(
      "缺少 RISK_GRAPH_DATABASE_URL，或 PGHOST/PGDATABASE/PGUSER/PGPASSWORD。"
    )
  }
  const sslMode = process.env.RISK_GRAPH_PGSSLMODE ?? process.env.PGSSLMODE
  return {
    ...(connectionString
      ? { connectionString }
      : {
          host,
          port: Number(
            process.env.RISK_GRAPH_PGPORT ?? process.env.PGPORT ?? "5432"
          ),
          database: process.env.RISK_GRAPH_PGDATABASE ?? process.env.PGDATABASE,
          user: process.env.RISK_GRAPH_PGUSER ?? process.env.PGUSER,
          password: process.env.RISK_GRAPH_PGPASSWORD ?? process.env.PGPASSWORD,
        }),
    ssl: sslMode === "require" ? { rejectUnauthorized: false } : undefined,
  }
}

async function main() {
  const inputPath = process.argv[2]
  if (!inputPath)
    throw new Error(
      "用法：npm run import:risk-graph-postgres -- <payload.json>"
    )
  const bundle = parseBundle(
    JSON.parse(await readFile(resolve(inputPath), "utf8")) as unknown
  )
  const client = new Client(databaseConfiguration())
  await client.connect()
  try {
    await client.query("BEGIN")
    await client.query("SELECT pg_advisory_xact_lock($1)", [2026082801])
    await client.query(`
      CREATE TABLE IF NOT EXISTS risk_graph_imports (
        import_id bigserial PRIMARY KEY,
        schema_version text NOT NULL,
        generated_at timestamptz NOT NULL,
        source_database text NOT NULL,
        company_count integer NOT NULL,
        snapshot_count integer NOT NULL,
        imported_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS risk_graph_companies (
        company_key text PRIMARY KEY,
        company_name text NOT NULL,
        stock_code text NOT NULL DEFAULT '',
        run_id text NOT NULL,
        payload jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS risk_graph_snapshots (
        company_key text NOT NULL REFERENCES risk_graph_companies(company_key) ON DELETE CASCADE,
        view text NOT NULL CHECK (view IN ('fee-transmission','subject-panorama')),
        min_weight numeric(4,2) NOT NULL CHECK (min_weight BETWEEN 0.35 AND 0.95),
        run_id text NOT NULL,
        payload_sha256 char(64) NOT NULL,
        payload jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (company_key, view, min_weight)
      );
      CREATE INDEX IF NOT EXISTS risk_graph_snapshots_run_idx ON risk_graph_snapshots(run_id);
    `)
    for (const company of bundle.companies) {
      await client.query(
        `INSERT INTO risk_graph_companies(company_key,company_name,stock_code,run_id,payload,updated_at)
         VALUES($1,$2,$3,$4,$5::jsonb,now())
         ON CONFLICT(company_key) DO UPDATE SET company_name=excluded.company_name,
           stock_code=excluded.stock_code,run_id=excluded.run_id,payload=excluded.payload,updated_at=now()`,
        [
          company.companyKey,
          company.companyName,
          company.stockCode,
          company.runId,
          JSON.stringify(company.payload),
        ]
      )
    }
    for (const snapshot of bundle.snapshots) {
      await client.query(
        `INSERT INTO risk_graph_snapshots(company_key,view,min_weight,run_id,payload_sha256,payload,updated_at)
         VALUES($1,$2,$3,$4,$5,$6::jsonb,now())
         ON CONFLICT(company_key,view,min_weight) DO UPDATE SET run_id=excluded.run_id,
           payload_sha256=excluded.payload_sha256,payload=excluded.payload,updated_at=now()`,
        [
          snapshot.companyKey,
          snapshot.view,
          snapshot.minWeight,
          snapshot.runId,
          snapshot.payloadSha256,
          JSON.stringify(snapshot.payload),
        ]
      )
    }
    await client.query(
      `INSERT INTO risk_graph_imports(schema_version,generated_at,source_database,company_count,snapshot_count)
       VALUES($1,$2,$3,$4,$5)`,
      [
        bundle.schemaVersion,
        bundle.generatedAt,
        bundle.sourceDatabase,
        bundle.companies.length,
        bundle.snapshots.length,
      ]
    )
    await client.query("COMMIT")
    console.log(
      JSON.stringify(
        {
          schemaVersion: bundle.schemaVersion,
          companyCount: bundle.companies.length,
          snapshotCount: bundle.snapshots.length,
          sourceDatabase: bundle.sourceDatabase,
        },
        null,
        2
      )
    )
  } catch (error) {
    await client.query("ROLLBACK")
    throw error
  } finally {
    await client.end()
  }
}

await main()
