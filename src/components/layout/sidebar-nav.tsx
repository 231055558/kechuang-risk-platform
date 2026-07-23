import { DatabaseZapIcon, ShieldCheckIcon } from "lucide-react"
import { useRef, useState } from "react"

import { LiquidGlassSurface } from "@/components/liquid"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { navGroups, navItems } from "@/lib/nav-data"
import { cn } from "@/lib/utils"
import type {
  NavigationItemId,
  NavigationTarget,
  NavItem,
} from "@/types/nav"
import type {
  CompanyDetail,
  CompanySummary,
  RealTimeSignal,
  RiskAssessment,
  TabValue,
} from "@/types/risk"

type SidebarNavProps = {
  activeNavigationItem: NavigationItemId
  detail: CompanyDetail
  assessment: RiskAssessment
  companySummaries: CompanySummary[]
  companyId: string
  onCompanyChange: (companyId: string) => void
  onNavigate: (target: NavigationTarget) => Promise<boolean>
  onPreloadView: (view: TabValue) => void
  signals: RealTimeSignal[]
}

export function SidebarNav({
  activeNavigationItem,
  detail,
  assessment,
  companySummaries,
  companyId,
  onCompanyChange,
  onNavigate,
  onPreloadView,
  signals,
}: SidebarNavProps) {
  return (
    <LiquidGlassSurface variant="sidebar" className="sidebar-glass" padding="0">
      <aside className="sidebar-shell" aria-label="主导航">
        <div className="sidebar-brand">
          <div className="sidebar-brand-mark">
            <ShieldCheckIcon className="size-5" />
          </div>
          <div>
            <div className="text-base font-semibold tracking-tight text-foreground">
              科创风控
            </div>
            <div className="text-xs text-muted-foreground">AI 风险识别平台</div>
          </div>
        </div>

        <LiquidGlassSurface
          variant="selector"
          refractive={false}
          className="sidebar-company-glass"
          padding="0"
        >
          <div className="sidebar-company-card">
            <Select value={companyId} onValueChange={onCompanyChange}>
              <SelectTrigger
                className="sidebar-company-trigger"
                aria-label="选择当前研究企业"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper" className="liquid-menu">
                <SelectGroup>
                  {companySummaries.map((company) => (
                    <SelectItem key={company.id} value={company.id}>
                      {company.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <div className="mt-2 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-xs text-muted-foreground">
                  {detail.sector}
                </div>
              </div>
              <div className="sidebar-risk-score">
                <span>{assessment.label}</span>
                <strong>{assessment.scoreLabel}</strong>
              </div>
            </div>
          </div>
        </LiquidGlassSurface>

        <SidebarWorkflowNavigation
          activeNavigationItem={activeNavigationItem}
          companyId={companyId}
          onNavigate={onNavigate}
          onPreloadView={onPreloadView}
          signals={signals}
        />

        <div className="sidebar-footnote">
          <DatabaseZapIcon className="size-4" />
          <span>方法版本 · {assessment.methodVersion}</span>
        </div>
      </aside>
    </LiquidGlassSurface>
  )
}

function SidebarWorkflowNavigation({
  activeNavigationItem,
  companyId,
  onNavigate,
  onPreloadView,
  signals,
}: {
  activeNavigationItem: NavigationItemId
  companyId: string
  onNavigate: (target: NavigationTarget) => Promise<boolean>
  onPreloadView: (view: TabValue) => void
  signals: RealTimeSignal[]
}) {
  const [pendingNavigation, setPendingNavigation] = useState<{
    itemId: NavigationItemId
    companyId: string
  } | null>(null)
  const navigationRequestRef = useRef(0)
  const highPriorityCount = signals.filter(
    (signal) =>
      signal.companyIds.includes(companyId) && signal.severity === "high"
  ).length
  const displayedActiveItemId =
    pendingNavigation?.companyId === companyId
      ? pendingNavigation.itemId
      : activeNavigationItem

  const handleNavigate = async (item: NavItem) => {
    const requestId = navigationRequestRef.current + 1
    navigationRequestRef.current = requestId
    setPendingNavigation({ itemId: item.id, companyId })

    const accepted = await onNavigate(item.target)
    if (navigationRequestRef.current === requestId) {
      setPendingNavigation(null)
    }

    return accepted
  }

  return (
    <div className="sidebar-navigation-scroll">
      <nav className="sidebar-nav" aria-label="业务导航">
        {navGroups.map((group) => (
          <div key={group} className="sidebar-nav-group">
            <div className="sidebar-group-label">{group}</div>
            <div className="sidebar-nav-cluster">
              {navItems
                .filter((item) => item.group === group)
                .map((item) => (
                  <SidebarNavItem
                    key={item.id}
                    item={item}
                    active={displayedActiveItemId === item.id}
                    liveCount={
                      item.id === "realtime-intelligence"
                        ? highPriorityCount
                        : undefined
                    }
                    onClick={() => void handleNavigate(item)}
                    onPreload={() => onPreloadView(item.target.view)}
                  />
                ))}
            </div>
          </div>
        ))}
      </nav>
    </div>
  )
}

function SidebarNavItem({
  item,
  active,
  liveCount,
  onClick,
  onPreload,
}: {
  item: NavItem
  active: boolean
  liveCount?: number
  onClick: () => void
  onPreload: () => void
}) {
  const Icon = item.icon

  return (
    <button
      type="button"
      onClick={onClick}
      onPointerEnter={onPreload}
      onFocus={onPreload}
      aria-current={active ? "page" : undefined}
      className={cn("sidebar-nav-item", active && "sidebar-nav-item-active")}
    >
      <Icon className="size-5" />
      <span>{item.label}</span>
      {liveCount !== undefined && liveCount > 0 ? (
        <span className="sidebar-live-count" aria-label={`${liveCount} 条高优先级情报`}>
          <span className="sidebar-live-count-dot" />
          {liveCount}
        </span>
      ) : active ? (
        <span className="sidebar-active-dot" />
      ) : null}
    </button>
  )
}
