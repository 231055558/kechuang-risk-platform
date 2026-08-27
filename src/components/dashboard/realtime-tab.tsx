import {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react"
import { useGSAP } from "@gsap/react"
import gsap from "gsap"
import {
  ExternalLinkIcon,
  FileSearchIcon,
  FilterIcon,
  HistoryIcon,
  NewspaperIcon,
  SearchIcon,
  SparklesIcon,
} from "lucide-react"

import { EmptyState, SeverityBadge } from "@/components/dashboard/shared"
import { usePrefersReducedMotion } from "@/components/motion/workflow-transition"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { getCompanyName, getCustomerVisibleIndicators } from "@/lib/data-r01"
import { formatSourceDateTime, formatSourceListTime } from "@/lib/date-format"
import { getCanonicalRiskDimensionLabels } from "@/lib/risk-dimensions"
import type {
  CompanyDetail,
  RealTimeDataSet,
  RealTimeSignal,
  RealTimeSignalCategory,
} from "@/types/risk"
import "@/styles/risk-news.css"

type RealtimeTabProps = {
  detail: CompanyDetail
  data: RealTimeDataSet
  focusSignalId: string | null
  promotedSignalIds: string[]
  onFocusSignalHandled: () => void
  onCompanyChange: (companyId: string, signalId: string) => void
  onPromote: (signal: RealTimeSignal) => void
}

const PAGE_SIZE = 24

type CardOrigin = {
  left: number
  top: number
  width: number
  height: number
}

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
  onFocusSignalHandled,
}: RealtimeTabProps) {
  const [selectedSignalId, setSelectedSignalId] = useState<string | null>(null)
  const [scope, setScope] = useState<"current" | "all">("current")
  const [category, setCategory] = useState<"all" | RealTimeSignalCategory>(
    "all"
  )
  const [query, setQuery] = useState("")
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const [cardOrigin, setCardOrigin] = useState<CardOrigin | null>(null)
  const deferredQuery = useDeferredValue(query)
  const previousCompanyIdRef = useRef(detail.id)
  const signalTriggerRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (previousCompanyIdRef.current === detail.id) return
    previousCompanyIdRef.current = detail.id
    setSelectedSignalId(null)
    setCardOrigin(null)
    setVisibleCount(PAGE_SIZE)
    if (
      focusSignalId &&
      !data.signals
        .find((signal) => signal.id === focusSignalId)
        ?.companyIds.includes(detail.id)
    ) {
      onFocusSignalHandled()
    }
  }, [data.signals, detail.id, focusSignalId, onFocusSignalHandled])

  const activeSignalId = focusSignalId ?? selectedSignalId
  const selectedSignal =
    data.signals.find((item) => item.id === activeSignalId) ?? null
  const categories = useMemo(
    () => [...new Set(data.signals.map((signal) => signal.category))],
    [data.signals]
  )
  const filteredSignals = useMemo(() => {
    const normalizedQuery = deferredQuery.trim().toLocaleLowerCase("zh-CN")
    const importance = { high: 3, medium: 2, watch: 1 } as const
    return data.signals
      .filter(
        (signal) => scope === "all" || signal.companyIds.includes(detail.id)
      )
      .filter((signal) => category === "all" || signal.category === category)
      .filter((signal) => {
        if (!normalizedQuery) return true
        return [
          signal.title,
          signal.summary,
          signal.historicalContext,
          signal.sourceName,
          ...signal.keyFacts,
          ...signal.companyIds.map(getCompanyName),
        ]
          .join(" ")
          .toLocaleLowerCase("zh-CN")
          .includes(normalizedQuery)
      })
      .sort(
        (left, right) =>
          importance[right.severity] - importance[left.severity] ||
          right.publishedAt.localeCompare(left.publishedAt)
      )
  }, [category, data.signals, deferredQuery, detail.id, scope])

  const visibleSignals = filteredSignals.slice(0, visibleCount)
  const selectedIndicatorNames = selectedSignal
    ? getCustomerVisibleIndicators(selectedSignal.indicatorIds).map(
        (indicator) => indicator.tertiaryRisk
      )
    : []

  return (
    <div className="risk-news page-stack">
      <header className="risk-news__header">
        <div>
          <span className="eyebrow">Risk intelligence</span>
          <h2>风险资讯</h2>
          <p>
            新闻、公告、诉讼与监管信息按风险重要度排布。资讯用于投资者阅读和来源核验，不参与财报叙事评分。
          </p>
        </div>
        <div>
          <strong>{filteredSignals.length}</strong>
          <span>条当前结果</span>
          <time dateTime={data.snapshotAt}>
            更新至 {formatSourceDateTime(data.snapshotAt)}
          </time>
        </div>
      </header>

      <section className="risk-news__toolbar" aria-label="风险资讯筛选">
        <div>
          <SearchIcon aria-hidden="true" />
          <Input
            type="search"
            name="risk-news-search"
            autoComplete="off"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setVisibleCount(PAGE_SIZE)
            }}
            placeholder="搜索标题、摘要、企业或来源…"
            aria-label="搜索风险资讯"
          />
        </div>
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
      </section>

      {visibleSignals.length ? (
        <section className="risk-news__grid" aria-label="风险资讯卡片">
          {visibleSignals.map((signal) => (
            <NewsCard
              key={signal.id}
              signal={signal}
              onOpen={(trigger) => {
                signalTriggerRef.current = trigger
                const rect = trigger.getBoundingClientRect()
                setCardOrigin({
                  left: rect.left,
                  top: rect.top,
                  width: rect.width,
                  height: rect.height,
                })
                setSelectedSignalId(signal.id)
              }}
            />
          ))}
        </section>
      ) : (
        <EmptyState
          title="没有匹配的资讯"
          description="调整企业范围、类别或搜索词后再试。"
        />
      )}

      {visibleSignals.length < filteredSignals.length ? (
        <div className="risk-news__more">
          <Button
            variant="outline"
            onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
          >
            继续加载{" "}
            {Math.min(
              PAGE_SIZE,
              filteredSignals.length - visibleSignals.length
            )}{" "}
            条
          </Button>
          <span>
            已显示 {visibleSignals.length}/{filteredSignals.length}
          </span>
        </div>
      ) : null}

      <RiskNewsDialog
        signal={selectedSignal}
        origin={cardOrigin}
        selectedIndicatorNames={selectedIndicatorNames}
        onClose={() => {
          setSelectedSignalId(null)
          setCardOrigin(null)
          onFocusSignalHandled()
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          if (signalTriggerRef.current?.isConnected) {
            signalTriggerRef.current.focus({ preventScroll: true })
          } else {
            document
              .getElementById("main-content")
              ?.focus({ preventScroll: true })
          }
        }}
      />
    </div>
  )
}

