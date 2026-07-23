import assert from "node:assert/strict"
import test from "node:test"

import {
  getScoringRule,
  normalizationRuleRegistry,
  previewObservationScore,
  scoringRuleRegistry,
} from "../src/lib/scoring-rules.ts"
import {
  createNormalizationRuleKey,
  type IndicatorNormalizationRule,
} from "../src/lib/risk-metrics.ts"
import type { IndicatorObservation } from "../src/types/risk.ts"

type RuleCase = {
  indicatorId: string
  valid: Array<[rawValue: string, expectedScore: 25 | 60 | 85]>
  invalid: string[]
}

const ruleCases: RuleCase[] = [
  {
    indicatorId: "kci-004",
    valid: [
      ["9.99", 85],
      ["10", 60],
      ["30", 60],
      ["30.01", 25],
    ],
    invalid: ["-0.01", "100.01", "Infinity"],
  },
  {
    indicatorId: "kci-014",
    valid: [
      ["0", 25],
      ["1", 60],
      ["2", 60],
      ["3", 85],
    ],
    invalid: ["-1", "1.5", "Infinity"],
  },
  {
    indicatorId: "kci-015",
    valid: [
      ["0", 25],
      ["1", 60],
      ["2", 60],
      ["3", 85],
    ],
    invalid: ["-1", "1.5", "Infinity"],
  },
  {
    indicatorId: "kci-024",
    valid: [
      ["19.99", 25],
      ["20", 60],
      ["50", 60],
      ["50.01", 85],
    ],
    invalid: ["-0.01", "100.01", "Infinity"],
  },
  {
    indicatorId: "kci-026",
    valid: [
      ["-10.01", 85],
      ["-10", 60],
      ["10", 60],
      ["10.01", 25],
    ],
    invalid: ["-1000.01", "1000.01", "Infinity"],
  },
  {
    indicatorId: "kci-028",
    valid: [
      ["11.99", 85],
      ["12", 60],
      ["24", 60],
      ["24.01", 25],
    ],
    invalid: ["-0.01", "Infinity"],
  },
  {
    indicatorId: "kci-030",
    valid: [
      ["99.99", 85],
      ["100", 60],
      ["120", 60],
      ["120.01", 25],
    ],
    invalid: ["-0.01", "10000.01", "Infinity"],
  },
  {
    indicatorId: "kci-035",
    valid: [
      ["29.99", 25],
      ["30", 60],
      ["60", 60],
      ["60.01", 85],
    ],
    invalid: ["-0.01", "100.01", "Infinity"],
  },
  {
    indicatorId: "kci-038",
    valid: [
      ["9.99", 25],
      ["10", 60],
      ["40", 60],
      ["40.01", 85],
    ],
    invalid: ["-0.01", "100.01", "Infinity"],
  },
  {
    indicatorId: "kci-039",
    valid: [
      ["0", 25],
      ["1", 60],
      ["2", 85],
    ],
    invalid: ["-1", "1.5", "Infinity"],
  },
]

test("the scoring registry contains the complete 10-rule local scoring set", () => {
  assert.equal(scoringRuleRegistry.size, 10)
  assert.deepEqual(
    [...scoringRuleRegistry.keys()].sort(),
    ruleCases.map((item) => item.indicatorId).sort()
  )
})

for (const ruleCase of ruleCases) {
  test(`${ruleCase.indicatorId} preserves threshold boundaries and rejects illegal values`, () => {
    const rule = getScoringRule(ruleCase.indicatorId)
    assert.ok(rule)

    for (const [rawValue, expectedScore] of ruleCase.valid) {
      assert.deepEqual(
        previewObservationScore(ruleCase.indicatorId, rawValue),
        { score: expectedScore, error: null },
        `${ruleCase.indicatorId}: ${rawValue}`
      )

      const normalize: IndicatorNormalizationRule =
        normalizationRuleRegistry[
          createNormalizationRuleKey(ruleCase.indicatorId, rule.version)
        ]
      assert.ok(normalize)
      assert.equal(
        normalize({
          companyId: "test-company",
          indicatorId: ruleCase.indicatorId,
          status: "available",
          value: rawValue,
          unit: rule.unit,
          normalizationRuleVersion: rule.version,
          reviewedBy: "测试复核人",
          reviewedAt: "2026-07-18",
          period: "2026-Q2",
          evidenceIds: ["evidence-1"],
          note: "",
        } satisfies IndicatorObservation),
        expectedScore
      )
    }

    for (const rawValue of ruleCase.invalid) {
      const preview = previewObservationScore(ruleCase.indicatorId, rawValue)
      assert.equal(preview.score, null, `${ruleCase.indicatorId}: ${rawValue}`)
      assert.ok(preview.error, `${ruleCase.indicatorId}: ${rawValue}`)
    }
  })
}

test("preview rejects blank values and unregistered indicators", () => {
  assert.deepEqual(previewObservationScore("kci-004", "  "), {
    score: null,
    error: "请填写观测值。",
  })
  assert.deepEqual(previewObservationScore("unknown-indicator", "10"), {
    score: null,
    error: "该指标尚未注册评分规则。",
  })
})

test("registered normalization rules reject unit mismatches", () => {
  for (const ruleCase of ruleCases) {
    const rule = getScoringRule(ruleCase.indicatorId)
    assert.ok(rule)
    const normalize: IndicatorNormalizationRule =
      normalizationRuleRegistry[
        createNormalizationRuleKey(ruleCase.indicatorId, rule.version)
      ]
    assert.ok(normalize)

    assert.equal(
      normalize({
        companyId: "test-company",
        indicatorId: ruleCase.indicatorId,
        status: "available",
        value: ruleCase.valid[0][0],
        unit: "错误单位",
        normalizationRuleVersion: rule.version,
        reviewedBy: "测试复核人",
        reviewedAt: "2026-07-18",
        period: "2026-Q2",
        evidenceIds: ["evidence-1"],
        note: "",
      }),
      null,
      ruleCase.indicatorId
    )
  }
})

test("registered normalization rules reject blank observation values", () => {
  const rule = getScoringRule("kci-014")
  assert.ok(rule)
  const normalize: IndicatorNormalizationRule =
    normalizationRuleRegistry[
      createNormalizationRuleKey(rule.indicatorId, rule.version)
    ]
  assert.ok(normalize)

  for (const value of ["", " ", "\n\t"]) {
    assert.equal(
      normalize({
        companyId: "test-company",
        indicatorId: rule.indicatorId,
        status: "available",
        value,
        unit: rule.unit,
        normalizationRuleVersion: rule.version,
        reviewedBy: "测试复核人",
        reviewedAt: "2026-07-18",
        period: "2026-Q2",
        evidenceIds: ["evidence-1"],
        note: "",
      }),
      null,
      JSON.stringify(value)
    )
  }
})
