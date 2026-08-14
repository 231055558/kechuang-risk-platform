import readXlsxFile, { type Sheet } from "read-excel-file/node"

import {
  KCR_INDICATOR_WEIGHTS,
  KCR_METHOD_VERSION,
  KCR_NARRATIVE_INDICATOR_IDS,
  KCR_WEIGHTED_INDICATOR_IDS,
  type KcrNarrativeIndicatorId,
  type KcrRiskDimensionId,
  type KcrWeightedIndicatorId,
} from "../domain/kcr-v1/model.ts"

export const KCR_WORKBOOK_SCHEMA_VERSION = "KCR-WORKBOOK-2026.08-v1" as const

const requiredSheetHeaders = {
  风险总览: [] as string[],
  企业主表: ["字段", "字段值", "值类型", "数据时点", "证据ID", "说明"],
  指标评分: [
    "编码",
    "风险维度",
    "二级指标",
    "权重(%)",
    "风险分(0-100)",
    "数据状态",
    "覆盖系数",
    "证据置信度",
    "评分依据",
  ],
  原始观测: [
    "观测ID",
    "指标/字段",
    "期间",
    "原始值",
    "单位",
    "同比/变化",
    "派生指标",
    "证据ID",
    "来源页/段",
    "值状态",
  ],
  风险事件: [
    "事件ID",
    "事件类型",
    "事件日期",
    "对象",
    "严重度",
    "状态",
    "金额/数量",
    "事件摘要",
    "证据ID",
    "模型处理",
  ],
  实体关系: [
    "边ID",
    "起点实体",
    "关系",
    "终点实体",
    "关系强度",
    "有效时间",
    "事实/推断",
    "证据ID",
    "传播系数建议",
    "说明",
  ],
  叙事校验: [
    "指标",
    "观测",
    "证据",
    "定性风险",
    "可获取性",
    "自动化方案",
    "当前缺口",
    "处理",
  ],
  证据库: [
    "证据ID",
    "标题",
    "来源层级",
    "发布机构",
    "发布日期",
    "URL",
    "本地文件",
    "关键页/段",
    "采集方式",
    "用途",
  ],
  评分规则: ["模块", "规则", "公式/阈值", "系统字段", "输出", "注意事项"],
  数据缺口: [
    "缺口ID",
    "指标",
    "缺失字段",
    "当前替代口径",
    "影响",
    "建议来源",
    "是否需付费",
    "优先级",
  ],
  API调用日志: [
    "调用ID",
    "时间",
    "供应商",
    "接口",
    "查询对象",
    "单价(元)",
    "用途",
    "结果摘要",
  ],
} as const

export type KcrWorkbookSheetName = keyof typeof requiredSheetHeaders
export type KcrWorkbookScalar = string | number | boolean | null

export interface KcrWorkbookIssue {
  severity: "error" | "warning"
  code: string
  sheet: string
  row: number | null
  column: string | null
  message: string
}

export interface KcrWorkbookIndicatorInput {
  id: KcrWeightedIndicatorId
  dimensionId: KcrRiskDimensionId
  label: string
  weight: number
  riskScore: number | null
  dataStatus: "complete" | "partial" | "missing"
  coverageFactor: 1 | 0.75 | 0
  evidenceConfidence: number
  rationale: string
}

export interface KcrWorkbookNarrativeInput {
  id: KcrNarrativeIndicatorId
  label: string
  observation: string
  evidenceIds: string[]
  qualitativeRisk: string
  availability: string
  automationPlan: string
  currentGap: string
  treatment: string
  affectsScore: false
}

export interface KcrWorkbookCompanyField {
  field: string
  value: KcrWorkbookScalar
  valueType: string
  asOf: string
  evidenceIds: string[]
  note: string
}

export interface KcrWorkbookObservation {
  id: string
  metric: string
  period: string
  rawValue: KcrWorkbookScalar
  unit: string
  change: KcrWorkbookScalar
  derivedValue: KcrWorkbookScalar
  evidenceIds: string[]
  locator: string
  valueStatus: string
}

export interface KcrWorkbookEvent {
  id: string
  eventType: string
  occurredAt: string | null
  subject: string
  severity: string
  status: string
  amountOrCount: KcrWorkbookScalar
  summary: string
  evidenceIds: string[]
  modelTreatment: string
}

