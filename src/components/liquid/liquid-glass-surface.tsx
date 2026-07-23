/* eslint-disable react-refresh/only-export-components */
import {
  lazy,
  Suspense,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"

import {
  reducedMotionPreferenceStore,
  usePrefersReducedMotion,
} from "@/components/motion/workflow-transition"

const LazyLiquidGlassNativeRenderer = lazy(
  () => import("./liquid-glass-native-renderer")
)

export type LiquidGlassVariant =
  | "sidebar"
  | "toolbar"
  | "panel"
  | "card"
  | "pill"
  | "nav-active"
  | "selector"
  | "floating"

export interface LiquidGlassSurfaceProps {
  children: ReactNode
  className?: string
  variant?: LiquidGlassVariant
  refractive?: boolean
  interactive?: boolean
  trackPointer?: boolean
  disabled?: boolean
  overLight?: boolean
  mouseContainer?: RefObject<HTMLElement | null> | null
  asFallback?: boolean
  padding?: string
  style?: CSSProperties
  onClick?: () => void
}

export interface LiquidGlassPreset {
  displacementScale: number
  blurAmount: number
  saturation: number
  aberrationIntensity: number
  elasticity: number
  cornerRadius: number
  mode: "standard" | "polar" | "prominent" | "shader"
  padding?: string
}

export const liquidGlassPresets: Record<LiquidGlassVariant, LiquidGlassPreset> =
  {
    sidebar: {
      displacementScale: 24,
      blurAmount: 0.04,
      saturation: 116,
      aberrationIntensity: 0.24,
      elasticity: 0.12,
      cornerRadius: 28,
      mode: "standard",
    },
    toolbar: {
      displacementScale: 26,
      blurAmount: 0.04,
      saturation: 118,
      aberrationIntensity: 0.25,
      elasticity: 0.16,
      cornerRadius: 26,
      mode: "standard",
    },
    panel: {
      displacementScale: 18,
      blurAmount: 0.045,
      saturation: 114,
      aberrationIntensity: 0.22,
      elasticity: 0.1,
      cornerRadius: 20,
      mode: "standard",
    },
    card: {
      displacementScale: 24,
      blurAmount: 0.045,
      saturation: 117,
      aberrationIntensity: 0.28,
      elasticity: 0.16,
      cornerRadius: 22,
      mode: "standard",
    },
    pill: {
      displacementScale: 20,
      blurAmount: 0.07,
      saturation: 115,
      aberrationIntensity: 0.2,
      elasticity: 0.16,
      cornerRadius: 999,
      mode: "standard",
      padding: "6px 12px",
    },
    "nav-active": {
      displacementScale: 22,
      blurAmount: 0.045,
      saturation: 116,
      aberrationIntensity: 0.24,
      elasticity: 0.18,
      cornerRadius: 16,
      mode: "standard",
    },
    selector: {
      displacementScale: 28,
      blurAmount: 0.045,
      saturation: 118,
      aberrationIntensity: 0.28,
      elasticity: 0.18,
      cornerRadius: 26,
      mode: "standard",
    },
    floating: {
      displacementScale: 28,
      blurAmount: 0.045,
      saturation: 118,
      aberrationIntensity: 0.3,
      elasticity: 0.18,
      cornerRadius: 24,
      mode: "standard",
    },
  }

const refractiveVariants = new Set<LiquidGlassVariant>([
  "sidebar",
  "toolbar",
  "pill",
  "selector",
  "floating",
])

const LIGHTWEIGHT_GLASS_QUERY =
  "(max-width: 767px), (pointer: coarse), (prefers-reduced-transparency: reduce), (prefers-contrast: more), (forced-colors: active)"
const lightweightGlassListeners = new Set<() => void>()

let lightweightGlassMediaQuery: MediaQueryList | null = null
let removeLightweightGlassListener: (() => void) | null = null
let cachedStaticLiquidGlassFallback: boolean | undefined

function getLightweightGlassMediaQuery() {
  if (typeof window === "undefined" || !window.matchMedia) {
    return null
  }

  lightweightGlassMediaQuery ??= window.matchMedia(LIGHTWEIGHT_GLASS_QUERY)
  return lightweightGlassMediaQuery
}

function getLightweightGlassSnapshot() {
  return getLightweightGlassMediaQuery()?.matches ?? true
}

function subscribeToLightweightGlass(listener: () => void) {
  const mediaQuery = getLightweightGlassMediaQuery()
  if (!mediaQuery) {
    return () => undefined
  }

  lightweightGlassListeners.add(listener)

  if (!removeLightweightGlassListener) {
    const notifyListeners = () => {
      lightweightGlassListeners.forEach((currentListener) => currentListener())
    }

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", notifyListeners)
      removeLightweightGlassListener = () => {
        mediaQuery.removeEventListener("change", notifyListeners)
      }
    } else {
      mediaQuery.addListener(notifyListeners)
      removeLightweightGlassListener = () => {
        mediaQuery.removeListener(notifyListeners)
      }
    }
  }

  return () => {
    lightweightGlassListeners.delete(listener)

    if (lightweightGlassListeners.size === 0) {
      removeLightweightGlassListener?.()
      removeLightweightGlassListener = null
    }
  }
}

