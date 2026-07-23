import assert from "node:assert/strict"
import test from "node:test"

import { isTechnologyBaselineQuantificationResult } from "../src/lib/technology-baseline-validation.ts"
import type {
  TechnologyBaselineCalibrationIndicatorResult,
  TechnologyBaselineIndicatorResult,
  TechnologyBaselineQuantificationResult,
} from "../src/types/risk.ts"

const calibrationThresholds = {
  "tqc-001": "低风险：>20 篇；中风险：5–20 篇；高风险：<5 篇。",
  "tqc-002": "低风险：>50 件；中风险：10–50 件；高风险：<10 件。",
  "tqc-003": "低风险：>60%；中风险：30–60%；高风险：<30%。",
  "tqc-004": "低风险：>15%；中风险：5–15%；高风险：<5%。",
  "tqc-006": "低风险：≥7 级；中风险：4–6 级；高风险：≤3 级。",
  "tqc-007": "低风险：>70%；中风险：30–70%；高风险：<30%。",
  "tqc-008": "低风险：<0.2；中风险：0.2–0.5；高风险：>0.5。",
} as const

function officialResult(
  indicatorId: TechnologyBaselineIndicatorResult["indicatorId"],
  label: string,
  sourceCategory: TechnologyBaselineIndicatorResult["sourceCategory"],
  unit: string,
  lifecycleWeight: number,
  value: number
): TechnologyBaselineIndicatorResult {
  return {
    indicatorId,
    label,
    sourceCategory,
    lifecycleWeight,
    status: "calculated",
    value,
    displayValue: `${value}${unit}`,
    unit,
    formulaTrace: `${label}=${value}${unit}。`,
    validationErrors: [],
    evidenceIds: ["ds-e2"],
    classification: "official",
    scoringEligible: false,
    contributesToAggregate: false,
    riskBand: null,
    standardizedRiskScore: null,
    thresholdTrace: null,
  }
}

function calibrationResult(
  result: TechnologyBaselineCalibrationIndicatorResult
): TechnologyBaselineCalibrationIndicatorResult {
  return result
}

