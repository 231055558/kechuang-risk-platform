import assert from "node:assert/strict"
import test from "node:test"

import {
  createInitialScoringWorkspace,
  deleteWorkspaceObservation,
  isScoringWorkspaceState,
  loadScoringWorkspace,
  saveScoringWorkspace,
  SCORING_WORKSPACE_BACKUP_KEY,
  SCORING_WORKSPACE_STORAGE_KEY,
  SCORING_WORKSPACE_VERSION,
  upsertWorkspaceObservation,
} from "../src/lib/scoring-workspace.ts"
import type {
  EvidenceScoringBinding,
  IndicatorObservation,
  ScoringWorkspaceState,
} from "../src/types/risk.ts"

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

function observation(
  overrides: Partial<IndicatorObservation> = {}
): IndicatorObservation {
  return {
    id: "observation-1",
    companyId: "company-1",
    indicatorId: "kci-004",
    status: "available",
    value: "30",
    unit: "%",
    normalizedScore: 60,
    normalizationRuleVersion: "kci-004-v1",
    reviewStatus: "reviewed",
    reviewedBy: "测试复核人",
    reviewedAt: "2026-07-18",
    period: "2026-Q2",
    evidenceIds: ["evidence-1"],
    note: "测试观测",
    createdAt: "2026-07-18T01:00:00.000Z",
    updatedAt: "2026-07-18T01:00:00.000Z",
    ...overrides,
  }
}

function binding(
  overrides: Partial<EvidenceScoringBinding> = {}
): EvidenceScoringBinding {
  return {
    id: "binding-1",
    observationId: "observation-1",
    companyId: "company-1",
    indicatorId: "kci-004",
    evidenceId: "evidence-1",
    period: "2026-Q2",
    unit: "%",
    locator: "公告第 12 页",
    createdAt: "2026-07-18T01:00:00.000Z",
    updatedAt: "2026-07-18T01:00:00.000Z",
    ...overrides,
  }
}

function workspace(): ScoringWorkspaceState {
  return {
    version: SCORING_WORKSPACE_VERSION,
    observations: [observation()],
    evidenceBindings: [binding()],
    defaultReviewer: "测试复核人",
    updatedAt: "2026-07-18T01:00:00.000Z",
  }
}

test("initial workspace provides a deterministic empty reset state", () => {
  const resetAt = new Date("2026-07-19T01:30:00.000Z")
  const initial = createInitialScoringWorkspace([], [], resetAt)

  assert.deepEqual(initial, {
    version: SCORING_WORKSPACE_VERSION,
    observations: [],
    evidenceBindings: [],
    defaultReviewer: "",
    updatedAt: resetAt.toISOString(),
  })
  assert.notEqual(
    initial.observations,
    createInitialScoringWorkspace().observations
  )
})

test("loadScoringWorkspace restores a valid localStorage payload", () => {
  const stored = workspace()
  let result: ReturnType<typeof loadScoringWorkspace> | undefined

  withWindow(
    {
      localStorage: {
        getItem(key: string) {
          return key === SCORING_WORKSPACE_STORAGE_KEY
            ? JSON.stringify(stored)
            : null
        },
      },
    },
    () => {
      result = loadScoringWorkspace(createInitialScoringWorkspace())
    }
  )

  assert.deepEqual(result, { state: stored, warning: "" })
})

test("workspace validation rejects unusable or duplicate stable IDs", () => {
  const invalidStates: Array<[string, ScoringWorkspaceState]> = [
    [
      "missing observation id",
      {
        ...workspace(),
        observations: [observation({ id: undefined })],
      },
    ],
    [
      "blank observation id",
      {
        ...workspace(),
        observations: [observation({ id: "   " })],
      },
    ],
    [
      "duplicate observation id",
      {
        ...workspace(),
        observations: [
          observation(),
          observation({
            indicatorId: "kci-008",
            evidenceIds: ["evidence-2"],
          }),
        ],
      },
    ],
    [
      "blank binding id",
      {
        ...workspace(),
        evidenceBindings: [binding({ id: " " })],
      },
    ],
    [
      "duplicate binding id",
      {
        ...workspace(),
        evidenceBindings: [
          binding(),
          binding({
            observationId: "observation-2",
            evidenceId: "evidence-2",
          }),
        ],
        observations: [
          observation(),
          observation({
            id: "observation-2",
            indicatorId: "kci-008",
            evidenceIds: ["evidence-2"],
          }),
        ],
      },
    ],
  ]

  for (const [label, state] of invalidStates) {
    assert.equal(isScoringWorkspaceState(state), false, label)
  }
})

test("workspace validation rejects duplicate business keys and evidence relationships", () => {
  assert.equal(
    isScoringWorkspaceState({
      ...workspace(),
      observations: [
        observation(),
        observation({
          id: "observation-2",
          evidenceIds: ["evidence-2"],
        }),
      ],
      evidenceBindings: [
        binding(),
        binding({
          id: "binding-2",
          observationId: "observation-2",
          evidenceId: "evidence-2",
        }),
      ],
    }),
    false
  )

  assert.equal(
    isScoringWorkspaceState({
      ...workspace(),
      evidenceBindings: [binding(), binding({ id: "binding-2" })],
    }),
    false
  )
})

