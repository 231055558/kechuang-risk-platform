import { writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { DatabaseSync } from "node:sqlite"

import { importIndustryRiskSqlite } from "./import-industry-risk-sqlite.ts"
import {
  INDUSTRY_RISK_DATA_SCHEMA_VERSION,
  assertIndustryRiskDataset,
  type IndustryRiskDataset,
  type IndustryRiskDeepSearchEvent,
  type IndustryRiskIndicatorId,
  type IndustryRiskPeerGroup,
  type IndustryRiskReportAvailability,
  type IndustryRiskSupplementaryObservation,
} from "../src/domain/industry-risk-v1/index.ts"

type SqlValue = string | number | null
type SqlRow = Record<string, SqlValue>

export interface UnifiedIndustryRiskSource {
  id: string
  label: string
  inputPath: string
}

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

function rows(database: DatabaseSync, sql: string) {
  return database.prepare(sql).all() as SqlRow[]
}

function hasTable(database: DatabaseSync, name: string) {
  return Boolean(
    database
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1"
      )
      .get(name)
  )
}

function namespaceId(peerGroupId: string, id: string) {
  return `${peerGroupId}:${id}`
}

function sourceId(peerGroupId: string, value: SqlValue) {
  return value === null
    ? null
    : namespaceId(peerGroupId, `source-${number(value)}`)
}

function indicatorId(value: SqlValue): IndustryRiskIndicatorId | null {
  const normalized = text(value)
  return /^R(?:0[1-9]|1[0-9]|2[0-2])$/.test(normalized)
    ? (normalized as IndustryRiskIndicatorId)
    : null
}

function companyIdBySourceId(dataset: IndustryRiskDataset) {
  return new Map(
    dataset.companies.map((company) => [company.sourceCompanyId, company.id])
  )
}

function readSupplementaryObservations(
  database: DatabaseSync,
  peerGroupId: string,
  companyIds: Map<number, string>,
  includedCompanyIds: Set<string>
) {
  if (!hasTable(database, "supplementary_observations")) return []
  return rows(
    database,
    "SELECT * FROM supplementary_observations ORDER BY supplementary_id"
  ).flatMap((row): IndustryRiskSupplementaryObservation[] => {
    const companyId = companyIds.get(number(row.company_id)) ?? ""
    if (!includedCompanyIds.has(companyId)) return []
    return [
      {
        id: namespaceId(
          peerGroupId,
          `supplementary-${number(row.supplementary_id)}`
        ),
        companyId,
        factName: text(row.fact_name),
        period: nullableText(row.period),
        asOfDate: nullableText(row.as_of_date),
        numericValue: nullableNumber(row.numeric_value),
        textValue: nullableText(row.text_value),
        unit: nullableText(row.unit),
        relatedIndicatorId: indicatorId(row.related_indicator_id),
        sourceId: sourceId(peerGroupId, row.source_id),
        sourcePage: nullableNumber(row.source_page),
        confidenceLabel: text(row.confidence),
        confidence: number(row.confidence_score),
        confidenceReason: text(row.confidence_reason),
        limitations: text(row.limitations),
      },
    ]
  })
}

function readDeepSearchEvents(
  database: DatabaseSync,
  peerGroupId: string,
  companyIds: Map<number, string>,
  includedCompanyIds: Set<string>
) {
  if (!hasTable(database, "deep_search_events")) return []
  return rows(
    database,
    "SELECT * FROM deep_search_events ORDER BY event_date DESC, event_id"
  ).flatMap((row): IndustryRiskDeepSearchEvent[] => {
    const companyId = companyIds.get(number(row.company_id)) ?? ""
    if (!includedCompanyIds.has(companyId)) return []
    return [
      {
        id: namespaceId(peerGroupId, `deep-event-${number(row.event_id)}`),
        companyId,
        eventType: text(row.event_type),
        eventDate: nullableText(row.event_date),
        title: text(row.title),
        url: nullableText(row.url),
        sourceChannel: text(row.source_channel),
        confidenceLabel: text(row.confidence),
        confidence: number(row.confidence_score),
        relatedIndicatorId: indicatorId(row.related_indicator_id),
        notes: text(row.notes),
      },
    ]
  })
}