function validResult(): TechnologyBaselineQuantificationResult {
  return {
    companyId: "deepseek",
    period: "2025",
    asOfDate: "2026-07-21",
    lifecycleStage: "startup",
    modelVersion: "TQB-2026.07-v5",
    runId: "tqb-v5-deepseek",
    generatedAt: "2026-07-21T08:00:00.000Z",
    status: "completed",
    technologyDimensionWeight: 30,
    lifecycleWeights: [
      { label: "论文发表数量", weight: 4 },
      { label: "专利产出效率", weight: 6 },
      { label: "研发投入强度", weight: 7 },
      { label: "人均知识产权效率", weight: 6 },
      { label: "技术合同成交额", weight: 5 },
      { label: "年报技术风险关键词密度", weight: 2 },
    ],
    quantifiedIndicatorCount: 6,
    calibrationStatus: "complete",
    calibrationMessage:
      "专项校准基于已配置阈值生成观察结果，不进入正式技术风险评分。",
    score: null,
    riskBand: null,
    quantifiedWeight: 30,
    scoringStatus: "calibration-observation-only",
    indicatorResults: [
      officialResult("tqi-001", "论文发表数量", "论文与研究", "篇", 4, 8),
      officialResult("tqi-002", "专利产出效率", "专利与知识产权", "件", 6, 30),
      officialResult("tqi-003", "研发投入强度", "研发投入", "%", 7, 32),
      officialResult(
        "tqi-004",
        "人均知识产权效率",
        "专利与知识产权",
        "件/百名研发人员",
        6,
        25
      ),
      officialResult("tqi-005", "技术合同成交额", "商业转化", "万元", 5, 1200),
      officialResult(
        "tqi-006",
        "年报技术风险关键词密度",
        "年报文本",
        "负面情感概率",
        2,
        0.35
      ),
    ],
    calibrationIndicatorResults: [
      calibrationResult({
        indicatorId: "tqc-001",
        label: "论文发表数量专项校准",
        sourceCategory: "论文与研究",
        status: "calculated",
        value: 8,
        displayValue: "8篇",
        unit: "篇",
        formulaTrace: "年度 SCI/核心期刊论文数=8 篇。",
        validationErrors: [],
        evidenceIds: ["ds-e2"],
        scoringEligible: true,
        contributesToAggregate: false,
        riskBand: "medium",
        standardizedRiskScore: 60,
        thresholdTrace: calibrationThresholds["tqc-001"],
      }),
      calibrationResult({
        indicatorId: "tqc-002",
        label: "专利申请数量专项校准",
        sourceCategory: "专利与知识产权",
        status: "calculated",
        value: 30,
        displayValue: "30件",
        unit: "件",
        formulaTrace: "累计发明专利申请量=30 件。",
        validationErrors: [],
        evidenceIds: ["ds-e2"],
        scoringEligible: true,
        contributesToAggregate: false,
        riskBand: "medium",
        standardizedRiskScore: 60,
        thresholdTrace: calibrationThresholds["tqc-002"],
      }),
      calibrationResult({
        indicatorId: "tqc-003",
        label: "专利授权率专项校准",
        sourceCategory: "专利与知识产权",
        status: "calculated",
        value: 75,
        displayValue: "75%",
        unit: "%",
        formulaTrace: "发明专利授权率=30 ÷ 40 × 100%=75%。",
        validationErrors: [],
        evidenceIds: ["ds-e2"],
        scoringEligible: true,
        contributesToAggregate: false,
        riskBand: "low",
        standardizedRiskScore: 25,
        thresholdTrace: calibrationThresholds["tqc-003"],
      }),
      calibrationResult({
        indicatorId: "tqc-004",
        label: "研发投入强度专项校准",
        sourceCategory: "研发投入",
        status: "calculated",
        value: 32,
        displayValue: "32%",
        unit: "%",
        formulaTrace: "研发投入强度=32 ÷ 100 × 100%=32%。",
        validationErrors: [],
        evidenceIds: ["ds-e2"],
        scoringEligible: true,
        contributesToAggregate: false,
        riskBand: "low",
        standardizedRiskScore: 25,
        thresholdTrace: calibrationThresholds["tqc-004"],
      }),
      calibrationResult({
        indicatorId: "tqc-005",
        label: "无形资产占净资产比专项观测",
        sourceCategory: "财务结构",
        status: "calculated",
        value: 20,
        displayValue: "20%",
        unit: "%",
        formulaTrace: "无形资产占净资产比例=40 ÷ 200 × 100%=20%。",
        validationErrors: [],
        evidenceIds: ["ds-e2"],
        scoringEligible: false,
        contributesToAggregate: false,
        riskBand: null,
        standardizedRiskScore: null,
        thresholdTrace: null,
      }),
      calibrationResult({
        indicatorId: "tqc-006",
        label: "技术成熟度（TRL）专项校准",
        sourceCategory: "技术成熟度",
        status: "calculated",
        value: 5,
        displayValue: "TRL 5级",
        unit: "TRL级",
        formulaTrace: "当前技术成熟度为 TRL 5 级。",
        validationErrors: [],
        evidenceIds: ["ds-e2"],
        scoringEligible: true,
        contributesToAggregate: false,
        riskBand: "medium",
        standardizedRiskScore: 60,
        thresholdTrace: calibrationThresholds["tqc-006"],
      }),
      calibrationResult({
        indicatorId: "tqc-007",
        label: "核心技术产品收入占比专项校准",
        sourceCategory: "商业转化",
        status: "calculated",
        value: 60,
        displayValue: "60%",
        unit: "%",
        formulaTrace: "核心技术产品收入占比=60 ÷ 100 × 100%=60%。",
        validationErrors: [],
        evidenceIds: ["ds-e2"],
        scoringEligible: true,
        contributesToAggregate: false,
        riskBand: "medium",
        standardizedRiskScore: 60,
        thresholdTrace: calibrationThresholds["tqc-007"],
      }),
      calibrationResult({
        indicatorId: "tqc-008",
        label: "技术风险负面情感概率专项校准",
        sourceCategory: "年报文本",
        status: "calculated",
        value: 0.35,
        displayValue: "0.35",
        unit: "负面情感概率",
        formulaTrace: "年报技术风险关键词负面情感概率=0.35。",
        validationErrors: [],
        evidenceIds: ["ds-e2"],
        scoringEligible: true,
        contributesToAggregate: false,
        riskBand: "medium",
        standardizedRiskScore: 60,
        thresholdTrace: calibrationThresholds["tqc-008"],
      }),
    ],
    calibratedIndicatorCount: 8,
    disclaimer:
      "专项校准仅用于指标观察，不进入正式技术风险雷达、综合指数或投资结论。",
  }
}

test("technology baseline validation accepts the complete TQB v5 contract", () => {
  assert.equal(isTechnologyBaselineQuantificationResult(validResult()), true)
})