export interface KcrWorkbookRelation {
  id: string
  sourceEntity: string
  relationType: string
  targetEntity: string
  strength: number | null
  validAt: string
  classification: "fact" | "inference" | "candidate"
  evidenceIds: string[]
  ruleReference: boolean
  propagationFactor: number
  note: string
}

export interface KcrWorkbookEvidence {
  id: string
  title: string
  sourceLevel: string
  publisher: string
  publishedAt: string | null
  sourceUrl: string | null
  locator: string
  collectionMethod: string
  purpose: string
}

export interface KcrWorkbookRule {
  module: string
  rule: string
  formulaOrThreshold: string
  systemField: string
  output: string
  note: string
}

export interface KcrWorkbookGap {
  id: string
  indicator: string
  missingField: string
  proxy: string
  impact: string
  suggestedSource: string
  paid: string
  priority: string
}

export interface KcrWorkbookApiCall {
  id: string
  requestedAt: string | null
  provider: string
  endpointLabel: string
  subject: string
  costCny: number
  purpose: string
  resultSummary: string
}

export interface KcrWorkbookImport {
  schemaVersion: typeof KCR_WORKBOOK_SCHEMA_VERSION
  methodVersion: typeof KCR_METHOD_VERSION
  metadata: {
    companyId: string
    companyName: string
    stockCode: string
    assessmentAt: string
    dataCutoff: string
  }
  companyFields: KcrWorkbookCompanyField[]
  indicators: KcrWorkbookIndicatorInput[]
  observations: KcrWorkbookObservation[]
  events: KcrWorkbookEvent[]
  relations: KcrWorkbookRelation[]
  narratives: KcrWorkbookNarrativeInput[]
  evidence: KcrWorkbookEvidence[]
  scoringRules: KcrWorkbookRule[]
  dataGaps: KcrWorkbookGap[]
  apiCalls: KcrWorkbookApiCall[]
  summary: {
    totalWeight: number
    weightedIndicatorCount: number
    narrativeIndicatorCount: number
    evidenceCount: number
    eventCount: number
    relationCount: number
  }
}

export type KcrWorkbookImportResult =
  | {
      ok: true
      value: KcrWorkbookImport
      warnings: KcrWorkbookIssue[]
    }
  | {
      ok: false
      errors: KcrWorkbookIssue[]
      warnings: KcrWorkbookIssue[]
    }

interface ParsedCell {
  value: KcrWorkbookScalar
  formulaWithoutResult: boolean
}

type WorkbookCellValue =
  | KcrWorkbookScalar
  | Date
  | { formula?: string; sharedFormula?: string; result?: WorkbookCellValue }
  | { richText: Array<{ text: string }> }
  | { text: string }
  | { error: string }

interface CellSource {
  value: WorkbookCellValue
}

interface RowSource {
  eachCell(
    options: { includeEmpty: boolean },
    callback: (cell: CellSource, columnNumber: number) => void
  ): void
  getCell(columnNumber: number): CellSource
}

interface WorksheetSource {
  name: string
  rowCount: number
  getRow(rowNumber: number): RowSource
}

interface WorkbookSource {
  getWorksheet(sheetName: string): WorksheetSource | undefined
}

function workbookFromSheets(sheets: Sheet[]): WorkbookSource {
  const worksheets = new Map<string, WorksheetSource>()
  for (const sheet of sheets) {
    worksheets.set(sheet.sheet, {
      name: sheet.sheet,
      rowCount: sheet.data.length,
      getRow(rowNumber) {
        const values = (sheet.data[rowNumber - 1] ?? []) as WorkbookCellValue[]
        return {
          eachCell(options, callback) {
            values.forEach((value, index) => {
              if (options.includeEmpty || value !== null) {
                callback({ value }, index + 1)
              }
            })
          },
          getCell(columnNumber) {
            return { value: values[columnNumber - 1] ?? null }
          },
        }
      },
    })
  }
  return {
    getWorksheet(sheetName) {
      return worksheets.get(sheetName)
    },
  }
}

interface TableRow {
  rowNumber: number
  values: Map<string, ParsedCell>
}