test("workspace validation rejects dangling or mismatched evidence bindings", () => {
  const invalidBindings: Array<[string, Partial<EvidenceScoringBinding>]> = [
    ["blank observation reference", { observationId: " " }],
    ["dangling observation reference", { observationId: "observation-other" }],
    ["company mismatch", { companyId: "company-other" }],
    ["indicator mismatch", { indicatorId: "kci-008" }],
    ["evidence mismatch", { evidenceId: "evidence-other" }],
    ["period mismatch", { period: "2026-Q1" }],
    ["unit mismatch", { unit: "次" }],
  ]

  for (const [label, overrides] of invalidBindings) {
    assert.equal(
      isScoringWorkspaceState({
        ...workspace(),
        evidenceBindings: [binding(overrides)],
      }),
      false,
      label
    )
  }
})

test("corrupted and unknown-version payloads are backed up before fallback", () => {
  const invalidPayloads = [
    "{not-json",
    JSON.stringify({ ...workspace(), version: 99 }),
    JSON.stringify({
      ...workspace(),
      evidenceBindings: [binding({ unit: "次" })],
    }),
  ]

  for (const raw of invalidPayloads) {
    const fallback = createInitialScoringWorkspace(
      [],
      [],
      new Date("2026-07-19T02:00:00.000Z")
    )
    const writes: Record<string, string> = {}

    withWindow(
      {
        localStorage: {
          getItem(key: string) {
            return key === SCORING_WORKSPACE_STORAGE_KEY ? raw : null
          },
          setItem(key: string, value: string) {
            writes[key] = value
          },
        },
      },
      () => {
        assert.deepEqual(loadScoringWorkspace(fallback), {
          state: fallback,
          warning: "检测到损坏或未知版本的评分数据，已备份并恢复初始工作区。",
        })
      }
    )

    assert.equal(writes[SCORING_WORKSPACE_BACKUP_KEY], raw)
  }
})

test("corrupted payload fallback reports when the recovery backup cannot be saved", () => {
  const fallback = createInitialScoringWorkspace()

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
      assert.deepEqual(loadScoringWorkspace(fallback), {
        state: fallback,
        warning:
          "检测到损坏或未知版本的评分数据，已恢复初始工作区，但浏览器未能保存备份。",
      })
    }
  )
})

test("storage resolution and read failures return the fallback without warnings", () => {
  const fallback = createInitialScoringWorkspace()

  withWindow(
    {
      get localStorage() {
        throw new Error("storage disabled")
      },
    },
    () => {
      assert.deepEqual(loadScoringWorkspace(fallback), {
        state: fallback,
        warning: "",
      })
    }
  )

  withWindow(
    {
      localStorage: {
        getItem() {
          throw new Error("storage blocked")
        },
      },
    },
    () => {
      assert.deepEqual(loadScoringWorkspace(fallback), {
        state: fallback,
        warning: "",
      })
    }
  )
})

test("saveScoringWorkspace persists valid state and reports write failures", () => {
  const state = workspace()
  const writes: Record<string, string> = {}

  withWindow(
    {
      localStorage: {
        setItem(key: string, value: string) {
          writes[key] = value
        },
      },
    },
    () => {
      assert.equal(saveScoringWorkspace(state), true)
    }
  )
  assert.deepEqual(JSON.parse(writes[SCORING_WORKSPACE_STORAGE_KEY]), state)

  withWindow(
    {
      get localStorage() {
        throw new Error("storage disabled")
      },
    },
    () => {
      assert.equal(saveScoringWorkspace(state), false)
    }
  )

  withWindow(
    {
      localStorage: {
        setItem() {
          throw new Error("quota exceeded")
        },
      },
    },
    () => {
      assert.equal(saveScoringWorkspace(state), false)
    }
  )
})

test("saveScoringWorkspace refuses structurally invalid state", () => {
  const writes: Record<string, string> = {}
  const invalid = {
    ...workspace(),
    evidenceBindings: [binding({ observationId: "observation-missing" })],
  }

  withWindow(
    {
      localStorage: {
        setItem(key: string, value: string) {
          writes[key] = value
        },
      },
    },
    () => {
      assert.equal(saveScoringWorkspace(invalid), false)
    }
  )

  assert.equal(SCORING_WORKSPACE_STORAGE_KEY in writes, false)
})