function NewsCard({
  signal,
  onOpen,
}: {
  signal: RealTimeSignal
  onOpen: (trigger: HTMLButtonElement) => void
}) {
  const dimensions = getCanonicalRiskDimensionLabels(signal.riskDimensionIds)
  return (
    <button
      type="button"
      className="risk-news__card"
      data-importance={signal.severity}
      onClick={(event) => onOpen(event.currentTarget)}
      aria-label={`查看${signal.title}`}
    >
      <div className="risk-news__card-meta">
        <time dateTime={signal.publishedAt}>
          {formatSourceListTime(signal.publishedAt)}
        </time>
        <span>{signal.sourceName}</span>
        <SeverityBadge severity={signal.severity} />
      </div>
      <div className="risk-news__card-tags">
        <Badge variant="outline">{signal.category}</Badge>
        {dimensions.slice(0, 2).map((label) => (
          <Badge key={label} variant="outline">
            {label}
          </Badge>
        ))}
      </div>
      <h3>{signal.title}</h3>
      <p>{signal.summary}</p>
      {signal.severity === "high" && signal.keyFacts.length ? (
        <ul>
          {signal.keyFacts.slice(0, 2).map((fact) => (
            <li key={fact}>{fact}</li>
          ))}
        </ul>
      ) : null}
      <footer>
        <span>{signal.companyIds.map(getCompanyName).join("、")}</span>
        <ExternalLinkIcon aria-hidden="true" />
      </footer>
    </button>
  )
}