function readReportAvailability(
  database: DatabaseSync,
  companyIds: Map<number, string>,
  includedCompanyIds: Set<string>
) {
  if (!hasTable(database, "report_availability")) return []
  return rows(
    database,
    "SELECT * FROM report_availability ORDER BY company_id"
  ).flatMap((row): IndustryRiskReportAvailability[] => {
    const companyId = companyIds.get(number(row.company_id)) ?? ""
    if (!includedCompanyIds.has(companyId)) return []
    return [
      {
        companyId,
        annual2025Status: text(row.annual_2025_status),
        latestPeriod: nullableText(row.latest_period),
        latestReportDate: nullableText(row.latest_report_date),
        latestReportTitle: nullableText(row.latest_report_title),
        latestReportUrl: nullableText(row.latest_report_url),
        notes: text(row.notes),
      },
    ]
  })
}

function observationSourceLinks(database: DatabaseSync, peerGroupId: string) {
  const links = new Map<number, string[]>()
  if (!hasTable(database, "observation_source_links")) return links
  for (const row of rows(
    database,
    "SELECT * FROM observation_source_links ORDER BY observation_id, source_order"
  )) {
    const observationId = number(row.observation_id)
    const linkedSourceId = sourceId(peerGroupId, row.source_id)
    if (!linkedSourceId) continue
    links.set(observationId, [
      ...(links.get(observationId) ?? []),
      linkedSourceId,
    ])
  }
  return links
}

