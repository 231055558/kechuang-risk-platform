import { Pool, type PoolConfig } from "pg"

import snapshotData from "../src/data/industry/narrative-risk-runtime.json" with { type: "json" }
import annualSnapshotData from "../src/data/industry/narrative-risk-annual-trends.json" with { type: "json" }
import {
  NARRATIVE_RISK_SCHEMA_VERSION,
  type NarrativeArtifactStatus,
  type NarrativeMetricClass,
  type NarrativeRiskAssessmentRecord,
  type NarrativeRiskAuditSummaryResponse,
  type NarrativeRiskCompanyDirectoryResponse,
  type NarrativeRiskCompanyResponse,
  type NarrativeRiskCoverageRecord,
  type NarrativeRiskEventRecord,
  type NarrativeRiskMetricRecord,
  type NarrativeRiskSourcePageResponse,
  type NarrativeRiskSourceRecord,
  type NarrativeAnnualAuditResponse,
  type NarrativeAnnualMethodologyResponse,
  type NarrativeAnnualTrendResponse,
} from "../src/domain/narrative-risk-v1/index.ts"
import {
  readNarrativeAnnualRuntimeSnapshot,
  readNarrativeRuntimeSnapshot,
  type NarrativeAnnualRuntimeSnapshot,
  type NarrativeRuntimeSnapshot,
} from "./narrative-risk-repository.ts"

type RuntimeRow = Record<string, unknown>

interface NarrativeRiskServiceOptions {
  forceSnapshot?: boolean
  pool?: Pool
  snapshot?: NarrativeRuntimeSnapshot
  annualSnapshot?: NarrativeAnnualRuntimeSnapshot
}

export interface NarrativeRiskSourceFilters {
  scopeId?: string | null
  channel?: string | null
  validationStatus?: string | null
  page?: number
  pageSize?: number
}

