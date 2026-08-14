import assert from "node:assert/strict"
import test from "node:test"

import type { Sheet } from "read-excel-file/node"

import {
  KCR_INDICATOR_WEIGHTS,
  KCR_WEIGHTED_INDICATOR_IDS,
} from "../src/domain/kcr-v1/model.ts"
import {
  importKcrWorkbook,
  importKcrWorkbookBuffer,
  requiredSheetHeaders,
  workbookFromSheets,
} from "../src/importers/kcr-workbook.ts"

function dimensionLabel(indicatorId: string) {
  if (indicatorId.startsWith("T")) return "技术风险"
  if (indicatorId.startsWith("C")) return "合规风险"
  if (indicatorId.startsWith("F")) return "财务融资风险"
  if (indicatorId.startsWith("E")) return "外部环境风险"
  return "人员与治理风险"
}

function sheet(sheet: string, data: Sheet["data"]): Sheet {
  return { sheet, data }
}

function makeValidSheets(): Sheet[] {
  const indicatorRows = KCR_WEIGHTED_INDICATOR_IDS.map((id, index) => [
    id,
    dimensionLabel(id),
    `测试指标 ${id}`,
    KCR_INDICATOR_WEIGHTS[id],
    index + 1,
    "完整观测",
    1,
    0.9,
    `${id} 的测试评分依据。`,
  ])
  const narratives = [
    [
      "叙事热度—基本面背离",
      "观测一",
      "S01",
      "低",
      "A",
      "自动化一",
      "缺口一",
      "不计分",
    ],
    [
      "第三方与自身表述偏差",
      "观测二",
      "S01",
      "中",
      "B",
      "自动化二",
      "缺口二",
      "不计分",
    ],
    [
      "关键叙事一致性",
      "观测三",
      "S01",
      "低",
      "A",
      "自动化三",
      "缺口三",
      "不计分",
    ],
    [
      "概念标签业务支撑度",
      "观测四",
      "S01",
      "低",
      "A",
      "自动化四",
      "缺口四",
      "不计分",
    ],
  ]

  return [
    sheet("风险总览", [
      ["测试企业风险评估总览"],
      ["评价时点：2026-08-13｜数据截止：2026-06-30｜风险分越高风险越大"],
    ]),
    sheet("企业主表", [
      [...requiredSheetHeaders.企业主表],
      ["企业ID", "test-company", "字符串", "2026-06-30", "S01", "测试企业"],
      [
        "企业全称",
        "测试企业股份有限公司",
        "字符串",
        "2026-06-30",
        "S01",
        "测试企业",
      ],
      ["证券代码", "000001.TEST", "字符串", "2026-06-30", "S01", "测试代码"],
    ]),
    sheet("指标评分", [[...requiredSheetHeaders.指标评分], ...indicatorRows]),
    sheet("原始观测", [[...requiredSheetHeaders.原始观测]]),
    sheet("风险事件", [[...requiredSheetHeaders.风险事件]]),
    sheet("实体关系", [[...requiredSheetHeaders.实体关系]]),
    sheet("叙事校验", [[...requiredSheetHeaders.叙事校验], ...narratives]),
    sheet("证据库", [
      [...requiredSheetHeaders.证据库],
      [
        "S01",
        "测试公开披露",
        "S1",
        "测试机构",
        "2026-06-30",
        "https://example.com/public-source",
        "/Users/example/private/source.pdf",
        "第1页",
        "公开下载",
        "测试",
      ],
    ]),
    sheet("评分规则", [[...requiredSheetHeaders.评分规则]]),
    sheet("数据缺口", [[...requiredSheetHeaders.数据缺口]]),
    sheet("API调用日志", [[...requiredSheetHeaders.API调用日志]]),
  ]
}

function importSheets(sheets: Sheet[]) {
  return importKcrWorkbook(workbookFromSheets(sheets))
}

