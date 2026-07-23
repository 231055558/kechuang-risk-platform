import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import {
  createPromotedSignalKey,
  createInitialDemoState,
  DEMO_STATE_STORAGE_KEY,
  getPromotedSignalIdsForCompany,
  LEGACY_DEMO_STATE_STORAGE_KEY,
  readDemoState,
  saveDemoState,
  type DemoState,
} from "../src/lib/demo-state.ts"
import type { RiskEvent } from "../src/types/risk.ts"

const testDirectory = dirname(fileURLToPath(import.meta.url))
const projectRoot = join(testDirectory, "..")

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

function createFallback() {
  return createInitialDemoState(
    "deepseek",
    "fourth-paradigm",
    new Date("2026-07-15T02:30:00.000Z")
  )
}

function createPromotedEvent(): RiskEvent {
  return {
    id: "snapshot-event-signal-1",
    companyId: "deepseek",
    riskType: "technology",
    severity: "high",
    status: "pending",
    sourceType: "risk-signal",
    stage: "growth",
    description: "A promoted risk signal.",
    evidenceIds: ["evidence-1"],
    indicatorIds: ["indicator-1"],
    investmentImpact: "high",
    aiSummary: "Summary",
    recommendedAction: "Review the signal.",
    identifiedAt: "2026-07-15",
  }
}

function createStoredState(): DemoState {
  return {
    ...createFallback(),
    activeView: "events",
    researchSection: "metrics",
    operationsSection: "investment",
    riskLens: "priority",
    timeRange: "3m",
    statusMap: {
      "event-1": "in-progress",
    },
    promotedEvents: [createPromotedEvent()],
    promotedSignalIds: [createPromotedSignalKey("deepseek", "signal-1")],
    lastUpdatedAt: "2026-07-15T03:00:00.000Z",
  }
}

function readFromValues(values: Record<string, string | null>) {
  const fallback = createFallback()
  let restored: DemoState | undefined

  withWindow(
    {
      sessionStorage: {
        getItem(key: string) {
          return values[key] ?? null
        },
      },
    },
    () => {
      restored = readDemoState(fallback)
    }
  )

  return { fallback, restored }
}

test("readDemoState accepts a fully valid current state", () => {
  const stored = createStoredState()
  const { restored } = readFromValues({
    [DEMO_STATE_STORAGE_KEY]: JSON.stringify(stored),
  })

  assert.deepEqual(restored, stored)
})

test("readDemoState preserves the investment advice destination", () => {
  const stored = {
    ...createStoredState(),
    operationsSection: "advice" as const,
  }
  const { restored } = readFromValues({
    [DEMO_STATE_STORAGE_KEY]: JSON.stringify(stored),
  })

  assert.equal(restored?.activeView, "events")
  assert.equal(restored?.operationsSection, "advice")
})

test("readDemoState falls back when storage resolution or reads throw", () => {
  const fallback = createFallback()

  withWindow(
    {
      get sessionStorage() {
        throw new Error("storage disabled")
      },
    },
    () => {
      assert.equal(readDemoState(fallback), fallback)
    }
  )

  withWindow(
    {
      sessionStorage: {
        getItem() {
          throw new Error("storage blocked")
        },
      },
    },
    () => {
      assert.equal(readDemoState(fallback), fallback)
    }
  )
})

test("saveDemoState reports storage resolution and write exceptions", () => {
  const state = createStoredState()

  withWindow(
    {
      get sessionStorage() {
        throw new Error("storage disabled")
      },
    },
    () => {
      assert.equal(saveDemoState(state), false)
    }
  )

  withWindow(
    {
      sessionStorage: {
        setItem() {
          throw new Error("quota exceeded")
        },
      },
    },
    () => {
      assert.equal(saveDemoState(state), false)
    }
  )
})

test("saveDemoState persists v2 state and clears the stale legacy key", () => {
  const state = createStoredState()
  const values: Record<string, string> = {
    [LEGACY_DEMO_STATE_STORAGE_KEY]: "stale",
  }

  withWindow(
    {
      sessionStorage: {
        setItem(key: string, value: string) {
          values[key] = value
        },
        removeItem(key: string) {
          delete values[key]
        },
      },
    },
    () => {
      assert.equal(saveDemoState(state), true)
    }
  )

  assert.deepEqual(JSON.parse(values[DEMO_STATE_STORAGE_KEY]), state)
  assert.equal(values[LEGACY_DEMO_STATE_STORAGE_KEY], undefined)
})

