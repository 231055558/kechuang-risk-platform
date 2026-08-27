import { createHash } from "node:crypto"
import { createReadStream, readdirSync, readFileSync, statSync } from "node:fs"
import { basename, resolve } from "node:path"
import { DatabaseSync } from "node:sqlite"

import { Client, type ClientConfig } from "pg"

type SqliteCell = null | string | number | bigint | Uint8Array
type SqliteRow = Record<string, SqliteCell>

interface SqliteColumn {
  cid: number
  name: string
  type: string
  notnull: number
  dflt_value: string | null
  pk: number
}

interface SqliteIndex {
  seq: number
  name: string
  unique: number
  origin: string
  partial: number
}

interface SqliteIndexColumn {
  seqno: number
  cid: number
  name: string | null
}

interface SqliteForeignKey {
  id: number
  seq: number
  table: string
  from: string
  to: string
  on_update: string
  on_delete: string
  match: string
}

interface SqliteObject {
  name: string
  sql: string
}

interface ImportOptions {
  inputPath: string
  replace: boolean
  verifyOnly: boolean
}

const DEFAULT_INPUT =
  "data/snapshots/科创企业R01-R22风险指标总数据库_94家_公开快照_20260820.sqlite"
const TARGET_SCHEMA = "risk_data"
const MIGRATIONS_DIRECTORY = resolve("db/migrations")
const MAX_QUERY_PARAMETERS = 60_000
const API_ROLE = "kechuang_api"
const INGEST_ROLE = "kechuang_ingest"

function quoteIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`
}

function qualifiedName(schema: string, object: string) {
  return `${quoteIdentifier(schema)}.${quoteIdentifier(object)}`
}

function sqliteRows<T>(database: DatabaseSync, sql: string) {
  return database.prepare(sql).all() as unknown as T[]
}

function sqliteIdentifier(value: string) {
  return quoteIdentifier(value)
}

function postgresType(sqliteType: string) {
  const normalized = sqliteType.trim().toUpperCase()
  if (normalized.includes("INT")) return "BIGINT"
  if (
    normalized.includes("CHAR") ||
    normalized.includes("CLOB") ||
    normalized.includes("TEXT") ||
    normalized === ""
  ) {
    return "TEXT"
  }
  if (normalized.includes("BLOB")) return "BYTEA"
  if (
    normalized.includes("REAL") ||
    normalized.includes("FLOA") ||
    normalized.includes("DOUB")
  ) {
    return "DOUBLE PRECISION"
  }
  if (normalized.includes("NUMERIC") || normalized.includes("DECIMAL")) {
    return "NUMERIC"
  }
  return "TEXT"
}

function compactIdentifier(value: string) {
  if (value.length <= 63) return value
  const suffix = createHash("sha256").update(value).digest("hex").slice(0, 8)
  return `${value.slice(0, 54)}_${suffix}`
}

function defaultClause(column: SqliteColumn, identity: boolean) {
  if (identity || column.dflt_value === null) return ""
  return ` DEFAULT ${column.dflt_value}`
}

function clientConfig(): ClientConfig {
  if (process.env.DATABASE_URL) {
    return {
      application_name: "kechuang-risk-snapshot-import",
      connectionString: process.env.DATABASE_URL,
    }
  }

  return {
    application_name: "kechuang-risk-snapshot-import",
    database: process.env.PGDATABASE ?? "kechuang_risk",
    host: process.env.PGHOST ?? "/tmp",
    password: process.env.PGPASSWORD,
    port: Number(process.env.PGPORT ?? "5432"),
    user: process.env.PGUSER ?? process.env.USER,
  }
}

function parseOptions(argv: readonly string[]): ImportOptions {
  const positional = argv.filter((argument) => !argument.startsWith("--"))
  const unsupported = argv.filter(
    (argument) =>
      argument.startsWith("--") &&
      argument !== "--replace" &&
      argument !== "--verify"
  )
  if (unsupported.length > 0) {
    throw new Error(`不支持的参数：${unsupported.join(", ")}`)
  }
  if (positional.length > 1) {
    throw new Error("只能指定一个 SQLite 输入文件。")
  }
  return {
    inputPath: resolve(positional[0] ?? DEFAULT_INPUT),
    replace: argv.includes("--replace"),
    verifyOnly: argv.includes("--verify"),
  }
}

async function sha256File(path: string) {
  return await new Promise<string>((resolveHash, reject) => {
    const hash = createHash("sha256")
    const stream = createReadStream(path)
    stream.on("data", (chunk) => hash.update(chunk))
    stream.on("error", reject)
    stream.on("end", () => resolveHash(hash.digest("hex")))
  })
}

async function bootstrapMigrations(client: Client) {
  await client.query("CREATE SCHEMA IF NOT EXISTS platform")
  await client.query(`
    CREATE TABLE IF NOT EXISTS platform.schema_migrations (
      migration_name TEXT PRIMARY KEY,
      sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
      applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `)

  const migrationNames = readdirSync(MIGRATIONS_DIRECTORY)
    .filter((name) => /^\d+.*\.sql$/.test(name))
    .sort()

  for (const migrationName of migrationNames) {
    const migrationPath = resolve(MIGRATIONS_DIRECTORY, migrationName)
    const sql = readFileSync(migrationPath, "utf8")
    const checksum = createHash("sha256").update(sql).digest("hex")
    const existing = await client.query<{ sha256: string }>(
      "SELECT sha256 FROM platform.schema_migrations WHERE migration_name = $1",
      [migrationName]
    )
    if (existing.rows[0]) {
      if (existing.rows[0].sha256 !== checksum) {
        throw new Error(`已应用的迁移 ${migrationName} 校验和发生变化。`)
      }
      continue
    }

    await client.query("BEGIN")
    try {
      await client.query(sql)
      await client.query(
        "INSERT INTO platform.schema_migrations(migration_name, sha256) VALUES ($1, $2)",
        [migrationName, checksum]
      )
      await client.query("COMMIT")
    } catch (error) {
      await client.query("ROLLBACK")
      throw error
    }
  }
}

function listSqliteObjects(database: DatabaseSync, type: "table" | "view") {
  return sqliteRows<SqliteObject>(
    database,
    `SELECT name, sql
     FROM sqlite_master
     WHERE type = '${type}' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\'
     ORDER BY name`
  )
}

function tableColumns(database: DatabaseSync, tableName: string) {
  return sqliteRows<SqliteColumn>(
    database,
    `PRAGMA table_info(${sqliteIdentifier(tableName)})`
  )
}

function tableIndexes(database: DatabaseSync, tableName: string) {
  return sqliteRows<SqliteIndex>(
    database,
    `PRAGMA index_list(${sqliteIdentifier(tableName)})`
  )
}

function indexColumns(database: DatabaseSync, indexName: string) {
  return sqliteRows<SqliteIndexColumn>(
    database,
    `PRAGMA index_info(${sqliteIdentifier(indexName)})`
  )
}

function tableForeignKeys(database: DatabaseSync, tableName: string) {
  return sqliteRows<SqliteForeignKey>(
    database,
    `PRAGMA foreign_key_list(${sqliteIdentifier(tableName)})`
  )
}

async function createTable(
  client: Client,
  database: DatabaseSync,
  schema: string,
  tableName: string
) {
  const columns = tableColumns(database, tableName)
  if (columns.length === 0) {
    throw new Error(`SQLite 表 ${tableName} 没有列。`)
  }
  const primaryKey = columns
    .filter((column) => column.pk > 0)
    .sort((left, right) => left.pk - right.pk)
  const identityColumn =
    primaryKey.length === 1 && postgresType(primaryKey[0].type) === "BIGINT"
      ? primaryKey[0].name
      : null

  const definitions = columns.map((column) => {
    const identity = column.name === identityColumn
    const type = postgresType(column.type)
    const generated = identity ? " GENERATED BY DEFAULT AS IDENTITY" : ""
    const required = column.notnull === 1 ? " NOT NULL" : ""
    return `${quoteIdentifier(column.name)} ${type}${generated}${required}${defaultClause(column, identity)}`
  })
  if (primaryKey.length > 0) {
    definitions.push(
      `PRIMARY KEY (${primaryKey
        .map((column) => quoteIdentifier(column.name))
        .join(", ")})`
    )
  }

  await client.query(
    `CREATE TABLE ${qualifiedName(schema, tableName)} (${definitions.join(", ")})`
  )
  return { columns, identityColumn }
}

function normalizeCell(value: SqliteCell | undefined) {
  if (value === undefined) return null
  return value
}

async function insertRows(
  client: Client,
  database: DatabaseSync,
  schema: string,
  tableName: string,
  columns: readonly SqliteColumn[]
) {
  const sourceRows = sqliteRows<SqliteRow>(
    database,
    `SELECT * FROM ${sqliteIdentifier(tableName)}`
  )
  if (sourceRows.length === 0) return 0

  const batchSize = Math.max(
    1,
    Math.min(500, Math.floor(MAX_QUERY_PARAMETERS / columns.length))
  )
  const columnSql = columns
    .map((column) => quoteIdentifier(column.name))
    .join(", ")

  for (let offset = 0; offset < sourceRows.length; offset += batchSize) {
    const batch = sourceRows.slice(offset, offset + batchSize)
    const values: SqliteCell[] = []
    const rowSql = batch.map((row, rowIndex) => {
      const placeholders = columns.map((column, columnIndex) => {
        values.push(normalizeCell(row[column.name]))
        return `$${rowIndex * columns.length + columnIndex + 1}`
      })
      return `(${placeholders.join(", ")})`
    })
    await client.query(
      `INSERT INTO ${qualifiedName(schema, tableName)} (${columnSql}) VALUES ${rowSql.join(", ")}`,
      values
    )
  }
  return sourceRows.length
}

async function synchronizeIdentity(
  client: Client,
  schema: string,
  tableName: string,
  identityColumn: string | null
) {
  if (!identityColumn) return
  const relation = `${schema}.${tableName}`
  const sequence = await client.query<{ sequence_name: string | null }>(
    "SELECT pg_get_serial_sequence($1, $2) AS sequence_name",
    [relation, identityColumn]
  )
  const sequenceName = sequence.rows[0]?.sequence_name
  if (!sequenceName) return
  const maximum = await client.query<{ maximum: string | null }>(
    `SELECT MAX(${quoteIdentifier(identityColumn)})::TEXT AS maximum FROM ${qualifiedName(schema, tableName)}`
  )
  const maximumValue = maximum.rows[0]?.maximum
  if (maximumValue === null || maximumValue === undefined) {
    await client.query("SELECT setval($1::regclass, 1, false)", [sequenceName])
  } else {
    await client.query("SELECT setval($1::regclass, $2::BIGINT, true)", [
      sequenceName,
      maximumValue,
    ])
  }
}

async function createIndexes(
  client: Client,
  database: DatabaseSync,
  schema: string,
  tableName: string
) {
  for (const index of tableIndexes(database, tableName)) {
    if (index.origin === "pk") continue
    if (index.partial === 1) {
      throw new Error(`暂不支持 SQLite 部分索引：${index.name}`)
    }
    const columns = indexColumns(database, index.name)
    if (columns.some((column) => column.cid < 0 || column.name === null)) {
      throw new Error(`暂不支持 SQLite 表达式索引：${index.name}`)
    }
    const generatedName = index.name.startsWith("sqlite_autoindex")
      ? `uq_${tableName}_${columns.map((column) => column.name).join("_")}`
      : index.name
    const unique = index.unique === 1 ? "UNIQUE " : ""
    await client.query(
      `CREATE ${unique}INDEX ${quoteIdentifier(
        compactIdentifier(generatedName)
      )} ON ${qualifiedName(schema, tableName)} (${columns
        .map((column) => quoteIdentifier(String(column.name)))
        .join(", ")})`
    )
  }
}

async function createForeignKeys(
  client: Client,
  database: DatabaseSync,
  schema: string,
  tableName: string
) {
  const grouped = new Map<number, SqliteForeignKey[]>()
  for (const foreignKey of tableForeignKeys(database, tableName)) {
    grouped.set(foreignKey.id, [
      ...(grouped.get(foreignKey.id) ?? []),
      foreignKey,
    ])
  }

  for (const [foreignKeyId, unorderedColumns] of grouped) {
    const columns = unorderedColumns.sort((left, right) => left.seq - right.seq)
    const first = columns[0]
    const constraintName = compactIdentifier(
      `fk_${tableName}_${foreignKeyId}_${columns
        .map((column) => column.from)
        .join("_")}`
    )
    const updateAction = first.on_update.toUpperCase()
    const deleteAction = first.on_delete.toUpperCase()
    const onUpdate =
      updateAction && updateAction !== "NO ACTION"
        ? ` ON UPDATE ${updateAction}`
        : ""
    const onDelete =
      deleteAction && deleteAction !== "NO ACTION"
        ? ` ON DELETE ${deleteAction}`
        : ""
    await client.query(
      `ALTER TABLE ${qualifiedName(schema, tableName)}
       ADD CONSTRAINT ${quoteIdentifier(constraintName)}
       FOREIGN KEY (${columns
         .map((column) => quoteIdentifier(column.from))
         .join(", ")})
       REFERENCES ${qualifiedName(schema, first.table)} (${columns
         .map((column) => quoteIdentifier(column.to))
         .join(", ")})${onUpdate}${onDelete}`
    )
  }
  return grouped.size
}

async function createViews(
  client: Client,
  database: DatabaseSync,
  schema: string
) {
  const views = listSqliteObjects(database, "view")
  await client.query(
    `SET LOCAL search_path TO ${quoteIdentifier(schema)}, public`
  )
  for (const view of views) {
    const match = view.sql.match(/^CREATE\s+VIEW\s+\S+\s+AS\s+([\s\S]+)$/i)
    if (!match) {
      throw new Error(`无法解析 SQLite 视图：${view.name}`)
    }
    await client.query(
      `CREATE VIEW ${qualifiedName(schema, view.name)} AS ${match[1]}`
    )
  }
  return views.length
}

async function schemaExists(client: Client, schema: string) {
  const result = await client.query<{ exists: boolean }>(
    "SELECT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname = $1) AS exists",
    [schema]
  )
  return result.rows[0]?.exists === true
}

async function applyExistingRoleGrants(client: Client, schema: string) {
  const roles = await client.query<{ rolname: string }>(
    "SELECT rolname FROM pg_roles WHERE rolname = ANY($1::TEXT[])",
    [[API_ROLE, INGEST_ROLE]]
  )
  const existingRoles = new Set(roles.rows.map((row) => row.rolname))
  if (existingRoles.has(API_ROLE)) {
    await client.query(
      `GRANT USAGE ON SCHEMA ${quoteIdentifier(schema)} TO ${quoteIdentifier(API_ROLE)}`
    )
    await client.query(
      `GRANT SELECT ON ALL TABLES IN SCHEMA ${quoteIdentifier(schema)} TO ${quoteIdentifier(API_ROLE)}`
    )
  }
  if (existingRoles.has(INGEST_ROLE)) {
    await client.query(
      `GRANT USAGE ON SCHEMA ${quoteIdentifier(schema)} TO ${quoteIdentifier(INGEST_ROLE)}`
    )
    await client.query(
      `GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA ${quoteIdentifier(schema)} TO ${quoteIdentifier(INGEST_ROLE)}`
    )
    await client.query(
      `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ${quoteIdentifier(schema)} TO ${quoteIdentifier(INGEST_ROLE)}`
    )
  }
}

function sqliteTableCounts(database: DatabaseSync) {
  return Object.fromEntries(
    listSqliteObjects(database, "table").map((table) => {
      const result = sqliteRows<{ count: number }>(
        database,
        `SELECT COUNT(*) AS count FROM ${sqliteIdentifier(table.name)}`
      )
      return [table.name, Number(result[0]?.count ?? 0)]
    })
  )
}

async function postgresTableCounts(client: Client, schema: string) {
  const tables = await client.query<{ table_name: string }>(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = $1 AND table_type = 'BASE TABLE'
     ORDER BY table_name`,
    [schema]
  )
  const counts: Record<string, number> = {}
  for (const table of tables.rows) {
    const result = await client.query<{ count: string }>(
      `SELECT COUNT(*)::TEXT AS count FROM ${qualifiedName(
        schema,
        table.table_name
      )}`
    )
    counts[table.table_name] = Number(result.rows[0]?.count ?? 0)
  }
  return counts
}