function usePrefersLightweightGlass() {
  return useSyncExternalStore(
    subscribeToLightweightGlass,
    getLightweightGlassSnapshot,
    () => true
  )
}

function getStaticLiquidGlassFallback(): boolean {
  if (typeof window === "undefined") return true
  if (cachedStaticLiquidGlassFallback !== undefined) {
    return cachedStaticLiquidGlassFallback
  }

  const ua = navigator.userAgent.toLowerCase()
  const isSafari =
    /^((?!chrome|android).)*safari/i.test(ua) && !ua.includes("edg")
  const isFirefox = ua.includes("firefox")
  const supportsBackdropFilter =
    typeof CSS !== "undefined" &&
    (CSS.supports("backdrop-filter", "blur(1px)") ||
      CSS.supports("-webkit-backdrop-filter", "blur(1px)"))
  const supportsSvgFilter =
    typeof SVGFEColorMatrixElement !== "undefined" &&
    typeof SVGFEDisplacementMapElement !== "undefined"

  cachedStaticLiquidGlassFallback =
    isSafari || isFirefox || !supportsBackdropFilter || !supportsSvgFilter

  return cachedStaticLiquidGlassFallback
}

export function getLiquidGlassFallback(): boolean {
  return (
    getStaticLiquidGlassFallback() || reducedMotionPreferenceStore.getSnapshot()
  )
}

