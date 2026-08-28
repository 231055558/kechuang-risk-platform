import { Pool, type PoolConfig } from "pg"

export type RiskGraphView = "fee-transmission" | "subject-panorama"

const allowedViews = new Set<RiskGraphView>([
  "fee-transmission",
  "subject-panorama",
])
const allowedWeights = [0.35, 0.5, 0.75] as const

export class RiskGraphServiceError extends Error {
  readonly statusCode: number
  readonly code: string

  constructor(statusCode: number, code: string, message: string) {
    super(message)
    this.name = "RiskGraphServiceError"
    this.statusCode = statusCode
    this.code = code
  }
}

function postgresConfiguration(): PoolConfig | null {
  const connectionString =
    process.env.RISK_GRAPH_DATABASE_URL ?? process.env.DATABASE_URL
  const host = process.env.RISK_GRAPH_PGHOST ?? process.env.PGHOST
  if (!connectionString && !host) return null
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
    max: Number(process.env.RISK_GRAPH_PGPOOL_MAX ?? "6"),
    connectionTimeoutMillis: Number(
      process.env.RISK_GRAPH_PGCONNECT_TIMEOUT_MS ?? "5000"
    ),
    idleTimeoutMillis: 30_000,
    ssl: sslMode === "require" ? { rejectUnauthorized: false } : undefined,
  }
}

function normalizeWeight(value: number) {
  if (!Number.isFinite(value)) {
    throw new RiskGraphServiceError(
      400,
      "RISK_GRAPH_WEIGHT_INVALID",
      "最小影响权重无效。"
    )
  }
  const exact = allowedWeights.find(
    (candidate) => Math.abs(candidate - value) < 0.001
  )
  if (exact === undefined) {
    throw new RiskGraphServiceError(
      400,
      "RISK_GRAPH_WEIGHT_UNSUPPORTED",
      "仅支持0.35、0.50或0.75影响权重。"
    )
  }
  return exact
}

export function createRiskGraphPostgresService() {
  const config = postgresConfiguration()
  const pool = config ? new Pool(config) : null

  function requirePool() {
    if (!pool) {
      throw new RiskGraphServiceError(
        503,
        "RISK_GRAPH_DATABASE_UNCONFIGURED",
        "云端知识图谱数据库尚未配置。"
      )
    }
    return pool
  }

  return {
    async health() {
      const result = await requirePool().query<{
        snapshot_count: string
        company_count: string
      }>(
        `SELECT (SELECT count(*) FROM risk_graph_snapshots)::text AS snapshot_count,
                (SELECT count(*) FROM risk_graph_companies)::text AS company_count`
      )
      return {
        ok: true,
        database: "postgresql",
        companyCount: Number(result.rows[0]?.company_count ?? 0),
        snapshotCount: Number(result.rows[0]?.snapshot_count ?? 0),
      }
    },

    async companies() {
      const result = await requirePool().query<{ payload: unknown }>(
        "SELECT payload FROM risk_graph_companies ORDER BY company_name"
      )
      return { companies: result.rows.map((row) => row.payload) }
    },

    async snapshot(companyKey: string, view: RiskGraphView, minWeight: number) {
      if (!companyKey) {
        throw new RiskGraphServiceError(
          400,
          "RISK_GRAPH_COMPANY_REQUIRED",
          "缺少企业节点标识。"
        )
      }
      if (!allowedViews.has(view)) {
        throw new RiskGraphServiceError(
          400,
          "RISK_GRAPH_VIEW_UNSUPPORTED",
          "不支持该知识图谱视图。"
        )
      }
      const weight = normalizeWeight(minWeight)
      const result = await requirePool().query<{ payload: unknown }>(
        `SELECT payload FROM risk_graph_snapshots
         WHERE company_key=$1 AND view=$2 AND min_weight=$3::numeric`,
        [companyKey, view, weight]
      )
      if (!result.rows[0]) {
        throw new RiskGraphServiceError(
          404,
          "RISK_GRAPH_SNAPSHOT_NOT_FOUND",
          "当前企业没有对应的知识图谱快照。"
        )
      }
      return result.rows[0].payload
    },

    async close() {
      if (pool) await pool.end()
    },
  }
}

export type RiskGraphPostgresService = ReturnType<
  typeof createRiskGraphPostgresService
>
