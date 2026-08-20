import {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import {
  ArrowUpRightIcon,
  CircleHelpIcon,
  ExternalLinkIcon,
  FileSearchIcon,
  FilterIcon,
  HistoryIcon,
  ListChecksIcon,
  SearchIcon,
  ShieldCheckIcon,
  SparklesIcon,
} from "lucide-react"

import {
  EmptyState,
  GlassPanel,
  SeverityBadge,
} from "@/components/dashboard/shared"
import { Reveal } from "@/components/motion/workflow-transition"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { getCompanyName, getCustomerVisibleIndicators } from "@/lib/data-r01"
import { formatSourceDateTime, formatSourceListTime } from "@/lib/date-format"
import { getCanonicalRiskDimensionLabels } from "@/lib/risk-dimensions"
import { cn } from "@/lib/utils"
import type {
  CompanyDetail,
  RealTimeDataSet,
  RealTimeSignal,
  RealTimeSignalCategory,
  SignalVerificationStatus,
} from "@/types/risk"

type RealtimeTabProps = {
  detail: CompanyDetail
  data: RealTimeDataSet
  focusSignalId: string | null
  promotedSignalIds: string[]
  onFocusSignalHandled: () => void
  onCompanyChange: (companyId: string, signalId: string) => void
  onPromote: (signal: RealTimeSignal) => void
}

const verificationLabels: Record<SignalVerificationStatus, string> = {
  pending: "待核验",
  monitoring: "持续观察",
  verified: "已核验",
}

const dateHeadingFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "long",
  day: "numeric",
  weekday: "short",
})

const PAGE_SIZE = 18

const sourceReliabilityLabels: Record<
  NonNullable<RealTimeSignal["sourceReliability"]>,
  string
> = {
  official: "企业或机构官方",
  exchange: "交易所公告",
  filing: "法定披露",
  paper: "原始论文",
  media: "媒体报道",
}

