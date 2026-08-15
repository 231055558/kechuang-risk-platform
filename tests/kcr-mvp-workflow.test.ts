import assert from "node:assert/strict"
import test from "node:test"

import goldenInput from "../src/data/mvp/cambricon-scoring-input-v3.json" with { type: "json" }
import { createKcrAssessmentApiResponse } from "../src/domain/kcr-v1/assessment-api.ts"
import type { KcrAssessmentApiResponse } from "../src/domain/kcr-v1/assessment-api.ts"
import {
  calculateKcrAssessment,
  type KcrAssessmentRequest,
  type KcrAssessmentResult,
} from "../src/domain/kcr-v1/scoring-engine.ts"
import {
  KCR_SCENARIO_PRESETS,
  buildKcrScenarioComparison,
  createKcrActionTaskFromRedFlag,
  parseStoredKcrActionTasks,
  updateKcrActionTaskStatus,
} from "../src/lib/kcr-mvp-workflow.ts"
import { createKcrAssessmentPrintHtml } from "../src/lib/report-export.ts"

const assessment = {
  methodVersion: "KCR-2026.08-v1",
  runId: "kcr3-a79ad506",
  companyId: "cambricon",
  assessmentAt: "2026-08-13",
  dataCutoff: "2026-06-30",
  baselineScore: 35.6,
  dimensions: [
    { dimensionId: "technology", label: "技术风险", score: 20.8 },
    { dimensionId: "compliance", label: "合规风险", score: 46.5 },
    { dimensionId: "finance", label: "财务与融资风险", score: 28.5 },
    { dimensionId: "external", label: "外部环境风险", score: 63.75 },
    {
      dimensionId: "personnel-governance",
      label: "人员与治理风险",
      score: 17.6667,
    },
  ],
} as KcrAssessmentResult

const redFlag = {
  eventId: "EV001",
  title: "BIS实体清单命中",
  summary: "公司及多家子公司被列入美国BIS实体清单。",
  severity: "high",
  priority: "P0",
  sourceIndicatorIds: ["E03"],
  evidenceIds: ["S04", "S05"],
  affectsBaselineScore: false,
} as KcrAssessmentResult["redFlags"][number]

test("KCR 情景只暴露固定预设且所有权重合计为 100", () => {
  assert.deepEqual(
    KCR_SCENARIO_PRESETS.map((preset) => preset.id),
    ["objective-baseline", "technology-diligence", "compliance-external"]
  )
  KCR_SCENARIO_PRESETS.forEach((preset) => {
    assert.equal(
      Object.values(preset.weights).reduce((sum, weight) => sum + weight, 0),
      100
    )
  })
})

test("情景比较保留 35.6 客观基线且不修改输入", () => {
  const before = structuredClone(assessment)
  const comparison = buildKcrScenarioComparison(
    assessment,
    "compliance-external"
  )

  assert.equal(comparison.baselineScore, 35.6)
  assert.equal(comparison.preset.engineeringAssumption, true)
  assert.equal(comparison.availableWeight, 100)
  assert.notEqual(comparison.scenarioScore, comparison.baselineScore)
  assert.deepEqual(assessment, before)
})

test("缺失维度不会按 0 分进入情景结果", () => {
  const partial = structuredClone(assessment)
  partial.dimensions[3]!.score = null

  const comparison = buildKcrScenarioComparison(partial, "compliance-external")

  assert.equal(comparison.availableWeight, 70)
  assert.equal(comparison.missingDimensionIds[0], "external")
  assert.match(comparison.formulaTrace, /70/)
})

test("红旗任务保留快照和事件来源并使用可复现的工程默认", () => {
  const task = createKcrActionTaskFromRedFlag({
    assessment,
    redFlag,
    now: new Date("2026-08-15T08:00:00.000Z"),
  })

  assert.equal(task.sourceType, "event")
  assert.equal(task.sourceId, "EV001")
  assert.equal(task.snapshotId, assessment.runId)
  assert.equal(task.priority, "P0")
  assert.equal(task.owner, "供应链与战略负责人")
  assert.equal(task.dueDate, "2026-08-20")
  assert.equal(task.status, "todo")
})

test("任务状态可更新且损坏的本地记录会被拒绝", () => {
  const task = createKcrActionTaskFromRedFlag({
    assessment,
    redFlag,
    now: new Date("2026-08-15T08:00:00.000Z"),
  })
  const updated = updateKcrActionTaskStatus(
    task,
    "in-progress",
    new Date("2026-08-16T08:00:00.000Z")
  )

  assert.equal(updated.status, "in-progress")
  assert.equal(updated.updatedAt, "2026-08-16T08:00:00.000Z")
  assert.deepEqual(parseStoredKcrActionTasks(JSON.stringify([updated])), [
    updated,
  ])
  assert.deepEqual(parseStoredKcrActionTasks('{"bad":true}'), [])
})

test("MVP 工作区只消费已经校验的 API 响应", () => {
  const response = { assessment } as KcrAssessmentApiResponse
  assert.equal(response.assessment.companyId, "cambricon")
})

test("KCR V3 报告列出版本、快照、红旗、18 项指标、证据和使用边界", () => {
  const goldenAssessment = calculateKcrAssessment(goldenInput)
  const response = createKcrAssessmentApiResponse(
    goldenAssessment,
    "team-workbook",
    (goldenInput as KcrAssessmentRequest).evidenceCatalog
  )
  const task = createKcrActionTaskFromRedFlag({
    assessment: goldenAssessment,
    redFlag: goldenAssessment.redFlags[0]!,
    now: new Date("2026-08-15T08:00:00.000Z"),
  })
  const html = createKcrAssessmentPrintHtml(response, [task], "寒武纪")

  assert.match(html, /KCR-2026\.08-v1/)
  assert.match(html, /KCR-SCORE-2026\.08-v3/)
  assert.match(html, /2026-06-30/)
  assert.match(html, /35\.6/)
  assert.match(html, /BIS实体清单命中/)
  assert.match(html, /复核并处置/)
  assert.match(html, /S04/)
  assert.match(html, /评分引用均能在证据目录中解析/)
  assert.equal((html.match(/<tr><td>T\d\d<\/td>/g) ?? []).length, 5)
  assert.equal((html.match(/<tr><td>[TCFEP]\d\d<\/td>/g) ?? []).length, 18)
  assert.match(html, /不构成投资、法律、审计或监管意见/)

  const staleTaskHtml = createKcrAssessmentPrintHtml(
    response,
    [{ ...task, snapshotId: "stale-run" }],
    "寒武纪"
  )
  assert.doesNotMatch(staleTaskHtml, /复核并处置：BIS实体清单命中/)
  assert.match(staleTaskHtml, /尚未从红旗生成处置任务/)
})
