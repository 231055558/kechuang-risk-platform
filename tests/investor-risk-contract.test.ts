import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  INDUSTRY_RISK_INVESTOR_CONTRACT_VERSION,
  INDUSTRY_RISK_INVESTOR_SEMANTICS,
  INDUSTRY_RISK_OBJECTIVE_INDICATOR_IDS,
  getIndustryRiskInvestorContract,
} from "../src/domain/industry-risk-v1/index.ts"
import { getIndustryRiskAssessment } from "../server/industry-risk-service.ts"

function readProjectFile(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
}

test("investor contract fixes data semantics across the assessment API", () => {
  const response = getIndustryRiskAssessment("star-688256")

  assert.equal(
    response.contract.version,
    INDUSTRY_RISK_INVESTOR_CONTRACT_VERSION
  )
  assert.deepEqual(response.contract, getIndustryRiskInvestorContract())
  assert.equal(response.contract.audience, "investor")
  assert.equal(response.contract.newsUsage, "information-only")
  assert.equal(response.contract.financialNarrativeCorpus, "annual-report-only")
  assert.equal(response.contract.heatEncoding, "peer-risk-percentile")
  assert.deepEqual(
    INDUSTRY_RISK_OBJECTIVE_INDICATOR_IDS,
    Array.from(
      { length: 18 },
      (_, index) => `R${String(index + 5).padStart(2, "0")}`
    )
  )
  assert.equal(
    INDUSTRY_RISK_INVESTOR_SEMANTICS.missingValue,
    "null-with-reason"
  )

  response.assessment.metrics.forEach((metric) => {
    if (metric.riskScore === null) {
      assert.ok(metric.missingReason)
    } else {
      assert.equal(metric.missingReason, null)
    }
  })
})

test("repository documents the cross-layer contract for future agents", () => {
  const agentInstructions = readProjectFile("AGENTS.md")
  const productContract = readProjectFile(
    "docs/contracts/investor-risk-workstation-v1.md"
  )
  const apiContract = readProjectFile("docs/contracts/industry-risk-api-v1.md")
  const storageContract = readProjectFile(
    "docs/contracts/industry-risk-storage-v1.md"
  )

  assert.match(agentInstructions, /前端、API、评分或数据导入/)
  assert.match(productContract, /新闻是资讯语料，不进入财报叙事评分/)
  assert.match(apiContract, /missingReason/)
  assert.match(storageContract, /禁止写入 0 作为占位/)
})
