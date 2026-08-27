import {
  Component,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react"
import {
  BookOpenCheckIcon,
  BrainCircuitIcon,
  DatabaseZapIcon,
  DownloadIcon,
  FileStackIcon,
  RotateCcwIcon,
  ScaleIcon,
  ShieldCheckIcon,
  WorkflowIcon,
} from "lucide-react"

import { AppShell } from "@/components/layout/app-shell"
import { WorkflowTransition } from "@/components/motion/workflow-transition"
import { useTheme } from "@/components/theme-provider"
import { useScoringWorkspace } from "@/hooks/use-scoring-workspace"
import { useTechnologyScoringWorkspace } from "@/hooks/use-technology-scoring-workspace"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  buildAssessmentRegistry,
  buildCompanySummaries,
  commonPlaybook,
  defaultCompareId,
  defaultCompanyId,
  detailRegistry,
  getCompanyDetail,
  getCompanyIntelligence,
  indicatorObservations,
  indicatorTaxonomy,
  manifest,
  realtimeData,
  realtimeSignals,
  riskIndicators,
} from "@/lib/data-r01"
import {
  createPromotedSignalKey,
  createInitialDemoState,
  getPromotedSignalIdsForCompany,
  readDemoState,
  saveDemoState,
  type DemoState,
} from "@/lib/demo-state"
import { getCanonicalRiskDimensionLabel } from "@/lib/risk-dimensions"
import {
  isCandidateDataSource,
  summarizeEvidenceGovernance,
} from "@/lib/source-governance"
import { quantifyTechnologyBaseline } from "@/lib/technology-baseline-api"
import { scoreTechnologyRisk } from "@/lib/technology-scoring-api"
import { cn } from "@/lib/utils"
import { INDUSTRY_RISK_MVP_METHOD_VERSION } from "@/domain/industry-risk-v1/scoring-engine.ts"
import type { NavigationTarget } from "@/types/nav"
import type {
  EventStatus,
  EvidenceScoringBinding,
  IndicatorObservation,
  IndicatorAdmissionStatus,
  OperationsSection,
  RealTimeSignal,
  ResearchSection,
  RiskEvent,
  TabValue,
  TechnologyBaselineQuantificationRequest,
  TechnologyRiskScoreRequest,
} from "@/types/risk"

function cachedImport<T>(loader: () => Promise<T>) {
  let promise: Promise<T> | undefined

  return () => {
    promise ??= loader().catch((error) => {
      promise = undefined
      throw error
    })
    return promise
  }
}

const loadOverviewTab = cachedImport(
  () => import("@/components/dashboard/overview-tab")
)
const loadRealtimeTab = cachedImport(
  () => import("@/components/dashboard/realtime-tab")
)
const loadReportsTab = cachedImport(
  () => import("@/components/dashboard/risk-reports-tab")
)
const loadIntelligenceTab = cachedImport(
  () => import("@/components/dashboard/intelligence-tab")
)
const loadCompareTab = cachedImport(
  () => import("@/components/dashboard/compare-tab")
)
const loadEventsTab = cachedImport(
  () => import("@/components/dashboard/events-tab")
)

type ViewComponentRegistry = {
  overview: typeof import("@/components/dashboard/overview-tab").OverviewTab
  realtime: typeof import("@/components/dashboard/realtime-tab").RealtimeTab
  reports: typeof import("@/components/dashboard/risk-reports-tab").RiskReportsTab
  intelligence: typeof import("@/components/dashboard/intelligence-tab").IntelligenceTab
  compare: typeof import("@/components/dashboard/compare-tab").CompareTab
  events: typeof import("@/components/dashboard/events-tab").EventsTab
}

const VIEW_COMPONENT_LOADERS = {
  overview: cachedImport(() =>
    loadOverviewTab().then((module) => module.OverviewTab)
  ),
  realtime: cachedImport(() =>
    loadRealtimeTab().then((module) => module.RealtimeTab)
  ),
  reports: cachedImport(() =>
    loadReportsTab().then((module) => module.RiskReportsTab)
  ),
  intelligence: cachedImport(() =>
    loadIntelligenceTab().then((module) => module.IntelligenceTab)
  ),
  compare: cachedImport(() =>
    loadCompareTab().then((module) => module.CompareTab)
  ),
  events: cachedImport(() =>
    loadEventsTab().then((module) => module.EventsTab)
  ),
} satisfies {
  [View in TabValue]: () => Promise<ViewComponentRegistry[View]>
}

const LazyOverviewTab = lazy(() =>
  VIEW_COMPONENT_LOADERS.overview().then((component) => ({
    default: component,
  }))
)
const LazyRealtimeTab = lazy(() =>
  VIEW_COMPONENT_LOADERS.realtime().then((component) => ({
    default: component,
  }))
)
const LazyReportsTab = lazy(() =>
  VIEW_COMPONENT_LOADERS.reports().then((component) => ({
    default: component,
  }))
)
const LazyIntelligenceTab = lazy(() =>
  VIEW_COMPONENT_LOADERS.intelligence().then((component) => ({
    default: component,
  }))
)
const LazyCompareTab = lazy(() =>
  VIEW_COMPONENT_LOADERS.compare().then((component) => ({
    default: component,
  }))
)
const LazyEventsTab = lazy(() =>
  VIEW_COMPONENT_LOADERS.events().then((component) => ({
    default: component,
  }))
)

type LazyViewRegistry = {
  overview: typeof LazyOverviewTab
  realtime: typeof LazyRealtimeTab
  reports: typeof LazyReportsTab
  intelligence: typeof LazyIntelligenceTab
  compare: typeof LazyCompareTab
  events: typeof LazyEventsTab
}

const INITIAL_LAZY_TABS = {
  overview: LazyOverviewTab,
  realtime: LazyRealtimeTab,
  reports: LazyReportsTab,
  intelligence: LazyIntelligenceTab,
  compare: LazyCompareTab,
  events: LazyEventsTab,
} satisfies LazyViewRegistry

const admissionLabels: Record<IndicatorAdmissionStatus, string> = {
  validated: "口径准入",
  observation: "观察项",
  candidate: "候选项",
}

type ExportKind = "pdf" | "csv" | "png"

const loadReportExport = cachedImport(() => import("@/lib/report-export"))