const dimensionLabels: Record<string, KcrRiskDimensionId> = {
  技术风险: "technology",
  合规风险: "compliance",
  财务融资风险: "finance",
  财务与融资风险: "finance",
  外部环境风险: "external",
  人员与治理风险: "personnel-governance",
}

const narrativeLabels: Record<string, KcrNarrativeIndicatorId> = {
  "叙事热度—基本面背离": "N01",
  叙事热度基本面背离度: "N01",
  第三方与自身表述偏差: "N02",
  "自身评价一致性/稳定性": "N03",
  关键叙事一致性: "N03",
  概念股标签关联度: "N04",
  概念标签业务支撑度: "N04",
}

const dataStatuses = {
  完整观测: { status: "complete", coverage: 1 },
  部分观测: { status: "partial", coverage: 0.75 },
  缺失: { status: "missing", coverage: 0 },
} as const

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim()
}

function normalizeCellValue(value: WorkbookCellValue): ParsedCell {
  if (value === null || value === undefined) {
    return { value: null, formulaWithoutResult: false }
  }
  if (value instanceof Date) {
    const year = value.getFullYear()
    const month = String(value.getMonth() + 1).padStart(2, "0")
    const day = String(value.getDate()).padStart(2, "0")
    return {
      value: `${year}-${month}-${day}`,
      formulaWithoutResult: false,
    }
  }
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return { value, formulaWithoutResult: false }
  }
  if ("formula" in value || "sharedFormula" in value) {
    if (value.result === undefined) {
      return { value: null, formulaWithoutResult: true }
    }
    return normalizeCellValue(value.result)
  }
  if ("richText" in value) {
    return {
      value: value.richText.map((part) => part.text).join(""),
      formulaWithoutResult: false,
    }
  }
  if ("text" in value) {
    return { value: value.text, formulaWithoutResult: false }
  }
  if ("error" in value) {
    return { value: null, formulaWithoutResult: false }
  }
  return { value: null, formulaWithoutResult: false }
}

function readCell(cell: CellSource) {
  return normalizeCellValue(cell.value)
}

function cellText(cell: CellSource) {
  const value = readCell(cell).value
  return value === null ? "" : normalizeText(String(value))
}

function issue(
  severity: KcrWorkbookIssue["severity"],
  code: string,
  sheet: string,
  row: number | null,
  column: string | null,
  message: string
): KcrWorkbookIssue {
  return { severity, code, sheet, row, column, message }
}

function getRequiredWorksheets(
  workbook: WorkbookSource,
  errors: KcrWorkbookIssue[]
) {
  const worksheets = new Map<KcrWorkbookSheetName, WorksheetSource>()
  for (const sheetName of Object.keys(
    requiredSheetHeaders
  ) as KcrWorkbookSheetName[]) {
    const worksheet = workbook.getWorksheet(sheetName)
    if (!worksheet) {
      errors.push(
        issue(
          "error",
          "MISSING_SHEET",
          sheetName,
          null,
          null,
          `缺少工作表“${sheetName}”。`
        )
      )
    } else {
      worksheets.set(sheetName, worksheet)
    }
  }
  return worksheets
}

function readTable(
  worksheet: WorksheetSource,
  requiredHeaders: readonly string[],
  errors: KcrWorkbookIssue[]
) {
  let headerRowNumber: number | null = null
  let headerColumns = new Map<string, number>()

  for (
    let rowNumber = 1;
    rowNumber <= Math.min(20, worksheet.rowCount);
    rowNumber += 1
  ) {
    const row = worksheet.getRow(rowNumber)
    const candidates = new Map<string, number>()
    row.eachCell({ includeEmpty: false }, (cell, columnNumber) => {
      const header = cellText(cell)
      if (header !== "") candidates.set(header, columnNumber)
    })
    if (requiredHeaders.every((header) => candidates.has(header))) {
      headerRowNumber = rowNumber
      headerColumns = candidates
      break
    }
  }

  if (headerRowNumber === null) {
    errors.push(
      issue(
        "error",
        "MISSING_REQUIRED_COLUMNS",
        worksheet.name,
        null,
        null,
        `找不到完整表头，必须包含：${requiredHeaders.join("、")}。`
      )
    )
    return []
  }

  const rows: TableRow[] = []
  for (
    let rowNumber = headerRowNumber + 1;
    rowNumber <= worksheet.rowCount;
    rowNumber += 1
  ) {
    const row = worksheet.getRow(rowNumber)
    const values = new Map<string, ParsedCell>()
    for (const [header, columnNumber] of headerColumns) {
      values.set(header, readCell(row.getCell(columnNumber)))
    }
    if ([...values.values()].every((cell) => cell.value === null)) continue
    rows.push({ rowNumber, values })
  }
  return rows
}