function RiskNewsDialog({
  signal,
  origin,
  selectedIndicatorNames,
  onClose,
  onCloseAutoFocus,
}: {
  signal: RealTimeSignal | null
  origin: CardOrigin | null
  selectedIndicatorNames: string[]
  onClose: () => void
  onCloseAutoFocus: NonNullable<
    ComponentProps<typeof DialogContent>["onCloseAutoFocus"]
  >
}) {
  const cardRef = useRef<HTMLDivElement>(null)
  const prefersReducedMotion = usePrefersReducedMotion()

  useGSAP(
    () => {
      const card = cardRef.current
      if (!card || !signal) return
      if (prefersReducedMotion) {
        gsap.set(card, { clearProps: "transform,opacity,visibility" })
        return
      }
      const finalRect = card.getBoundingClientRect()
      const x = origin
        ? origin.left +
          origin.width / 2 -
          (finalRect.left + finalRect.width / 2)
        : 0
      const y = origin
        ? origin.top +
          origin.height / 2 -
          (finalRect.top + finalRect.height / 2)
        : 14
      const scaleX = origin
        ? Math.max(0.16, Math.min(1, origin.width / finalRect.width))
        : 0.96
      const scaleY = origin
        ? Math.max(0.16, Math.min(1, origin.height / finalRect.height))
        : 0.96
      gsap.fromTo(
        card,
        {
          x,
          y,
          scaleX,
          scaleY,
          opacity: origin ? 0.72 : 0,
          transformOrigin: "center center",
        },
        {
          x: 0,
          y: 0,
          scaleX: 1,
          scaleY: 1,
          opacity: 1,
          duration: 0.44,
          ease: "power3.out",
          clearProps: "transform,opacity",
        }
      )
    },
    {
      scope: cardRef,
      dependencies: [
        signal?.id,
        origin?.left,
        origin?.top,
        origin?.width,
        origin?.height,
        prefersReducedMotion,
      ],
      revertOnUpdate: true,
    }
  )

  return (
    <Dialog
      open={Boolean(signal)}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent
        className="risk-news__modal"
        onCloseAutoFocus={onCloseAutoFocus}
      >
        {signal ? (
          <article
            ref={cardRef}
            className="risk-news__modal-card"
            data-importance={signal.severity}
          >
            <DialogHeader>
              <div className="signal-drawer-badges">
                <SeverityBadge severity={signal.severity} />
                <Badge variant="outline">{signal.category}</Badge>
                {getCanonicalRiskDimensionLabels(signal.riskDimensionIds).map(
                  (label) => (
                    <Badge key={label} variant="outline">
                      {label}
                    </Badge>
                  )
                )}
              </div>
              <DialogTitle>{signal.title}</DialogTitle>
              <DialogDescription>
                {formatSourceDateTime(signal.publishedAt)} · {signal.sourceName}
              </DialogDescription>
            </DialogHeader>
            <div className="risk-news__modal-content">
              <DrawerSection title="信息摘要" icon={NewspaperIcon} emphasized>
                <p>{signal.summary}</p>
              </DrawerSection>
              <DrawerSection title="投资者影响" icon={SparklesIcon}>
                <p>{signal.potentialImpact}</p>
              </DrawerSection>
              {signal.keyFacts.length ? (
                <DrawerSection title="关键事实" icon={FileSearchIcon}>
                  <ul>
                    {signal.keyFacts.map((fact) => (
                      <li key={fact}>{fact}</li>
                    ))}
                  </ul>
                </DrawerSection>
              ) : null}
              <DrawerSection title="内容转述与分析" icon={NewspaperIcon}>
                <p>{signal.aiInsight}</p>
              </DrawerSection>
              <DrawerSection title="历史与口径背景" icon={HistoryIcon}>
                <p>{signal.historicalContext}</p>
              </DrawerSection>
              <DrawerSection title="来源与研究关联" icon={ExternalLinkIcon}>
                <dl>
                  <div>
                    <dt>企业</dt>
                    <dd>{signal.companyIds.map(getCompanyName).join("、")}</dd>
                  </div>
                  <div>
                    <dt>来源类型</dt>
                    <dd>
                      {signal.sourceReliability
                        ? sourceReliabilityLabels[signal.sourceReliability]
                        : "来源类型未标注"}
                    </dd>
                  </div>
                  <div>
                    <dt>原文定位</dt>
                    <dd>{signal.sourceLocator}</dd>
                  </div>
                  <div>
                    <dt>关联指标</dt>
                    <dd>
                      {selectedIndicatorNames.length
                        ? selectedIndicatorNames.join("、")
                        : "未建立指标关联"}
                    </dd>
                  </div>
                  <div>
                    <dt>关联边界</dt>
                    <dd>关联仅用于研究下钻，不表示已进入评分。</dd>
                  </div>
                  <div>
                    <dt>快照时间</dt>
                    <dd>{formatSourceDateTime(signal.capturedAt)}</dd>
                  </div>
                </dl>
                <Button variant="outline" asChild>
                  <a href={signal.sourceUrl} target="_blank" rel="noreferrer">
                    打开原始来源 <ExternalLinkIcon data-icon="inline-end" />
                  </a>
                </Button>
              </DrawerSection>
            </div>
          </article>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function DrawerSection({
  title,
  icon: Icon,
  children,
  emphasized = false,
}: {
  title: string
  icon: typeof NewspaperIcon
  children: ReactNode
  emphasized?: boolean
}) {
  return (
    <section className="drawer-section" data-emphasized={emphasized}>
      <h3>
        <Icon aria-hidden="true" />
        {title}
      </h3>
      {children}
    </section>
  )
}