test("legacy promoted signal IDs migrate into company-scoped keys", () => {
  const currentState = {
    ...createStoredState(),
    promotedSignalIds: ["signal-1"],
  }
  const { restored } = readFromValues({
    [DEMO_STATE_STORAGE_KEY]: JSON.stringify(currentState),
  })

  assert.deepEqual(restored?.promotedSignalIds, [
    createPromotedSignalKey("deepseek", "signal-1"),
  ])
  assert.deepEqual(
    getPromotedSignalIdsForCompany(
      [
        createPromotedSignalKey("deepseek", "signal-1"),
        createPromotedSignalKey("fourth-paradigm", "signal-1"),
      ],
      "deepseek"
    ),
    ["signal-1"]
  )
})

test("stored promoted events migrate legacy risk-feed terminology", () => {
  const legacyEvent = {
    ...createPromotedEvent(),
    riskType: "风险动态信号",
    sourceType: "风险动态 · 公开来源",
  }
  const stored = {
    ...createStoredState(),
    activeView: "realtime" as const,
    promotedEvents: [legacyEvent],
  }
  const { restored } = readFromValues({
    [DEMO_STATE_STORAGE_KEY]: JSON.stringify(stored),
  })

  assert.equal(restored?.activeView, "realtime")
  assert.equal(restored?.promotedEvents[0]?.id, legacyEvent.id)
  assert.equal(restored?.promotedEvents[0]?.riskType, "实时情报线索")
  assert.equal(
    restored?.promotedEvents[0]?.sourceType,
    "实时情报 · 公开来源"
  )
  assert.deepEqual(restored?.promotedSignalIds, stored.promotedSignalIds)
})

test("a minimal v1 state migrates with field-level fallbacks", () => {
  const { fallback, restored } = readFromValues({
    [LEGACY_DEMO_STATE_STORAGE_KEY]: JSON.stringify({
      version: 1,
      activeView: "transmission",
    }),
  })

  assert.deepEqual(restored, {
    ...fallback,
    version: 2,
    activeView: "events",
    operationsSection: "transmission",
  })
})

test("legacy promoted signals use the matching event company namespace", () => {
  const { restored } = readFromValues({
    [LEGACY_DEMO_STATE_STORAGE_KEY]: JSON.stringify({
      version: 1,
      companyId: "horizon",
      promotedEvents: [createPromotedEvent()],
      promotedSignalIds: ["signal-1"],
    }),
  })

  assert.equal(restored?.companyId, "horizon")
  assert.deepEqual(restored?.promotedSignalIds, [
    createPromotedSignalKey("deepseek", "signal-1"),
  ])
})

test("legacy promoted signals without one matching event company are dropped", () => {
  const duplicateSignalEvent = {
    ...createPromotedEvent(),
    companyId: "horizon",
  }
  const { restored } = readFromValues({
    [LEGACY_DEMO_STATE_STORAGE_KEY]: JSON.stringify({
      version: 1,
      promotedEvents: [createPromotedEvent(), duplicateSignalEvent],
      promotedSignalIds: ["signal-1", "orphan-signal"],
    }),
  })

  assert.deepEqual(restored?.promotedSignalIds, [])
})

test("restored state never compares a company with itself", () => {
  const stored = {
    ...createStoredState(),
    companyId: "deepseek",
    compareCompanyId: "deepseek",
  }
  const { restored } = readFromValues({
    [DEMO_STATE_STORAGE_KEY]: JSON.stringify(stored),
  })

  assert.equal(restored?.companyId, "deepseek")
  assert.equal(restored?.compareCompanyId, "fourth-paradigm")
})

test("damaged v1 fields fall back before the migrated v2 state is validated", () => {
  const { fallback, restored } = readFromValues({
    [LEGACY_DEMO_STATE_STORAGE_KEY]: JSON.stringify({
      version: 1,
      companyId: 42,
      compareCompanyId: null,
      activeView: "lifecycle",
      researchSection: "invalid-section",
      operationsSection: [],
      riskLens: "urgent",
      timeRange: "12m",
      statusMap: null,
      promotedEvents: [null],
      promotedSignalIds: [null],
      lastUpdatedAt: "not-a-date",
    }),
  })

  assert.deepEqual(restored, {
    ...fallback,
    version: 2,
    activeView: "intelligence",
    researchSection: "lifecycle",
  })
})

