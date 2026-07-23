import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react"

import { SidebarNav } from "@/components/layout/sidebar-nav"
import { TopCommandBar } from "@/components/layout/top-command-bar"
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet"
import {
  getNavigationItem,
  getNavigationItemIdForTarget,
  resolveActiveNavigationItem,
} from "@/lib/nav-data"
import type { NavigationItemId, NavigationTarget } from "@/types/nav"
import type {
  CompanyDetail,
  CompanySummary,
  OperationsSection,
  RealTimeSignal,
  ResearchSection,
  RiskAssessment,
  TabValue,
} from "@/types/risk"

const DESKTOP_LAYOUT_QUERY = "(min-width: 1024px)"
const desktopLayoutListeners = new Set<() => void>()

let desktopLayoutMediaQuery: MediaQueryList | null = null
let removeDesktopLayoutListener: (() => void) | null = null

function getDesktopLayoutMediaQuery() {
  if (typeof window === "undefined" || !window.matchMedia) {
    return null
  }

  desktopLayoutMediaQuery ??= window.matchMedia(DESKTOP_LAYOUT_QUERY)
  return desktopLayoutMediaQuery
}

function getDesktopLayoutSnapshot() {
  return getDesktopLayoutMediaQuery()?.matches ?? false
}

function subscribeToDesktopLayout(listener: () => void) {
  const mediaQuery = getDesktopLayoutMediaQuery()
  if (!mediaQuery) {
    return () => undefined
  }

  desktopLayoutListeners.add(listener)

  if (!removeDesktopLayoutListener) {
    const notifyListeners = () => {
      desktopLayoutListeners.forEach((currentListener) => currentListener())
    }

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", notifyListeners)
      removeDesktopLayoutListener = () => {
        mediaQuery.removeEventListener("change", notifyListeners)
      }
    } else {
      mediaQuery.addListener(notifyListeners)
      removeDesktopLayoutListener = () => {
        mediaQuery.removeListener(notifyListeners)
      }
    }
  }

  return () => {
    desktopLayoutListeners.delete(listener)

    if (desktopLayoutListeners.size === 0) {
      removeDesktopLayoutListener?.()
      removeDesktopLayoutListener = null
    }
  }
}

function useDesktopLayout() {
  return useSyncExternalStore(
    subscribeToDesktopLayout,
    getDesktopLayoutSnapshot,
    () => false
  )
}

type AppShellProps = {
  activeView: TabValue
  researchSection: ResearchSection
  operationsSection: OperationsSection
  children: ReactNode
  companyId: string
  detail: CompanyDetail
  assessment: RiskAssessment
  companySummaries: CompanySummary[]
  theme: string
  onCompanyChange: (companyId: string) => void
  onNavigate: (target: NavigationTarget) => Promise<boolean>
  onPreloadView: (view: TabValue) => void
  onOpenExports: () => void
  onResetDemo: () => void
  onToggleTheme: () => void
  feedback: string
  signals: RealTimeSignal[]
}

type NavigationFocusRequest = {
  accepted: boolean | null
  itemId: NavigationItemId
  sheetClosed: boolean
  source: "desktop" | "mobile"
}