function assertMatchingCounts(
  sourceCounts: Record<string, number>,
  targetCounts: Record<string, number>
) {
  const differences = Object.entries(sourceCounts).flatMap(
    ([tableName, sourceCount]) => {
      const targetCount = targetCounts[tableName]
      return targetCount === sourceCount
        ? []
        : [
            `${tableName}: SQLite=${sourceCount}, PostgreSQL=${targetCount ?? "缺失"}`,
          ]
    }
  )
  const extraTables = Object.keys(targetCounts).filter(
    (tableName) => !(tableName in sourceCounts)
  )
  differences.push(
    ...extraTables.map((tableName) => `${tableName}: PostgreSQL 多余表`)
  )
  if (differences.length > 0) {
    throw new Error(`数据行数校验失败：\n${differences.join("\n")}`)
  }
}

async function verifyTarget(
  client: Client,
  database: DatabaseSync,
  schema: string
) {
  if (!(await schemaExists(client, schema))) {
    throw new Error(`PostgreSQL schema ${schema} 不存在。`)
  }
  const sourceCounts = sqliteTableCounts(database)
  const targetCounts = await postgresTableCounts(client, schema)
  assertMatchingCounts(sourceCounts, targetCounts)

  const expectedForeignKeyCount = listSqliteObjects(database, "table").reduce(
    (count, table) => {
      const ids = new Set(
        tableForeignKeys(database, table.name).map(
          (foreignKey) => foreignKey.id
        )
      )
      return count + ids.size
    },
    0
  )
  const foreignKeys = await client.query<{ count: string }>(
    `SELECT COUNT(*)::TEXT AS count
     FROM pg_constraint constraint_record
     JOIN pg_namespace schema_record
       ON schema_record.oid = constraint_record.connamespace
     WHERE schema_record.nspname = $1
       AND constraint_record.contype = 'f'
       AND constraint_record.convalidated`,
    [schema]
  )
  const foreignKeyCount = Number(foreignKeys.rows[0]?.count ?? 0)
  if (foreignKeyCount !== expectedForeignKeyCount) {
    throw new Error(
      `外键校验失败：SQLite=${expectedForeignKeyCount}, PostgreSQL=${foreignKeyCount}`
    )
  }

  const views = await client.query<{ count: string }>(
    `SELECT COUNT(*)::TEXT AS count
     FROM information_schema.views
     WHERE table_schema = $1`,
    [schema]
  )
  const viewCount = Number(views.rows[0]?.count ?? 0)
  const expectedViewCount = listSqliteObjects(database, "view").length
  if (viewCount !== expectedViewCount) {
    throw new Error(
      `视图校验失败：SQLite=${expectedViewCount}, PostgreSQL=${viewCount}`
    )
  }

  const dataVersion = await client.query<{ value: string }>(
    `SELECT value FROM ${qualifiedName(schema, "metadata")} WHERE key = 'data_version'`
  )
  if (!dataVersion.rows[0]?.value) {
    throw new Error("PostgreSQL metadata 缺少 data_version。")
  }

  return {
    dataVersion: dataVersion.rows[0].value,
    foreignKeyCount,
    tableCounts: targetCounts,
    viewCount,
  }
}

