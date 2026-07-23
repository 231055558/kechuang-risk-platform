import assert from "node:assert/strict"
import test from "node:test"

import {
  scoreTechnologyRisk,
  TechnologyScoringApiError,
} from "../src/lib/technology-scoring-api.ts"
import { calculateTechnologyBaseline } from "../src/lib/technology-baseline-engine.ts"
import {
  clearTechnologyScoringCompany,
  createInitialTechnologyScoringWorkspace,
  isTechnologyScoringWorkspaceState,
  loadTechnologyScoringWorkspace,
  resetTechnologyScoringWorkspace,
  saveTechnologyScoringWorkspace,
  TECHNOLOGY_SCORING_WORKSPACE_BACKUP_KEY,
  TECHNOLOGY_SCORING_WORKSPACE_STORAGE_KEY,
  TECHNOLOGY_SCORING_WORKSPACE_VERSION,
  upsertTechnologyScoringCompany,
} from "../src/lib/technology-scoring-workspace.ts"
import type {
  TechnologyBaselineEvidenceReference,
  TechnologyBaselineQuantificationRequest,
  TechnologyRiskOverride,
  TechnologyRiskScoreRequest,
  TechnologyRiskScoreResult,
  TechnologyScoringWorkspaceState,
} from "../src/types/risk.ts"

function asRequest(value: unknown) {
  return value as TechnologyRiskScoreRequest
}

function asOverride(value: unknown) {
  return value as TechnologyRiskOverride
}

function validResult(companyId = "company-1"): TechnologyRiskScoreResult {
  const definitions = [
    ["kci-006", "核心技术性能行业分位", 10],
    ["kci-007", "核心论文质量与技术转化关联", 8],
    ["kci-008", "核心专利质量与技术壁垒", 9],
    ["kci-009", "持续创新能力", 8],
    ["kci-010", "技术成熟与阶段兑现度", 20],
    ["kci-011", "工程化与商业转化率", 15],
    ["kci-012", "独立验证与关键测试有效性", 18],
    ["kci-013", "关键技术外部依赖度", 12],
  ] as const

  return {
    companyId,
    period: "2026-Q2",
    asOfDate: "2026-07-19",
    modelVersion: "KTR-2026.07-v1",
    runId: "ktr-valid-result",
    generatedAt: "2026-07-19T02:00:00.000Z",
    status: "insufficient-coverage",
    coveredWeight: 0,
    weightedCoverage: 0,
    baseScore: null,
    score: null,
    indicatorResults: definitions.map(([indicatorId, label, weight]) => ({
      indicatorId,
      label,
      weight,
      status: "missing",
      capabilityScore: null,
      riskScore: null,
      formulaTrace: "未提交该指标的原始观测值。",
      validationErrors: [],
      evidenceIds: [],
    })),
    incidentOverlay: {
      index: 0,
      level: "low",
      riskFloor: 0,
      incidentId: null,
      formulaTrace: "未提交具备计分证据的重大技术事故。",
    },
    forcedHighReasons: [],
  }
}

function validBaselineResult(companyId = "deepseek") {
  const request: TechnologyBaselineQuantificationRequest = {
    companyId,
    period: "2025",
    asOfDate: "2026-07-21",
    lifecycleStage: "startup",
    values: {
      papersPublished: 8,
      validInventionPatents: 30,
      researchDevelopmentExpense: 32,
      operatingRevenue: 100,
      totalIntellectualProperty: 50,
      researchStaffCount: 200,
      technologyContractTransactionAmount: 1200,
      annualReportRiskNegativeProbability: 0.35,
      patentApplications: 30,
      patentGrants: 18,
      intangibleAssets: 20,
      netAssets: 100,
      currentTrl: 6,
      coreTechnologyProductRevenue: 60,
    },
    evidence: [
      "tqi-001",
      "tqi-002",
      "tqi-003",
      "tqi-004",
      "tqi-005",
      "tqi-006",
      "tqc-001",
      "tqc-002",
      "tqc-003",
      "tqc-004",
      "tqc-005",
      "tqc-006",
      "tqc-007",
      "tqc-008",
    ].map((indicatorId) => ({
      indicatorId:
        indicatorId as TechnologyBaselineEvidenceReference["indicatorId"],
      evidenceId: "ds-e2",
      locator: `公开披露第 ${indicatorId.slice(-1)} 节`,
      supportStrength: "direct" as const,
    })),
  }

  return calculateTechnologyBaseline(
    request,
    new Date("2026-07-21T08:00:00.000Z")
  )
}