function postgresConfig(): PoolConfig {
  if (process.env.DATABASE_URL) {
    return {
      application_name: "kechuang-narrative-risk-api",
      connectionString: process.env.DATABASE_URL,
      connectionTimeoutMillis: 1_200,
      max: 4,
    }
  }
  return {
    application_name: "kechuang-narrative-risk-api",
    connectionTimeoutMillis: 1_200,
    database: process.env.PGDATABASE ?? "kechuang_risk",
    host: process.env.PGHOST ?? "/tmp",
    max: 4,
    password: process.env.PGPASSWORD,
    port: Number(process.env.PGPORT ?? "5432"),
    user: process.env.PGUSER ?? process.env.USER,
  }
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : null
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function integerValue(value: unknown) {
  const parsed = numberValue(value)
  return parsed === null ? 0 : Math.trunc(parsed)
}

function booleanValue(value: unknown) {
  return value === true
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : []
}

function publicUrl(value: unknown) {
  if (typeof value !== "string" || value.trim() === "") return null
  try {
    const parsed = new URL(value)
    return parsed.protocol === "https:" || parsed.protocol === "http:"
      ? parsed.toString()
      : null
  } catch {
    return null
  }
}

function envelope(dataset: NarrativeRuntimeSnapshot) {
  return {
    schemaVersion: NARRATIVE_RISK_SCHEMA_VERSION,
    dataVersion: dataset.dataVersion,
    asOfDate: dataset.asOfDate,
    sourceMode: dataset.sourceMode,
  }
}

function metricClass(value: unknown): NarrativeMetricClass {
  return value === "formal" ||
    value === "proxy" ||
    value === "invalid" ||
    value === "missing"
    ? value
    : "missing"
}

function artifactStatus(value: unknown): NarrativeArtifactStatus | null {
  return value === "archived" ||
    value === "unavailable" ||
    value === "not-required" ||
    value === "pending-review"
    ? value
    : null
}

function assessmentRecord(
  row: RuntimeRow,
  scope: RuntimeRow | undefined,
  membership: RuntimeRow | undefined
): NarrativeRiskAssessmentRecord {
  return {
    scopeId: String(row.scopeId),
    scopeLabel: stringValue(scope?.label) ?? String(row.scopeId),
    sampleRole: stringValue(membership?.sampleRole),
    windowStart: stringValue(membership?.windowStart),
    windowEnd: stringValue(membership?.windowEnd),
    dataCutoff: stringValue(membership?.dataCutoff),
    objectiveRiskScore: numberValue(row.objectiveRiskScore),
    weightedCoverage: numberValue(row.weightedCoverage),
    pdqiValue: numberValue(row.pdqiValue),
    pdqiVariant: stringValue(row.pdqiVariant),
    itagValue: numberValue(row.itagValue),
    itagVariant: stringValue(row.itagVariant),
    toneValue: numberValue(row.toneValue),
    toneVariant: stringValue(row.toneVariant),
    jointRiskLevel: stringValue(row.jointRiskLevel),
    validationStatus: stringValue(row.validationStatus) ?? "unverified",
    conclusion: stringValue(row.conclusion),
  }
}

function metricRecord(row: RuntimeRow): NarrativeRiskMetricRecord {
  const classification = metricClass(row.metricClass)
  const raw = numberValue(row.rawNumericValue)
  const validated = numberValue(row.validatedNumericValue)
  return {
    metricId: String(row.metricId),
    scopeId: String(row.scopeId),
    indicatorId: stringValue(row.indicatorId),
    metricName: String(row.metricName),
    metricVariant: String(row.metricVariant),
    metricClass: classification,
    rawNumericValue: raw,
    validatedNumericValue: validated,
    displayNumericValue:
      classification === "invalid" || classification === "missing"
        ? null
        : (validated ?? (classification === "proxy" ? raw : null)),
    unit: stringValue(row.unit),
    status: stringValue(row.status),
    validationStatus: stringValue(row.validationStatus) ?? "unverified",
    confidenceScore: numberValue(row.confidenceScore),
    confidenceLevel: stringValue(row.confidenceLevel),
    formula: stringValue(row.formula),
    asOfDate: stringValue(row.asOfDate),
    limitation: stringValue(row.limitation),
    scoreEligible: booleanValue(row.scoreEligible),
    scoreExclusionReason: stringValue(row.scoreExclusionReason),
    sourceCount: integerValue(row.sourceCount),
  }
}

function coverageRecord(row: RuntimeRow): NarrativeRiskCoverageRecord {
  return {
    scopeId: String(row.scopeId),
    indicatorId: String(row.indicatorId),
    coverageStatus: String(row.coverageStatus),
    originalDefinitionUsable:
      typeof row.originalDefinitionUsable === "boolean"
        ? row.originalDefinitionUsable
        : null,
    documentMethodUsable:
      typeof row.documentMethodUsable === "boolean"
        ? row.documentMethodUsable
        : null,
    confidenceScore: numberValue(row.confidenceScore),
    confidenceLevel: stringValue(row.confidenceLevel),
    observationCount: numberValue(row.observationCount),
    numericObservationCount: numberValue(row.numericObservationCount),
    limitation: stringValue(row.limitation),
  }
}

function eventRecord(row: RuntimeRow): NarrativeRiskEventRecord {
  return {
    eventId: String(row.eventId),
    scopeId: String(row.scopeId),
    eventDate: stringValue(row.eventDate),
    eventTitle: String(row.eventTitle),
    eventType: stringValue(row.eventType),
    featureRole: stringValue(row.featureRole),
    labelRole: stringValue(row.labelRole),
    severity: stringValue(row.severity),
    sourceId: stringValue(row.sourceId),
    notes: stringValue(row.notes),
  }
}

function sourceRecord(row: RuntimeRow): NarrativeRiskSourceRecord {
  const status = artifactStatus(row.artifactStatus)
  return {
    sourceKey: String(row.sourceKey),
    sourceId: String(row.sourceId),
    scopeId: String(row.scopeId),
    companyKey: stringValue(row.companyKey),
    channel: stringValue(row.channel),
    title: stringValue(row.title),
    institution: stringValue(row.institution),
    publicationDate: stringValue(row.publicationDate),
    canonicalUrl: publicUrl(row.canonicalUrl),
    validationStatus: stringValue(row.validationStatus) ?? "unverified",
    rawOccurrenceCount: integerValue(row.rawOccurrenceCount),
    webUrlRequired: row.webUrlRequired !== false,
    browserValidated: booleanValue(row.browserValidated),
    artifact: status
      ? {
          status,
          artifactKind: stringValue(row.artifactKind) ?? "metadata-only",
          httpStatus: numberValue(row.httpStatus),
          contentType: stringValue(row.contentType),
          byteSize: numberValue(row.byteSize),
          contentSha256: stringValue(row.contentSha256),
          fetchedAt: stringValue(row.fetchedAt),
          publicExcerpt: stringValue(row.publicExcerpt)?.slice(0, 240) ?? null,
        }
      : null,
  }
}

export class NarrativeRiskCompanyNotFoundError extends Error {
  readonly statusCode = 404
  readonly code = "NARRATIVE_RISK_COMPANY_NOT_FOUND"

  constructor(companyKey: string) {
    super(`企业 ${companyKey} 不在当前叙事风险样本中。`)
    this.name = "NarrativeRiskCompanyNotFoundError"
  }
}

export function createNarrativeRiskService(
  options: NarrativeRiskServiceOptions = {}
) {
  const forceSnapshot =
    options.forceSnapshot ?? process.env.NARRATIVE_RISK_FORCE_SNAPSHOT === "1"
  const fallback =
    options.snapshot ?? (snapshotData as unknown as NarrativeRuntimeSnapshot)
  const annualFallback =
    options.annualSnapshot ??
    (annualSnapshotData as unknown as NarrativeAnnualRuntimeSnapshot)
  const pool = options.pool ?? new Pool(postgresConfig())
  let cache: { expiresAt: number; value: NarrativeRuntimeSnapshot } | undefined
  let fallbackLogged = false
  let annualCache:
    { expiresAt: number; value: NarrativeAnnualRuntimeSnapshot } | undefined
  let annualFallbackLogged = false

  async function loadDataset() {
    if (forceSnapshot) return { ...fallback, sourceMode: "snapshot" as const }
    if (cache && cache.expiresAt > Date.now()) return cache.value
    try {
      const value = await readNarrativeRuntimeSnapshot(pool, "postgres")
      cache = { expiresAt: Date.now() + 15_000, value }
      fallbackLogged = false
      return value
    } catch (error) {
      if (!fallbackLogged) {
        console.warn(
          "Narrative risk PostgreSQL unavailable; using sanitized snapshot.",
          error instanceof Error ? error.message : String(error)
        )
        fallbackLogged = true
      }
      return { ...fallback, sourceMode: "snapshot" as const }
    }
  }

  async function loadAnnualDataset() {
    if (forceSnapshot) {
      return { ...annualFallback, sourceMode: "snapshot" as const }
    }
    if (annualCache && annualCache.expiresAt > Date.now()) {
      return annualCache.value
    }
    try {
      const value = await readNarrativeAnnualRuntimeSnapshot(pool, "postgres")
      annualCache = { expiresAt: Date.now() + 15_000, value }
      annualFallbackLogged = false
      return value
    } catch (error) {
      if (!annualFallbackLogged) {
        console.warn(
          "Narrative annual trends PostgreSQL unavailable; using sanitized snapshot.",
          error instanceof Error ? error.message : String(error)
        )
        annualFallbackLogged = true
      }
      return { ...annualFallback, sourceMode: "snapshot" as const }
    }
  }

  async function listCompanies(): Promise<NarrativeRiskCompanyDirectoryResponse> {
    const dataset = await loadDataset()
    const companies = dataset.companies.map((company) => {
      const key = String(company.companyKey)
      const memberships = dataset.scopeCompanies.filter(
        (row) => row.companyKey === key
      )
      const assessments = dataset.assessments.filter(
        (row) => row.companyKey === key
      )
      const metrics = dataset.metrics.filter((row) => row.companyKey === key)
      const sources = dataset.sources.filter((row) => row.companyKey === key)
      const events = dataset.events.filter((row) => row.companyKey === key)
      const objectiveAssessment = assessments.find(
        (row) => numberValue(row.objectiveRiskScore) !== null
      )
      const classes = metrics.map((row) => metricClass(row.metricClass))
      return {
        companyKey: key,
        shortName: String(company.shortName),
        fullName: stringValue(company.fullName),
        stockCode: stringValue(company.stockCode),
        scopeIds: memberships.map((row) => String(row.scopeId)),
        sampleRoles: memberships
          .map((row) => stringValue(row.sampleRole))
          .filter((value): value is string => value !== null),
        assessmentCount: assessments.length,
        objectiveRiskScore: numberValue(
          objectiveAssessment?.objectiveRiskScore
        ),
        weightedCoverage: numberValue(objectiveAssessment?.weightedCoverage),
        metricCount: metrics.length,
        formalMetricCount: classes.filter((value) => value === "formal").length,
        proxyMetricCount: classes.filter((value) => value === "proxy").length,
        invalidMetricCount: classes.filter((value) => value === "invalid")
          .length,
        missingMetricCount: classes.filter((value) => value === "missing")
          .length,
        sourceCount: sources.length,
        eventCount: events.length,
        validationStatuses: [
          ...new Set(
            assessments
              .map((row) => stringValue(row.validationStatus))
              .filter((value): value is string => value !== null)
          ),
        ],
      }
    })
    return {
      ...envelope(dataset),
      scopes: dataset.scopes.map((scope) => ({
        scopeId: String(scope.scopeId),
        label: String(scope.label),
        methodology: String(scope.methodology),
        asOfDate: stringValue(scope.asOfDate),
        companyCount: integerValue(scope.companyCount),
      })),
      companies,
      counts: {
        uniqueCompanies: companies.length,
        scopeCompanyRecords: dataset.scopeCompanies.length,
        sources: dataset.sources.length,
        metrics: dataset.metrics.length,
        pendingReview: dataset.sources.filter(
          (row) => row.artifactStatus === "pending-review"
        ).length,
      },
    }
  }

  async function getCompany(
    companyKey: string
  ): Promise<NarrativeRiskCompanyResponse> {
    const dataset = await loadDataset()
    const company = dataset.companies.find(
      (row) => row.companyKey === companyKey
    )
    if (!company) throw new NarrativeRiskCompanyNotFoundError(companyKey)
    const memberships = dataset.scopeCompanies.filter(
      (row) => row.companyKey === companyKey
    )
    const assessments = dataset.assessments.filter(
      (row) => row.companyKey === companyKey
    )
    const sources = dataset.sources.filter(
      (row) => row.companyKey === companyKey
    )
    return {
      ...envelope(dataset),
      company: {
        companyKey,
        shortName: String(company.shortName),
        fullName: stringValue(company.fullName),
        stockCode: stringValue(company.stockCode),
        aliases: stringArray(company.aliases),
      },
      assessments: assessments.map((row) =>
        assessmentRecord(
          row,
          dataset.scopes.find((scope) => scope.scopeId === row.scopeId),
          memberships.find((membership) => membership.scopeId === row.scopeId)
        )
      ),
      metrics: dataset.metrics
        .filter((row) => row.companyKey === companyKey)
        .map(metricRecord),
      coverage: dataset.coverage
        .filter((row) => row.companyKey === companyKey)
        .map(coverageRecord),
      events: dataset.events
        .filter((row) => row.companyKey === companyKey)
        .map(eventRecord),
      auditFindings: dataset.auditFindings
        .filter((row) => row.companyKey === companyKey)
        .map((row) => ({
          findingId: String(row.findingId),
          scopeId: stringValue(row.scopeId),
          sourceId: stringValue(row.sourceId),
          metricId: stringValue(row.metricId),
          severity: String(row.severity),
          status: String(row.status),
          title: String(row.title),
          detail: String(row.detail),
        })),
      counts: {
        scopes: memberships.length,
        sources: sources.length,
        archivedSources: sources.filter(
          (row) => row.artifactStatus === "archived"
        ).length,
        pendingReview: sources.filter(
          (row) => row.artifactStatus === "pending-review"
        ).length,
      },
    }
  }

  async function listSources(
    companyKey: string,
    filters: NarrativeRiskSourceFilters = {}
  ): Promise<NarrativeRiskSourcePageResponse> {
    const dataset = await loadDataset()
    if (!dataset.companies.some((row) => row.companyKey === companyKey)) {
      throw new NarrativeRiskCompanyNotFoundError(companyKey)
    }
    const requestedPage = numberValue(filters.page) ?? 1
    const requestedPageSize = numberValue(filters.pageSize) ?? 20
    const page = Math.max(1, Math.trunc(requestedPage))
    const pageSize = Math.min(100, Math.max(1, Math.trunc(requestedPageSize)))
    const rows = dataset.sources.filter(
      (row) =>
        row.companyKey === companyKey &&
        (!filters.scopeId || row.scopeId === filters.scopeId) &&
        (!filters.channel || row.channel === filters.channel) &&
        (!filters.validationStatus ||
          row.validationStatus === filters.validationStatus)
    )
    const offset = (page - 1) * pageSize
    return {
      ...envelope(dataset),
      companyKey,
      filters: {
        scopeId: filters.scopeId ?? null,
        channel: filters.channel ?? null,
        validationStatus: filters.validationStatus ?? null,
      },
      page,
      pageSize,
      total: rows.length,
      items: rows.slice(offset, offset + pageSize).map(sourceRecord),
    }
  }

  async function getAuditSummary(): Promise<NarrativeRiskAuditSummaryResponse> {
    const dataset = await loadDataset()
    const artifacts = dataset.sources.filter(
      (row) => artifactStatus(row.artifactStatus) !== null
    )
    return {
      ...envelope(dataset),
      latestRun: dataset.latestRun
        ? {
            runId: String(dataset.latestRun.runId),
            status: String(dataset.latestRun.status),
            completedAt: stringValue(dataset.latestRun.completedAt),
          }
        : null,
      counts: {
        linkedUniqueSources: artifacts.length,
        artifacts: artifacts.length,
        archived: artifacts.filter((row) => row.artifactStatus === "archived")
          .length,
        unavailable: artifacts.filter(
          (row) => row.artifactStatus === "unavailable"
        ).length,
        notRequired: artifacts.filter(
          (row) => row.artifactStatus === "not-required"
        ).length,
        pendingReview: artifacts.filter(
          (row) => row.artifactStatus === "pending-review"
        ).length,
        duplicateSourceGroups: dataset.sources.filter(
          (row) => integerValue(row.rawOccurrenceCount) > 1
        ).length,
        invalidMetrics: dataset.metrics.filter(
          (row) => metricClass(row.metricClass) === "invalid"
        ).length,
        missingFormalPdqi: dataset.metrics.filter(
          (row) =>
            row.metricVariant === "formal-industry-year-normalized" &&
            numberValue(row.validatedNumericValue) === null
        ).length,
      },
    }
  }

  async function getAnnualTrends(): Promise<NarrativeAnnualTrendResponse> {
    const dataset = await loadAnnualDataset()
    return {
      schemaVersion: NARRATIVE_RISK_SCHEMA_VERSION,
      dataVersion: dataset.dataVersion,
      asOfDate: dataset.asOfDate,
      sourceMode: dataset.sourceMode,
      methodVersion: String(dataset.methodVersion.methodVersion),
      companies:
        dataset.companies as unknown as NarrativeAnnualTrendResponse["companies"],
      observations:
        dataset.observations as unknown as NarrativeAnnualTrendResponse["observations"],
    }
  }

  async function getAnnualMethodology(): Promise<NarrativeAnnualMethodologyResponse> {
    const dataset = await loadAnnualDataset()
    return {
      schemaVersion: NARRATIVE_RISK_SCHEMA_VERSION,
      dataVersion: dataset.dataVersion,
      asOfDate: dataset.asOfDate,
      sourceMode: dataset.sourceMode,
      methodVersion:
        dataset.methodVersion as unknown as NarrativeAnnualMethodologyResponse["methodVersion"],
      methodology:
        dataset.methodology as unknown as NarrativeAnnualMethodologyResponse["methodology"],
    }
  }

  async function getAnnualAudit(): Promise<NarrativeAnnualAuditResponse> {
    const dataset = await loadAnnualDataset()
    return {
      schemaVersion: NARRATIVE_RISK_SCHEMA_VERSION,
      dataVersion: dataset.dataVersion,
      asOfDate: dataset.asOfDate,
      sourceMode: dataset.sourceMode,
      methodVersion: String(dataset.methodVersion.methodVersion),
      documents:
        dataset.documents as unknown as NarrativeAnnualAuditResponse["documents"],
      peerBenchmarks: dataset.peerBenchmarks,
      toneAudits: dataset.toneAudits,
      audit: dataset.audit as unknown as NarrativeAnnualAuditResponse["audit"],
    }
  }

  return {
    getAnnualAudit,
    getAnnualMethodology,
    getAnnualTrends,
    getAuditSummary,
    getCompany,
    listCompanies,
    listSources,
  }
}

const narrativeRiskService = createNarrativeRiskService()

export const listNarrativeRiskCompanies = narrativeRiskService.listCompanies
export const getNarrativeRiskCompany = narrativeRiskService.getCompany
export const listNarrativeRiskSources = narrativeRiskService.listSources
export const getNarrativeRiskAuditSummary = narrativeRiskService.getAuditSummary
export const getNarrativeAnnualTrends = narrativeRiskService.getAnnualTrends
export const getNarrativeAnnualMethodology =
  narrativeRiskService.getAnnualMethodology
export const getNarrativeAnnualAudit = narrativeRiskService.getAnnualAudit