export function importUnifiedIndustryRisk(
  sourceSpecs: readonly UnifiedIndustryRiskSource[]
): IndustryRiskDataset {
  if (sourceSpecs.length === 0) {
    throw new Error("至少需要一个 R01–R22 SQLite 数据源。")
  }

  const claimedStockCodes = new Set<string>()
  const companies: IndustryRiskDataset["companies"] = []
  const sources: IndustryRiskDataset["sources"] = []
  const observations: IndustryRiskDataset["observations"] = []
  const coverage: IndustryRiskDataset["coverage"] = []
  const screeningHits: IndustryRiskDataset["screeningHits"] = []
  const inquiryEvidence: IndustryRiskDataset["inquiryEvidence"] = []
  const litigationEvidence: IndustryRiskDataset["litigationEvidence"] = []
  const supplementaryObservations: IndustryRiskSupplementaryObservation[] = []
  const deepSearchEvents: IndustryRiskDeepSearchEvent[] = []
  const reportAvailability: IndustryRiskReportAvailability[] = []
  const peerGroups: IndustryRiskPeerGroup[] = []
  const dataVersions: string[] = []
  const reportingPeriods: string[] = []
  const sourceDates: string[] = []
  let indicators: IndustryRiskDataset["indicators"] = []

  for (const spec of sourceSpecs) {
    const imported = importIndustryRiskSqlite(spec.inputPath)
    if (indicators.length === 0) indicators = imported.indicators
    const selectedCompanies = imported.companies.filter((company) => {
      if (claimedStockCodes.has(company.stockCode)) return false
      claimedStockCodes.add(company.stockCode)
      return true
    })
    const includedCompanyIds = new Set(
      selectedCompanies.map((company) => company.id)
    )
    const sourceKey = (id: string) => namespaceId(spec.id, id)
    const database = new DatabaseSync(resolve(spec.inputPath), {
      readOnly: true,
    })
    try {
      const linkedSources = observationSourceLinks(database, spec.id)
      companies.push(
        ...selectedCompanies.map((company) => ({
          ...company,
          peerGroupId: spec.id,
        }))
      )
      sources.push(
        ...imported.sources.map((source) => ({
          ...source,
          id: sourceKey(source.id),
          peerGroupId: spec.id,
        }))
      )
      observations.push(
        ...imported.observations
          .filter((item) => includedCompanyIds.has(item.companyId))
          .map((item) => {
            const rawObservationId = Number(item.id.replace("observation-", ""))
            const primarySourceId = sourceKey(item.sourceId)
            return {
              ...item,
              id: sourceKey(item.id),
              sourceId: primarySourceId,
              sourceIds: [
                ...new Set([
                  primarySourceId,
                  ...(linkedSources.get(rawObservationId) ?? []),
                ]),
              ],
            }
          })
      )
      coverage.push(
        ...imported.coverage.filter((item) =>
          includedCompanyIds.has(item.companyId)
        )
      )
      screeningHits.push(
        ...imported.screeningHits
          .filter((item) => includedCompanyIds.has(item.companyId))
          .map((item) => ({ ...item, id: sourceKey(item.id) }))
      )
      inquiryEvidence.push(
        ...imported.inquiryEvidence
          .filter((item) => includedCompanyIds.has(item.companyId))
          .map((item) => ({ ...item, id: sourceKey(item.id) }))
      )
      litigationEvidence.push(
        ...imported.litigationEvidence
          .filter((item) => includedCompanyIds.has(item.companyId))
          .map((item) => ({ ...item, id: sourceKey(item.id) }))
      )

      const sourceCompanyIds = companyIdBySourceId(imported)
      supplementaryObservations.push(
        ...readSupplementaryObservations(
          database,
          spec.id,
          sourceCompanyIds,
          includedCompanyIds
        )
      )
      deepSearchEvents.push(
        ...readDeepSearchEvents(
          database,
          spec.id,
          sourceCompanyIds,
          includedCompanyIds
        )
      )
      reportAvailability.push(
        ...readReportAvailability(
          database,
          sourceCompanyIds,
          includedCompanyIds
        )
      )
    } finally {
      database.close()
    }

    const scoreReadyIndicatorIds =
      imported.metadata.scoreReadyIndicatorIds.filter((id) =>
        selectedCompanies.every((company) =>
          imported.coverage.some(
            (item) =>
              item.companyId === company.id &&
              item.indicatorId === id &&
              item.usableForScoring
          )
        )
      )
    peerGroups.push({
      id: spec.id,
      label: spec.label,
      reportingPeriod:
        imported.metadata.reportingPeriod || "2025年度至2026最新一期",
      companyIds: selectedCompanies.map((company) => company.id),
      scoreReadyIndicatorIds,
    })
    dataVersions.push(imported.metadata.dataVersion)
    reportingPeriods.push(
      imported.metadata.reportingPeriod || "2025年度至2026最新一期"
    )
    sourceDates.push(imported.metadata.sourceDate)
  }

  const usedSourceIds = new Set<string>()
  for (const observation of observations) {
    usedSourceIds.add(observation.sourceId)
    observation.sourceIds?.forEach((id) => usedSourceIds.add(id))
  }
  for (const item of supplementaryObservations) {
    if (item.sourceId) usedSourceIds.add(item.sourceId)
  }

  const dataset: IndustryRiskDataset = {
    metadata: {
      schemaVersion: INDUSTRY_RISK_DATA_SCHEMA_VERSION,
      dataVersion: `R01-R22-unified:${dataVersions.filter(Boolean).join("+")}`,
      sourceDate: sourceDates.filter(Boolean).sort().at(-1) ?? "2026-08-19",
      reportingPeriod: [...new Set(reportingPeriods.filter(Boolean))].join(
        " / "
      ),
      sectorLabel: "科创板多行业 R01–R22 样本",
      board: "科创板",
      sampleSize: companies.length,
      indicatorCount: indicators.length,
      sourceAttribution: "用户现有 R01–R22 风险数据库统一接入",
      scopeNote:
        "四个最新行业数据库按输入顺序去重；更具体的行业样本优先，未知值保持缺失，不以零替代。",
      scoreReadyIndicatorIds: [
        ...new Set(peerGroups.flatMap((group) => group.scoreReadyIndicatorIds)),
      ],
      peerGroups,
    },
    companies,
    indicators,
    sources: sources.filter((source) => usedSourceIds.has(source.id)),
    observations,
    coverage,
    screeningHits,
    inquiryEvidence,
    litigationEvidence,
    supplementaryObservations,
    deepSearchEvents,
    reportAvailability,
  }
  return assertIndustryRiskDataset(dataset)
}

function main() {
  const [outputPath, ...sourceArguments] = process.argv.slice(2)
  if (
    !outputPath ||
    sourceArguments.length === 0 ||
    sourceArguments.length % 3
  ) {
    console.error(
      "用法：npm run import:industry-risk-unified -- output.json peerGroupId label input.sqlite [...]"
    )
    process.exitCode = 1
    return
  }
  const sourceSpecs = Array.from(
    { length: sourceArguments.length / 3 },
    (_, index): UnifiedIndustryRiskSource => ({
      id: sourceArguments[index * 3],
      label: sourceArguments[index * 3 + 1],
      inputPath: sourceArguments[index * 3 + 2],
    })
  )
  const dataset = importUnifiedIndustryRisk(sourceSpecs)
  writeFileSync(resolve(outputPath), `${JSON.stringify(dataset, null, 2)}\n`)
  console.log(
    `已统一接入 ${dataset.companies.length} 家企业、${dataset.observations.length} 条观测、${dataset.deepSearchEvents?.length ?? 0} 条深搜事件。`
  )
}

if (
  process.argv[1] &&
  import.meta.url === new URL(process.argv[1], "file:").href
) {
  main()
}