function withWindow(value: object, run: () => void) {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window")

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value,
  })

  try {
    run()
  } finally {
    if (originalWindow) {
      Object.defineProperty(globalThis, "window", originalWindow)
    } else {
      Reflect.deleteProperty(globalThis, "window")
    }
  }
}

function workspace(): TechnologyScoringWorkspaceState {
  return {
    version: TECHNOLOGY_SCORING_WORKSPACE_VERSION,
    companies: {
      "company-1": {
        draftRequest: asRequest({
          companyId: "company-1",
          observations: { "kci-004": 32 },
        }),
        latestResult: validResult(),
        override: asOverride({
          score: 55,
          reason: "专家复核调整",
        }),
        updatedAt: "2026-07-19T02:00:00.000Z",
      },
    },
    updatedAt: "2026-07-19T02:00:00.000Z",
  }
}

test("technology scoring API posts JSON to the exact relative endpoint", async () => {
  const request = asRequest({
    companyId: "company-1",
    observations: { "kci-004": 32 },
  })
  const expected = validResult()
  const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = []
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ input, init })
    return new Response(JSON.stringify(expected), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  }) as typeof fetch

  const result = await scoreTechnologyRisk(request, { fetch: fetchImpl })

  assert.deepEqual(result, expected)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].input, "api/v1/technology-risk/score")
  assert.equal(calls[0].init?.method, "POST")
  assert.deepEqual(calls[0].init?.headers, {
    accept: "application/json",
    "content-type": "application/json",
  })
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), request)
})

test("technology scoring API exposes non-2xx JSON errors", async () => {
  const fetchImpl = (async () =>
    new Response(
      JSON.stringify({
        error: {
          code: "TECHNOLOGY_INPUT_REQUIRED",
          message: "缺少必要的技术指标。",
        },
      }),
      {
        status: 422,
        headers: { "content-type": "application/json" },
      }
    )) as typeof fetch

  await assert.rejects(
    () => scoreTechnologyRisk(asRequest({}), { fetch: fetchImpl }),
    (error: unknown) => {
      assert.ok(error instanceof TechnologyScoringApiError)
      assert.equal(error.status, 422)
      assert.equal(error.code, "TECHNOLOGY_INPUT_REQUIRED")
      assert.equal(error.message, "缺少必要的技术指标。")
      return true
    }
  )
})

test("technology scoring API safely reports malformed error and success payloads", async () => {
  const malformedErrorFetch = (async () =>
    new Response("<html>upstream unavailable</html>", {
      status: 502,
      headers: { "content-type": "text/html" },
    })) as typeof fetch

  await assert.rejects(
    () => scoreTechnologyRisk(asRequest({}), { fetch: malformedErrorFetch }),
    (error: unknown) => {
      assert.ok(error instanceof TechnologyScoringApiError)
      assert.equal(error.status, 502)
      assert.equal(error.code, "TECHNOLOGY_SCORE_REQUEST_FAILED")
      assert.match(error.message, /HTTP 502/)
      return true
    }
  )

  const malformedSuccessFetch = (async () =>
    new Response("", { status: 200 })) as typeof fetch

  await assert.rejects(
    () => scoreTechnologyRisk(asRequest({}), { fetch: malformedSuccessFetch }),
    (error: unknown) => {
      assert.ok(error instanceof TechnologyScoringApiError)
      assert.equal(error.status, 200)
      assert.equal(error.code, "TECHNOLOGY_SCORE_RESPONSE_INVALID")
      return true
    }
  )

  const emptyObjectSuccessFetch = (async () =>
    new Response("{}", { status: 200 })) as typeof fetch

  await assert.rejects(
    () => scoreTechnologyRisk(asRequest({}), { fetch: emptyObjectSuccessFetch }),
    (error: unknown) => {
      assert.ok(error instanceof TechnologyScoringApiError)
      assert.equal(error.status, 200)
      assert.equal(error.code, "TECHNOLOGY_SCORE_RESPONSE_INVALID")
      return true
    }
  )
})

