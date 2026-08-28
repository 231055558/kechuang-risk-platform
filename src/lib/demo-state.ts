import type {
  EventStatus,
  OperationsSection,
  ResearchSection,
  RiskEvent,
  TabValue,
} from "@/types/risk"

export const DEMO_STATE_STORAGE_KEY = "kechuang-risk-demo-state-v2"
export const LEGACY_DEMO_STATE_STORAGE_KEY = "kechuang-risk-demo-state-v1"
export const DEMO_STATE_VERSION = 2
const PROMOTED_SIGNAL_KEY_SEPARATOR = "::"

export type DemoState = {
  version: number
  companyId: string
  compareCompanyId: string
  activeView: TabValue
  researchSection: ResearchSection
  operationsSection: OperationsSection
  riskLens: "all" | "priority" | "high"
  timeRange: "3m" | "6m"
  statusMap: Record<string, EventStatus>
  promotedEvents: RiskEvent[]
  promotedSignalIds: string[]
  lastUpdatedAt: string
}

type StoredDemoState = {
  version?: unknown
  companyId?: unknown
  compareCompanyId?: unknown
  activeView?: unknown
  researchSection?: unknown
  operationsSection?: unknown
  riskLens?: unknown
  timeRange?: unknown
  statusMap?: unknown
  promotedEvents?: unknown
  promotedSignalIds?: unknown
  lastUpdatedAt?: unknown
}

const canonicalViews = new Set<TabValue>([
  "overview",
  "narrative",
  "realtime",
  "reports",
  "intelligence",
  "compare",
  "events",
])
const researchSections = new Set<ResearchSection>([
  "profile",
  "metrics",
  "lifecycle",
  "evidence",
])
const operationsSections = new Set<OperationsSection>([
  "events",
  "transmission",
  "governance",
  "investment",
  "advice",
])
const riskLenses = new Set<DemoState["riskLens"]>(["all", "priority", "high"])
const timeRanges = new Set<DemoState["timeRange"]>(["3m", "6m"])
const eventStatuses = new Set<EventStatus>(["pending", "in-progress", "done"])
const eventSeverities = new Set<RiskEvent["severity"]>([
  "high",
  "medium",
  "watch",
])
const investmentImpacts = new Set<NonNullable<RiskEvent["investmentImpact"]>>([
  "low",
  "medium",
  "high",
])

type StorageReader = Pick<Storage, "getItem">
type StorageWriter = Pick<Storage, "setItem">
type StorageRemover = Pick<Storage, "removeItem">

export function safeResolveStorage<StorageValue>(
  resolveStorage: () => StorageValue
): StorageValue | null {
  try {
    return resolveStorage()
  } catch {
    return null
  }
}

export function safeGetStorageItem(
  resolveStorage: () => StorageReader,
  key: string
) {
  try {
    return resolveStorage().getItem(key)
  } catch {
    return null
  }
}

export function safeSetStorageItem(
  resolveStorage: () => StorageWriter,
  key: string,
  value: string
) {
  try {
    resolveStorage().setItem(key, value)
    return true
  } catch {
    return false
  }
}

export function safeRemoveStorageItem(
  resolveStorage: () => StorageRemover,
  key: string
) {
  try {
    resolveStorage().removeItem(key)
    return true
  } catch {
    return false
  }
}

export function createPromotedSignalKey(companyId: string, signalId: string) {
  return `${companyId}${PROMOTED_SIGNAL_KEY_SEPARATOR}${signalId}`
}

export function getPromotedSignalIdsForCompany(
  promotedSignalKeys: string[],
  companyId: string
) {
  const companyPrefix = `${companyId}${PROMOTED_SIGNAL_KEY_SEPARATOR}`

  return promotedSignalKeys
    .filter((key) => key.startsWith(companyPrefix))
    .map((key) => key.slice(companyPrefix.length))
    .filter(Boolean)
}

function isPromotedSignalKey(value: unknown): value is string {
  if (!isNonEmptyString(value)) {
    return false
  }

  const parts = value.split(PROMOTED_SIGNAL_KEY_SEPARATOR)
  return (
    parts.length === 2 &&
    isNonEmptyString(parts[0]) &&
    isNonEmptyString(parts[1])
  )
}

function findPromotedSignalCompanyId(
  signalId: string,
  promotedEvents: RiskEvent[]
) {
  const companyIds = new Set(
    promotedEvents
      .filter(
        (event) =>
          event.id === `snapshot-event-${signalId}` ||
          event.id === `snapshot-event-${event.companyId}-${signalId}`
      )
      .map((event) => event.companyId)
  )

  return companyIds.size === 1 ? [...companyIds][0] : null
}