function valueAt(row: TableRow, column: string) {
  return row.values.get(column) ?? { value: null, formulaWithoutResult: false }
}

function requiredString(
  row: TableRow,
  column: string,
  sheet: string,
  errors: KcrWorkbookIssue[]
) {
  const cell = valueAt(row, column)
  if (cell.formulaWithoutResult) {
    errors.push(
      issue(
        "error",
        "FORMULA_RESULT_MISSING",
        sheet,
        row.rowNumber,
        column,
        "公式没有缓存结果；导入器不会执行工作簿公式。"
      )
    )
    return ""
  }
  if (cell.value === null || normalizeText(String(cell.value)) === "") {
    errors.push(
      issue(
        "error",
        "REQUIRED_VALUE_MISSING",
        sheet,
        row.rowNumber,
        column,
        "必填值为空。"
      )
    )
    return ""
  }
  return normalizeText(String(cell.value))
}

function optionalString(row: TableRow, column: string) {
  const value = valueAt(row, column).value
  return value === null ? "" : normalizeText(String(value))
}

function requiredNumber(
  row: TableRow,
  column: string,
  sheet: string,
  errors: KcrWorkbookIssue[],
  options?: { nullable?: boolean }
) {
  const cell = valueAt(row, column)
  if (cell.formulaWithoutResult) {
    errors.push(
      issue(
        "error",
        "FORMULA_RESULT_MISSING",
        sheet,
        row.rowNumber,
        column,
        "公式没有缓存结果；导入器不会执行工作簿公式。"
      )
    )
    return null
  }
  if (cell.value === null && options?.nullable) return null
  if (typeof cell.value !== "number" || !Number.isFinite(cell.value)) {
    errors.push(
      issue(
        "error",
        "NUMBER_REQUIRED",
        sheet,
        row.rowNumber,
        column,
        "该列必须是有限数值。"
      )
    )
    return null
  }
  return cell.value
}

function scalarAt(row: TableRow, column: string) {
  return valueAt(row, column).value
}

