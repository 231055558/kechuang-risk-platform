import assert from "node:assert/strict"
import test from "node:test"

import {
  getIndustryRiskAssessment,
  listIndustryRiskCompanies,
} from "../server/industry-risk-service.ts"
import {
  buildInvestorRiskSignals,
  buildInvestmentPerspective,
  calculateInvestorPeerPosition,
  deriveInvestorResearchReadiness,
} from "../src/lib/investor-decision.ts"

test("投资研判同业位置使用风险由高到低排名且不混淆分数与分位", () => {
  const directory = listIndustryRiskCompanies()
  const position = calculateInvestorPeerPosition(directory, "star-688256")

  assert.equal(position.sampleSize, 64)
  assert.ok(position.score !== null)
  assert.ok(position.rank !== null)
  assert.ok(position.riskPercentile !== null)
  assert.ok(position.peerMean !== null)
  assert.ok(position.lowerRiskQuartile !== null)
  assert.notEqual(position.score, position.riskPercentile)
})

test("三类投资研判分别回答投委会、个人承受和银行授信问题", () => {
  const assessment = getIndustryRiskAssessment("star-688256").assessment
  const institution = buildInvestmentPerspective(assessment, "institution")
  const individual = buildInvestmentPerspective(assessment, "individual")
  const bank = buildInvestmentPerspective(assessment, "bank")

  assert.match(institution.question, /投委会/)
  assert.match(individual.question, /承受能力/)
  assert.match(bank.question, /授信/)
  assert.match(bank.requiredChecks.join(""), /审计三表|有息债务/)
  assert.ok(
    [institution, individual, bank].every(
      (content) =>
        content.executionSteps.length === 4 &&
        content.executionSteps.every(
          (step) =>
            step.requiredMaterial.length > 10 &&
            step.deliverable.length > 8 &&
            step.verification.length > 8
        )
    )
  )
  assert.doesNotMatch(
    JSON.stringify([institution, individual, bank]),
    /建议买入|建议卖出/
  )
})

test("风险信号只使用已有正式分位并按P75和P60分层", () => {
  const assessment = getIndustryRiskAssessment("star-688256").assessment
  const signals = buildInvestorRiskSignals(assessment)

  assert.ok(signals.length > 0)
  assert.ok(signals.every((signal) => signal.riskPercentile >= 0))
  assert.ok(
    signals.every((signal) => {
      if (signal.status === "triggered") return signal.riskPercentile >= 0.75
      if (signal.status === "watch") {
        return signal.riskPercentile >= 0.6 && signal.riskPercentile < 0.75
      }
      return signal.riskPercentile < 0.6
    })
  )
})

test("研判准备度只反映数据覆盖，不输出买卖结论", () => {
  const assessment = getIndustryRiskAssessment("star-688256").assessment
  const readiness = deriveInvestorResearchReadiness(assessment)

  assert.equal(readiness.key, "ready")
  assert.doesNotMatch(`${readiness.label}${readiness.detail}`, /买入|卖出/)

  const missing = structuredClone(assessment)
  missing.totalRiskScore = null
  missing.weightedDataCoverage = 0
  assert.equal(deriveInvestorResearchReadiness(missing).key, "insufficient")
})