export function AppShell({
  activeView,
  researchSection,
  operationsSection,
  children,
  companyId,
  detail,
  assessment,
  companySummaries,
  theme,
  onCompanyChange,
  onNavigate,
  onPreloadView,
  onOpenExports,
  onResetDemo,
  onToggleTheme,
  feedback,
  signals,
}: AppShellProps) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const isDesktop = useDesktopLayout()
  const mobileNavButtonRef = useRef<HTMLButtonElement>(null)
  const mainContentRef = useRef<HTMLElement>(null)
  const activeNavigationItem = resolveActiveNavigationItem(
    activeView,
    researchSection,
    operationsSection
  )
  const activeNav = getNavigationItem(activeNavigationItem)
  const activeNavigationItemRef = useRef(activeNavigationItem)
  const navigationFocusRequestRef = useRef<NavigationFocusRequest | null>(null)

  const focusMainContent = useCallback(() => {
    window.requestAnimationFrame(() => {
      mainContentRef.current?.focus({ preventScroll: true })
    })
  }, [])

  const settleNavigationFocus = useCallback(
    (request = navigationFocusRequestRef.current) => {
      if (!request || navigationFocusRequestRef.current !== request) {
        return
      }

      if (request.source === "mobile" && !request.sheetClosed) {
        return
      }

      if (request.accepted === false) {
        navigationFocusRequestRef.current = null
        if (request.source === "mobile") {
          mobileNavButtonRef.current?.focus({ preventScroll: true })
        }
        return
      }

      if (
        request.accepted !== true ||
        request.itemId !== activeNavigationItemRef.current
      ) {
        return
      }

      navigationFocusRequestRef.current = null
      focusMainContent()
    },
    [focusMainContent]
  )

  useEffect(() => {
    activeNavigationItemRef.current = activeNavigationItem
    settleNavigationFocus()
  }, [activeNavigationItem, settleNavigationFocus])

  const beginNavigationFocus = (
    target: NavigationTarget,
    source: NavigationFocusRequest["source"]
  ) => {
    const itemId = getNavigationItemIdForTarget(target)
    const currentRequest = navigationFocusRequestRef.current
    if (
      source === "mobile" &&
      currentRequest?.source === "mobile" &&
      currentRequest.itemId === itemId &&
      currentRequest.accepted === null
    ) {
      return currentRequest
    }

    const request: NavigationFocusRequest = {
      accepted: null,
      itemId,
      sheetClosed: source === "desktop",
      source,
    }
    navigationFocusRequestRef.current = request

    if (source === "mobile") {
      setMobileNavOpen(false)
    }

    return request
  }

  const handleNavigation = async (
    target: NavigationTarget,
    source: NavigationFocusRequest["source"]
  ) => {
    const request = beginNavigationFocus(target, source)
    const accepted = await onNavigate(target)

    if (navigationFocusRequestRef.current === request) {
      request.accepted = accepted
      settleNavigationFocus(request)
    }

    return accepted
  }

  const handleReset = () => {
    onResetDemo()
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        跳至主要内容
      </a>

      {isDesktop ? (
        <SidebarNav
          activeNavigationItem={activeNavigationItem}
          detail={detail}
          assessment={assessment}
          companySummaries={companySummaries}
          companyId={companyId}
          onCompanyChange={onCompanyChange}
          onNavigate={(target) => handleNavigation(target, "desktop")}
          onPreloadView={onPreloadView}
          signals={signals}
        />
      ) : (
        <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
          <SheetContent
            side="left"
            size="navigation"
            className="mobile-sidebar-panel p-0"
            showCloseButton={false}
            onCloseAutoFocus={(event) => {
              event.preventDefault()
              const request = navigationFocusRequestRef.current
              if (request?.source === "mobile") {
                request.sheetClosed = true
                settleNavigationFocus(request)
                return
              }

              mobileNavButtonRef.current?.focus()
            }}
          >
            <SheetTitle className="sr-only">移动端导航</SheetTitle>
            <SidebarNav
              activeNavigationItem={activeNavigationItem}
              detail={detail}
              assessment={assessment}
              companySummaries={companySummaries}
              companyId={companyId}
              onCompanyChange={(value) => {
                onCompanyChange(value)
                setMobileNavOpen(false)
              }}
              onNavigate={(target) => handleNavigation(target, "mobile")}
              onPreloadView={onPreloadView}
              signals={signals}
            />
          </SheetContent>
        </Sheet>
      )}

      <main
        id="main-content"
        ref={mainContentRef}
        className="app-main"
        data-view={activeView}
        tabIndex={-1}
        aria-labelledby="app-page-title"
      >
        <TopCommandBar
          group={activeNav.group}
          title={activeNav.label}
          description={activeNav.description}
          theme={theme}
          onToggleTheme={onToggleTheme}
          onOpenExports={onOpenExports}
          onResetDemo={handleReset}
          onOpenMobileNav={() => setMobileNavOpen(true)}
          mobileNavButtonRef={mobileNavButtonRef}
          feedback={feedback}
        />
        <div className="app-content">{children}</div>
      </main>
    </div>
  )
}