function loadViewComponent<View extends TabValue>(
  view: View
): Promise<ViewComponentRegistry[View]> {
  return VIEW_COMPONENT_LOADERS[view]() as Promise<ViewComponentRegistry[View]>
}

function createLazyViewComponent<View extends TabValue>(
  view: View
): LazyViewRegistry[View] {
  return lazy(() =>
    loadViewComponent(view).then((component) => ({
      default: component,
    }))
  ) as LazyViewRegistry[View]
}

function preloadView(view: TabValue) {
  void loadViewComponent(view).catch(() => undefined)
}

function resolveCompareCompanyId(
  companyId: string,
  requestedCompanyId?: string
) {
  if (
    requestedCompanyId &&
    requestedCompanyId !== companyId &&
    detailRegistry[requestedCompanyId]
  ) {
    return requestedCompanyId
  }

  const benchmarkCompanyId = getCompanyDetail(companyId).benchmarkCompanyId
  if (benchmarkCompanyId !== companyId && detailRegistry[benchmarkCompanyId]) {
    return benchmarkCompanyId
  }

  return (
    Object.keys(detailRegistry).find(
      (candidateId) => candidateId !== companyId
    ) ?? companyId
  )
}

class ViewLoadErrorBoundary extends Component<
  { children: ReactNode; onRetry: () => void },
  { hasError: boolean }
> {
  state = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children
    }

    return (
      <div
        className="glass-strong mx-auto flex min-h-56 max-w-2xl flex-col items-start justify-center gap-4 rounded-lg border border-border/80 p-6"
        role="alert"
      >
        <div>
          <h2 className="text-lg font-semibold">页面模块暂时无法加载</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            网络恢复后可重新加载当前页面，已保存的研究状态不会受影响。
          </p>
        </div>
        <Button variant="outline" onClick={this.props.onRetry}>
          <RotateCcwIcon data-icon="inline-start" />
          重新加载
        </Button>
      </div>
    )
  }
}

