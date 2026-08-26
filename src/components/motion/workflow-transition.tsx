/* eslint-disable react-refresh/only-export-components */
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react"
import { useGSAP } from "@gsap/react"
import gsap from "gsap"

import type { TabValue } from "@/types/risk"

gsap.registerPlugin(useGSAP)

export const PRODUCTIVE_MOTION = {
  micro: 0.1,
  fast: 0.16,
  state: 0.24,
  scene: 0.38,
  data: 0.44,
  graph: 0.52,
  easeEnter: "power3.out",
  easeStandard: "power2.inOut",
  easeData: "power2.out",
} as const

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)"
const reducedMotionListeners = new Set<() => void>()
const revealCallbacks = new Map<Element, () => void>()

let reducedMotionMediaQuery: MediaQueryList | null = null
let removeReducedMotionListener: (() => void) | null = null
let sharedRevealObserver: IntersectionObserver | null = null

function getReducedMotionMediaQuery() {
  if (typeof window === "undefined" || !window.matchMedia) {
    return null
  }

  reducedMotionMediaQuery ??= window.matchMedia(REDUCED_MOTION_QUERY)
  return reducedMotionMediaQuery
}

function getReducedMotionSnapshot() {
  return getReducedMotionMediaQuery()?.matches ?? true
}

function subscribeToReducedMotion(listener: () => void) {
  const mediaQuery = getReducedMotionMediaQuery()
  if (!mediaQuery) {
    return () => undefined
  }

  reducedMotionListeners.add(listener)

  if (!removeReducedMotionListener) {
    const notifyListeners = () => {
      reducedMotionListeners.forEach((currentListener) => currentListener())
    }

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", notifyListeners)
      removeReducedMotionListener = () => {
        mediaQuery.removeEventListener("change", notifyListeners)
      }
    } else {
      mediaQuery.addListener(notifyListeners)
      removeReducedMotionListener = () => {
        mediaQuery.removeListener(notifyListeners)
      }
    }
  }

  return () => {
    reducedMotionListeners.delete(listener)

    if (reducedMotionListeners.size === 0) {
      removeReducedMotionListener?.()
      removeReducedMotionListener = null
    }
  }
}

export const reducedMotionPreferenceStore = {
  getSnapshot: getReducedMotionSnapshot,
  subscribe: subscribeToReducedMotion,
}

export function usePrefersReducedMotion() {
  return useSyncExternalStore(
    reducedMotionPreferenceStore.subscribe,
    reducedMotionPreferenceStore.getSnapshot,
    () => true
  )
}

function getSharedRevealObserver() {
  if (typeof window === "undefined" || !("IntersectionObserver" in window)) {
    return null
  }

  sharedRevealObserver ??= new window.IntersectionObserver(
    (entries, observer) => {
      entries.forEach((entry) => {
        const reveal = revealCallbacks.get(entry.target)
        if (!entry.isIntersecting || !reveal) {
          return
        }

        revealCallbacks.delete(entry.target)
        observer.unobserve(entry.target)
        reveal()
      })
    },
    {
      rootMargin: "0px 0px -8% 0px",
      threshold: 0.06,
    }
  )

  return sharedRevealObserver
}

export function observeRevealElement(element: Element, reveal: () => void) {
  const observer = getSharedRevealObserver()
  if (!observer) {
    reveal()
    return () => undefined
  }

  revealCallbacks.set(element, reveal)
  observer.observe(element)

  return () => {
    if (revealCallbacks.get(element) !== reveal) {
      return
    }

    revealCallbacks.delete(element)
    observer.unobserve(element)
  }
}

export function WorkflowTransition({
  view,
  children,
}: {
  view: TabValue
  children: ReactNode
}) {
  const sceneRef = useRef<HTMLDivElement>(null)
  const prefersReducedMotion = usePrefersReducedMotion()

  useGSAP(
    () => {
      const scene = sceneRef.current
      if (!scene) return

      if (prefersReducedMotion) {
        gsap.set(scene, { clearProps: "opacity,transform" })
        return
      }

      gsap.fromTo(
        scene,
        { autoAlpha: 0, y: 10 },
        {
          autoAlpha: 1,
          y: 0,
          duration: PRODUCTIVE_MOTION.scene,
          ease: PRODUCTIVE_MOTION.easeEnter,
          clearProps: "opacity,transform,visibility",
          overwrite: "auto",
        }
      )
    },
    {
      scope: sceneRef,
      dependencies: [view, prefersReducedMotion],
      revertOnUpdate: true,
    }
  )

  return (
    <div ref={sceneRef} className="workflow-transition" data-view={view}>
      {children}
    </div>
  )
}

export function Reveal({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  const elementRef = useRef<HTMLDivElement>(null)
  const prefersReducedMotion = usePrefersReducedMotion()
  const supportsIntersectionObserver =
    typeof window !== "undefined" && "IntersectionObserver" in window
  const [hasRevealed, setHasRevealed] = useState(
    () => prefersReducedMotion || !supportsIntersectionObserver
  )
  const revealState =
    prefersReducedMotion || !supportsIntersectionObserver || hasRevealed
      ? "visible"
      : "pending"

  useEffect(() => {
    if (!prefersReducedMotion) {
      return undefined
    }

    const frameId = window.requestAnimationFrame(() => {
      setHasRevealed(true)
    })

    return () => window.cancelAnimationFrame(frameId)
  }, [prefersReducedMotion])

  useEffect(() => {
    if (revealState === "visible") {
      return undefined
    }

    const element = elementRef.current
    if (!element) {
      return undefined
    }

    return observeRevealElement(element, () => setHasRevealed(true))
  }, [revealState])

  return (
    <div
      ref={elementRef}
      className={["motion-reveal", className].filter(Boolean).join(" ")}
      data-reveal-state={revealState}
    >
      {children}
    </div>
  )
}