test("readDemoState rejects malformed nested state and enum values", () => {
  const validState = createStoredState()
  const malformedStates: Array<[string, unknown]> = [
    ["null state", null],
    ["unsupported version", { ...validState, version: 99 }],
    ["empty company ID", { ...validState, companyId: "" }],
    ["invalid active view", { ...validState, activeView: "invalid-view" }],
    ["legacy active view in v2", { ...validState, activeView: "transmission" }],
    [
      "invalid research section",
      { ...validState, researchSection: "invalid-section" },
    ],
    [
      "invalid operations section",
      { ...validState, operationsSection: "invalid-section" },
    ],
    ["invalid risk lens", { ...validState, riskLens: "urgent" }],
    ["invalid time range", { ...validState, timeRange: "12m" }],
    ["null status map", { ...validState, statusMap: null }],
    [
      "invalid status map value",
      { ...validState, statusMap: { "event-1": "blocked" } },
    ],
    ["null promoted event", { ...validState, promotedEvents: [null] }],
    [
      "empty promoted event ID",
      {
        ...validState,
        promotedEvents: [{ ...createPromotedEvent(), id: "" }],
      },
    ],
    [
      "invalid promoted event severity",
      {
        ...validState,
        promotedEvents: [{ ...createPromotedEvent(), severity: "critical" }],
      },
    ],
    [
      "invalid promoted event status",
      {
        ...validState,
        promotedEvents: [{ ...createPromotedEvent(), status: "blocked" }],
      },
    ],
    [
      "invalid nested evidence ID",
      {
        ...validState,
        promotedEvents: [{ ...createPromotedEvent(), evidenceIds: [""] }],
      },
    ],
    [
      "invalid nested indicator IDs",
      {
        ...validState,
        promotedEvents: [{ ...createPromotedEvent(), indicatorIds: [null] }],
      },
    ],
    [
      "invalid investment impact",
      {
        ...validState,
        promotedEvents: [
          { ...createPromotedEvent(), investmentImpact: "critical" },
        ],
      },
    ],
    [
      "empty source name",
      {
        ...validState,
        promotedEvents: [{ ...createPromotedEvent(), sourceName: "" }],
      },
    ],
    [
      "unsafe source URL",
      {
        ...validState,
        promotedEvents: [
          { ...createPromotedEvent(), sourceUrl: "javascript:alert(1)" },
        ],
      },
    ],
    [
      "invalid source publication date",
      {
        ...validState,
        promotedEvents: [
          { ...createPromotedEvent(), sourcePublishedAt: "not-a-date" },
        ],
      },
    ],
    ["empty promoted signal ID", { ...validState, promotedSignalIds: [""] }],
    [
      "invalid update timestamp",
      { ...validState, lastUpdatedAt: "not-a-date" },
    ],
  ]

  malformedStates.forEach(([label, state]) => {
    const { fallback, restored } = readFromValues({
      [DEMO_STATE_STORAGE_KEY]: JSON.stringify(state),
    })

    assert.equal(restored, fallback, label)
  })
})

test("malformed current state falls through to a valid legacy state", () => {
  const legacyState = {
    ...createStoredState(),
    version: 1,
    activeView: "transmission",
  }
  Reflect.deleteProperty(legacyState, "researchSection")
  Reflect.deleteProperty(legacyState, "operationsSection")

  const { restored } = readFromValues({
    [DEMO_STATE_STORAGE_KEY]: JSON.stringify({
      ...createStoredState(),
      promotedEvents: [null],
    }),
    [LEGACY_DEMO_STATE_STORAGE_KEY]: JSON.stringify(legacyState),
  })

  assert.equal(restored?.version, 2)
  assert.equal(restored?.activeView, "events")
  assert.equal(restored?.operationsSection, "transmission")
})

test("a successful v1 migration writes v2 and removes the legacy key", () => {
  const legacyState = {
    ...createStoredState(),
    version: 1,
    activeView: "transmission",
    promotedSignalIds: ["signal-1"],
  }
  Reflect.deleteProperty(legacyState, "researchSection")
  Reflect.deleteProperty(legacyState, "operationsSection")

  const values: Record<string, string> = {
    [LEGACY_DEMO_STATE_STORAGE_KEY]: JSON.stringify(legacyState),
  }
  let restored: DemoState | undefined

  withWindow(
    {
      sessionStorage: {
        getItem(key: string) {
          return values[key] ?? null
        },
        setItem(key: string, value: string) {
          values[key] = value
        },
        removeItem(key: string) {
          delete values[key]
        },
      },
    },
    () => {
      restored = readDemoState(createFallback())
    }
  )

  assert.equal(restored?.activeView, "events")
  assert.deepEqual(restored?.promotedSignalIds, [
    createPromotedSignalKey("deepseek", "signal-1"),
  ])
  assert.deepEqual(JSON.parse(values[DEMO_STATE_STORAGE_KEY]), restored)
  assert.equal(values[LEGACY_DEMO_STATE_STORAGE_KEY], undefined)
})

test("theme persistence routes reads and writes through safe storage helpers", () => {
  const source = readFileSync(
    join(projectRoot, "src/components/theme-provider.tsx"),
    "utf8"
  )

  assert.match(source, /safeGetStorageItem/)
  assert.match(source, /safeSetStorageItem/)
  assert.doesNotMatch(source, /\blocalStorage\.(?:getItem|setItem)\s*\(/)
})