function splitEvidenceIds(value: string) {
  return value
    .split(/[/、,，;；]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function asNullableDate(value: KcrWorkbookScalar) {
  if (value === null || value === "") return null
  return normalizeText(String(value))
}

function expectedDimension(indicatorId: string): KcrRiskDimensionId | null {
  if (indicatorId.startsWith("T")) return "technology"
  if (indicatorId.startsWith("C")) return "compliance"
  if (indicatorId.startsWith("F")) return "finance"
  if (indicatorId.startsWith("E")) return "external"
  if (indicatorId.startsWith("P")) return "personnel-governance"
  return null
}

function parseAssessmentDates(
  worksheet: WorksheetSource,
  errors: KcrWorkbookIssue[]
) {
  let assessmentAt = ""
  let dataCutoff = ""
  for (
    let rowNumber = 1;
    rowNumber <= Math.min(10, worksheet.rowCount);
    rowNumber += 1
  ) {
    const row = worksheet.getRow(rowNumber)
    row.eachCell({ includeEmpty: false }, (cell) => {
      const text = cellText(cell)
      const assessmentMatch = text.match(/评价时点[：:]\s*(\d{4}-\d{2}-\d{2})/)
      const cutoffMatch = text.match(/数据截止[：:]\s*(\d{4}-\d{2}-\d{2})/)
      if (assessmentMatch) assessmentAt = assessmentMatch[1]
      if (cutoffMatch) dataCutoff = cutoffMatch[1]
    })
  }
  if (!assessmentAt || !dataCutoff) {
    errors.push(
      issue(
        "error",
        "ASSESSMENT_DATES_MISSING",
        worksheet.name,
        null,
        null,
        "风险总览必须包含 YYYY-MM-DD 格式的评价时点和数据截止日期。"
      )
    )
  }
  return { assessmentAt, dataCutoff }
}

function parseIndicators(rows: TableRow[], errors: KcrWorkbookIssue[]) {
  const indicators: KcrWorkbookIndicatorInput[] = []
  const seen = new Set<string>()

  for (const row of rows) {
    const rawId = optionalString(row, "编码")
    if (rawId === "" || rawId.startsWith("合计")) continue
    if (!KCR_WEIGHTED_INDICATOR_IDS.includes(rawId as KcrWeightedIndicatorId)) {
      errors.push(
        issue(
          "error",
          "UNKNOWN_INDICATOR_ID",
          "指标评分",
          row.rowNumber,
          "编码",
          `未知指标编码：${rawId}。`
        )
      )
      continue
    }
    if (seen.has(rawId)) {
      errors.push(
        issue(
          "error",
          "DUPLICATE_INDICATOR_ID",
          "指标评分",
          row.rowNumber,
          "编码",
          `指标 ${rawId} 重复。`
        )
      )
      continue
    }
    seen.add(rawId)
    const id = rawId as KcrWeightedIndicatorId
    const dimensionLabel = requiredString(row, "风险维度", "指标评分", errors)
    const dimensionId = dimensionLabels[dimensionLabel]
    const expected = expectedDimension(id)
    if (!dimensionId || dimensionId !== expected) {
      errors.push(
        issue(
          "error",
          "INDICATOR_DIMENSION_MISMATCH",
          "指标评分",
          row.rowNumber,
          "风险维度",
          `${id} 的风险维度与冻结方法不一致。`
        )
      )
    }
    const weight = requiredNumber(row, "权重(%)", "指标评分", errors)
    if (weight !== null && weight !== KCR_INDICATOR_WEIGHTS[id]) {
      errors.push(
        issue(
          "error",
          "INDICATOR_WEIGHT_MISMATCH",
          "指标评分",
          row.rowNumber,
          "权重(%)",
          `${id} 权重应为 ${KCR_INDICATOR_WEIGHTS[id]}，当前为 ${weight}。`
        )
      )
    }
    const dataStatusLabel = requiredString(row, "数据状态", "指标评分", errors)
    const statusRule =
      dataStatuses[dataStatusLabel as keyof typeof dataStatuses]
    if (!statusRule) {
      errors.push(
        issue(
          "error",
          "UNKNOWN_DATA_STATUS",
          "指标评分",
          row.rowNumber,
          "数据状态",
          `不支持的数据状态：${dataStatusLabel}。`
        )
      )
    }
    const coverageFactor = requiredNumber(row, "覆盖系数", "指标评分", errors)
    if (
      statusRule &&
      coverageFactor !== null &&
      coverageFactor !== statusRule.coverage
    ) {
      errors.push(
        issue(
          "error",
          "COVERAGE_STATUS_MISMATCH",
          "指标评分",
          row.rowNumber,
          "覆盖系数",
          `${dataStatusLabel} 的覆盖系数必须为 ${statusRule.coverage}。`
        )
      )
    }
    const riskScore = requiredNumber(row, "风险分(0-100)", "指标评分", errors, {
      nullable: statusRule?.status === "missing",
    })
    if (riskScore !== null && (riskScore < 0 || riskScore > 100)) {
      errors.push(
        issue(
          "error",
          "RISK_SCORE_OUT_OF_RANGE",
          "指标评分",
          row.rowNumber,
          "风险分(0-100)",
          "风险分必须位于 0–100。"
        )
      )
    }
    if (statusRule?.status === "missing" && riskScore !== null) {
      errors.push(
        issue(
          "error",
          "MISSING_INDICATOR_HAS_SCORE",
          "指标评分",
          row.rowNumber,
          "风险分(0-100)",
          "缺失指标不得用 0 或其他风险分代替。"
        )
      )
    }
    const evidenceConfidence = requiredNumber(
      row,
      "证据置信度",
      "指标评分",
      errors
    )
    if (
      evidenceConfidence !== null &&
      (evidenceConfidence < 0 || evidenceConfidence > 1)
    ) {
      errors.push(
        issue(
          "error",
          "CONFIDENCE_OUT_OF_RANGE",
          "指标评分",
          row.rowNumber,
          "证据置信度",
          "证据置信度必须位于 0–1。"
        )
      )
    }

    if (
      dimensionId &&
      weight !== null &&
      statusRule &&
      coverageFactor !== null &&
      evidenceConfidence !== null
    ) {
      indicators.push({
        id,
        dimensionId,
        label: requiredString(row, "二级指标", "指标评分", errors),
        weight,
        riskScore,
        dataStatus: statusRule.status,
        coverageFactor: coverageFactor as 1 | 0.75 | 0,
        evidenceConfidence,
        rationale: requiredString(row, "评分依据", "指标评分", errors),
      })
    }
  }

  const missingIds = KCR_WEIGHTED_INDICATOR_IDS.filter((id) => !seen.has(id))
  if (missingIds.length > 0) {
    errors.push(
      issue(
        "error",
        "INDICATOR_SET_INCOMPLETE",
        "指标评分",
        null,
        "编码",
        `缺少指标：${missingIds.join("、")}。`
      )
    )
  }
  const totalWeight = indicators.reduce(
    (total, indicator) => total + indicator.weight,
    0
  )
  if (totalWeight !== 100) {
    errors.push(
      issue(
        "error",
        "WEIGHT_TOTAL_MISMATCH",
        "指标评分",
        null,
        "权重(%)",
        `指标权重合计必须为 100，当前为 ${totalWeight}。`
      )
    )
  }
  return indicators
}

function parseNarratives(rows: TableRow[], errors: KcrWorkbookIssue[]) {
  const narratives: KcrWorkbookNarrativeInput[] = []
  const seen = new Set<KcrNarrativeIndicatorId>()
  for (const row of rows) {
    const label = requiredString(row, "指标", "叙事校验", errors)
    const id = narrativeLabels[label]
    if (!id) {
      errors.push(
        issue(
          "error",
          "UNKNOWN_NARRATIVE_INDICATOR",
          "叙事校验",
          row.rowNumber,
          "指标",
          `无法映射叙事校验项：${label}。`
        )
      )
      continue
    }
    if (seen.has(id)) {
      errors.push(
        issue(
          "error",
          "DUPLICATE_NARRATIVE_INDICATOR",
          "叙事校验",
          row.rowNumber,
          "指标",
          `叙事校验项 ${id} 重复。`
        )
      )
      continue
    }
    seen.add(id)
    const treatment = requiredString(row, "处理", "叙事校验", errors)
    if (!treatment.includes("不计分")) {
      errors.push(
        issue(
          "error",
          "NARRATIVE_SCORING_FORBIDDEN",
          "叙事校验",
          row.rowNumber,
          "处理",
          "叙事校验项必须明确标记为不计分。"
        )
      )
    }
    narratives.push({
      id,
      label,
      observation: requiredString(row, "观测", "叙事校验", errors),
      evidenceIds: splitEvidenceIds(optionalString(row, "证据")),
      qualitativeRisk: requiredString(row, "定性风险", "叙事校验", errors),
      availability: optionalString(row, "可获取性"),
      automationPlan: optionalString(row, "自动化方案"),
      currentGap: optionalString(row, "当前缺口"),
      treatment,
      affectsScore: false,
    })
  }
  const missing = KCR_NARRATIVE_INDICATOR_IDS.filter((id) => !seen.has(id))
  if (missing.length > 0) {
    errors.push(
      issue(
        "error",
        "NARRATIVE_SET_INCOMPLETE",
        "叙事校验",
        null,
        "指标",
        `缺少叙事校验项：${missing.join("、")}。`
      )
    )
  }
  return narratives
}

function tableValue(row: TableRow, column: string) {
  return scalarAt(row, column)
}

export function importKcrWorkbook(
  workbook: WorkbookSource
): KcrWorkbookImportResult {
  const errors: KcrWorkbookIssue[] = []
  const warnings: KcrWorkbookIssue[] = []
  const sheets = getRequiredWorksheets(workbook, errors)
  if (sheets.size !== Object.keys(requiredSheetHeaders).length) {
    for (const [sheetName, worksheet] of sheets) {
      if (sheetName !== "风险总览") {
        readTable(worksheet, requiredSheetHeaders[sheetName], errors)
      }
    }
    return { ok: false, errors, warnings }
  }

  const overview = sheets.get("风险总览")!
  const dates = parseAssessmentDates(overview, errors)
  const tables = Object.fromEntries(
    (Object.keys(requiredSheetHeaders) as KcrWorkbookSheetName[])
      .filter((sheetName) => sheetName !== "风险总览")
      .map((sheetName) => [
        sheetName,
        readTable(
          sheets.get(sheetName)!,
          requiredSheetHeaders[sheetName],
          errors
        ),
      ])
  ) as Record<Exclude<KcrWorkbookSheetName, "风险总览">, TableRow[]>

  const companyFields = tables.企业主表.map((row) => ({
    field: requiredString(row, "字段", "企业主表", errors),
    value: tableValue(row, "字段值"),
    valueType: optionalString(row, "值类型"),
    asOf: optionalString(row, "数据时点"),
    evidenceIds: splitEvidenceIds(optionalString(row, "证据ID")),
    note: optionalString(row, "说明"),
  }))
  const companyMap = new Map(
    companyFields.map((field) => [field.field, field.value])
  )
  const companyId = normalizeText(String(companyMap.get("企业ID") ?? ""))
  const companyName = normalizeText(String(companyMap.get("企业全称") ?? ""))
  const stockCode = normalizeText(String(companyMap.get("证券代码") ?? ""))
  for (const [field, value] of [
    ["企业ID", companyId],
    ["企业全称", companyName],
    ["证券代码", stockCode],
  ]) {
    if (!value) {
      errors.push(
        issue(
          "error",
          "COMPANY_FIELD_MISSING",
          "企业主表",
          null,
          "字段值",
          `企业主表缺少${field}。`
        )
      )
    }
  }

  const indicators = parseIndicators(tables.指标评分, errors)
  const narratives = parseNarratives(tables.叙事校验, errors)
  const observations = tables.原始观测.map((row) => ({
    id: requiredString(row, "观测ID", "原始观测", errors),
    metric: requiredString(row, "指标/字段", "原始观测", errors),
    period: requiredString(row, "期间", "原始观测", errors),
    rawValue: tableValue(row, "原始值"),
    unit: optionalString(row, "单位"),
    change: tableValue(row, "同比/变化"),
    derivedValue: tableValue(row, "派生指标"),
    evidenceIds: splitEvidenceIds(optionalString(row, "证据ID")),
    locator: optionalString(row, "来源页/段"),
    valueStatus: optionalString(row, "值状态"),
  }))
  const events = tables.风险事件.map((row) => ({
    id: requiredString(row, "事件ID", "风险事件", errors),
    eventType: requiredString(row, "事件类型", "风险事件", errors),
    occurredAt: asNullableDate(tableValue(row, "事件日期")),
    subject: optionalString(row, "对象"),
    severity: optionalString(row, "严重度"),
    status: optionalString(row, "状态"),
    amountOrCount: tableValue(row, "金额/数量"),
    summary: requiredString(row, "事件摘要", "风险事件", errors),
    evidenceIds: splitEvidenceIds(optionalString(row, "证据ID")),
    modelTreatment: optionalString(row, "模型处理"),
  }))
  const relations = tables.实体关系.map((row) => {
    const rawEvidenceIds = splitEvidenceIds(optionalString(row, "证据ID"))
    const ruleReference = rawEvidenceIds.includes("RULE")
    const classificationLabel = optionalString(row, "事实/推断")
    const classification: KcrWorkbookRelation["classification"] =
      classificationLabel === "事实"
        ? "fact"
        : classificationLabel === "推断"
          ? "inference"
          : "candidate"
    const propagationFactor = requiredNumber(
      row,
      "传播系数建议",
      "实体关系",
      errors
    )
    return {
      id: requiredString(row, "边ID", "实体关系", errors),
      sourceEntity: requiredString(row, "起点实体", "实体关系", errors),
      relationType: requiredString(row, "关系", "实体关系", errors),
      targetEntity: requiredString(row, "终点实体", "实体关系", errors),
      strength: requiredNumber(row, "关系强度", "实体关系", errors, {
        nullable: true,
      }),
      validAt: optionalString(row, "有效时间"),
      classification,
      evidenceIds: rawEvidenceIds.filter((id) => id !== "RULE"),
      ruleReference,
      propagationFactor: propagationFactor ?? 0,
      note: optionalString(row, "说明"),
    }
  })
  const evidence = tables.证据库.map((row) => {
    if (optionalString(row, "本地文件") !== "") {
      warnings.push(
        issue(
          "warning",
          "LOCAL_FILE_PATH_IGNORED",
          "证据库",
          row.rowNumber,
          "本地文件",
          "为避免泄露工作站路径，本地文件列不会进入导入结果。"
        )
      )
    }
    const url = optionalString(row, "URL")
    return {
      id: requiredString(row, "证据ID", "证据库", errors),
      title: requiredString(row, "标题", "证据库", errors),
      sourceLevel: optionalString(row, "来源层级"),
      publisher: optionalString(row, "发布机构"),
      publishedAt: asNullableDate(tableValue(row, "发布日期")),
      sourceUrl: url === "" ? null : url,
      locator: optionalString(row, "关键页/段"),
      collectionMethod: optionalString(row, "采集方式"),
      purpose: optionalString(row, "用途"),
    }
  })
  const scoringRules = tables.评分规则.map((row) => ({
    module: requiredString(row, "模块", "评分规则", errors),
    rule: requiredString(row, "规则", "评分规则", errors),
    formulaOrThreshold: optionalString(row, "公式/阈值"),
    systemField: optionalString(row, "系统字段"),
    output: optionalString(row, "输出"),
    note: optionalString(row, "注意事项"),
  }))
  const dataGaps = tables.数据缺口.map((row) => ({
    id: requiredString(row, "缺口ID", "数据缺口", errors),
    indicator: requiredString(row, "指标", "数据缺口", errors),
    missingField: requiredString(row, "缺失字段", "数据缺口", errors),
    proxy: optionalString(row, "当前替代口径"),
    impact: optionalString(row, "影响"),
    suggestedSource: optionalString(row, "建议来源"),
    paid: optionalString(row, "是否需付费"),
    priority: optionalString(row, "优先级"),
  }))
  const apiCalls = tables.API调用日志.map((row) => ({
    id: requiredString(row, "调用ID", "API调用日志", errors),
    requestedAt: asNullableDate(tableValue(row, "时间")),
    provider: requiredString(row, "供应商", "API调用日志", errors),
    endpointLabel: requiredString(row, "接口", "API调用日志", errors),
    subject: optionalString(row, "查询对象"),
    costCny: requiredNumber(row, "单价(元)", "API调用日志", errors) ?? 0,
    purpose: optionalString(row, "用途"),
    resultSummary: optionalString(row, "结果摘要"),
  }))

  if (errors.length > 0) return { ok: false, errors, warnings }

  const value: KcrWorkbookImport = {
    schemaVersion: KCR_WORKBOOK_SCHEMA_VERSION,
    methodVersion: KCR_METHOD_VERSION,
    metadata: {
      companyId,
      companyName,
      stockCode,
      assessmentAt: dates.assessmentAt,
      dataCutoff: dates.dataCutoff,
    },
    companyFields,
    indicators,
    observations,
    events,
    relations,
    narratives,
    evidence,
    scoringRules,
    dataGaps,
    apiCalls,
    summary: {
      totalWeight: indicators.reduce(
        (total, indicator) => total + indicator.weight,
        0
      ),
      weightedIndicatorCount: indicators.length,
      narrativeIndicatorCount: narratives.length,
      evidenceCount: evidence.length,
      eventCount: events.length,
      relationCount: relations.length,
    },
  }
  return { ok: true, value, warnings }
}

export async function importKcrWorkbookBuffer(
  buffer: Uint8Array
): Promise<KcrWorkbookImportResult> {
  try {
    const sheets = await readXlsxFile(
      buffer as unknown as Parameters<typeof readXlsxFile>[0]
    )
    return importKcrWorkbook(workbookFromSheets(sheets))
  } catch {
    return {
      ok: false,
      errors: [
        issue(
          "error",
          "WORKBOOK_READ_FAILED",
          "工作簿",
          null,
          null,
          "无法读取 Excel 工作簿；请确认文件是有效的 .xlsx 文件。"
        ),
      ],
      warnings: [],
    }
  }
}

export { requiredSheetHeaders, workbookFromSheets }