function normalizePromotedSignalKeys(
  signalIds: string[],
  promotedEvents: RiskEvent[]
) {
  return [
    ...new Set(
      signalIds.flatMap((signalId) => {
        if (signalId.includes(PROMOTED_SIGNAL_KEY_SEPARATOR)) {
          return isPromotedSignalKey(signalId) ? [signalId] : []
        }

        const companyId = findPromotedSignalCompanyId(signalId, promotedEvents)
        return companyId ? [createPromotedSignalKey(companyId, signalId)] : []
      })
    ),
  ]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function isValidDateString(value: unknown): value is string {
  return isNonEmptyString(value) && !Number.isNaN(Date.parse(value))
}

function isHttpUrl(value: unknown): value is string {
  if (!isNonEmptyString(value)) {
    return false
  }

  try {
    const url = new URL(value)
    return url.protocol === "http:" || url.protocol === "https:"
  } catch {
    return false
  }
}

function isValueInSet<Value extends string>(
  value: unknown,
  values: ReadonlySet<Value>
): value is Value {
  return typeof value === "string" && values.has(value as Value)
}

function isNonEmptyStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isNonEmptyString)
}

function isPromotedSignalInputArray(value: unknown): value is string[] {
  return (
    isNonEmptyStringArray(value) &&
    value.every(
      (signalId) =>
        !signalId.includes(PROMOTED_SIGNAL_KEY_SEPARATOR) ||
        isPromotedSignalKey(signalId)
    )
  )
}

function isPromotedSignalKeyArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isPromotedSignalKey)
}

function isStatusMap(value: unknown): value is Record<string, EventStatus> {
  return (
    isRecord(value) &&
    Object.entries(value).every(
      ([eventId, status]) =>
        isNonEmptyString(eventId) && isValueInSet(status, eventStatuses)
    )
  )
}

function isRiskEvent(value: unknown): value is RiskEvent {
  if (!isRecord(value)) {
    return false
  }

  if (
    !isNonEmptyString(value.id) ||
    !isNonEmptyString(value.companyId) ||
    !isNonEmptyString(value.riskType) ||
    !isValueInSet(value.severity, eventSeverities) ||
    !isValueInSet(value.status, eventStatuses) ||
    !isNonEmptyString(value.sourceType) ||
    !isNonEmptyString(value.stage) ||
    !isNonEmptyString(value.description) ||
    !isNonEmptyStringArray(value.evidenceIds) ||
    !isNonEmptyString(value.aiSummary) ||
    !isNonEmptyString(value.recommendedAction) ||
    !isValidDateString(value.identifiedAt)
  ) {
    return false
  }

  if (
    value.indicatorIds !== undefined &&
    !isNonEmptyStringArray(value.indicatorIds)
  ) {
    return false
  }

  if (value.sourceName !== undefined && !isNonEmptyString(value.sourceName)) {
    return false
  }

  if (value.sourceUrl !== undefined && !isHttpUrl(value.sourceUrl)) {
    return false
  }

  if (
    value.sourcePublishedAt !== undefined &&
    !isValidDateString(value.sourcePublishedAt)
  ) {
    return false
  }

  if (
    value.investmentImpact !== undefined &&
    !isValueInSet(value.investmentImpact, investmentImpacts)
  ) {
    return false
  }

  return true
}

function isStoredV1DemoState(value: unknown): value is StoredDemoState {
  return isRecord(value) && value.version === 1
}

function isStoredV2DemoState(value: unknown): value is StoredDemoState {
  if (!isRecord(value) || value.version !== DEMO_STATE_VERSION) {
    return false
  }

  return (
    isNonEmptyString(value.companyId) &&
    isNonEmptyString(value.compareCompanyId) &&
    isValueInSet(value.activeView, canonicalViews) &&
    isValueInSet(value.researchSection, researchSections) &&
    isValueInSet(value.operationsSection, operationsSections) &&
    isValueInSet(value.riskLens, riskLenses) &&
    isValueInSet(value.timeRange, timeRanges) &&
    isStatusMap(value.statusMap) &&
    Array.isArray(value.promotedEvents) &&
    value.promotedEvents.every(isRiskEvent) &&
    isPromotedSignalInputArray(value.promotedSignalIds) &&
    isValidDateString(value.lastUpdatedAt)
  )
}

function isCompleteDemoState(value: unknown): value is DemoState {
  return (
    isStoredV2DemoState(value) &&
    value.companyId !== value.compareCompanyId &&
    isPromotedSignalKeyArray(value.promotedSignalIds)
  )
}

function resolveCompareCompanyId(
  candidate: unknown,
  companyId: string,
  fallback: DemoState
) {
  return [candidate, fallback.compareCompanyId, fallback.companyId].find(
    (company): company is string =>
      isNonEmptyString(company) && company !== companyId
  )
}

