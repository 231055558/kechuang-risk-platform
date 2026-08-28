import {
  MenuIcon,
  MoonStarIcon,
  RefreshCwIcon,
  SunMediumIcon,
  type LucideIcon,
} from "lucide-react"
import type { RefObject } from "react"

import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

type GlobalShellControlsProps = {
  theme: string
  onToggleTheme: () => void
  onResetDemo: () => void
  onOpenMobileNav: () => void
  mobileNavButtonRef: RefObject<HTMLButtonElement | null>
  feedback: string
}

export function GlobalShellControls({
  theme,
  onToggleTheme,
  onResetDemo,
  onOpenMobileNav,
  mobileNavButtonRef,
  feedback,
}: GlobalShellControlsProps) {
  return (
    <div className="risk-os-global-controls-wrap">
      {feedback ? (
        <div
          className="risk-os-global-feedback"
          role="status"
          aria-live="polite"
        >
          {feedback}
        </div>
      ) : null}
      <div className="risk-os-global-controls" aria-label="全局页面控制">
        <GlobalControlAction
          icon={MenuIcon}
          label="打开导航"
          onClick={onOpenMobileNav}
          className="risk-os-global-mobile-nav lg:hidden"
          buttonRef={mobileNavButtonRef}
        />
        <GlobalControlAction
          icon={theme === "dark" ? SunMediumIcon : MoonStarIcon}
          label={theme === "dark" ? "切换到浅色模式" : "切换到暗色模式"}
          onClick={onToggleTheme}
        />
        <GlobalControlAction
          icon={RefreshCwIcon}
          label="恢复初始状态"
          onClick={onResetDemo}
        />
      </div>
    </div>
  )
}

function GlobalControlAction({
  icon: Icon,
  label,
  onClick,
  className,
  buttonRef,
}: {
  icon: LucideIcon
  label: string
  onClick: () => void
  className?: string
  buttonRef?: RefObject<HTMLButtonElement | null>
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          ref={buttonRef}
          variant="outline"
          size="icon-sm"
          className={className}
          onClick={onClick}
          aria-label={label}
        >
          <Icon aria-hidden="true" />
          <span className="sr-only">{label}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={8}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}
