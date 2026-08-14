import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import {
  KCR_DATA_SCHEMA_VERSION,
  KCR_METHOD_VERSION,
  assertKcrDataset,
  collectKcrDatasetIssues,
  type KcrDataset,
  type KcrIndicator,
  type KcrNarrativeIndicatorId,
  type KcrRiskDimensionId,
  type KcrWeightedIndicatorId,
} from "../src/domain/kcr-v1/index.ts"

const projectRoot = dirname(
  fileURLToPath(new URL("../package.json", import.meta.url))
)
const methodContract = JSON.parse(
  readFileSync(
    join(projectRoot, "src/data/methods/kcr-2026.08-v1.json"),
    "utf8"
  )
) as {
  methodVersion: string
  indicators: Array<{
    id: string
    kind: string
    dimensionId: string | null
    label: string
    weight: number | null
    affectsScore: boolean
  }>
}

function makeIndicators(): KcrIndicator[] {
  return methodContract.indicators.map((indicator): KcrIndicator => {
    if (indicator.kind === "weighted") {
      return {
        id: indicator.id as KcrWeightedIndicatorId,
        kind: "weighted",
        dimensionId: indicator.dimensionId as KcrRiskDimensionId,
        label: indicator.label,
        weight: indicator.weight as number,
        affectsScore: true,
        definition: `${indicator.label}的冻结口径。`,
        valueType: "number",
        unit: null,
        frequency: "annual",
        scoringRuleVersion: "KCR-RULE-2026.08-v1",
      }
    }

    return {
      id: indicator.id as KcrNarrativeIndicatorId,
      kind: "narrative-validation",
      dimensionId: null,
      label: indicator.label,
      weight: null,
      affectsScore: false,
      definition: `${indicator.label}的冻结口径。`,
      valueType: "text",
      unit: null,
      frequency: "quarterly",
      scoringRuleVersion: null,
    }
  })
}

function makeDataset(): KcrDataset {
  return {
    schemaVersion: KCR_DATA_SCHEMA_VERSION,
    methodVersion: KCR_METHOD_VERSION,
    exportedAt: "2026-08-14T12:00:00+08:00",
    companies: [
      {
        id: "cambricon",
        legalName: "中科寒武纪科技股份有限公司",
        shortName: "寒武纪",
        aliases: [],
        sector: "AI 芯片",
        lifecycleStage: "growth",
        headquarters: "北京",
        stockCodes: ["688256.SH"],
        createdAt: "2026-08-14T12:00:00+08:00",
        updatedAt: "2026-08-14T12:00:00+08:00",
      },
    ],
    indicators: makeIndicators(),
    observations: [
      {
        id: "obs-cambricon-t01-2026h1",
        companyId: "cambricon",
        indicatorId: "T01",
        snapshotId: "snapshot-cambricon-20260813",
        status: "available",
        rawValue: 42,
        unit: "score",
        normalizedRiskScore: 20.8,
        confidence: 0.9,
        period: {
          label: "2026H1",
          start: "2026-01-01",
          end: "2026-06-30",
        },
        asOfDate: "2026-06-30",
        scoringRuleVersion: "KCR-RULE-2026.08-v1",
        reviewStatus: "reviewed",
        reviewedBy: "researcher",
        reviewedAt: "2026-08-13T12:00:00+08:00",
        note: "测试观测。",
        createdAt: "2026-08-13T12:00:00+08:00",
        updatedAt: "2026-08-13T12:00:00+08:00",
      },
    ],
    evidence: [
      {
        id: "evidence-cambricon-t01",
        companyId: "cambricon",
        sourceTier: "company-filing",
        sourceName: "上市公司公告",
        sourceUrl: "https://example.com/public-filing.pdf",
        title: "测试公开披露",
        publishedAt: "2026-06-30T12:00:00+08:00",
        capturedAt: "2026-08-13T12:00:00+08:00",
        locator: "第 1 页",
        summary: "仅用于契约测试。",
        contentHash: null,
        confidence: 0.9,
        redistribution: "public-link-only",
        apiCallLogId: null,
      },
    ],
    evidenceBindings: [
      {
        id: "binding-cambricon-t01",
        companyId: "cambricon",
        evidenceId: "evidence-cambricon-t01",
        targetType: "observation",
        targetId: "obs-cambricon-t01-2026h1",
        supportStrength: "direct",
        inferenceBasis: null,
        createdAt: "2026-08-13T12:00:00+08:00",
      },
    ],
    events: [],
    graphNodes: [],
    graphRelations: [],
    snapshots: [
      {
        id: "snapshot-cambricon-20260813",
        companyId: "cambricon",
        methodVersion: KCR_METHOD_VERSION,
        assessmentAt: "2026-08-13",
        dataCutoff: "2026-06-30",
        generatedAt: "2026-08-13T12:00:00+08:00",
        status: "draft",
        baselineScore: null,
        riskLevel: null,
        dimensions: [
          {
            dimensionId: "technology",
            score: null,
            coveredWeight: 4,
            totalWeight: 25,
            coverage: 0.16,
            confidence: 0.9,
          },
          {
            dimensionId: "compliance",
            score: null,
            coveredWeight: 0,
            totalWeight: 20,
            coverage: 0,
            confidence: null,
          },
          {
            dimensionId: "finance",
            score: null,
            coveredWeight: 0,
            totalWeight: 20,
            coverage: 0,
            confidence: null,
          },
          {
            dimensionId: "external",
            score: null,
            coveredWeight: 0,
            totalWeight: 20,
            coverage: 0,
            confidence: null,
          },
          {
            dimensionId: "personnel-governance",
            score: null,
            coveredWeight: 0,
            totalWeight: 15,
            coverage: 0,
            confidence: null,
          },
        ],
        evidenceCoverage: 0.04,
        confidence: 0.9,
        redFlagEventIds: [],
        missingIndicatorIds: [
          "T02",
          "T03",
          "T04",
          "T05",
          "C01",
          "C02",
          "C03",
          "F01",
          "F02",
          "F03",
          "F04",
          "E01",
          "E02",
          "E03",
          "P01",
          "P02",
          "P03",
        ],
        observationIds: ["obs-cambricon-t01-2026h1"],
        disclaimer: "仅用于契约测试，不构成投资建议。",
      },
    ],
    actionTasks: [],
    apiCallLogs: [],
  }
}