test("initial and reset workspaces are empty and versioned", () => {
  const now = new Date("2026-07-19T03:00:00.000Z")

  assert.deepEqual(createInitialTechnologyScoringWorkspace(now), {
    version: TECHNOLOGY_SCORING_WORKSPACE_VERSION,
    companies: {},
    updatedAt: now.toISOString(),
  })
  assert.deepEqual(resetTechnologyScoringWorkspace(now), {
    version: TECHNOLOGY_SCORING_WORKSPACE_VERSION,
    companies: {},
    updatedAt: now.toISOString(),
  })
})

test("valid technology scoring data loads and persists", () => {
  const stored = workspace()
  const writes: Record<string, string> = {}
  let loaded: ReturnType<typeof loadTechnologyScoringWorkspace> | undefined

  withWindow(
    {
      localStorage: {
        getItem(key: string) {
          return key === TECHNOLOGY_SCORING_WORKSPACE_STORAGE_KEY
            ? JSON.stringify(stored)
            : null
        },
        setItem(key: string, value: string) {
          writes[key] = value
        },
      },
    },
    () => {
      loaded = loadTechnologyScoringWorkspace(
        createInitialTechnologyScoringWorkspace()
      )
      assert.equal(saveTechnologyScoringWorkspace(stored), true)
    }
  )

  assert.deepEqual(loaded, { state: stored, warning: "" })
  assert.deepEqual(
    JSON.parse(writes[TECHNOLOGY_SCORING_WORKSPACE_STORAGE_KEY]),
    stored
  )
})

test("TQB v5 baseline results persist with the technology scoring workspace", () => {
  const baseline = validBaselineResult()
  const stored: TechnologyScoringWorkspaceState = {
    version: TECHNOLOGY_SCORING_WORKSPACE_VERSION,
    companies: {
      deepseek: {
        draftRequest: null,
        latestResult: null,
        override: null,
        baselineDraftRequest: null,
        latestBaselineResult: baseline,
        updatedAt: "2026-07-21T08:00:00.000Z",
      },
    },
    updatedAt: "2026-07-21T08:00:00.000Z",
  }
  let loaded: ReturnType<typeof loadTechnologyScoringWorkspace> | undefined

  withWindow(
    {
      localStorage: {
        getItem(key: string) {
          return key === TECHNOLOGY_SCORING_WORKSPACE_STORAGE_KEY
            ? JSON.stringify(stored)
            : null
        },
        setItem() {},
      },
    },
    () => {
      assert.equal(isTechnologyScoringWorkspaceState(stored), true)
      loaded = loadTechnologyScoringWorkspace(
        createInitialTechnologyScoringWorkspace()
      )
    }
  )

  assert.equal(baseline.modelVersion, "TQB-2026.07-v5")
  assert.equal(baseline.calibrationIndicatorResults.length, 8)
  assert.deepEqual(loaded, { state: stored, warning: "" })
})