async function importSnapshot(
  client: Client,
  database: DatabaseSync,
  options: ImportOptions,
  sourceSha256: string
) {
  const sqliteVersion = sqliteRows<{ version: string }>(
    database,
    "SELECT sqlite_version() AS version"
  )[0]?.version
  const run = await client.query<{ import_run_id: string }>(
    `INSERT INTO platform.snapshot_import_runs(
       status, source_path, source_sha256, target_schema, sqlite_version
     ) VALUES ('running', $1, $2, $3, $4)
     RETURNING import_run_id::TEXT`,
    [options.inputPath, sourceSha256, TARGET_SCHEMA, sqliteVersion]
  )
  const importRunId = run.rows[0].import_run_id
  const timestamp = new Date()
    .toISOString()
    .replaceAll(/[-:.TZ]/g, "")
    .slice(0, 14)
  const stagingSchema = compactIdentifier(
    `risk_import_${timestamp}_${importRunId}`
  )
  const backupSchema = compactIdentifier(
    `risk_backup_${timestamp}_${importRunId}`
  )

  try {
    await client.query("BEGIN")
    await client.query("SET LOCAL lock_timeout = '10s'")
    await client.query("SET LOCAL statement_timeout = '0'")
    const targetExists = await schemaExists(client, TARGET_SCHEMA)
    if (targetExists && !options.replace) {
      throw new Error(
        `PostgreSQL schema ${TARGET_SCHEMA} 已存在；如需保留旧版并导入新版，请显式传入 --replace。`
      )
    }

    await client.query(`CREATE SCHEMA ${quoteIdentifier(stagingSchema)}`)
    const tableCounts: Record<string, number> = {}
    const identityColumns = new Map<string, string | null>()
    const tables = listSqliteObjects(database, "table")
    for (const table of tables) {
      const definition = await createTable(
        client,
        database,
        stagingSchema,
        table.name
      )
      identityColumns.set(table.name, definition.identityColumn)
      tableCounts[table.name] = await insertRows(
        client,
        database,
        stagingSchema,
        table.name,
        definition.columns
      )
    }

    for (const table of tables) {
      await createIndexes(client, database, stagingSchema, table.name)
    }

    let foreignKeyCount = 0
    for (const table of tables) {
      foreignKeyCount += await createForeignKeys(
        client,
        database,
        stagingSchema,
        table.name
      )
      await synchronizeIdentity(
        client,
        stagingSchema,
        table.name,
        identityColumns.get(table.name) ?? null
      )
    }

    const viewCount = await createViews(client, database, stagingSchema)
    const verification = await verifyTarget(client, database, stagingSchema)

    let previousSchema: string | null = null
    if (targetExists) {
      await client.query(
        `ALTER SCHEMA ${quoteIdentifier(TARGET_SCHEMA)} RENAME TO ${quoteIdentifier(backupSchema)}`
      )
      previousSchema = backupSchema
    }
    await client.query(
      `ALTER SCHEMA ${quoteIdentifier(stagingSchema)} RENAME TO ${quoteIdentifier(TARGET_SCHEMA)}`
    )
    await applyExistingRoleGrants(client, TARGET_SCHEMA)
    await client.query("COMMIT")

    await client.query(
      `UPDATE platform.snapshot_import_runs
       SET status = 'succeeded', completed_at = CURRENT_TIMESTAMP,
           previous_schema = $2, table_counts = $3::JSONB,
           view_count = $4, foreign_key_count = $5
       WHERE import_run_id = $1`,
      [
        importRunId,
        previousSchema,
        JSON.stringify(tableCounts),
        viewCount,
        foreignKeyCount,
      ]
    )
    return {
      ...verification,
      importRunId,
      previousSchema,
      sourceSha256,
      targetSchema: TARGET_SCHEMA,
    }
  } catch (error) {
    await client.query("ROLLBACK")
    const message = error instanceof Error ? error.message : String(error)
    await client.query(
      `UPDATE platform.snapshot_import_runs
       SET status = 'failed', completed_at = CURRENT_TIMESTAMP,
           error_message = $2
       WHERE import_run_id = $1`,
      [importRunId, message]
    )
    throw error
  }
}

async function main() {
  const options = parseOptions(process.argv.slice(2))
  const inputStats = statSync(options.inputPath)
  if (!inputStats.isFile()) {
    throw new Error(`SQLite 输入不是文件：${options.inputPath}`)
  }

  const database = new DatabaseSync(options.inputPath, { readOnly: true })
  const client = new Client(clientConfig())
  try {
    const integrity = sqliteRows<Record<string, string>>(
      database,
      "PRAGMA integrity_check"
    )[0]
    if (!integrity || Object.values(integrity)[0] !== "ok") {
      throw new Error("SQLite 完整性检查未通过。")
    }
    await client.connect()
    await bootstrapMigrations(client)
    const sourceSha256 = await sha256File(options.inputPath)
    const result = options.verifyOnly
      ? await verifyTarget(client, database, TARGET_SCHEMA)
      : await importSnapshot(client, database, options, sourceSha256)
    process.stdout.write(
      `${JSON.stringify(
        {
          input: basename(options.inputPath),
          mode: options.verifyOnly ? "verify" : "import",
          ...result,
        },
        null,
        2
      )}\n`
    )
  } finally {
    database.close()
    await client.end().catch(() => undefined)
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(message)
  process.exitCode = 1
})
