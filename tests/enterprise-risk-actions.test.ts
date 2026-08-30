import assert from "node:assert/strict"
import test from "node:test"

import { getIndustryRiskAssessment } from "../server/industry-risk-service.ts"
import { buildEnterpriseRiskActions } from "../src/lib/enterprise-risk-actions.ts"

test("企业降险建议由现有高风险指标触发并给出可验证产出", () => {
  const assessment = getIndustryRiskAssessment("star-688256").assessment
  const actions = buildEnterpriseRiskActions(assessment)

  assert.ok(actions.length >= 5)
  assert.equal(actions[0].indicatorId, "R19")
  assert.ok(
    actions.every(
      (action) =>
        action.action.length > 20 &&
        action.deliverable.length > 10 &&
        action.validation.length > 10
    )
  )
})

test("企业降险建议不包含任务管理字段或虚构评分", () => {
  const actions = buildEnterpriseRiskActions(
    getIndustryRiskAssessment("star-688256").assessment
  )
  const serialized = JSON.stringify(actions)

  assert.doesNotMatch(
    serialized,
    /owner|dueDate|taskStatus|pendingAction|responsibleDepartment/
  )
  assert.ok(actions.every((action) => action.riskPercentile >= 0))
})