function App() {
  const { theme, setTheme } = useTheme()
  const [restoredState] = useState(() => {
    const fallback = createInitialDemoState(defaultCompanyId, defaultCompareId)
    const restored = readDemoState(fallback)

    if (!detailRegistry[restored.companyId]) {
      return fallback
    }

    return {
      ...restored,
      compareCompanyId: resolveCompareCompanyId(
        restored.companyId,
        restored.compareCompanyId
      ),
    }
  })
  const [companyId, setCompanyId] = useState(restoredState.companyId)
  const [compareCompanyId, setCompareCompanyId] = useState(
    restoredState.compareCompanyId
  )
  const [activeView, setActiveView] = useState<TabValue>(
    restoredState.activeView
  )
  const [committedView, setCommittedView] = useState<TabValue>(
    restoredState.activeView
  )
  const navigationRequestRef = useRef(0)
  const navigationTargetRequestRef = useRef(0)
  const committedViewRef = useRef(restoredState.activeView)
  const companyIdRef = useRef(restoredState.companyId)
  const [researchSection, setResearchSection] = useState<ResearchSection>(
    restoredState.researchSection
  )
  const [operationsSection, setOperationsSection] = useState<OperationsSection>(
    restoredState.operationsSection
  )
  const [riskLens, setRiskLens] = useState<"all" | "priority" | "high">(
    restoredState.riskLens
  )
  const [timeRange, setTimeRange] = useState<"3m" | "6m">(
    restoredState.timeRange
  )
  const [statusMap, setStatusMap] = useState<Record<string, EventStatus>>(
    restoredState.statusMap
  )
  const [promotedEvents, setPromotedEvents] = useState<RiskEvent[]>(
    restoredState.promotedEvents
  )
  const [promotedSignalIds, setPromotedSignalIds] = useState<string[]>(
    restoredState.promotedSignalIds
  )
  const [lastUpdatedAt, setLastUpdatedAt] = useState(
    restoredState.lastUpdatedAt
  )
  const [focusedRealtimeSignalId, setFocusedRealtimeSignalId] = useState<
    string | null
  >(null)
  const [focusedEventId, setFocusedEventId] = useState<string | null>(null)
  const [methodOpen, setMethodOpen] = useState(false)
  const [exportDialogOpen, setExportDialogOpen] = useState(false)
  const methodTriggerRef = useRef<HTMLElement | null>(null)
  const exportTriggerRef = useRef<HTMLElement | null>(null)
  const [exportInProgress, setExportInProgress] = useState<ExportKind | null>(
    null
  )
  const exportInProgressRef = useRef<ExportKind | null>(null)
  const [feedback, setFeedback] = useState("")
  const [scoringCreateToken, setScoringCreateToken] = useState(0)
  const scoringCreateRequestRef = useRef(0)
  const [lazyTabs, setLazyTabs] = useState<LazyViewRegistry>(
    () => INITIAL_LAZY_TABS
  )
  const [viewLoadAttempt, setViewLoadAttempt] = useState(0)
  const {
    overview: OverviewTab,
    realtime: RealtimeTab,
    reports: ReportsTab,
    intelligence: IntelligenceTab,
    compare: CompareTab,
    events: EventsTab,
  } = lazyTabs
  const {
    workspace: scoringWorkspace,
    storageWarning: scoringStorageWarning,
    saveObservation,
    deleteObservation,
    setDefaultReviewer,
    resetWorkspace: resetScoringWorkspace,
  } = useScoringWorkspace(indicatorObservations)
  const {
    workspace: technologyWorkspace,
    storageWarning: technologyStorageWarning,
    upsertCompany: upsertTechnologyCompany,
    clearCompany: clearTechnologyCompany,
    resetWorkspace: resetTechnologyWorkspace,
  } = useTechnologyScoringWorkspace()
  const detail = useMemo(() => getCompanyDetail(companyId), [companyId])
  const runtimeAssessmentRegistry = useMemo(
    () =>
      buildAssessmentRegistry(
        scoringWorkspace.observations,
        scoringWorkspace.evidenceBindings,
        technologyWorkspace.companies
      ),
    [
      scoringWorkspace.evidenceBindings,
      scoringWorkspace.observations,
      technologyWorkspace.companies,
    ]
  )
  const runtimeCompanySummaries = useMemo(
    () => buildCompanySummaries(runtimeAssessmentRegistry),
    [runtimeAssessmentRegistry]
  )
  const assessment =
    runtimeAssessmentRegistry[companyId] ??
    runtimeAssessmentRegistry[defaultCompanyId]
  const industryAssessmentSummary = {
    label: "企业风险基准",
    scoreLabel: assessment.scoreLabel,
    methodVersion: INDUSTRY_RISK_MVP_METHOD_VERSION,
    overviewDescription: "汇总企业风险结论、同业位置、关键事件与可追溯证据",
  }
  const promotedSignalIdsForCompany = useMemo(
    () => getPromotedSignalIdsForCompany(promotedSignalIds, detail.id),
    [detail.id, promotedSignalIds]
  )
  const resolvedEvents = useMemo<RiskEvent[]>(
    () =>
      [
        ...detail.events,
        ...promotedEvents.filter((event) => event.companyId === detail.id),
      ].map((event) => ({
        ...event,
        riskType: getCanonicalRiskDimensionLabel(event.riskType),
        status: statusMap[event.id] ?? event.status,
      })),
    [detail.events, detail.id, promotedEvents, statusMap]
  )

  const demoStateSnapshot = useMemo<DemoState>(
    () => ({
      version: restoredState.version,
      companyId,
      compareCompanyId,
      activeView: committedView,
      researchSection,
      operationsSection,
      riskLens,
      timeRange,
      statusMap,
      promotedEvents,
      promotedSignalIds,
      lastUpdatedAt,
    }),
    [
      committedView,
      companyId,
      compareCompanyId,
      lastUpdatedAt,
      operationsSection,
      promotedEvents,
      promotedSignalIds,
      researchSection,
      restoredState.version,
      riskLens,
      statusMap,
      timeRange,
    ]
  )
  const latestDemoStateRef = useRef(demoStateSnapshot)

  const persistDemoStateSnapshot = useCallback(
    (snapshot: DemoState, reportFailure = true) => {
      const saved = saveDemoState(snapshot)
      if (!saved && reportFailure) {
        setFeedback("更新已在本页生效，但浏览器无法保存会话；刷新后可能丢失。")
      }
      return saved
    },
    []
  )

  const commitDemoState = useCallback(
    (patch: Partial<DemoState>) => {
      const nextSnapshot = {
        ...latestDemoStateRef.current,
        ...patch,
      }
      latestDemoStateRef.current = nextSnapshot
      return persistDemoStateSnapshot(nextSnapshot)
    },
    [persistDemoStateSnapshot]
  )

  useEffect(() => {
    latestDemoStateRef.current = demoStateSnapshot
    saveDemoState(demoStateSnapshot)
  }, [demoStateSnapshot])

  useEffect(() => {
    const persistLatestState = () => {
      persistDemoStateSnapshot(latestDemoStateRef.current, false)
    }

    window.addEventListener("pagehide", persistLatestState)
    return () => window.removeEventListener("pagehide", persistLatestState)
  }, [persistDemoStateSnapshot])

  useEffect(() => {
    if (!feedback) {
      return undefined
    }

    const timer = window.setTimeout(() => setFeedback(""), 4200)
    return () => window.clearTimeout(timer)
  }, [feedback])

  const prepareView = useCallback(async (view: TabValue) => {
    try {
      await loadViewComponent(view)
      return true
    } catch {
      setFeedback("页面模块加载失败，请检查网络后重试。")
      return false
    }
  }, [])

  const retryViewLoad = useCallback(() => {
    const view = activeView
    setLazyTabs((current) => ({
      ...current,
      [view]: createLazyViewComponent(view),
    }))
    setViewLoadAttempt((current) => current + 1)
    setFeedback("")
  }, [activeView])

  const scrollToPageTop = (behavior: ScrollBehavior = "auto") => {
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, left: 0, behavior })
    })
  }

  const handleCompanyChange = (value: string) => {
    if (value === companyId) {
      return
    }

    const nextCompareCompanyId = resolveCompareCompanyId(value)
    navigationRequestRef.current += 1
    navigationTargetRequestRef.current += 1
    companyIdRef.current = value
    setCompanyId(value)
    setCompareCompanyId(nextCompareCompanyId)
    setActiveView(committedViewRef.current)
    setFocusedRealtimeSignalId(null)
    setFocusedEventId(null)
    commitDemoState({
      companyId: value,
      compareCompanyId: nextCompareCompanyId,
    })
    scrollToPageTop()
  }

  const handleViewChange = async (view: TabValue) => {
    const requestId = navigationRequestRef.current + 1
    navigationRequestRef.current = requestId
    const previousView = committedViewRef.current
    scrollToPageTop(view === activeView ? "smooth" : "auto")
    setActiveView(view)
    const ready = await prepareView(view)
    if (requestId !== navigationRequestRef.current) {
      return false
    }

    if (!ready) {
      setActiveView(previousView)
      return false
    }

    committedViewRef.current = view
    setCommittedView(view)
    commitDemoState({ activeView: view })
    return true
  }

  const handleNavigationTarget = async (target: NavigationTarget) => {
    const requestId = navigationTargetRequestRef.current + 1
    navigationTargetRequestRef.current = requestId
    const previousResearchSection = researchSection
    const previousOperationsSection = operationsSection
    const researchSectionChanged =
      target.researchSection !== undefined &&
      target.researchSection !== researchSection
    const operationsSectionChanged =
      target.operationsSection !== undefined &&
      target.operationsSection !== operationsSection

    if (researchSectionChanged) {
      setResearchSection(target.researchSection!)
    }

    if (operationsSectionChanged) {
      setOperationsSection(target.operationsSection!)
    }

    const accepted = await handleViewChange(target.view)
    const requestIsCurrent = requestId === navigationTargetRequestRef.current

    if (!accepted || !requestIsCurrent) {
      if (requestIsCurrent) {
        if (researchSectionChanged) {
          setResearchSection(previousResearchSection)
        }
        if (operationsSectionChanged) {
          setOperationsSection(previousOperationsSection)
        }
      }
      return false
    }

    const patch: Partial<DemoState> = {}
    if (researchSectionChanged && target.researchSection) {
      patch.researchSection = target.researchSection
    }
    if (operationsSectionChanged && target.operationsSection) {
      patch.operationsSection = target.operationsSection
    }
    if (Object.keys(patch).length > 0) {
      commitDemoState(patch)
    }

    return true
  }

  const handleRealtimeSignalFocusHandled = useCallback(() => {
    setFocusedRealtimeSignalId(null)
  }, [])

  const handleEventFocusHandled = useCallback(() => {
    setFocusedEventId(null)
  }, [])

  const handleRealtimeCompanyChange = (
    nextCompanyId: string,
    signalId: string
  ) => {
    if (!detailRegistry[nextCompanyId]) {
      return
    }

    handleCompanyChange(nextCompanyId)
    setFocusedRealtimeSignalId(signalId)
    setFeedback(`已切换至 ${detailRegistry[nextCompanyId].name}，可继续核验。`)
  }

  const handleOpenEvent = async (eventId: string) => {
    setFocusedEventId(eventId)
    const accepted = await handleNavigationTarget({
      view: "events",
      operationsSection: "events",
    })
    if (!accepted) {
      setFocusedEventId(null)
    }
  }

  const handleResearchSectionChange = (section: ResearchSection) => {
    if (section === researchSection) {
      scrollToPageTop("smooth")
      return
    }

    setResearchSection(section)
    commitDemoState({ researchSection: section })
    scrollToPageTop()
  }

  const handleCreateObservation = async () => {
    const accepted = await handleNavigationTarget({
      view: "intelligence",
      researchSection: "metrics",
    })
    if (accepted) {
      scoringCreateRequestRef.current += 1
      setScoringCreateToken(scoringCreateRequestRef.current)
    }
  }

  const handleCreateObservationRequestHandled = useCallback(() => {
    setScoringCreateToken(0)
  }, [])

  const handleSaveObservation = useCallback(
    (
      observation: IndicatorObservation,
      evidenceBindings: EvidenceScoringBinding[]
    ) => {
      const saved = saveObservation(observation, evidenceBindings)
      setFeedback(
        saved
          ? observation.reviewStatus === "reviewed"
            ? "指标数据已更新，风险结论与对比结果已同步计算。"
            : "评分观测草稿已保存，不会进入当前评分。"
          : "评分修改已在当前页面生效，但浏览器无法写入本地存储。"
      )
      return saved
    },
    [saveObservation]
  )

  const handleDeleteObservation = useCallback(
    (observationId: string) => {
      const saved = deleteObservation(observationId)
      setFeedback(
        saved
          ? "评分观测及其证据绑定已删除。"
          : "删除已在当前页面生效，但浏览器无法写入本地存储。"
      )
      return saved
    },
    [deleteObservation]
  )

  const handleResetScoringWorkspace = useCallback(() => {
    const saved = resetScoringWorkspace()
    setFeedback(
      saved
        ? "已恢复经过审计的初始评分数据。"
        : "初始评分数据已在当前页面恢复，但浏览器无法写入本地存储。"
    )
    return saved
  }, [resetScoringWorkspace])

  const handleSaveTechnologyDraft = useCallback(
    (request: TechnologyRiskScoreRequest) => {
      const saved = upsertTechnologyCompany(companyId, {
        draftRequest: request,
        latestResult: null,
      })
      setFeedback(
        saved
          ? "技术风险草稿已保存；重新运行后端评分后才会更新研判。"
          : "技术风险草稿已在当前页面生效，但浏览器无法写入本地存储。"
      )
      return saved
    },
    [companyId, upsertTechnologyCompany]
  )

  const handleScoreTechnology = useCallback(
    async (request: TechnologyRiskScoreRequest) => {
      const result = await scoreTechnologyRisk(request)
      const saved = upsertTechnologyCompany(companyId, {
        draftRequest: request,
        latestResult: result,
      })
      setFeedback(
        result.status === "scored"
          ? saved
            ? `技术风险后端评分完成：${result.score} 分。`
            : `技术风险后端评分完成：${result.score} 分；浏览器未能持久保存结果。`
          : `技术风险评分覆盖权重为 ${result.coveredWeight}%，未达到 70% 的正式出分门槛。`
      )
      return result
    },
    [companyId, upsertTechnologyCompany]
  )

  const handleClearTechnologyScoring = useCallback(() => {
    const saved = clearTechnologyCompany(companyId)
    setFeedback(
      saved
        ? "已清除当前企业的技术风险草稿和自动评分结果。"
        : "技术风险数据已在当前页面清除，但浏览器无法写入本地存储。"
    )
    return saved
  }, [clearTechnologyCompany, companyId])

  const handleSaveTechnologyBaselineDraft = useCallback(
    (request: TechnologyBaselineQuantificationRequest) => {
      const saved = upsertTechnologyCompany(companyId, {
        baselineDraftRequest: request,
        latestBaselineResult: null,
      })
      setFeedback(
        saved
          ? "技术基础量化草稿已保存；运行量化后会生成可审计的原始结果。"
          : "技术基础量化草稿已在当前页面生效，但浏览器无法写入本地存储。"
      )
      return saved
    },
    [companyId, upsertTechnologyCompany]
  )

  const handleQuantifyTechnologyBaseline = useCallback(
    async (request: TechnologyBaselineQuantificationRequest) => {
      const result = await quantifyTechnologyBaseline(request)
      const saved = upsertTechnologyCompany(companyId, {
        baselineDraftRequest: request,
        latestBaselineResult: result,
      })
      const feedback = `技术量化已保存 ${result.quantifiedIndicatorCount}/6 项，专项校准 ${result.calibratedIndicatorCount}/8 项；专项阈值仅用于单项观测，本次不会更新技术风险分或雷达图。`
      setFeedback(saved ? feedback : `${feedback} 浏览器未能持久保存结果。`)
      return result
    },
    [companyId, upsertTechnologyCompany]
  )

  const handleClearTechnologyBaseline = useCallback(() => {
    const saved = upsertTechnologyCompany(companyId, {
      baselineDraftRequest: null,
      latestBaselineResult: null,
    })
    setFeedback(
      saved
        ? "已清除当前企业的技术基础量化数据。"
        : "技术基础量化数据已在当前页面清除，但浏览器无法写入本地存储。"
    )
    return saved
  }, [companyId, upsertTechnologyCompany])

  const handleOperationsSectionChange = (section: OperationsSection) => {
    if (section === operationsSection) {
      scrollToPageTop("smooth")
      return
    }

    setOperationsSection(section)
    commitDemoState({ operationsSection: section })
    scrollToPageTop()
  }

  const handleRiskLensChange = (value: "all" | "priority" | "high") => {
    setRiskLens(value)
    commitDemoState({ riskLens: value })
  }

  const handleTimeRangeChange = (value: "3m" | "6m") => {
    setTimeRange(value)
    commitDemoState({ timeRange: value })
  }

  const handleCompareCompanyChange = (value: string) => {
    const nextCompareCompanyId = resolveCompareCompanyId(
      companyIdRef.current,
      value
    )
    setCompareCompanyId(nextCompareCompanyId)
    commitDemoState({ compareCompanyId: nextCompareCompanyId })
  }

  const handlePromoteSignal = (signal: RealTimeSignal) => {
    if (
      !signal.companyIds.includes(detail.id) ||
      promotedSignalIdsForCompany.includes(signal.id)
    ) {
      return
    }

    const primaryRiskDimensionId = signal.riskDimensionIds[0] ?? null
    const evidenceIds = detail.evidence
      .filter((evidence) => evidence.sourceUrl === signal.sourceUrl)
      .map((evidence) => evidence.id)
    const promotedEvent: RiskEvent = {
      id: `snapshot-event-${detail.id}-${signal.id}`,
      companyId: detail.id,
      riskType: getCanonicalRiskDimensionLabel(
        primaryRiskDimensionId ?? "实时情报线索"
      ),
      severity: signal.severity,
      status: "pending",
      sourceType: `实时情报 · ${signal.sourceName}`,
      stage: detail.stage,
      description: signal.summary,
      evidenceIds,
      indicatorIds: signal.indicatorIds,
      sourceName: signal.sourceName,
      sourceUrl: signal.sourceUrl,
      sourcePublishedAt: signal.publishedAt,
      investmentImpact: signal.severity === "high" ? "high" : "medium",
      aiSummary: signal.aiInsight,
      recommendedAction: signal.recommendedAction,
      identifiedAt: signal.capturedAt.slice(0, 10),
    }
    const promotedSignalKey = createPromotedSignalKey(detail.id, signal.id)
    const nextPromotedEvents = [
      ...latestDemoStateRef.current.promotedEvents,
      promotedEvent,
    ]
    const nextPromotedSignalIds = [
      ...latestDemoStateRef.current.promotedSignalIds,
      promotedSignalKey,
    ]
    const nextLastUpdatedAt = new Date().toISOString()

    setPromotedEvents((current) => [...current, promotedEvent])
    setPromotedSignalIds((current) => [
      ...current,
      createPromotedSignalKey(detail.id, signal.id),
    ])
    setLastUpdatedAt(nextLastUpdatedAt)
    const saved = commitDemoState({
      promotedEvents: nextPromotedEvents,
      promotedSignalIds: nextPromotedSignalIds,
      lastUpdatedAt: nextLastUpdatedAt,
    })
    if (saved) {
      setFeedback("信息已转入当前企业的待核验事件。")
    }
  }

  const handleEventStatusChange = (eventId: string, status: EventStatus) => {
    const nextStatusMap = {
      ...latestDemoStateRef.current.statusMap,
      [eventId]: status,
    }
    const nextLastUpdatedAt = new Date().toISOString()
    setStatusMap(nextStatusMap)
    setLastUpdatedAt(nextLastUpdatedAt)
    const saved = commitDemoState({
      statusMap: nextStatusMap,
      lastUpdatedAt: nextLastUpdatedAt,
    })
    if (saved) {
      setFeedback("事件状态已更新，并保存到当前浏览器会话。")
    }
  }

  const handleResetDemo = () => {
    const initialState = createInitialDemoState(
      defaultCompanyId,
      defaultCompareId
    )
    navigationRequestRef.current += 1
    navigationTargetRequestRef.current += 1
    committedViewRef.current = initialState.activeView
    companyIdRef.current = initialState.companyId
    setCompanyId(initialState.companyId)
    setCompareCompanyId(initialState.compareCompanyId)
    setActiveView(initialState.activeView)
    setCommittedView(initialState.activeView)
    setResearchSection(initialState.researchSection)
    setOperationsSection(initialState.operationsSection)
    setRiskLens(initialState.riskLens)
    setTimeRange(initialState.timeRange)
    setStatusMap(initialState.statusMap)
    setPromotedEvents(initialState.promotedEvents)
    setPromotedSignalIds(initialState.promotedSignalIds)
    setFocusedRealtimeSignalId(null)
    setFocusedEventId(null)
    setLastUpdatedAt(initialState.lastUpdatedAt)
    const demoSaved = commitDemoState(initialState)
    const scoringSaved = resetScoringWorkspace()
    const technologyScoringSaved = resetTechnologyWorkspace()
    if (demoSaved && scoringSaved && technologyScoringSaved) {
      setFeedback("已恢复初始企业、筛选条件、事件状态与评分数据。")
    } else if (!scoringSaved || !technologyScoringSaved) {
      setFeedback("初始状态已在当前页面恢复，但部分评分数据无法写入本地存储。")
    }
    scrollToPageTop("smooth")
  }

  const runExport = async (kind: ExportKind) => {
    if (exportInProgressRef.current !== null) {
      return
    }

    exportInProgressRef.current = kind
    setExportInProgress(kind)
    try {
      const reportExport = await loadReportExport()
      if (kind === "pdf") {
        await reportExport.printRiskSummary(
          detail,
          assessment,
          resolvedEvents,
          manifest,
          realtimeData.snapshotAt,
          scoringWorkspace.evidenceBindings
        )
      } else if (kind === "csv") {
        await reportExport.exportEventsCsv(
          detail,
          assessment,
          resolvedEvents,
          manifest,
          realtimeData.snapshotAt,
          scoringWorkspace.evidenceBindings
        )
      } else {
        await reportExport.exportRiskSummaryPng(
          detail,
          assessment,
          resolvedEvents,
          manifest,
          realtimeData.snapshotAt,
          scoringWorkspace.evidenceBindings
        )
      }
    } catch {
      setFeedback("导出失败：模块加载或文件生成未完成，请稍后重试。")
    } finally {
      exportInProgressRef.current = null
      setExportInProgress(null)
    }
  }

  const handleOpenExports = () => {
    exportTriggerRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
    setExportDialogOpen(true)
    void loadReportExport().catch(() => {
      setFeedback("导出模块预加载失败，点击导出时将自动重试。")
    })
  }

  const handleOpenMethod = () => {
    methodTriggerRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
    setMethodOpen(true)
  }

  return (
    <AppShell
      activeView={activeView}
      researchSection={researchSection}
      operationsSection={operationsSection}
      companyId={companyId}
      detail={detail}
      assessment={assessment}
      assessmentSummaryOverride={
        activeView === "overview" || activeView === "reports"
          ? industryAssessmentSummary
          : undefined
      }
      companySummaries={runtimeCompanySummaries}
      theme={theme}
      onCompanyChange={handleCompanyChange}
      onNavigate={handleNavigationTarget}
      onPreloadView={preloadView}
      onOpenExports={handleOpenExports}
      showExports={activeView === "reports"}
      onResetDemo={handleResetDemo}
      onToggleTheme={() => setTheme(theme === "dark" ? "light" : "dark")}
      feedback={feedback}
      signals={realtimeSignals}
    >
      <div className="content-stack">
        <ViewLoadErrorBoundary
          key={`${activeView}:${viewLoadAttempt}`}
          onRetry={retryViewLoad}
        >
          <Suspense fallback={<TabSkeleton />}>
            <WorkflowTransition key={activeView} view={activeView}>
              {activeView === "overview" ? (
                <OverviewTab
                  detail={detail}
                  assessment={assessment}
                  events={resolvedEvents}
                  timeRange={timeRange}
                  riskLens={riskLens}
                  onNavigate={(view) => {
                    void handleNavigationTarget(
                      view === "intelligence"
                        ? { view, researchSection: "metrics" }
                        : { view, operationsSection: "events" }
                    )
                  }}
                  onRiskLensChange={handleRiskLensChange}
                  onTimeRangeChange={handleTimeRangeChange}
                  onOpenMethod={handleOpenMethod}
                  onOpenEvent={handleOpenEvent}
                  onCreateObservation={handleCreateObservation}
                />
              ) : null}
              {activeView === "realtime" ? (
                <RealtimeTab
                  detail={detail}
                  data={realtimeData}
                  focusSignalId={focusedRealtimeSignalId}
                  promotedSignalIds={promotedSignalIdsForCompany}
                  onFocusSignalHandled={handleRealtimeSignalFocusHandled}
                  onCompanyChange={handleRealtimeCompanyChange}
                  onPromote={handlePromoteSignal}
                />
              ) : null}
              {activeView === "reports" ? (
                <ReportsTab
                  companyId={companyId}
                  detail={detail}
                  onOpenExports={handleOpenExports}
                  onNavigate={(target) => {
                    void handleNavigationTarget(target)
                  }}
                />
              ) : null}
              {activeView === "intelligence" ? (
                <IntelligenceTab
                  detail={detail}
                  intelligence={getCompanyIntelligence(detail.id)}
                  section={researchSection}
                  onSectionChange={handleResearchSectionChange}
                  assessment={assessment}
                  observations={scoringWorkspace.observations}
                  evidenceBindings={scoringWorkspace.evidenceBindings}
                  defaultReviewer={scoringWorkspace.defaultReviewer}
                  storageWarning={scoringStorageWarning}
                  technologyCompanyState={
                    technologyWorkspace.companies[detail.id]
                  }
                  technologyStorageWarning={technologyStorageWarning}
                  createToken={scoringCreateToken}
                  onCreateRequestHandled={handleCreateObservationRequestHandled}
                  onSaveTechnologyDraft={handleSaveTechnologyDraft}
                  onScoreTechnology={handleScoreTechnology}
                  onClearTechnology={handleClearTechnologyScoring}
                  onSaveTechnologyBaselineDraft={
                    handleSaveTechnologyBaselineDraft
                  }
                  onQuantifyTechnologyBaseline={
                    handleQuantifyTechnologyBaseline
                  }
                  onClearTechnologyBaseline={handleClearTechnologyBaseline}
                  onSaveObservation={handleSaveObservation}
                  onDeleteObservation={handleDeleteObservation}
                  onSetDefaultReviewer={setDefaultReviewer}
                  onResetScoring={handleResetScoringWorkspace}
                />
              ) : null}
              {activeView === "compare" ? (
                <CompareTab
                  companyId={companyId}
                  compareCompanyId={compareCompanyId}
                  onCompareCompanyIdChange={handleCompareCompanyChange}
                  summaries={runtimeCompanySummaries}
                  assessments={runtimeAssessmentRegistry}
                />
              ) : null}
              {activeView === "events" ? (
                <EventsTab
                  detail={detail}
                  events={resolvedEvents}
                  section={operationsSection}
                  focusEventId={focusedEventId}
                  onSectionChange={handleOperationsSectionChange}
                  onFocusEventHandled={handleEventFocusHandled}
                  playbook={commonPlaybook}
                  onStatusChange={handleEventStatusChange}
                />
              ) : null}
            </WorkflowTransition>
          </Suspense>
        </ViewLoadErrorBoundary>

        <footer className="app-footer">
          基于公开信息与统一风险规则自动计算，用于投资风险识别、同业比较与证据核验。
        </footer>
      </div>

      <MethodSheet
        open={methodOpen}
        onOpenChange={setMethodOpen}
        detail={detail}
        onReset={handleResetDemo}
        returnFocusRef={methodTriggerRef}
      />

      <Dialog open={exportDialogOpen} onOpenChange={setExportDialogOpen}>
        <DialogContent
          className="glass-strong sm:max-w-lg"
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            const trigger = exportTriggerRef.current
            if (trigger?.isConnected) {
              trigger.focus({ preventScroll: true })
            }
          }}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl">
              <DownloadIcon aria-hidden="true" />
              导出 {detail.name} 风险材料
            </DialogTitle>
            <DialogDescription>
              导出文件包含方法版本、评分证据覆盖率、研判截止日期、公开情报更新时间和研究边界声明。
            </DialogDescription>
          </DialogHeader>
          <div className="export-action-list">
            <>
              <ExportAction
                title="企业风险摘要 PDF"
                description="打开系统打印面板，可直接另存为 PDF。"
                disabled={exportInProgress !== null}
                pending={exportInProgress === "pdf"}
                onClick={() => runExport("pdf")}
              />
              <ExportAction
                title="风险事件 CSV"
                description="导出风险事件、证据口径、方法版本和来源定位。"
                disabled={exportInProgress !== null}
                pending={exportInProgress === "csv"}
                onClick={() => runExport("csv")}
              />
              <ExportAction
                title="风险概览 PNG"
                description="生成 1600 × 900 风险概览图片。"
                disabled={exportInProgress !== null}
                pending={exportInProgress === "png"}
                onClick={() => runExport("png")}
              />
            </>
          </div>
        </DialogContent>
      </Dialog>
    </AppShell>
  )
}

