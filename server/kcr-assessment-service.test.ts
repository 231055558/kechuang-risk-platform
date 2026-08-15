import assert from "node:assert/strict"
import test from "node:test"

import {
  getKcrCompanyAssessment,
  KcrCompanyAssessmentNotFoundError,
} from "./kcr-assessment-service.ts"

test("Cambricon snapshot service recalculates the golden V3 assessment", () => {
  const response = getKcrCompanyAssessment("cambricon")

  assert.equal(response.assessment.modelVersion, "KCR-SCORE-2026.08-v3")
  assert.equal(response.assessment.methodVersion, "KCR-2026.08-v1")
  assert.equal(response.assessment.baselineScore, 35.6)
  assert.equal(response.assessment.riskLevelLabel, "中")
  assert.equal(response.assessment.evidenceCoverage, 0.95)
  assert.equal(response.assessment.confidence, 0.8875)
  assert.equal(response.assessment.dimensions.length, 5)
  assert.equal(response.assessment.redFlags.length, 2)
  assert.equal(response.assessment.indicatorResults.length, 18)
  assert.equal(response.evidenceCatalog.length, 8)
  assert.deepEqual(response.evidenceCatalog[0], {
    id: "S01",
    title: "中科寒武纪科技股份有限公司2026年半年度报告",
    sourceTier: "company-filing",
    sourceName: "中科寒武纪/上交所",
    sourceUrl:
      "https://static.cninfo.com.cn/finalpage/2026-08-08/1225464969.PDF",
    publishedAt: "2026-08-08",
    locator: "第7、17-22、52-58、109、146-159页",
  })
  assert.equal(response.provenance.methodStatus, "candidate-for-team-review")
  assert.equal(response.provenance.assessmentInputSource, "team-workbook")
  assert.equal(response.provenance.engineeringDefaults.length, 4)
})

test("company snapshot service rejects companies without a V3 snapshot", () => {
  assert.throws(
    () => getKcrCompanyAssessment("deepseek"),
    (error: unknown) => {
      assert.ok(error instanceof KcrCompanyAssessmentNotFoundError)
      assert.equal(error.statusCode, 404)
      assert.equal(error.code, "KCR_COMPANY_ASSESSMENT_NOT_FOUND")
      return true
    }
  )
})