export function RealtimeTab({
  detail,
  data,
  focusSignalId,
  promotedSignalIds,
  onFocusSignalHandled,
  onCompanyChange,
  onPromote,
}: RealtimeTabProps) {
  const [selectedSignalId, setSelectedSignalId] = useState<string | null>(null)
  const [scope, setScope] = useState<"current" | "all">("current")
  const [category, setCategory] = useState<"all" | RealTimeSignalCategory>(
    "all"
  )
  const [verification, setVerification] = useState<
    "all" | SignalVerificationStatus
  >("all")
  const [timeScope, setTimeScope] = useState<"all" | "current" | "history">(
    "all"
  )
  const [query, setQuery] = useState("")
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const deferredQuery = useDeferredValue(query)
  const previousCompanyIdRef = useRef(detail.id)
  const signalTriggerRef = useRef<HTMLButtonElement | null>(null)
  const snapshotYear = data.snapshotAt.slice(0, 4)
  const snapshotYearStart = `${snapshotYear}-01-01`

  useEffect(() => {
    if (previousCompanyIdRef.current === detail.id) {
      return
    }

    previousCompanyIdRef.current = detail.id
    setSelectedSignalId(null)
    setVisibleCount(PAGE_SIZE)
    const focusedSignal = focusSignalId
      ? data.signals.find((signal) => signal.id === focusSignalId)
      : null
    if (!focusedSignal?.companyIds.includes(detail.id)) {
      onFocusSignalHandled()
    }
  }, [data.signals, detail.id, focusSignalId, onFocusSignalHandled])

  useEffect(() => {
    if (focusSignalId) {
      signalTriggerRef.current = null
    }
  }, [focusSignalId])

  const activeSignalId = focusSignalId ?? selectedSignalId
  const selectedSignal =
    data.signals.find((item) => item.id === activeSignalId) ?? null

  const filteredSignals = useMemo(() => {
    const normalizedQuery = deferredQuery.trim().toLocaleLowerCase("zh-CN")

    return data.signals
      .filter(
        (signal) => scope === "all" || signal.companyIds.includes(detail.id)
      )
      .filter((signal) => category === "all" || signal.category === category)
      .filter(
        (signal) =>
          verification === "all" || signal.verificationStatus === verification
      )
      .filter(
        (signal) =>
          timeScope === "all" ||
          (timeScope === "current"
            ? signal.publishedAt.startsWith(`${snapshotYear}-`)
            : signal.publishedAt < snapshotYearStart)
      )
      .filter((signal) => {
        if (!normalizedQuery) {
          return true
        }

        return [
          signal.title,
          signal.summary,
          signal.historicalContext,
          signal.sourceName,
          signal.sourceLocator,
          ...signal.keyFacts,
          ...signal.researchQuestions,
          ...signal.companyIds.map(getCompanyName),
        ]
          .join(" ")
          .toLocaleLowerCase("zh-CN")
          .includes(normalizedQuery)
      })
      .sort((left, right) => right.publishedAt.localeCompare(left.publishedAt))
  }, [
    category,
    data.signals,
    deferredQuery,
    detail.id,
    scope,
    snapshotYear,
    snapshotYearStart,
    timeScope,
    verification,
  ])

  const groupedSignals = useMemo(
    () => groupSignalsByDate(filteredSignals.slice(0, visibleCount)),
    [filteredSignals, visibleCount]
  )
  const categories = useMemo(
    () => [...new Set(data.signals.map((signal) => signal.category))],
    [data.signals]
  )
  const visibleSignalCount = Math.min(visibleCount, filteredSignals.length)
  const selectedIndicatorNames = selectedSignal
    ? getCustomerVisibleIndicators(selectedSignal.indicatorIds).map(
        (indicator) => indicator.tertiaryRisk
      )
    : []
  const switchableCompanyId =
    selectedSignal?.companyIds.find((companyId) => companyId !== detail.id) ??
    null

  return (
    <div className="page-stack">
      <Reveal className="feed-controls-stack">
        <GlassPanel
          className="feed-toolbar"
          surfaceClassName="filter-toolbar-glass"
          variant="floating"
          aria-label="实时情报筛选"
        >
          <div className="feed-search">
            <SearchIcon aria-hidden="true" />
            <Input
              type="search"
              name="realtime-intelligence-search"
              autoComplete="off"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                setVisibleCount(PAGE_SIZE)
              }}
              placeholder="搜索标题、关键事实、论文、专利、诉讼或来源…"
              aria-label="搜索实时情报"
            />
          </div>
          <div className="feed-filters">
            <FilterIcon aria-hidden="true" />
            <Select
              value={scope}
              onValueChange={(value) => {
                setScope(value as "current" | "all")
                setVisibleCount(PAGE_SIZE)
              }}
            >
              <SelectTrigger aria-label="企业范围">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="current">当前企业</SelectItem>
                  <SelectItem value="all">全部企业</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
            <Select
              value={category}
              onValueChange={(value) => {
                setCategory(value as "all" | RealTimeSignalCategory)
                setVisibleCount(PAGE_SIZE)
              }}
            >
              <SelectTrigger aria-label="信息类别">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="all">全部类别</SelectItem>
                  {categories.map((item) => (
                    <SelectItem key={item} value={item}>
                      {item}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <Select
              value={timeScope}
              onValueChange={(value) => {
                setTimeScope(value as "all" | "current" | "history")
                setVisibleCount(PAGE_SIZE)
              }}
            >
              <SelectTrigger aria-label="时间范围">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="all">全部时间</SelectItem>
                  <SelectItem value="current">{snapshotYear} 年</SelectItem>
                  <SelectItem value="history">历史资料</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
            <Select
              value={verification}
              onValueChange={(value) => {
                setVerification(value as "all" | SignalVerificationStatus)
                setVisibleCount(PAGE_SIZE)
              }}
            >
              <SelectTrigger aria-label="核验状态">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="all">全部状态</SelectItem>
                  <SelectItem value="pending">待核验</SelectItem>
                  <SelectItem value="monitoring">持续观察</SelectItem>
                  <SelectItem value="verified">已核验</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
        </GlassPanel>

        <div className="feed-summary">
          <div className="feed-summary-primary">
            <span>实时情报流</span>
            <strong>{filteredSignals.length} 条</strong>
          </div>
          <time dateTime={data.snapshotAt}>
            公开情报更新至 {formatSourceDateTime(data.snapshotAt)}
          </time>
          <span className="feed-summary-note">{data.note}</span>
        </div>
      </Reveal>

      {groupedSignals.length > 0 ? (
        <div className="signal-date-groups">
          {groupedSignals.map(([date, signals]) => (
            <Reveal key={date}>
              <section className="signal-date-group">
                <div className="signal-date-heading">
                  <time dateTime={date}>{formatDateHeading(date)}</time>
                  <span>{signals.length} 条信息</span>
                </div>
                <div className="signal-feed">
                  {signals.map((signal) => (
                    <SignalRow
                      key={signal.id}
                      signal={signal}
                      promoted={promotedSignalIds.includes(signal.id)}
                      onOpen={(trigger) => {
                        signalTriggerRef.current = trigger
                        setSelectedSignalId(signal.id)
                      }}
                    />
                  ))}
                </div>
              </section>
            </Reveal>
          ))}
        </div>
      ) : (
        <Reveal>
          <EmptyState
            title="没有匹配的公开信息"
            description="调整企业范围、时间、类别、核验状态或搜索词后再试。"
          />
        </Reveal>
      )}

      {visibleSignalCount < filteredSignals.length ? (
        <Reveal className="signal-load-more">
          <Button
            variant="outline"
            onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
          >
            继续加载{" "}
            {Math.min(PAGE_SIZE, filteredSignals.length - visibleSignalCount)}{" "}
            条
          </Button>
          <span>
            已显示 {visibleSignalCount}/{filteredSignals.length}
          </span>
        </Reveal>
      ) : null}

      <Sheet
        open={Boolean(selectedSignal)}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedSignalId(null)
            onFocusSignalHandled()
          }
        }}
      >
        <SheetContent
          size="signal"
          className="method-sheet method-sheet--signal"
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            const trigger = signalTriggerRef.current
            if (trigger?.isConnected) {
              trigger.focus({ preventScroll: true })
              return
            }

            document
              .getElementById("main-content")
              ?.focus({ preventScroll: true })
          }}
        >
          {selectedSignal ? (
            <>
              <SheetHeader>
                <div className="signal-drawer-badges">
                  <SeverityBadge severity={selectedSignal.severity} />
                  <VerificationBadge
                    status={selectedSignal.verificationStatus}
                  />
                  <Badge variant="outline">{selectedSignal.category}</Badge>
                </div>
                <SheetTitle>{selectedSignal.title}</SheetTitle>
                <SheetDescription>
                  {formatSourceDateTime(selectedSignal.publishedAt)} ·{" "}
                  {selectedSignal.sourceName}
                </SheetDescription>
              </SheetHeader>
              <div className="sheet-scroll-content">
                <DrawerSection title="信息摘要">
                  <p>{selectedSignal.summary}</p>
                </DrawerSection>
                <DrawerSection title="关键事实" icon={ListChecksIcon}>
                  <ul className="signal-key-facts">
                    {selectedSignal.keyFacts.map((fact) => (
                      <li key={fact}>{fact}</li>
                    ))}
                  </ul>
                </DrawerSection>
                <DrawerSection title="历史与口径背景" icon={HistoryIcon}>
                  <p>{selectedSignal.historicalContext}</p>
                </DrawerSection>
                <DrawerSection title="研究辅助分析" icon={SparklesIcon}>
                  <p>{selectedSignal.aiInsight}</p>
                  <div className="drawer-note">
                    <strong>潜在影响</strong>
                    <span>{selectedSignal.potentialImpact}</span>
                  </div>
                </DrawerSection>
                <DrawerSection title="建议核验动作" icon={ShieldCheckIcon}>
                  <p>{selectedSignal.recommendedAction}</p>
                </DrawerSection>
                <DrawerSection title="待回答的研究问题" icon={CircleHelpIcon}>
                  <ol className="signal-research-questions">
                    {selectedSignal.researchQuestions.map((question) => (
                      <li key={question}>{question}</li>
                    ))}
                  </ol>
                </DrawerSection>
                <DrawerSection title="证据与关联" icon={FileSearchIcon}>
                  <dl className="signal-detail-list">
                    <div>
                      <dt>企业</dt>
                      <dd>
                        {selectedSignal.companyIds
                          .map(getCompanyName)
                          .join("、")}
                      </dd>
                    </div>
                    <div>
                      <dt>来源类型</dt>
                      <dd>
                        {selectedSignal.sourceReliability
                          ? sourceReliabilityLabels[
                              selectedSignal.sourceReliability
                            ]
                          : "来源类型未标注"}
                      </dd>
                    </div>
                    <div>
                      <dt>原文定位</dt>
                      <dd>{selectedSignal.sourceLocator}</dd>
                    </div>
                    <div>
                      <dt>风险维度</dt>
                      <dd>
                        {getCanonicalRiskDimensionLabels(
                          selectedSignal.riskDimensionIds
                        ).join("、")}
                      </dd>
                    </div>
                    <div>
                      <dt>关联指标</dt>
                      <dd>
                        {selectedIndicatorNames.length > 0
                          ? selectedIndicatorNames.join("、")
                          : "仅作情报观察，未建立正式指标关联"}
                      </dd>
                    </div>
                    <div>
                      <dt>可访问来源</dt>
                      <dd>{selectedSignal.sourceCount} 条</dd>
                    </div>
                    <div>
                      <dt>快照记录时间</dt>
                      <dd>{formatSourceDateTime(selectedSignal.capturedAt)}</dd>
                    </div>
                  </dl>
                  <Button variant="outline" asChild>
                    <a
                      href={selectedSignal.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      打开原始披露
                      <ExternalLinkIcon data-icon="inline-end" />
                    </a>
                  </Button>
                </DrawerSection>
              </div>
              <div className="sheet-action-bar">
                {promotedSignalIds.includes(selectedSignal.id) ? (
                  <Button disabled>
                    <ArrowUpRightIcon data-icon="inline-start" />
                    已转为事件
                  </Button>
                ) : selectedSignal.companyIds.includes(detail.id) ? (
                  <Button onClick={() => onPromote(selectedSignal)}>
                    <ArrowUpRightIcon data-icon="inline-start" />
                    加入事件清单并待核验
                  </Button>
                ) : switchableCompanyId ? (
                  <Button
                    onClick={() =>
                      onCompanyChange(switchableCompanyId, selectedSignal.id)
                    }
                  >
                    <ArrowUpRightIcon data-icon="inline-start" />
                    切换至 {getCompanyName(switchableCompanyId)} 继续核验
                  </Button>
                ) : (
                  <Button disabled>
                    <ArrowUpRightIcon data-icon="inline-start" />
                    暂无可关联企业
                  </Button>
                )}
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  )
}

function SignalRow({
  signal,
  promoted,
  onOpen,
}: {
  signal: RealTimeSignal
  promoted: boolean
  onOpen: (trigger: HTMLButtonElement) => void
}) {
  return (
    <button
      type="button"
      className="signal-row"
      data-severity={signal.severity}
      data-verification={signal.verificationStatus}
      onClick={(event) => onOpen(event.currentTarget)}
      aria-label={`查看“${signal.title}”，${signal.companyIds
        .map(getCompanyName)
        .join("、")}，${
        signal.severity === "high"
          ? "高危"
          : signal.severity === "medium"
            ? "中危"
            : "观察"
      }，${verificationLabels[signal.verificationStatus]}`}
    >
      <div className="signal-row-time">
        <time dateTime={signal.publishedAt}>
          {formatSourceListTime(signal.publishedAt)}
        </time>
        <span>{signal.sourceName}</span>
      </div>
      <div className="signal-row-content">
        <div className="signal-row-meta">
          <Badge variant="outline">{signal.category}</Badge>
          <span>{signal.companyIds.map(getCompanyName).join("、")}</span>
          <SeverityBadge severity={signal.severity} />
          <VerificationBadge status={signal.verificationStatus} />
          {promoted ? (
            <Badge variant="outline" className="status-badge status-info">
              已转事件
            </Badge>
          ) : null}
        </div>
        <h2>{signal.title}</h2>
        <p>{signal.summary}</p>
        <ul className="signal-row-facts" aria-label="关键事实预览">
          {signal.keyFacts.slice(0, 2).map((fact) => (
            <li key={fact}>{fact}</li>
          ))}
        </ul>
      </div>
      <ArrowUpRightIcon aria-hidden="true" />
    </button>
  )
}

function VerificationBadge({ status }: { status: SignalVerificationStatus }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "status-badge",
        status === "verified"
          ? "status-success"
          : status === "monitoring"
            ? "status-info"
            : "status-warning"
      )}
    >
      {verificationLabels[status]}
    </Badge>
  )
}

function DrawerSection({
  title,
  icon: Icon,
  children,
}: {
  title: string
  icon?: typeof SparklesIcon
  children: ReactNode
}) {
  return (
    <section className="drawer-section">
      <h3>
        {Icon ? <Icon aria-hidden="true" /> : null}
        {title}
      </h3>
      {children}
    </section>
  )
}

function groupSignalsByDate(signals: RealTimeSignal[]) {
  const groups = new Map<string, RealTimeSignal[]>()
  signals.forEach((signal) => {
    const date = signal.publishedAt.slice(0, 10)
    groups.set(date, [...(groups.get(date) ?? []), signal])
  })
  return [...groups.entries()]
}

function formatDateHeading(value: string) {
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  return dateHeadingFormatter.format(date)
}