test("domain constants cannot drift from the frozen method contract", () => {
  assert.equal(methodContract.methodVersion, KCR_METHOD_VERSION)
  assert.deepEqual(
    methodContract.indicators.map((indicator) => indicator.id),
    makeIndicators().map((indicator) => indicator.id)
  )
})

test("a minimal evidence-backed KCR dataset satisfies every invariant", () => {
  const dataset = makeDataset()
  assert.deepEqual(collectKcrDatasetIssues(dataset), [])
  assert.doesNotThrow(() => assertKcrDataset(dataset))
})

test("missing observations cannot silently become zero", () => {
  const dataset = makeDataset()
  dataset.observations[0].status = "missing"
  dataset.observations[0].rawValue = 0
  dataset.observations[0].normalizedRiskScore = 0

  assert.ok(
    collectKcrDatasetIssues(dataset).some(
      (issue) => issue.code === "MISSING_OBSERVATION_HAS_VALUE"
    )
  )
})

test("a scored observation without effective evidence is rejected", () => {
  const dataset = makeDataset()
  dataset.evidenceBindings[0].supportStrength = "background"

  assert.ok(
    collectKcrDatasetIssues(dataset).some(
      (issue) => issue.code === "SCORED_OBSERVATION_WITHOUT_EVIDENCE"
    )
  )
})

test("a scored observation must be reviewed and keep its scoring provenance", () => {
  const dataset = makeDataset()
  dataset.observations[0].reviewStatus = "unreviewed"
  dataset.observations[0].scoringRuleVersion = null

  assert.ok(
    collectKcrDatasetIssues(dataset).some(
      (issue) => issue.code === "SCORED_OBSERVATION_NOT_APPROVED"
    )
  )
})

test("snapshot coverage is derived from effective weighted observations", () => {
  const dataset = makeDataset()
  dataset.snapshots[0].dimensions[0].coveredWeight = 5
  dataset.snapshots[0].dimensions[0].coverage = 0.2
  dataset.snapshots[0].evidenceCoverage = 0.05

  const codes = collectKcrDatasetIssues(dataset).map((issue) => issue.code)
  assert.ok(codes.includes("DIMENSION_COVERAGE_MISMATCH"))
  assert.ok(codes.includes("SNAPSHOT_COVERAGE_MISMATCH"))
})

test("cross-company evidence bindings are rejected", () => {
  const dataset = makeDataset()
  dataset.companies.push({
    ...dataset.companies[0],
    id: "another-company",
    legalName: "另一家公司",
    shortName: "另一家公司",
  })
  dataset.evidenceBindings[0].companyId = "another-company"

  assert.ok(
    collectKcrDatasetIssues(dataset).some(
      (issue) => issue.code === "CROSS_COMPANY_EVIDENCE_BINDING"
    )
  )
})

test("inferred evidence and inferred graph relations cannot pretend certainty", () => {
  const dataset = makeDataset()
  dataset.evidenceBindings[0].supportStrength = "inferred"
  dataset.evidenceBindings[0].inferenceBasis = null
  dataset.graphNodes.push(
    {
      id: "node-company",
      companyId: "cambricon",
      type: "company",
      label: "寒武纪",
      externalKey: null,
      attributes: {},
    },
    {
      id: "node-risk",
      companyId: "cambricon",
      type: "risk-dimension",
      label: "外部环境风险",
      externalKey: null,
      attributes: {},
    }
  )
  dataset.graphRelations.push({
    id: "relation-inferred",
    companyId: "cambricon",
    snapshotId: "snapshot-cambricon-20260813",
    sourceNodeId: "node-company",
    targetNodeId: "node-risk",
    relationType: "exposed-to",
    classification: "inference",
    strength: 0.8,
    confidence: 1,
    validFrom: null,
    validTo: null,
    observedAt: "2026-08-13T12:00:00+08:00",
    propagation: null,
  })

  const codes = collectKcrDatasetIssues(dataset).map((issue) => issue.code)
  assert.ok(codes.includes("INFERENCE_BASIS_REQUIRED"))
  assert.ok(codes.includes("INFERENCE_CANNOT_BE_CERTAIN"))
})

test("snapshots reject old dimensions and invalid red-flag references", () => {
  const dataset = makeDataset()
  dataset.snapshots[0].dimensions.pop()
  dataset.events.push({
    id: "event-not-red-flag",
    companyId: "cambricon",
    title: "普通监测事件",
    description: "测试事件。",
    eventType: "monitoring",
    dimensionIds: ["technology"],
    severity: "watch",
    status: "monitoring",
    redFlag: false,
    occurredAt: null,
    discoveredAt: "2026-08-13T12:00:00+08:00",
    impact: "待观察。",
    createdAt: "2026-08-13T12:00:00+08:00",
    updatedAt: "2026-08-13T12:00:00+08:00",
  })
  dataset.snapshots[0].redFlagEventIds.push("event-not-red-flag")

  const codes = collectKcrDatasetIssues(dataset).map((issue) => issue.code)
  assert.ok(codes.includes("SNAPSHOT_DIMENSION_SET_MISMATCH"))
  assert.ok(codes.includes("INVALID_RED_FLAG_REFERENCE"))
})
