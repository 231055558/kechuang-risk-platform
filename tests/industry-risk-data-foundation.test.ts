import assert from "node:assert/strict"
import test from "node:test"

import pilotData from "../src/data/industry/semiconductor-risk-pilot.json" with { type: "json" }
import design37Data from "../src/data/industry/design37-risk-pilot.json" with { type: "json" }
import {
  INDUSTRY_RISK_DATA_SCHEMA_VERSION,
  assertIndustryRiskDataset,
  collectIndustryRiskDatasetIssues,
  type IndustryRiskDataset,
} from "../src/domain/industry-risk-v1/index.ts"

const dataset = pilotData as IndustryRiskDataset
const design37Dataset = design37Data as IndustryRiskDataset

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
  assert.equal(dataset.deepSearchEvents.length, 0)
  assert.equal(dataset.supplementaryObservations.length, 0)
  assert.equal(dataset.reportAvailability.length, 0)
  assert.equal(dataset.bonusDefinitions.length, 3)
  assert.deepEqual(dataset.metadata.scoreReadyIndicatorIds, [
    "R07",
    "R13",
    "R14",
    "R16",
    "R18",
  ])
})

test("the design37 fixture preserves the deep-search audit matrix", () => {
  assert.doesNotThrow(() => assertIndustryRiskDataset(design37Dataset))
  assert.equal(design37Dataset.companies.length, 37)
  assert.equal(design37Dataset.indicators.length, 22)
  assert.equal(design37Dataset.observations.length, 1_657)
  assert.equal(design37Dataset.coverage.length, 814)
  assert.equal(design37Dataset.sources.length, 186)
  assert.equal(design37Dataset.screeningHits.length, 19)
  assert.equal(design37Dataset.inquiryEvidence.length, 51)
  assert.equal(design37Dataset.litigationEvidence.length, 5)
  assert.equal(design37Dataset.deepSearchEvents.length, 96)
  assert.equal(design37Dataset.supplementaryObservations.length, 292)
  assert.equal(design37Dataset.reportAvailability.length, 37)
  assert.equal(design37Dataset.bonusDefinitions.length, 3)
  assert.deepEqual(design37Dataset.metadata.scoreReadyIndicatorIds, [
    "R07",
    "R13",
    "R14",
  ])
  assert.ok(
    design37Dataset.supplementaryObservations.every(
      (item) => item.affectsScore === false
    )
  )
  assert.ok(
    design37Dataset.bonusDefinitions.every(
      (item) => item.affectsScore === false && item.status === "definition-only"
    )
  )
})

test("the public fixture contains no local workstation paths", () => {
  const serialized = JSON.stringify(dataset)
  assert.doesNotMatch(serialized, /\/Users\//)
  assert.doesNotMatch(serialized, /\/home\//)
  assert.doesNotMatch(serialized, /file:\/\//i)
})

test("the design37 derived fixture removes provider workstation paths and excerpts", () => {
  const serialized = JSON.stringify(design37Dataset)
  assert.doesNotMatch(serialized, /\/Users\//)
  assert.doesNotMatch(serialized, /\/home\//)
  assert.doesNotMatch(serialized, /file:\/\//i)
  assert.doesNotMatch(serialized, /localEvidenceFile|evidenceExcerpt/i)
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
