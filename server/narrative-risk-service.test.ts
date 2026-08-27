import assert from "node:assert/strict"
import test from "node:test"

import { createNarrativeRiskService } from "./narrative-risk-service.ts"

test("sanitized snapshot preserves seven companies and both Cambricon scopes", async () => {
  const service = createNarrativeRiskService({ forceSnapshot: true })
  const directory = await service.listCompanies()
  assert.equal(directory.sourceMode, "snapshot")
  assert.equal(directory.asOfDate, "2026-08-26")
  assert.equal(directory.counts.uniqueCompanies, 7)
  assert.equal(directory.counts.scopeCompanyRecords, 8)

  const cambricon = await service.getCompany("cambricon")
  assert.equal(cambricon.assessments.length, 2)
  assert.deepEqual(
    new Set(cambricon.assessments.map((row) => row.scopeId)),
    new Set(["objective-four-20260826", "r01-r04-audit-20260826"])
  )
  assert.ok(
    cambricon.assessments.every((row) => row.toneVariant === "TONE-QA-only-36")
  )
  assert.ok(
    cambricon.metrics
      .filter((row) => row.metricClass === "proxy")
      .every((row) => row.scoreEligible === false)
  )
  assert.ok(
    cambricon.metrics
      .filter(
        (row) => row.metricClass === "invalid" || row.metricClass === "missing"
      )
      .every((row) => row.displayNumericValue === null)
  )
})

test("snapshot source ledger is classified and never exposes private paths or full text", async () => {
  const service = createNarrativeRiskService({ forceSnapshot: true })
  const audit = await service.getAuditSummary()
  assert.equal(audit.counts.linkedUniqueSources, 83)
  assert.equal(audit.counts.artifacts, 83)
  assert.equal(
    audit.counts.archived +
      audit.counts.unavailable +
      audit.counts.notRequired +
      audit.counts.pendingReview,
    83
  )

  const page = await service.listSources("cambricon", { pageSize: 100 })
  const serialized = JSON.stringify(page)
  assert.doesNotMatch(serialized, /\/Users\//)
  assert.doesNotMatch(serialized, /private\//)
  assert.doesNotMatch(serialized, /storageKey|localPath/)
  assert.ok(
    page.items.every((row) => (row.artifact?.publicExcerpt.length ?? 0) <= 240)
  )
})

test("revised annual snapshot exposes 21 reports, ten Chinese metrics, and no private text", async () => {
  const service = createNarrativeRiskService({ forceSnapshot: true })
  const trends = await service.getAnnualTrends()
  const methodology = await service.getAnnualMethodology()
  const audit = await service.getAnnualAudit()

  assert.equal(trends.sourceMode, "snapshot")
  assert.equal(trends.companies.length, 7)
  assert.equal(trends.observations.length, 210)
  assert.equal(methodology.methodology.length, 10)
  assert.ok(
    methodology.methodology.every((item) => /[\u3400-\u9fff]/.test(item.name))
  )
  assert.ok(
    methodology.methodology.every(
      (item) =>
        !/\b(?:IS|RCA|DSR|PDQI|ITAG|TONE|POSPCT|NEGPCT)\b/.test(item.formula)
    )
  )
  assert.equal(audit.documents.length, 21)
  assert.equal(audit.audit.archivedReportCount, 21)
  assert.equal(audit.peerBenchmarks.length, 0)

  const unlisted = trends.companies.filter(
    (item) => item.includedYears.length === 0
  )
  assert.deepEqual(unlisted.map((item) => item.companyName).sort(), [
    "燧原科技",
    "芯驰科技",
  ])
  assert.ok(
    unlisted.every((item) => item.exclusionReason === "未上市，不纳入年报趋势")
  )

  const serialized = JSON.stringify({ trends, methodology, audit })
  assert.doesNotMatch(serialized, /\/Users\//)
  assert.doesNotMatch(serialized, /private\//)
  assert.doesNotMatch(serialized, /管理层回答文本|年报全文/)
})