export function LiquidGlassSurface({
  children,
  className = "",
  variant = "card",
  refractive,
  interactive = false,
  trackPointer = false,
  disabled = false,
  overLight,
  mouseContainer = null,
  asFallback = false,
  padding,
  style,
  onClick,
}: LiquidGlassSurfaceProps) {
  const prefersReducedMotion = usePrefersReducedMotion()
  const prefersLightweightGlass = usePrefersLightweightGlass()
  const shouldUseFallback =
    asFallback || prefersReducedMotion || getStaticLiquidGlassFallback()
  const shouldUseRefraction = refractive ?? refractiveVariants.has(variant)
  const canRenderNative =
    !shouldUseFallback && !prefersLightweightGlass && shouldUseRefraction
  const [isNativeRendererReady, setIsNativeRendererReady] = useState(false)
  const isNativeRendererVisible = canRenderNative && isNativeRendererReady
  const shouldTrackPointer = trackPointer && !disabled && canRenderNative
  const surfaceRef = useRef<HTMLDivElement>(null)
  const pointerFrameRef = useRef<number | null>(null)
  const pointerMonitorCleanupRef = useRef<(() => void) | null>(null)
  const isSettlingRef = useRef(false)
  const pointerHistoryRef = useRef({
    x: 50,
    y: 18,
    time: 0,
  })
  const pointerVisualRef = useRef({
    x: 50,
    y: 18,
    dx: 0,
    dy: 0,
    speed: 0,
    active: 0,
  })
  const handleClick = disabled ? undefined : onClick
  const handleNativeRendererReady = useCallback(() => {
    setIsNativeRendererReady(true)
  }, [])
  const surfaceStyle = {
    ...style,
    cursor: interactive ? "pointer" : style?.cursor,
  }

  useEffect(
    () => () => {
      pointerMonitorCleanupRef.current?.()

      if (pointerFrameRef.current !== null) {
        window.cancelAnimationFrame(pointerFrameRef.current)
      }
    },
    []
  )

  useEffect(() => {
    if (shouldTrackPointer) {
      return
    }

    pointerMonitorCleanupRef.current?.()
    pointerMonitorCleanupRef.current = null

    if (pointerFrameRef.current !== null) {
      window.cancelAnimationFrame(pointerFrameRef.current)
      pointerFrameRef.current = null
    }

    const surface = surfaceRef.current
    surface?.removeAttribute("data-pressed")
    surface?.style.setProperty("--glass-pointer-x", "50%")
    surface?.style.setProperty("--glass-pointer-y", "18%")
    surface?.style.setProperty("--glass-pointer-dx", "0")
    surface?.style.setProperty("--glass-pointer-dy", "0")
    surface?.style.setProperty("--glass-pointer-speed", "0")
    surface?.style.setProperty("--glass-pointer-active", "0")
    pointerHistoryRef.current = { x: 50, y: 18, time: 0 }
    pointerVisualRef.current = {
      x: 50,
      y: 18,
      dx: 0,
      dy: 0,
      speed: 0,
      active: 0,
    }
    isSettlingRef.current = false
  }, [shouldTrackPointer])

  function stopPointerMonitoring() {
    pointerMonitorCleanupRef.current?.()
    pointerMonitorCleanupRef.current = null
  }

  function settlePointer(surface: HTMLDivElement) {
    if (isSettlingRef.current) return

    isSettlingRef.current = true
    stopPointerMonitoring()

    const start = performance.now()
    const origin = pointerVisualRef.current
    const duration = 300

    if (pointerFrameRef.current !== null) {
      window.cancelAnimationFrame(pointerFrameRef.current)
      pointerFrameRef.current = null
    }

    surface.removeAttribute("data-pressed")

    const settle = (now: number) => {
      const progress = Math.min((now - start) / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3)
      const remaining = 1 - eased
      const x = origin.x + (50 - origin.x) * eased
      const y = origin.y + (18 - origin.y) * eased
      const dx = origin.dx * remaining
      const dy = origin.dy * remaining
      const speed = origin.speed * remaining * remaining
      const active = origin.active * remaining

      surface.style.setProperty("--glass-pointer-x", `${x.toFixed(2)}%`)
      surface.style.setProperty("--glass-pointer-y", `${y.toFixed(2)}%`)
      surface.style.setProperty("--glass-pointer-dx", dx.toFixed(3))
      surface.style.setProperty("--glass-pointer-dy", dy.toFixed(3))
      surface.style.setProperty("--glass-pointer-speed", speed.toFixed(3))
      surface.style.setProperty("--glass-pointer-active", active.toFixed(3))

      pointerVisualRef.current = { x, y, dx, dy, speed, active }

      if (progress < 1) {
        pointerFrameRef.current = window.requestAnimationFrame(settle)
        return
      }

      pointerHistoryRef.current = { x: 50, y: 18, time: 0 }
      pointerVisualRef.current = {
        x: 50,
        y: 18,
        dx: 0,
        dy: 0,
        speed: 0,
        active: 0,
      }
      isSettlingRef.current = false
      pointerFrameRef.current = null
    }

    pointerFrameRef.current = window.requestAnimationFrame(settle)
  }

  function startPointerMonitoring(surface: HTMLDivElement) {
    if (pointerMonitorCleanupRef.current) return

    const handleWindowPointerMove = (event: PointerEvent) => {
      const rect = surface.getBoundingClientRect()
      const isOutside =
        event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom

      if (isOutside) {
        settlePointer(surface)
      }
    }
    const handleWindowExit = () => settlePointer(surface)

    window.addEventListener("pointermove", handleWindowPointerMove, {
      passive: true,
    })
    window.addEventListener("blur", handleWindowExit)
    document.addEventListener("mouseleave", handleWindowExit)
    pointerMonitorCleanupRef.current = () => {
      window.removeEventListener("pointermove", handleWindowPointerMove)
      window.removeEventListener("blur", handleWindowExit)
      document.removeEventListener("mouseleave", handleWindowExit)
    }
  }

  const updatePointerPosition = (event: ReactPointerEvent<HTMLDivElement>) => {
    const surface = event.currentTarget
    const rect = surface.getBoundingClientRect()
    const x = ((event.clientX - rect.left) / rect.width) * 100
    const y = ((event.clientY - rect.top) / rect.height) * 100
    const now = performance.now()
    const elapsed = pointerHistoryRef.current.time
      ? Math.max(now - pointerHistoryRef.current.time, 16)
      : 16
    const deltaX = x - pointerHistoryRef.current.x
    const deltaY = y - pointerHistoryRef.current.y
    const velocity = Math.min(Math.hypot(deltaX, deltaY) / (elapsed / 16), 12)
    const normalizedX = Math.max(-0.5, Math.min(0.5, x / 100 - 0.5))
    const normalizedY = Math.max(-0.5, Math.min(0.5, y / 100 - 0.5))

    pointerHistoryRef.current = { x, y, time: now }
    isSettlingRef.current = false
    startPointerMonitoring(surface)

    if (pointerFrameRef.current !== null) {
      window.cancelAnimationFrame(pointerFrameRef.current)
    }

    pointerFrameRef.current = window.requestAnimationFrame(() => {
      surface.style.setProperty("--glass-pointer-x", `${x}%`)
      surface.style.setProperty("--glass-pointer-y", `${y}%`)
      surface.style.setProperty("--glass-pointer-dx", normalizedX.toFixed(3))
      surface.style.setProperty("--glass-pointer-dy", normalizedY.toFixed(3))
      surface.style.setProperty(
        "--glass-pointer-speed",
        (velocity / 12).toFixed(3)
      )
      surface.style.setProperty("--glass-pointer-active", "1")
      pointerVisualRef.current = {
        x,
        y,
        dx: normalizedX,
        dy: normalizedY,
        speed: velocity / 12,
        active: 1,
      }
      pointerFrameRef.current = null
    })
  }

  const handlePointerLeave = (
    event: ReactPointerEvent<HTMLDivElement> | ReactMouseEvent<HTMLDivElement>
  ) => {
    if (shouldTrackPointer) {
      settlePointer(event.currentTarget)
    } else {
      event.currentTarget.removeAttribute("data-pressed")
    }
  }

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!disabled && interactive) {
      event.currentTarget.dataset.pressed = "true"
    }
  }

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.currentTarget.removeAttribute("data-pressed")
  }

  const renderSurfaceLayers = () => (
    <>
      <span className="liquid-glass-specular" aria-hidden="true" />
      <span className="liquid-glass-caustic" aria-hidden="true" />
    </>
  )

  const sharedSurfaceProps = {
    "data-interactive": interactive ? "true" : "false",
    "data-disabled": disabled ? "true" : "false",
    onClick: handleClick,
    ...(interactive
      ? {
          onPointerDown: handlePointerDown,
          onPointerLeave: handlePointerLeave,
          onPointerUp: handlePointerUp,
          onPointerCancel: handlePointerLeave,
        }
      : {}),
    ...(shouldTrackPointer
      ? {
          onPointerEnter: updatePointerPosition,
          onPointerLeave: handlePointerLeave,
          onMouseLeave: handlePointerLeave,
          onPointerMove: updatePointerPosition,
        }
      : {}),
    style: surfaceStyle,
  } as const

  const preset = liquidGlassPresets[variant]
  const isOverLight = overLight ?? false
  const surfaceClassName = `liquid-glass-surface ${
    isNativeRendererVisible
      ? "liquid-glass-native"
      : shouldUseFallback
        ? "liquid-glass-fallback"
        : "liquid-glass-css"
  } ${className}`
  const surfaceContent = (
    <>
      {canRenderNative ? (
        <Suspense
          fallback={
            <span className="liquid-glass-effect-host" aria-hidden="true" />
          }
        >
          <LazyLiquidGlassNativeRenderer
            preset={preset}
            mouseContainer={mouseContainer ?? surfaceRef}
            trackPointer={shouldTrackPointer}
            overLight={isOverLight}
            onReady={handleNativeRendererReady}
          />
        </Suspense>
      ) : null}
      {renderSurfaceLayers()}
      <div
        className="liquid-glass-content"
        style={padding ? { padding } : undefined}
      >
        {children}
      </div>
    </>
  )

  if (isNativeRendererVisible) {
    return (
      <div
        ref={surfaceRef}
        className={surfaceClassName}
        data-variant={variant}
        data-renderer="native"
        data-refraction="on"
        {...sharedSurfaceProps}
      >
        {surfaceContent}
      </div>
    )
  }

  return (
    <div
      ref={surfaceRef}
      className={surfaceClassName}
      data-variant={variant}
      data-renderer={shouldUseFallback ? "fallback" : "css"}
      data-refraction="off"
      {...sharedSurfaceProps}
    >
      {surfaceContent}
    </div>
  )
}

export default LiquidGlassSurface
