import {
  ActivityIcon,
  DownloadIcon,
  type LucideIcon,
  MenuIcon,
  MoonStarIcon,
  RefreshCwIcon,
  SunMediumIcon,
} from "lucide-react"
import { useEffect, useRef, useState, type RefObject } from "react"

import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

type TopCommandBarProps = {
  group: string
  title: string
  description: string
  companyName: string
  companySector: string
  snapshotAt: string
  theme: string
  onToggleTheme: () => void
  onOpenExports: () => void
  onResetDemo: () => void
  onOpenMobileNav: () => void
  mobileNavButtonRef: RefObject<HTMLButtonElement | null>
  feedback: string
}

export function TopCommandBar({
  group,
  title,
  description,
  companyName,
  companySector,
  snapshotAt,
  theme,
  onToggleTheme,
  onOpenExports,
  onResetDemo,
  onOpenMobileNav,
  mobileNavButtonRef,
  feedback,
}: TopCommandBarProps) {
  const [isCompact, setIsCompact] = useState(false)
  const compactStateRef = useRef(false)
  const commandRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    let frame = 0
    const root = document.documentElement
    const surface = commandRef.current?.closest(
      ".risk-os-command-surface"
    ) as HTMLElement | null

    const updateCompactState = () => {
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(() => {
        const scrollY = window.scrollY
        const collapseProgress = Math.min(Math.max((scrollY - 4) / 64, 0), 1)
        const nextIsCompact = compactStateRef.current
          ? scrollY > 18
          : scrollY > 34

        root.style.setProperty(
          "--command-height",
          `${(80 - collapseProgress * 14).toFixed(2)}px`
        )
        root.style.setProperty(
          "--command-padding-y",
          `${(12 - collapseProgress * 4).toFixed(2)}px`
        )
        root.style.setProperty(
          "--command-title-size",
          `${(21 - collapseProgress * 2).toFixed(2)}px`
        )
        root.style.setProperty(
          "--command-description-opacity",
          (1 - collapseProgress).toFixed(3)
        )
        root.style.setProperty(
          "--command-description-shift",
          `${(-collapseProgress * 3).toFixed(2)}px`
        )
        if (surface) {
          root.style.setProperty(
            "--sticky-command-offset",
            `${Math.ceil(surface.getBoundingClientRect().bottom + 12)}px`
          )
        }

        if (compactStateRef.current === nextIsCompact) {
          return
        }

        compactStateRef.current = nextIsCompact
        setIsCompact(nextIsCompact)
      })
    }

    updateCompactState()
    window.addEventListener("scroll", updateCompactState, { passive: true })
    window.addEventListener("resize", updateCompactState, { passive: true })
    const resizeObserver =
      surface && typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(updateCompactState)
        : null
    if (surface) {
      resizeObserver?.observe(surface)
    }

    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener("scroll", updateCompactState)
      window.removeEventListener("resize", updateCompactState)
      resizeObserver?.disconnect()
      root.style.removeProperty("--command-height")
      root.style.removeProperty("--command-padding-y")
      root.style.removeProperty("--command-title-size")
      root.style.removeProperty("--command-description-opacity")
      root.style.removeProperty("--command-description-shift")
      root.style.removeProperty("--sticky-command-offset")
    }
  }, [])

  return (
    <div
      className={cn(
        "risk-os-command-surface",
        isCompact && "risk-os-command-surface-compact"
      )}
    >
      <header className="top-command risk-os-command" ref={commandRef}>
        <div className="top-command-copy">
          <Button
            variant="ghost"
            size="icon-sm"
            className="top-mobile-nav-button lg:hidden"
            onClick={onOpenMobileNav}
            aria-label="打开导航"
            ref={mobileNavButtonRef}
          >
            <MenuIcon data-icon="inline-start" />
            <span className="sr-only">打开导航</span>
          </Button>
          <div className="top-command-text">
            <div className="top-command-context">{group}</div>
            <h1 id="app-page-title" className="top-command-title">
              {title}
            </h1>
            <div className="top-command-description">{description}</div>
          </div>
        </div>

        <div className="risk-os-command-context" aria-label="当前研究上下文">
          <span>
            <ActivityIcon aria-hidden="true" />
            数据在线
          </span>
          <strong>{companyName}</strong>
          <span>{companySector}</span>
          <time>{snapshotAt}</time>
        </div>

        <div className="top-command-actions">
          <TopIconAction
            icon={theme === "dark" ? SunMediumIcon : MoonStarIcon}
            label={theme === "dark" ? "切换到浅色模式" : "切换到暗色模式"}
            onClick={onToggleTheme}
          />
          <TopIconAction
            icon={DownloadIcon}
            label="导出风险材料"
            onClick={onOpenExports}
            className="top-export-action"
          />
          <TopIconAction
            icon={RefreshCwIcon}
            label="恢复初始状态"
            onClick={onResetDemo}
          />
        </div>
        {feedback ? (
          <div className="top-feedback" role="status" aria-live="polite">
            {feedback}
          </div>
        ) : null}
      </header>
    </div>
  )
}

function TopIconAction({
  icon: Icon,
  label,
  className = "",
  onClick,
}: {
  icon: LucideIcon
  label: string
  className?: string
  onClick: () => void
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="outline"
          size="icon-sm"
          className={cn("top-icon-button", className)}
          onClick={onClick}
          aria-label={label}
        >
          <Icon data-icon="inline-start" />
          <span className="sr-only">{label}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={8}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}