function getSheet(sheets: Sheet[], name: string) {
  const result = sheets.find((item) => item.sheet === name)
  assert.ok(result)
  return result
}

test("a valid workbook imports the complete frozen method without local paths", () => {
  const result = importSheets(makeValidSheets())
  assert.equal(result.ok, true)
  if (!result.ok) return

  assert.equal(result.value.methodVersion, "KCR-2026.08-v1")
  assert.equal(result.value.summary.totalWeight, 100)
  assert.equal(result.value.summary.weightedIndicatorCount, 18)
  assert.equal(result.value.summary.narrativeIndicatorCount, 4)
  assert.equal(
    result.value.narratives.every((item) => !item.affectsScore),
    true
  )
  assert.deepEqual(
    result.warnings.map((warning) => warning.code),
    ["LOCAL_FILE_PATH_IGNORED"]
  )
  assert.doesNotMatch(JSON.stringify(result.value), /\/Users\/example/)
})

test("all missing sheets and headers are returned in one validation report", () => {
  const sheets = makeValidSheets().filter((item) => item.sheet !== "风险事件")
  const companySheet = getSheet(sheets, "企业主表")
  companySheet.data[0] = companySheet.data[0].filter(
    (header) => header !== "说明"
  )

  const result = importSheets(sheets)
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.ok(result.errors.some((problem) => problem.code === "MISSING_SHEET"))
  assert.ok(
    result.errors.some((problem) => problem.code === "MISSING_REQUIRED_COLUMNS")
  )
})

test("duplicate indicator IDs are rejected", () => {
  const sheets = makeValidSheets()
  const indicators = getSheet(sheets, "指标评分")
  indicators.data.push([...indicators.data[1]])

  const result = importSheets(sheets)
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.ok(
    result.errors.some((problem) => problem.code === "DUPLICATE_INDICATOR_ID")
  )
})

test("individual and total indicator weight drift are rejected", () => {
  const sheets = makeValidSheets()
  const indicators = getSheet(sheets, "指标评分")
  indicators.data[1][3] = 5

  const result = importSheets(sheets)
  assert.equal(result.ok, false)
  if (result.ok) return
  const codes = result.errors.map((problem) => problem.code)
  assert.ok(codes.includes("INDICATOR_WEIGHT_MISMATCH"))
  assert.ok(codes.includes("WEIGHT_TOTAL_MISMATCH"))
})

test("data status and coverage factor cannot contradict each other", () => {
  const sheets = makeValidSheets()
  const indicators = getSheet(sheets, "指标评分")
  indicators.data[1][5] = "部分观测"
  indicators.data[1][6] = 1

  const result = importSheets(sheets)
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.ok(
    result.errors.some((problem) => problem.code === "COVERAGE_STATUS_MISMATCH")
  )
})

test("missing indicators cannot carry a zero risk score", () => {
  const sheets = makeValidSheets()
  const indicators = getSheet(sheets, "指标评分")
  indicators.data[1][4] = 0
  indicators.data[1][5] = "缺失"
  indicators.data[1][6] = 0

  const result = importSheets(sheets)
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.ok(
    result.errors.some(
      (problem) => problem.code === "MISSING_INDICATOR_HAS_SCORE"
    )
  )
})

test("workbook formulas are never executed and require a cached result", () => {
  const sheets = makeValidSheets()
  const indicators = getSheet(sheets, "指标评分")
  indicators.data[1][4] = { formula: "1+1" } as never

  const result = importSheets(sheets)
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.ok(
    result.errors.some((problem) => problem.code === "FORMULA_RESULT_MISSING")
  )
})

test("a corrupt xlsx buffer fails without producing partial data", async () => {
  const result = await importKcrWorkbookBuffer(
    new TextEncoder().encode("not an xlsx workbook")
  )
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.deepEqual(
    result.errors.map((problem) => problem.code),
    ["WORKBOOK_READ_FAILED"]
  )
})