export function createInitialDemoState(
  companyId: string,
  compareCompanyId: string,
  now = new Date()
): DemoState {
  return {
    version: DEMO_STATE_VERSION,
    companyId,
    compareCompanyId,
    activeView: "overview",
    researchSection: "profile",
    operationsSection: "events",
    riskLens: "all",
    timeRange: "6m",
    statusMap: {},
    promotedEvents: [],
    promotedSignalIds: [],
    lastUpdatedAt: now.toISOString(),
  }
}

export function migrateDemoState(
  state: StoredDemoState,
  fallback: DemoState
): DemoState {
  const legacyView = state.activeView
  const companyId = isNonEmptyString(state.companyId)
    ? state.companyId
    : fallback.companyId
  const compareCompanyId =
    resolveCompareCompanyId(state.compareCompanyId, companyId, fallback) ??
    fallback.compareCompanyId
  const promotedEvents =
    Array.isArray(state.promotedEvents) &&
    state.promotedEvents.every(isRiskEvent)
      ? state.promotedEvents.map(migratePromotedEventTerminology)
      : fallback.promotedEvents
  const promotedSignalIds = isNonEmptyStringArray(state.promotedSignalIds)
    ? normalizePromotedSignalKeys(state.promotedSignalIds, promotedEvents)
    : fallback.promotedSignalIds
  let activeView: TabValue = fallback.activeView
  let researchSection = isValueInSet(state.researchSection, researchSections)
    ? state.researchSection
    : fallback.researchSection
  let operationsSection = isValueInSet(
    state.operationsSection,
    operationsSections
  )
    ? state.operationsSection
    : fallback.operationsSection

  if (legacyView && canonicalViews.has(legacyView as TabValue)) {
    activeView = legacyView as TabValue
  } else if (legacyView === "lifecycle") {
    activeView = "intelligence"
    researchSection = "lifecycle"
  } else if (legacyView === "transmission") {
    activeView = "events"
    operationsSection = "transmission"
  } else if (legacyView === "governance") {
    activeView = "events"
    operationsSection = "investment"
  }

  return {
    version: DEMO_STATE_VERSION,
    companyId,
    compareCompanyId,
    activeView,
    researchSection,
    operationsSection,
    riskLens: isValueInSet(state.riskLens, riskLenses)
      ? state.riskLens
      : fallback.riskLens,
    timeRange: isValueInSet(state.timeRange, timeRanges)
      ? state.timeRange
      : fallback.timeRange,
    statusMap: isStatusMap(state.statusMap)
      ? state.statusMap
      : fallback.statusMap,
    promotedEvents,
    promotedSignalIds,
    lastUpdatedAt: isValidDateString(state.lastUpdatedAt)
      ? state.lastUpdatedAt
      : fallback.lastUpdatedAt,
  }
}

function migratePromotedEventTerminology(event: RiskEvent): RiskEvent {
  const sourceType = event.sourceType.startsWith("风险动态 · ")
    ? `实时情报 · ${event.sourceType.slice("风险动态 · ".length)}`
    : event.sourceType
  const riskType =
    event.riskType === "风险动态信号" ? "实时情报线索" : event.riskType

  return sourceType === event.sourceType && riskType === event.riskType
    ? event
    : { ...event, sourceType, riskType }
}

function parseStoredState(rawState: string | null, fallback: DemoState) {
  if (!rawState) {
    return null
  }

  let state: unknown
  try {
    state = JSON.parse(rawState)
  } catch {
    return null
  }

  if (!isStoredV1DemoState(state) && !isStoredV2DemoState(state)) {
    return null
  }

  const migrated = migrateDemoState(state, fallback)
  return isCompleteDemoState(migrated) ? migrated : null
}

export function readDemoState(fallback: DemoState): DemoState {
  if (typeof window === "undefined") {
    return fallback
  }

  const getSessionStorage = () => window.sessionStorage
  const current = parseStoredState(
    safeGetStorageItem(getSessionStorage, DEMO_STATE_STORAGE_KEY),
    fallback
  )
  if (current) {
    safeRemoveStorageItem(getSessionStorage, LEGACY_DEMO_STATE_STORAGE_KEY)
    return current
  }

  const migratedLegacy = parseStoredState(
    safeGetStorageItem(getSessionStorage, LEGACY_DEMO_STATE_STORAGE_KEY),
    fallback
  )
  if (!migratedLegacy) {
    return fallback
  }

  saveDemoState(migratedLegacy)
  return migratedLegacy
}

export function saveDemoState(state: DemoState) {
  if (typeof window === "undefined") {
    return false
  }

  let serializedState: string
  try {
    serializedState = JSON.stringify(state)
  } catch {
    return false
  }

  const saved = safeSetStorageItem(
    () => window.sessionStorage,
    DEMO_STATE_STORAGE_KEY,
    serializedState
  )
  if (saved) {
    safeRemoveStorageItem(
      () => window.sessionStorage,
      LEGACY_DEMO_STATE_STORAGE_KEY
    )
  }

  return saved
}