test("upsert inserts new observations and their evidence bindings", () => {
  const initial = createInitialScoringWorkspace(
    [],
    [],
    new Date("2026-07-18T00:00:00.000Z")
  )
  const now = new Date("2026-07-19T03:00:00.000Z")
  const next = upsertWorkspaceObservation(
    initial,
    observation({
      id: "observation-new",
      createdAt: undefined,
      updatedAt: undefined,
    }),
    [
      binding({
        id: "binding-new",
        observationId: "",
        createdAt: "",
        updatedAt: "",
      }),
    ],
    now
  )

  assert.equal(next.observations.length, 1)
  assert.deepEqual(next.observations[0], {
    ...observation({
      id: "observation-new",
      createdAt: undefined,
      updatedAt: undefined,
    }),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  })
  assert.deepEqual(next.evidenceBindings[0], {
    ...binding({
      id: "binding-new",
      observationId: "observation-new",
      createdAt: "",
      updatedAt: "",
    }),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  })
  assert.equal(next.updatedAt, now.toISOString())
})

test("upsert updates by company, indicator, and period without duplicates", () => {
  const initial = workspace()
  const now = new Date("2026-07-19T04:00:00.000Z")
  const next = upsertWorkspaceObservation(
    initial,
    observation({
      id: undefined,
      value: "31",
      normalizedScore: 25,
      evidenceIds: ["evidence-2"],
      createdAt: undefined,
      updatedAt: undefined,
    }),
    [
      binding({
        id: "binding-2",
        observationId: "",
        evidenceId: "evidence-2",
        locator: "公告第 18 页",
        createdAt: "",
        updatedAt: "",
      }),
    ],
    now
  )

  assert.equal(next.observations.length, 1)
  assert.equal(next.observations[0].id, "observation-1")
  assert.equal(next.observations[0].createdAt, "2026-07-18T01:00:00.000Z")
  assert.equal(next.observations[0].updatedAt, now.toISOString())
  assert.equal(next.observations[0].value, "31")
  assert.deepEqual(next.observations[0].evidenceIds, ["evidence-2"])
  assert.deepEqual(
    next.evidenceBindings.map((item) => item.evidenceId),
    ["evidence-2"]
  )
  assert.equal(next.evidenceBindings[0].observationId, "observation-1")
  assert.equal(next.evidenceBindings[0].updatedAt, now.toISOString())
})

test("editing into an existing business key atomically merges observations and bindings", () => {
  const initial = {
    ...workspace(),
    observations: [
      observation({
        period: "2026-Q1",
        evidenceIds: ["evidence-a"],
      }),
      observation({
        id: "observation-2",
        indicatorId: "kci-008",
        period: "2026-Q2",
        evidenceIds: ["evidence-b"],
      }),
    ],
    evidenceBindings: [
      binding({
        evidenceId: "evidence-a",
        period: "2026-Q1",
      }),
      binding({
        id: "binding-2",
        observationId: "observation-2",
        indicatorId: "kci-008",
        evidenceId: "evidence-b",
        period: "2026-Q2",
      }),
    ],
  }
  const now = new Date("2026-07-19T04:30:00.000Z")
  const next = upsertWorkspaceObservation(
    initial,
    observation({
      id: "observation-1",
      indicatorId: "kci-008",
      period: "2026-Q2",
      evidenceIds: ["evidence-new"],
      createdAt: undefined,
      updatedAt: undefined,
    }),
    [
      binding({
        id: "binding-new",
        observationId: "",
        indicatorId: "kci-008",
        evidenceId: "evidence-new",
        period: "2026-Q2",
        createdAt: "",
        updatedAt: "",
      }),
    ],
    now
  )

  assert.equal(next.observations.length, 1)
  assert.equal(next.observations[0].id, "observation-1")
  assert.equal(next.observations[0].indicatorId, "kci-008")
  assert.equal(next.observations[0].period, "2026-Q2")
  assert.equal(next.observations[0].createdAt, "2026-07-18T01:00:00.000Z")
  assert.deepEqual(next.observations[0].evidenceIds, ["evidence-new"])
  assert.deepEqual(next.evidenceBindings, [
    {
      ...binding({
        id: "binding-new",
        observationId: "observation-1",
        indicatorId: "kci-008",
        evidenceId: "evidence-new",
        period: "2026-Q2",
        createdAt: "",
        updatedAt: "",
      }),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    },
  ])
  assert.equal(isScoringWorkspaceState(next), true)
})

test("delete removes an observation and cascades to only its bindings", () => {
  const initial = {
    ...workspace(),
    observations: [
      observation(),
      observation({
        id: "observation-2",
        indicatorId: "kci-008",
        evidenceIds: ["evidence-2"],
      }),
    ],
    evidenceBindings: [
      binding(),
      binding({
        id: "binding-2",
        observationId: "observation-2",
        indicatorId: "kci-008",
        evidenceId: "evidence-2",
      }),
    ],
  }
  const now = new Date("2026-07-19T05:00:00.000Z")
  const next = deleteWorkspaceObservation(initial, "observation-1", now)

  assert.deepEqual(
    next.observations.map((item) => item.id),
    ["observation-2"]
  )
  assert.deepEqual(
    next.evidenceBindings.map((item) => item.id),
    ["binding-2"]
  )
  assert.equal(next.updatedAt, now.toISOString())
})