test("legacy TQB v3 and v4 results are cleared without deleting valid v5 draft fields", () => {
  const v5Draft: TechnologyBaselineQuantificationRequest = {
    companyId: "deepseek",
    period: "2025",
    asOfDate: "2026-07-21",
    lifecycleStage: "startup",
    values: {
      patentApplications: 18,
      patentGrants: 12,
      intangibleAssets: 20,
      netAssets: 100,
      currentTrl: 6,
      coreTechnologyProductRevenue: 60,
      operatingRevenue: 100,
    },
    evidence: [
      {
        indicatorId: "tqc-003",
        evidenceId: "ds-e2",
        locator: "公开披露第 3 节",
        supportStrength: "direct",
      },
    ],
  }

  for (const modelVersion of ["TQB-2026.07-v3", "TQB-2026.07-v4"]) {
    const legacy = {
      ...workspace(),
      companies: {
        deepseek: {
          draftRequest: null,
          latestResult: validResult("deepseek"),
          override: null,
          baselineDraftRequest: v5Draft,
          latestBaselineResult: {
            modelVersion,
          },
          updatedAt: "2026-07-21T08:00:00.000Z",
        },
      },
    }
    const writes: Record<string, string> = {}
    let loaded: ReturnType<typeof loadTechnologyScoringWorkspace> | undefined

    withWindow(
      {
        localStorage: {
          getItem(key: string) {
            return key === TECHNOLOGY_SCORING_WORKSPACE_STORAGE_KEY
              ? JSON.stringify(legacy)
              : null
          },
          setItem(key: string, value: string) {
            writes[key] = value
          },
        },
      },
      () => {
        loaded = loadTechnologyScoringWorkspace(
          createInitialTechnologyScoringWorkspace(
            new Date("2026-07-21T09:00:00.000Z")
          )
        )
      }
    )

    assert.ok(loaded)
    assert.equal(
      loaded.warning,
      "旧版技术量化结果已清除；已保留兼容草稿，请按 TQB-2026.07-v5 口径重新运行。"
    )
    assert.equal(
      loaded.state.companies.deepseek?.latestResult?.runId,
      "ktr-valid-result"
    )
    assert.deepEqual(loaded.state.companies.deepseek?.baselineDraftRequest, v5Draft)
    assert.equal(loaded.state.companies.deepseek?.latestBaselineResult, null)
    assert.ok(writes[TECHNOLOGY_SCORING_WORKSPACE_STORAGE_KEY])
  }
})

test("corrupted, malformed, and unknown-version data is backed up before fallback", () => {
  const invalidPayloads = [
    "{not-json",
    JSON.stringify({ ...workspace(), version: 99 }),
    JSON.stringify({
      ...workspace(),
      companies: {
        "company-1": {
          ...workspace().companies["company-1"],
          latestResult: "not-an-object",
        },
      },
    }),
    JSON.stringify({
      ...workspace(),
      companies: {
        "company-1": {
          ...workspace().companies["company-1"],
          latestResult: {},
        },
      },
    }),
  ]

  for (const raw of invalidPayloads) {
    const fallback = createInitialTechnologyScoringWorkspace(
      new Date("2026-07-19T04:00:00.000Z")
    )
    const writes: Record<string, string> = {}

    withWindow(
      {
        localStorage: {
          getItem(key: string) {
            return key === TECHNOLOGY_SCORING_WORKSPACE_STORAGE_KEY ? raw : null
          },
          setItem(key: string, value: string) {
            writes[key] = value
          },
        },
      },
      () => {
        assert.deepEqual(loadTechnologyScoringWorkspace(fallback), {
          state: fallback,
          warning:
            "检测到损坏或未知版本的技术风险评分数据，已备份并恢复初始工作区。",
        })
      }
    )

    assert.equal(writes[TECHNOLOGY_SCORING_WORKSPACE_BACKUP_KEY], raw)
  }
})

test("storage failures remain non-fatal and report failed recovery writes", () => {
  const fallback = createInitialTechnologyScoringWorkspace()

  withWindow(
    {
      get localStorage() {
        throw new Error("storage disabled")
      },
    },
    () => {
      assert.deepEqual(loadTechnologyScoringWorkspace(fallback), {
        state: fallback,
        warning: "",
      })
      assert.equal(saveTechnologyScoringWorkspace(workspace()), false)
    }
  )

  withWindow(
    {
      localStorage: {
        getItem() {
          return "{not-json"
        },
        setItem() {
          throw new Error("quota exceeded")
        },
      },
    },
    () => {
      assert.deepEqual(loadTechnologyScoringWorkspace(fallback), {
        state: fallback,
        warning:
          "检测到损坏或未知版本的技术风险评分数据，已恢复初始工作区，但浏览器未能保存备份。",
      })
    }
  )
})

