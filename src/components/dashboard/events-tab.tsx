import {
  useDeferredValue,
  useMemo,
  useRef,
  useState,
} from "react"
import {
  ArrowRightIcon,
  CircleAlertIcon,
  ClipboardCheckIcon,
  GitBranchIcon,
  LandmarkIcon,
  LightbulbIcon,
  ListChecksIcon,
  ShieldCheckIcon,
  TargetIcon,
  UserRoundCheckIcon,
} from "lucide-react"

import {
  EmptyState,
  EvidenceList,
  GlassPanel,
  SectionHeader,
  SeverityBadge,
  StatusBadge,
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
import { getAdmittedIndicators, getObservationIndicators } from "@/lib/data"
import { cn } from "@/lib/utils"
import type {
  CommonPlaybookItem,
  CompanyDetail,
  EventSeverity,
  EventStatus,
  GovernanceItem,
  OperationsSection,
  RiskEvent,
} from "@/types/risk"

type EventsTabProps = {
  detail: CompanyDetail
  events: RiskEvent[]
  section: OperationsSection
  focusEventId: string | null
  onSectionChange: (section: OperationsSection) => void
  onFocusEventHandled: () => void
  onStatusChange: (eventId: string, status: EventStatus) => void
  playbook: CommonPlaybookItem[]
}

const layerLabels = {
  source: "风险源",
  mediator: "传导环节",
  impact: "业务影响",
  response: "响应动作",
} as const

const governanceImpactLabels = {
  low: "低治理影响",
  medium: "中治理影响",
  high: "高治理影响",
} as const

const dateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/
const eventDateFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "long",
  day: "numeric",
  weekday: "short",
})
const eventDateTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
})

export function EventsTab({
  detail,
  events,
  section,
  focusEventId,
  onSectionChange,
  onFocusEventHandled,
  onStatusChange,
  playbook,
}: EventsTabProps) {
  const [transmissionEventId, setTransmissionEventId] = useState<string | null>(
    null
  )

  return (
    <div className="page-stack">
      {section === "events" ? (
        <EventRegister
          key={`${detail.id}:${focusEventId ?? "none"}`}
          detail={detail}
          events={events}
          focusEventId={focusEventId}
          onFocusEventHandled={onFocusEventHandled}
          onStatusChange={onStatusChange}
          onOpenTransmission={(eventId) => {
            setTransmissionEventId(eventId)
            onSectionChange("transmission")
          }}
        />
      ) : null}

      {section === "transmission" ? (
        <TransmissionPanel
          key={`${detail.id}:${transmissionEventId ?? "default"}`}
          detail={detail}
          events={events}
          focusEventId={transmissionEventId}
          onOpenGovernance={() => onSectionChange("governance")}
        />
      ) : null}

      {section === "governance" ? (
        <GovernancePanel
          detail={detail}
          playbook={playbook}
          onOpenInvestment={() => onSectionChange("investment")}
        />
      ) : null}

      {section === "investment" ? <InvestmentPanel detail={detail} /> : null}

      {section === "advice" ? <InvestmentAdvicePanel /> : null}
    </div>
  )
}