test("technology baseline validation rejects forged official scores and totals", () => {
  const forgedScore = {
    ...validResult(),
    score: 42,
  }
  const forgedBand = {
    ...validResult(),
    riskBand: "medium",
  }
  const forgedQuantifiedCount = {
    ...validResult(),
    quantifiedIndicatorCount: 5,
  }
  const forgedQuantifiedWeight = {
    ...validResult(),
    quantifiedWeight: 29,
  }
  const wrongScoringStatus = {
    ...validResult(),
    scoringStatus: "calibration-required",
  }

  assert.equal(isTechnologyBaselineQuantificationResult(forgedScore), false)
  assert.equal(isTechnologyBaselineQuantificationResult(forgedBand), false)
  assert.equal(
    isTechnologyBaselineQuantificationResult(forgedQuantifiedCount),
    false
  )
  assert.equal(
    isTechnologyBaselineQuantificationResult(forgedQuantifiedWeight),
    false
  )
  assert.equal(
    isTechnologyBaselineQuantificationResult(wrongScoringStatus),
    false
  )
})

test("technology baseline validation rejects forged calibration risk scores, bands, and traces", () => {
  const forgedScore = {
    ...validResult(),
    calibrationIndicatorResults: validResult().calibrationIndicatorResults.map(
      (item) =>
        item.indicatorId === "tqc-001"
          ? { ...item, standardizedRiskScore: 85 }
          : item
    ),
  }
  const forgedBand = {
    ...validResult(),
    calibrationIndicatorResults: validResult().calibrationIndicatorResults.map(
      (item) =>
        item.indicatorId === "tqc-008"
          ? { ...item, riskBand: "high", standardizedRiskScore: 85 }
          : item
    ),
  }
  const forgedTrace = {
    ...validResult(),
    calibrationIndicatorResults: validResult().calibrationIndicatorResults.map(
      (item) =>
        item.indicatorId === "tqc-003"
          ? { ...item, thresholdTrace: "自行修改的阈值" }
          : item
    ),
  }

  assert.equal(isTechnologyBaselineQuantificationResult(forgedScore), false)
  assert.equal(isTechnologyBaselineQuantificationResult(forgedBand), false)
  assert.equal(isTechnologyBaselineQuantificationResult(forgedTrace), false)
})

test("technology baseline validation keeps the formula-only intangible-assets ratio out of scoring", () => {
  const forgedFormulaOnlyScore = {
    ...validResult(),
    calibrationIndicatorResults: validResult().calibrationIndicatorResults.map(
      (item) =>
        item.indicatorId === "tqc-005"
          ? {
              ...item,
              scoringEligible: true,
              riskBand: "medium",
              standardizedRiskScore: 60,
              thresholdTrace: "伪造阈值",
            }
          : item
    ),
  }

  assert.equal(
    isTechnologyBaselineQuantificationResult(forgedFormulaOnlyScore),
    false
  )
})

test("technology baseline validation requires ordered calibration metadata and accurate summaries", () => {
  const reordered = {
    ...validResult(),
    calibrationIndicatorResults: [
      validResult().calibrationIndicatorResults[1]!,
      validResult().calibrationIndicatorResults[0]!,
      ...validResult().calibrationIndicatorResults.slice(2),
    ],
  }
  const wrongCount = {
    ...validResult(),
    calibratedIndicatorCount: 7,
  }
  const wrongStatus = {
    ...validResult(),
    calibrationStatus: "partial",
  }

  assert.equal(isTechnologyBaselineQuantificationResult(reordered), false)
  assert.equal(isTechnologyBaselineQuantificationResult(wrongCount), false)
  assert.equal(isTechnologyBaselineQuantificationResult(wrongStatus), false)
})

test("technology baseline validation requires null scoring fields for noncalculated calibration items", () => {
  const withStaleScore = {
    ...validResult(),
    calibrationIndicatorResults: validResult().calibrationIndicatorResults.map(
      (item) =>
        item.indicatorId === "tqc-002"
          ? {
              ...item,
              status: "missing",
              value: null,
              evidenceIds: [],
              scoringEligible: false,
              riskBand: "medium",
              standardizedRiskScore: 60,
              thresholdTrace: calibrationThresholds["tqc-002"],
            }
          : item
    ),
  }

  assert.equal(isTechnologyBaselineQuantificationResult(withStaleScore), false)
})

test("technology baseline validation rejects legacy and non-official contracts", () => {
  const legacy = {
    ...validResult(),
    modelVersion: "TQB-2026.07-v4",
  }
  const wrongIndicator = {
    ...validResult(),
    indicatorResults: validResult().indicatorResults.map((item) =>
      item.indicatorId === "tqi-001"
        ? { ...item, classification: "candidate" }
        : item
    ),
  }

  assert.equal(isTechnologyBaselineQuantificationResult(legacy), false)
  assert.equal(isTechnologyBaselineQuantificationResult(wrongIndicator), false)
})