test("save rejects structurally invalid or unserializable workspaces", () => {
  const invalid = {
    ...workspace(),
    companies: {
      "company-1": {
        ...workspace().companies["company-1"],
        draftRequest: [],
      },
    },
  } as unknown as TechnologyScoringWorkspaceState
  const circularResult: Record<string, unknown> = {}
  circularResult.self = circularResult
  const unserializable = {
    ...workspace(),
    companies: {
      "company-1": {
        ...workspace().companies["company-1"],
        latestResult: circularResult,
      },
    },
  } as unknown as TechnologyScoringWorkspaceState

  withWindow(
    {
      localStorage: {
        setItem() {
          throw new Error("should not be reached for invalid state")
        },
      },
    },
    () => {
      assert.equal(saveTechnologyScoringWorkspace(invalid), false)
      assert.equal(saveTechnologyScoringWorkspace(unserializable), false)
    }
  )
})

test("upsert merges one company without removing other company records", () => {
  const initial = {
    ...workspace(),
    companies: {
      ...workspace().companies,
      "company-2": {
        draftRequest: asRequest({ companyId: "company-2" }),
        latestResult: null,
        override: null,
        updatedAt: "2026-07-19T02:30:00.000Z",
      },
    },
  }
  const now = new Date("2026-07-19T05:00:00.000Z")
  const next = upsertTechnologyScoringCompany(
    initial,
    "company-1",
    {
      draftRequest: asRequest({
        companyId: "company-1",
        observations: { "kci-004": 41 },
      }),
      latestResult: null,
    },
    now
  )

  assert.deepEqual(Object.keys(next.companies).sort(), [
    "company-1",
    "company-2",
  ])
  assert.deepEqual(next.companies["company-1"], {
    draftRequest: asRequest({
      companyId: "company-1",
      observations: { "kci-004": 41 },
    }),
    latestResult: null,
    override: workspace().companies["company-1"].override,
    baselineDraftRequest: null,
    latestBaselineResult: null,
    updatedAt: now.toISOString(),
  })
  assert.equal(next.companies["company-2"], initial.companies["company-2"])
  assert.equal(next.updatedAt, now.toISOString())
  assert.equal(isTechnologyScoringWorkspaceState(next), true)
})

test("clear removes only one company and reset removes all companies", () => {
  const initial = {
    ...workspace(),
    companies: {
      ...workspace().companies,
      "company-2": {
        draftRequest: asRequest({ companyId: "company-2" }),
        latestResult: null,
        override: null,
        updatedAt: "2026-07-19T02:30:00.000Z",
      },
    },
  }
  const now = new Date("2026-07-19T06:00:00.000Z")
  const cleared = clearTechnologyScoringCompany(initial, "company-1", now)

  assert.deepEqual(Object.keys(cleared.companies), ["company-2"])
  assert.equal(cleared.companies["company-2"], initial.companies["company-2"])
  assert.equal(cleared.updatedAt, now.toISOString())
  assert.deepEqual(resetTechnologyScoringWorkspace(now).companies, {})
})

test("workspace validation rejects malformed company records", () => {
  const invalidStates: unknown[] = [
    { ...workspace(), companies: [] },
    {
      ...workspace(),
      companies: {
        "": workspace().companies["company-1"],
      },
    },
    {
      ...workspace(),
      companies: {
        "company-1": {
          ...workspace().companies["company-1"],
          updatedAt: null,
        },
      },
    },
    {
      ...workspace(),
      companies: {
        "company-1": {
          ...workspace().companies["company-1"],
          draftRequest: [],
        },
      },
    },
  ]

  for (const state of invalidStates) {
    assert.equal(isTechnologyScoringWorkspaceState(state), false)
  }
})