function MethodSheet({
  open,
  onOpenChange,
  detail,
  onReset,
  returnFocusRef,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  detail: ReturnType<typeof getCompanyDetail>
  onReset: () => void
  returnFocusRef: RefObject<HTMLElement | null>
}) {
  const evidenceSummary = summarizeEvidenceGovernance(detail.evidence)
  const [activeMethodTab, setActiveMethodTab] = useState("workflow")
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)

  const handleMethodTabChange = (value: string) => {
    setActiveMethodTab(value)
    window.requestAnimationFrame(() => {
      scrollContainerRef.current?.scrollTo({
        top: 0,
        left: 0,
        behavior: "auto",
      })
    })
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        className="method-sheet method-sheet--method sm:max-w-3xl"
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          const trigger = returnFocusRef.current
          if (trigger?.isConnected) {
            trigger.focus({ preventScroll: true })
          }
        }}
      >
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <BookOpenCheckIcon aria-hidden="true" />
            方法与模型
          </SheetTitle>
          <SheetDescription>
            统一查看结构化辅助研判流程、6 类一级风险、17 组二级口径、43
            项具名三级指标、证据规则和使用边界。
          </SheetDescription>
        </SheetHeader>
        <Tabs
          value={activeMethodTab}
          onValueChange={handleMethodTabChange}
          className="method-tabs"
        >
          <TabsList aria-label="方法与模型内容">
            <TabsTrigger value="workflow">辅助研判流程</TabsTrigger>
            <TabsTrigger value="indicators">指标库</TabsTrigger>
            <TabsTrigger value="evidence">证据治理</TabsTrigger>
            <TabsTrigger value="boundary">模型边界</TabsTrigger>
          </TabsList>

          <div ref={scrollContainerRef} className="sheet-scroll-content">
            <TabsContent value="workflow">
              <div className="method-flow-list">
                <MethodFlow
                  index="01"
                  icon={DatabaseZapIcon}
                  title="来源登记与留痕"
                  content="登记公开来源、发布时间、快照记录时间与版本信息，保留原始链接和可回溯位置。"
                />
                <MethodFlow
                  index="02"
                  icon={BrainCircuitIcon}
                  title="事实整理与映射"
                  content="基于已收集的披露、论文和技术材料，由规则与专家辅助整理事实、事件和主体关系，并映射到新版指标。"
                />
                <MethodFlow
                  index="03"
                  icon={ScaleIcon}
                  title="自动计算与排序"
                  content="系统使用当前可用的 R05–R22 客观指标、同业风险分位和两级 CRITIC 权重形成企业风险指数与主要风险；财报叙事按三个独立维度建约，待语料接入后评估，新闻不参与评分。"
                />
                <MethodFlow
                  index="04"
                  icon={WorkflowIcon}
                  title="建议生成与持续更新"
                  content="高影响指标自动触发对应的风险应对规则；指标、事件或正式披露变化后，系统同步更新结论和建议。"
                />
              </div>
              <section className="method-detail-section">
                <h3>当前企业资料覆盖范围</h3>
                <div className="tag-list">
                  {detail.aiCoverage.ingestedSourceTypes.map((item) => (
                    <Badge key={item} variant="outline">
                      {item}
                    </Badge>
                  ))}
                </div>
              </section>
            </TabsContent>

            <TabsContent value="indicators">
              <div className="method-stat-grid">
                <DataNote
                  label="一级风险"
                  value={`${indicatorTaxonomy.primaryCount} 类`}
                />
                <DataNote
                  label="二级风险"
                  value={`${indicatorTaxonomy.secondaryCount} 类`}
                />
                <DataNote
                  label="具名三级指标"
                  value={`${indicatorTaxonomy.tertiaryCount} 条`}
                />
              </div>
              <div className="admission-summary">
                {(
                  Object.entries(indicatorTaxonomy.admissionCounts) as Array<
                    [IndicatorAdmissionStatus, number]
                  >
                ).map(([status, count]) => (
                  <Badge
                    key={status}
                    variant="outline"
                    className={cn("status-badge", `admission-${status}`)}
                  >
                    {admissionLabels[status]} {count}
                  </Badge>
                ))}
              </div>
              <section className="method-detail-section">
                <h3>指标准入规则</h3>
                <p>
                  {indicatorTaxonomy.admissionGovernance.basis} 决策版本{" "}
                  {indicatorTaxonomy.admissionGovernance.decisionVersion}
                  ，数据日期{" "}
                  {indicatorTaxonomy.admissionGovernance.decisionDate}
                  ，数据维护角色为
                  {indicatorTaxonomy.admissionGovernance.reviewerRole}。
                </p>
              </section>
              <div className="method-indicator-groups">
                {indicatorTaxonomy.groups.map((group) => (
                  <section key={group.primary}>
                    <div className="method-indicator-heading">
                      <div>
                        <span>
                          {group.secondaryCount} 个二级 / {group.tertiaryCount}{" "}
                          条具名三级指标
                        </span>
                        <h3>{group.primary}</h3>
                      </div>
                    </div>
                    <div className="method-indicator-list">
                      {riskIndicators
                        .filter(
                          (indicator) => indicator.primaryRisk === group.primary
                        )
                        .map((indicator) => (
                          <article key={indicator.id}>
                            <div>
                              <span>{indicator.secondaryRisk}</span>
                              <h4>{indicator.tertiaryRisk}</h4>
                            </div>
                            <Badge
                              variant="outline"
                              className={cn(
                                "status-badge",
                                `admission-${indicator.admissionStatus}`
                              )}
                            >
                              {admissionLabels[indicator.admissionStatus]}
                            </Badge>
                            <p>{indicator.definition}</p>
                            <dl>
                              <div>
                                <dt>阈值</dt>
                                <dd>{indicator.threshold}</dd>
                              </div>
                              <div>
                                <dt>来源</dt>
                                <dd>{indicator.dataSource}</dd>
                              </div>
                            </dl>
                          </article>
                        ))}
                    </div>
                  </section>
                ))}
              </div>
            </TabsContent>

            <TabsContent value="evidence">
              <div className="method-stat-grid">
                <DataNote
                  label="证据记录"
                  value={`${evidenceSummary.evidenceRecordCount} 条`}
                />
                <DataNote
                  label="唯一来源 URL"
                  value={`${evidenceSummary.uniqueSourceUrlCount} 个`}
                />
                <DataNote
                  label="有效来源覆盖"
                  value={`${evidenceSummary.coverage}%`}
                />
              </div>
              <div className="method-rule-list">
                <MethodRule
                  title="直接披露"
                  status="可支撑研判"
                  content="企业公告、交易所披露、监管文件、论文原文等可直接验证的事实记录。"
                />
                <MethodRule
                  title="推导支持"
                  status="须展示推导链"
                  content="只有明确写出推导依据时才计入覆盖率，界面使用辅助判断语气。"
                />
                <MethodRule
                  title="背景材料"
                  status="不进入评分"
                  content="官网首页、产品介绍等仅提供上下文，不能独立支撑风险结论。"
                />
                <MethodRule
                  title="待授权候选来源"
                  status="不进入评分"
                  content="Wind、天眼查、企查查、智慧芽等未授权数据只在方法库标记为候选。"
                />
              </div>
              <section className="method-detail-section">
                <h3>来源治理检查</h3>
                <p>
                  当前指标库中有{" "}
                  {
                    riskIndicators.filter((indicator) =>
                      isCandidateDataSource(indicator.dataSource)
                    ).length
                  }{" "}
                  项依赖待授权候选来源；重复 URL 可以复用，但来源统计只计一次。
                </p>
              </section>
            </TabsContent>

            <TabsContent value="boundary">
              <div className="method-boundary-stack">
                <MethodBoundary
                  icon={ShieldCheckIcon}
                  title="指数由统一规则自动计算"
                  content="系统根据当前可用指标、同业风险分位和 CRITIC 权重形成风险指数；缺失指标不补零，也不阻断其他指标计算。"
                />
                <MethodBoundary
                  icon={ScaleIcon}
                  title="数据覆盖不阻断系统结论"
                  content="系统使用全部现有有效指标形成结果，并同时展示实际纳入指标数量；只有完全没有可计算数据时才不输出分值。"
                />
                <MethodBoundary
                  icon={FileStackIcon}
                  title="公开快照不等于实时监测"
                  content={`当前数据截止 ${manifest.snapshotAt}，不承诺浏览器实时抓源；方法版本为 ${indicatorTaxonomy.methodVersion}。`}
                />
                <MethodBoundary
                  icon={BrainCircuitIcon}
                  title="系统建议聚焦风险应对"
                  content="系统自动输出尽调、治理和持续跟踪建议，不输出买入、卖出、估值或收益预测。"
                />
              </div>
              <div className="method-disclaimer">{manifest.disclaimer}</div>
            </TabsContent>
          </div>
        </Tabs>
        <div className="sheet-action-bar">
          <span>数据更新至 {manifest.snapshotAt}</span>
          <Button variant="outline" onClick={onReset}>
            <RotateCcwIcon data-icon="inline-start" />
            恢复初始状态
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}

