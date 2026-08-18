import assert from "node:assert/strict"
import test from "node:test"

import pilotData from "../src/data/industry/semiconductor-risk-pilot.json" with { type: "json" }
import {
  INDUSTRY_RISK_DATA_SCHEMA_VERSION,
  assertIndustryRiskDataset,
  collectIndustryRiskDatasetIssues,
  type IndustryRiskDataset,
} from "../src/domain/industry-risk-v1/index.ts"

const dataset = pilotData as IndustryRiskDataset

test("the semiconductor pilot fixture preserves Mao's complete audit matrix", () => {
  assert.doesNotThrow(() => assertIndustryRiskDataset(dataset))
  assert.equal(
    dataset.metadata.schemaVersion,
    INDUSTRY_RISK_DATA_SCHEMA_VERSION
  )
  assert.equal(dataset.companies.length, 10)
  assert.equal(dataset.indicators.length, 22)
  assert.equal(dataset.observations.length, 237)
  assert.equal(dataset.coverage.length, 220)
  assert.equal(dataset.sources.length, 31)
  assert.equal(dataset.screeningHits.length, 32)
  assert.equal(dataset.inquiryEvidence.length, 10)
  assert.equal(dataset.litigationEvidence.length, 6)
  assert.deepEqual(dataset.metadata.scoreReadyIndicatorIds, [
    "R07",
    "R13",
    "R14",
    "R16",
    "R18",
  ])
})

test("the public fixture contains no local workstation paths", () => {
  const serialized = JSON.stringify(dataset)
  assert.doesNotMatch(serialized, /\/Users\//)
  assert.doesNotMatch(serialized, /\/home\//)
  assert.doesNotMatch(serialized, /file:\/\//i)
})

test("the validator rejects broken evidence provenance", () => {
  const broken = structuredClone(dataset)
  broken.observations[0].sourceId = "source-missing"
  assert.match(
    collectIndustryRiskDatasetIssues(broken).join("\n"),
    /缺少有效来源/
  )
})

test("licensed litigation evidence is retained only as derived facts", () => {
  assert.ok(
    dataset.litigationEvidence.every(
      (item) => item.redistribution === "licensed-derived"
    )
  )
  const serialized = JSON.stringify(dataset.litigationEvidence)
  assert.doesNotMatch(serialized, /parties|caseNumber|evidenceExcerpt/i)
})