function EventRegister({
  detail,
  events,
  focusEventId,
  onFocusEventHandled,
  onStatusChange,
  onOpenTransmission,
}: {
  detail: CompanyDetail
  events: RiskEvent[]
  focusEventId: string | null
  onFocusEventHandled: () => void
  onStatusChange: (eventId: string, status: EventStatus) => void
  onOpenTransmission: (eventId: string) => void
}) {
  const [severity, setSeverity] = useState<"all" | EventSeverity>("all")
  const [status, setStatus] = useState<"all" | EventStatus>("all")
  const [query, setQuery] = useState("")
  const [selectedEventId, setSelectedEventId] = useState<string | null>(() =>
    focusEventId && events.some((event) => event.id === focusEventId)
      ? focusEventId
      : null
  )
  const deferredQuery = useDeferredValue(query)
  const eventTriggerRef = useRef<HTMLButtonElement | null>(null)
  const focusMainAfterCloseRef = useRef(false)

  const filteredEvents = useMemo(() => {
    const normalizedQuery = deferredQuery.trim().toLocaleLowerCase("zh-CN")

    return [...events]
      .filter((event) => severity === "all" || event.severity === severity)
      .filter((event) => status === "all" || event.status === status)
      .filter((event) => {
        if (!normalizedQuery) {
          return true
        }

        return [
          event.riskType,
          event.description,
          event.aiSummary,
          event.sourceType,
        ]
          .join(" ")
          .toLocaleLowerCase("zh-CN")
          .includes(normalizedQuery)
      })
      .sort((left, right) =>
        right.identifiedAt.localeCompare(left.identifiedAt)
      )
  }, [deferredQuery, events, severity, status])

  const selectedEvent =
    events.find((event) => event.id === selectedEventId) ?? null
  const selectedEventAdmittedIndicators = getAdmittedIndicators(
    selectedEvent?.indicatorIds
  )
  const selectedEventObservationIndicators = getObservationIndicators(
    selectedEvent?.indicatorIds
  )

  return (
    <div className="tab-content-stack">
      <Reveal className="feed-controls-stack">
        <GlassPanel
          className="feed-toolbar"
          surfaceClassName="filter-toolbar-glass"
          variant="floating"
          aria-label="风险事件筛选"
        >
          <div className="feed-search">
            <ListChecksIcon aria-hidden="true" />
            <Input
              type="search"
              name="event-search"
              autoComplete="off"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索事件、来源或风险类型…"
              aria-label="搜索风险事件"
            />
          </div>
          <div className="feed-filters">
            <Select
              value={severity}
              onValueChange={(value) =>
                setSeverity(value as "all" | EventSeverity)
              }
            >
              <SelectTrigger aria-label="事件严重度">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="event-select-menu">
                <SelectGroup>
                  <SelectItem value="all">全部等级</SelectItem>
                  <SelectItem value="high">高危</SelectItem>
                  <SelectItem value="medium">中危</SelectItem>
                  <SelectItem value="watch">观察</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
            <Select
              value={status}
              onValueChange={(value) => setStatus(value as "all" | EventStatus)}
            >
              <SelectTrigger aria-label="事件处置状态">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="event-select-menu">
                <SelectGroup>
                  <SelectItem value="all">全部状态</SelectItem>
                  <SelectItem value="pending">待处理</SelectItem>
                  <SelectItem value="in-progress">处理中</SelectItem>
                  <SelectItem value="done">已完成</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
        </GlassPanel>

        <div className="feed-summary">
          <div className="feed-summary-primary">
            <span>事件清单</span>
            <strong className="tabular-number">
              {filteredEvents.length} 条
            </strong>
          </div>
        </div>
      </Reveal>

      {filteredEvents.length > 0 ? (
        <Reveal>
          <section className="event-register" aria-label="风险事件列表">
            {filteredEvents.map((event) => (
              <article
                key={event.id}
                className="event-register-row"
                data-severity={event.severity}
              >
                <button
                  type="button"
                  className="event-register-main"
                  onClick={(clickEvent) => {
                    eventTriggerRef.current = clickEvent.currentTarget
                    setSelectedEventId(event.id)
                  }}
                >
                  <time
                    dateTime={event.identifiedAt}
                    className="tabular-number"
                  >
                    {formatEventDate(event.identifiedAt)}
                  </time>
                  <div className="event-register-copy">
                    <div className="event-register-meta">
                      <SeverityBadge severity={event.severity} />
                      <Badge variant="outline">{event.riskType}</Badge>
                      <span>{event.sourceType}</span>
                    </div>
                    <h2>{event.description}</h2>
                    <p>
                      {event.stage} · 建议责任角色：
                      {resolveOwner(event.riskType)}
                    </p>
                  </div>
                  <ArrowRightIcon aria-hidden="true" />
                </button>
                <div className="event-register-status">
                  <Select
                    value={event.status}
                    onValueChange={(value) =>
                      onStatusChange(event.id, value as EventStatus)
                    }
                  >
                    <SelectTrigger
                      aria-label={`更新“${event.riskType}”事件状态`}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="event-select-menu">
                      <SelectGroup>
                        <SelectItem value="pending">待处理</SelectItem>
                        <SelectItem value="in-progress">处理中</SelectItem>
                        <SelectItem value="done">已完成</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </div>
              </article>
            ))}
          </section>
        </Reveal>
      ) : (
        <Reveal>
          <EmptyState
            title="没有匹配的风险事件"
            description="调整严重度、处置状态或搜索词后再试。"
          />
        </Reveal>
      )}

      <Sheet
        open={Boolean(selectedEvent)}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedEventId(null)
            if (focusEventId) {
              onFocusEventHandled()
            }
          }
        }}
      >
        <SheetContent
          size="event"
          className="method-sheet method-sheet--event"
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            if (focusMainAfterCloseRef.current) {
              focusMainAfterCloseRef.current = false
              document
                .getElementById("main-content")
                ?.focus({ preventScroll: true })
              return
            }

            const trigger = eventTriggerRef.current
            if (trigger?.isConnected) {
              trigger.focus({ preventScroll: true })
              return
            }

            document
              .getElementById("main-content")
              ?.focus({ preventScroll: true })
          }}
        >
          {selectedEvent ? (
            <>
              <SheetHeader>
                <div className="signal-drawer-badges">
                  <SeverityBadge severity={selectedEvent.severity} />
                  <StatusBadge status={selectedEvent.status} />
                  <Badge variant="outline">
                    {
                      governanceImpactLabels[
                        selectedEvent.investmentImpact ?? "medium"
                      ]
                    }
                  </Badge>
                </div>
                <SheetTitle>{selectedEvent.riskType}</SheetTitle>
                <SheetDescription className="tabular-number">
                  {formatEventDate(selectedEvent.identifiedAt)} ·{" "}
                  {selectedEvent.sourceType}
                </SheetDescription>
              </SheetHeader>
              <div className="sheet-scroll-content">
                <EventFlowStep
                  index="01"
                  title="事实"
                  content={selectedEvent.description}
                />
                <EventFlowStep
                  index="02"
                  title="研究辅助归纳"
                  content={selectedEvent.aiSummary}
                />
                <EventFlowStep
                  index="03"
                  title="处置动作"
                  content={selectedEvent.recommendedAction}
                />
                <EventFlowStep
                  index="04"
                  title="责任与状态"
                  content={`${resolveOwner(selectedEvent.riskType)} · 当前${statusText(selectedEvent.status)}`}
                />
                <EventFlowStep
                  index="05"
                  title="治理与尽调影响"
                  content={`该事件当前为${
                    governanceImpactLabels[
                      selectedEvent.investmentImpact ?? "medium"
                    ]
                  }，应与材料核验、治理阈值和持续监测条件联动。`}
                />

                <section className="drawer-section">
                  <h3>口径准入指标命中</h3>
                  {selectedEventAdmittedIndicators.length > 0 ? (
                    <div className="compact-list">
                      {selectedEventAdmittedIndicators.map((indicator) => (
                        <article key={indicator.id}>
                          <strong>{indicator.tertiaryRisk}</strong>
                          <p>
                            {indicator.primaryRisk} / {indicator.secondaryRisk}{" "}
                            · 口径准入
                          </p>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <EmptyState
                      title="暂无口径准入指标命中"
                      description="当前旧指标引用尚无可靠映射，事件保留为待核验研究线索，不进入评分。"
                    />
                  )}
                </section>

                {selectedEventObservationIndicators.length > 0 ? (
                  <section className="drawer-section">
                    <h3>观察指标关联</h3>
                    <div className="compact-list">
                      {selectedEventObservationIndicators.map((indicator) => (
                        <article key={indicator.id}>
                          <strong>{indicator.tertiaryRisk}</strong>
                          <p>
                            {indicator.primaryRisk} / {indicator.secondaryRisk}{" "}
                            · 观察项，不计分
                          </p>
                        </article>
                      ))}
                    </div>
                  </section>
                ) : null}

                <section className="drawer-section">
                  <h3>证据链</h3>
                  {selectedEvent.sourceUrl ? (
                    <div className="compact-list">
                      <article>
                        <strong>事件原始来源</strong>
                        <p>
                          <a
                            href={selectedEvent.sourceUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {selectedEvent.sourceName ??
                              selectedEvent.sourceType}
                          </a>
                          {selectedEvent.sourcePublishedAt ? (
                            <>
                              {" · "}
                              <time
                                dateTime={selectedEvent.sourcePublishedAt}
                                className="tabular-number"
                              >
                                {formatEventDateTime(
                                  selectedEvent.sourcePublishedAt
                                )}
                              </time>
                            </>
                          ) : null}
                        </p>
                      </article>
                    </div>
                  ) : null}
                  {selectedEvent.evidenceIds.length > 0 ? (
                    <EvidenceList
                      detail={detail}
                      evidenceIds={selectedEvent.evidenceIds}
                    />
                  ) : selectedEvent.sourceUrl ? null : (
                    <EmptyState
                      title="暂无证据"
                      description="当前事件尚未关联可展示的证据记录。"
                    />
                  )}
                </section>
              </div>
              <div className="sheet-action-bar">
                <Select
                  value={selectedEvent.status}
                  onValueChange={(value) =>
                    onStatusChange(selectedEvent.id, value as EventStatus)
                  }
                >
                  <SelectTrigger aria-label="更新当前事件状态">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="event-select-menu">
                    <SelectGroup>
                      <SelectItem value="pending">待处理</SelectItem>
                      <SelectItem value="in-progress">处理中</SelectItem>
                      <SelectItem value="done">已完成</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <Button
                  onClick={() => {
                    focusMainAfterCloseRef.current = true
                    setSelectedEventId(null)
                    if (focusEventId) {
                      onFocusEventHandled()
                    }
                    onOpenTransmission(selectedEvent.id)
                  }}
                >
                  查看风险传导
                  <ArrowRightIcon data-icon="inline-end" />
                </Button>
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  )
}

function TransmissionPanel({
  detail,
  events,
  focusEventId,
  onOpenGovernance,
}: {
  detail: CompanyDetail
  events: RiskEvent[]
  focusEventId: string | null
  onOpenGovernance: () => void
}) {
  const [selectedNodeId, setSelectedNodeId] = useState(() =>
    resolveTransmissionNodeId(detail, events, focusEventId)
  )

  const selectedNode =
    detail.transmissionGraph.nodes.find((node) => node.id === selectedNodeId) ??
    detail.transmissionGraph.nodes[0]
  const layers = ["source", "mediator", "impact", "response"] as const
  const relatedEvents = selectedNode
    ? events.filter((event) =>
        event.evidenceIds.some((evidenceId) =>
          selectedNode.evidenceIds.includes(evidenceId)
        )
      )
    : []
  const relatedActions = selectedNode
    ? detail.governance.filter((item) =>
        item.evidenceIds.some((evidenceId) =>
          selectedNode.evidenceIds.includes(evidenceId)
        )
      )
    : []

  return (
    <div className="tab-content-stack">
      <Reveal>
        <section className="page-section">
          <SectionHeader
            title="风险传导路径"
            tone="violet"
            description={detail.transmissionGraph.keyInsight}
          />
          <div className="transmission-flow">
            {layers.map((layer, layerIndex) => {
              const nodes = detail.transmissionGraph.nodes.filter(
                (node) => node.layer === layer
              )
              return (
                <section key={layer} className="transmission-layer">
                  <div className="transmission-layer-heading">
                    <span>{String(layerIndex + 1).padStart(2, "0")}</span>
                    <div>
                      <strong>{layerLabels[layer]}</strong>
                      <p>{nodes.length} 个已记录节点</p>
                    </div>
                  </div>
                  <div className="transmission-node-list">
                    {nodes.map((node) => (
                      <button
                        key={node.id}
                        type="button"
                        className={cn(
                          "transmission-node-row",
                          node.id === selectedNode?.id &&
                            "transmission-node-row-active"
                        )}
                        onClick={() => setSelectedNodeId(node.id)}
                      >
                        <div>
                          <strong>{node.label}</strong>
                          <p>{node.description}</p>
                        </div>
                        <ArrowRightIcon aria-hidden="true" />
                      </button>
                    ))}
                  </div>
                </section>
              )
            })}
          </div>
        </section>
      </Reveal>

      {selectedNode ? (
        <Reveal>
          <section className="page-section">
            <SectionHeader
              title={`节点复核：${selectedNode.label}`}
              tone="cyan"
              description="节点解释、关联事件和治理动作共用同一组证据，便于检查推导链是否成立。"
              action={
                <Button variant="outline" onClick={onOpenGovernance}>
                  查看企业处置
                  <ArrowRightIcon data-icon="inline-end" />
                </Button>
              }
            />
            <div className="node-audit-grid">
              <NodeAudit
                icon={GitBranchIcon}
                label="传导层级"
                value={layerLabels[selectedNode.layer]}
              />
              <NodeAudit
                icon={ListChecksIcon}
                label="关联事件"
                value={`${relatedEvents.length} 条`}
              />
              <NodeAudit
                icon={ClipboardCheckIcon}
                label="关联动作"
                value={`${relatedActions.length} 项`}
              />
              <NodeAudit
                icon={ShieldCheckIcon}
                label="证据记录"
                value={`${selectedNode.evidenceIds.length} 条`}
              />
            </div>
            <EvidenceList
              detail={detail}
              evidenceIds={selectedNode.evidenceIds}
            />
          </section>
        </Reveal>
      ) : null}
    </div>
  )
}

function resolveTransmissionNodeId(
  detail: CompanyDetail,
  events: RiskEvent[],
  focusEventId: string | null
) {
  const fallbackId = detail.transmissionGraph.nodes[0]?.id ?? ""
  const focusedEvent = focusEventId
    ? events.find((event) => event.id === focusEventId)
    : null

  if (!focusedEvent || focusedEvent.evidenceIds.length === 0) {
    return fallbackId
  }

  const evidenceIds = new Set(focusedEvent.evidenceIds)
  const rankedNodes = detail.transmissionGraph.nodes
    .map((node) => ({
      id: node.id,
      overlap: node.evidenceIds.filter((id) => evidenceIds.has(id)).length,
    }))
    .sort((left, right) => right.overlap - left.overlap)

  return rankedNodes[0]?.overlap ? rankedNodes[0].id : fallbackId
}

function GovernancePanel({
  detail,
  playbook,
  onOpenInvestment,
}: {
  detail: CompanyDetail
  playbook: CommonPlaybookItem[]
  onOpenInvestment: () => void
}) {
  return (
    <div className="tab-content-stack">
      <Reveal>
        <section className="page-section">
          <SectionHeader
            title="企业处置"
            tone="teal"
            description="按问题、责任角色、优先级、执行动作和证据要求推进处置闭环。"
            action={
              <Button variant="outline" onClick={onOpenInvestment}>
                查看投资约束
                <ArrowRightIcon data-icon="inline-end" />
              </Button>
            }
          />
          <div className="governance-action-list">
            {detail.governance.map((item) => (
              <GovernanceAction key={item.id} item={item} detail={detail} />
            ))}
          </div>
        </section>
      </Reveal>

      <Reveal>
        <section className="page-section">
          <SectionHeader
            title="通用治理 Playbook"
            tone="blue"
            description="通用动作仅作为操作模板；落到具体企业时仍需绑定责任人、期限和可核验材料。"
          />
          <div className="playbook-list">
            {playbook.map((item) => (
              <article key={item.title} className="playbook-row">
                <div className="playbook-row-title">
                  <Badge variant="outline">{item.priority}</Badge>
                  <div>
                    <span>{item.riskType}</span>
                    <h3>{item.title}</h3>
                  </div>
                </div>
                <p>{item.action}</p>
                <div className="playbook-data">
                  <strong>所需数据：</strong>
                  {item.dataSupport}
                </div>
              </article>
            ))}
          </div>
        </section>
      </Reveal>
    </div>
  )
}

function GovernanceAction({
  item,
  detail,
}: {
  item: GovernanceItem
  detail: CompanyDetail
}) {
  return (
    <article className="governance-action-row">
      <div className="governance-action-heading">
        <div>
          <span>
            {item.riskType} · {item.stage}
          </span>
          <h3>{item.title}</h3>
        </div>
        <Badge
          variant="outline"
          className={cn(
            "status-badge",
            item.priority === "P0"
              ? "status-danger"
              : item.priority === "P1"
                ? "status-warning"
                : "status-neutral"
          )}
        >
          {item.priority}
        </Badge>
      </div>
      <div className="governance-action-grid">
        <div>
          <strong>问题事实</strong>
          <p>{item.problem}</p>
        </div>
        <div>
          <strong>建议动作</strong>
          <p>{item.action}</p>
        </div>
        <div>
          <strong>责任角色</strong>
          <p>{resolveOwner(item.riskType)}</p>
        </div>
        <div>
          <strong>验收材料</strong>
          <p>{item.dataSupport}</p>
        </div>
      </div>
      <EvidenceList detail={detail} evidenceIds={item.evidenceIds} limit={2} />
    </article>
  )
}

function InvestmentPanel({ detail }: { detail: CompanyDetail }) {
  const investment = detail.investmentView

  if (!investment) {
    return (
      <EmptyState
        title="暂无尽调约束记录"
        description="当前企业尚未形成可回溯到公开证据的尽调条件、治理阈值与监测约束。"
      />
    )
  }

  return (
    <div className="tab-content-stack">
      <Reveal>
        <GlassPanel
          className="investment-stance"
          surfaceClassName="investment-hero-glass"
          variant="floating"
        >
          <div>
            <span className="eyebrow">尽调边界</span>
            <h2>{investment.stance}</h2>
            <p>{investment.summary}</p>
          </div>
          <div className="investment-appetite">
            <LandmarkIcon aria-hidden="true" />
            <div>
              <span>适用边界</span>
              <strong>{investment.riskAppetite}</strong>
            </div>
          </div>
        </GlassPanel>
      </Reveal>

      <ConstraintSection
        icon={TargetIcon}
        title="尽调前置条件"
        description="材料、访谈和审计记录满足前置条件后，再进入下一轮人工评审。"
        items={[
          ...investment.preInvestmentChecks,
          ...investment.dueDiligenceFocus,
        ]}
      />
      <ConstraintSection
        icon={LandmarkIcon}
        title="评审与治理阈值"
        description="通过证据门槛、阶段里程碑和质量阈值表达不确定性，不给出估值或交易结论。"
        items={investment.valuationConstraints}
      />
      <ConstraintSection
        icon={UserRoundCheckIcon}
        title="持续监测"
        description="把企业披露、事件状态与治理进度纳入周期性复核。"
        items={investment.postInvestmentMonitoring}
      />
      <ConstraintSection
        icon={CircleAlertIcon}
        title="升级复核触发"
        description="触发后应升级核验、补充材料或重新进行人工研判。"
        items={investment.stopLossTriggers}
        danger
      />

      <Reveal>
        <section className="method-boundary-note">
          <ShieldCheckIcon aria-hidden="true" />
          <div>
            <strong>使用边界</strong>
            <p>
              本页基于公开信息快照形成尽调与治理约束，不构成证券投资建议、收益承诺或监管认定。
            </p>
          </div>
        </section>
      </Reveal>
    </div>
  )
}

function InvestmentAdvicePanel() {
  return (
    <div className="investment-advice-screen">
      <Reveal className="investment-advice-reveal">
        <GlassPanel
          className="investment-advice-panel"
          surfaceClassName="investment-advice-glass"
          variant="floating"
          aria-labelledby="investment-advice-title"
        >
          <div className="investment-advice-icon" aria-hidden="true">
            <LightbulbIcon />
          </div>
          <div>
            <span className="eyebrow">投资建议</span>
            <h2 id="investment-advice-title">投资建议正在完善</h2>
            <p>
              当前不会在证据与约束不完整时生成结论。完成公开证据复核并确认投资约束后，系统将在这里形成面向当前企业的建议。
            </p>
          </div>
        </GlassPanel>
      </Reveal>
    </div>
  )
}

function ConstraintSection({
  icon: Icon,
  title,
  description,
  items,
  danger = false,
}: {
  icon: typeof TargetIcon
  title: string
  description: string
  items: string[]
  danger?: boolean
}) {
  return (
    <Reveal>
      <section className="page-section">
        <SectionHeader
          title={title}
          description={description}
          tone={danger ? "rose" : "amber"}
        />
        <div className="constraint-list">
          {items.map((item, index) => (
            <article
              key={item}
              className={cn(
                "constraint-row",
                danger && "constraint-row-danger"
              )}
            >
              <span>{String(index + 1).padStart(2, "0")}</span>
              <Icon aria-hidden="true" />
              <p>{item}</p>
            </article>
          ))}
        </div>
      </section>
    </Reveal>
  )
}

function EventFlowStep({
  index,
  title,
  content,
}: {
  index: string
  title: string
  content: string
}) {
  return (
    <section className="event-flow-step">
      <span>{index}</span>
      <div>
        <h3>{title}</h3>
        <p>{content}</p>
      </div>
    </section>
  )
}

function NodeAudit({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof GitBranchIcon
  label: string
  value: string
}) {
  return (
    <div className="node-audit-item">
      <Icon aria-hidden="true" />
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
    </div>
  )
}

function resolveOwner(riskType: string) {
  if (/技术|算法|产品|安全/.test(riskType)) {
    return "CTO / 产品安全负责人"
  }
  if (/合规|监管|数据|伦理|诉讼/.test(riskType)) {
    return "法务合规负责人"
  }
  if (/财务|融资|估值|经营/.test(riskType)) {
    return "CFO / 投融资负责人"
  }
  if (/供应链|地缘|外部/.test(riskType)) {
    return "供应链与战略负责人"
  }
  if (/人员|人才|股权/.test(riskType)) {
    return "人力与董事会办公室"
  }
  return "风险管理负责人"
}

function statusText(status: EventStatus) {
  return status === "done"
    ? "已完成"
    : status === "in-progress"
      ? "处理中"
      : "待处理"
}

function formatEventDate(value: string) {
  const normalizedValue = dateOnlyPattern.test(value)
    ? `${value}T00:00:00`
    : value
  const date = new Date(normalizedValue)

  return Number.isNaN(date.getTime()) ? value : eventDateFormatter.format(date)
}

function formatEventDateTime(value: string) {
  if (dateOnlyPattern.test(value)) {
    return formatEventDate(value)
  }

  const date = new Date(value)

  return Number.isNaN(date.getTime())
    ? value
    : eventDateTimeFormatter.format(date)
}