function ExportAction({
  title,
  description,
  onClick,
  disabled,
  pending,
}: {
  title: string
  description: string
  onClick: () => void | Promise<void>
  disabled: boolean
  pending: boolean
}) {
  return (
    <button
      type="button"
      className="export-action"
      disabled={disabled}
      aria-busy={pending}
      onClick={() => void onClick()}
    >
      <span>
        <strong>{title}</strong>
        <small>{pending ? "正在生成，请稍候…" : description}</small>
      </span>
      <DownloadIcon aria-hidden="true" />
    </button>
  )
}

function TabSkeleton() {
  return (
    <div className="tab-skeleton" role="status" aria-label="页面加载中">
      <div className="tab-skeleton-panel">
        <div className="tab-skeleton-heading">
          <div className="tab-skeleton-line tab-skeleton-line-primary" />
          <div className="tab-skeleton-line tab-skeleton-line-secondary" />
        </div>
        <div className="tab-skeleton-metrics" aria-hidden="true">
          {Array.from({ length: 3 }, (_, index) => (
            <div className="tab-skeleton-metric" key={index}>
              <span />
              <strong />
            </div>
          ))}
        </div>
      </div>
      <div className="tab-skeleton-list">
        {Array.from({ length: 4 }, (_, index) => (
          <div className="tab-skeleton-row" key={index} aria-hidden="true">
            <span className="tab-skeleton-dot" />
            <div className="tab-skeleton-copy">
              <span />
              <span />
            </div>
            <span className="tab-skeleton-chip" />
          </div>
        ))}
      </div>
    </div>
  )
}

function DataNote({ label, value }: { label: string; value: string }) {
  return (
    <div className="method-stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function MethodFlow({
  index,
  icon: Icon,
  title,
  content,
}: {
  index: string
  icon: typeof WorkflowIcon
  title: string
  content: string
}) {
  return (
    <article>
      <span>{index}</span>
      <Icon aria-hidden="true" />
      <div>
        <h3>{title}</h3>
        <p>{content}</p>
      </div>
    </article>
  )
}

function MethodRule({
  title,
  status,
  content,
}: {
  title: string
  status: string
  content: string
}) {
  return (
    <article>
      <div>
        <h3>{title}</h3>
        <Badge variant="outline">{status}</Badge>
      </div>
      <p>{content}</p>
    </article>
  )
}

function MethodBoundary({
  icon: Icon,
  title,
  content,
}: {
  icon: typeof ShieldCheckIcon
  title: string
  content: string
}) {
  return (
    <article>
      <Icon aria-hidden="true" />
      <div>
        <h3>{title}</h3>
        <p>{content}</p>
      </div>
    </article>
  )
}

export default App
