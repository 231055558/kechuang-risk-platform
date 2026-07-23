import { useEffect } from "react"

const RESTING_X = 0
const RESTING_Y = -4

export function useGlassEnvironment() {
  useEffect(() => {
    const root = document.documentElement
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches

    if (reducedMotion) {
      root.style.setProperty("--ambient-shift-x", `${RESTING_X}px`)
      root.style.setProperty("--ambient-shift-y", `${RESTING_Y}px`)
      root.style.setProperty("--ambient-scroll", "0")
      return undefined
    }

    let frame = 0
    let currentX = RESTING_X
    let currentY = RESTING_Y
    let targetX = RESTING_X
    let targetY = RESTING_Y
    let currentScroll = 0
    let targetScroll = 0

    const render = () => {
      currentX += (targetX - currentX) * 0.1
      currentY += (targetY - currentY) * 0.1
      currentScroll += (targetScroll - currentScroll) * 0.12

      root.style.setProperty("--ambient-shift-x", `${currentX.toFixed(2)}px`)
      root.style.setProperty("--ambient-shift-y", `${currentY.toFixed(2)}px`)
      root.style.setProperty("--ambient-scroll", currentScroll.toFixed(3))

      const isSettled =
        Math.abs(targetX - currentX) < 0.02 &&
        Math.abs(targetY - currentY) < 0.02 &&
        Math.abs(targetScroll - currentScroll) < 0.002

      frame = isSettled ? 0 : window.requestAnimationFrame(render)
    }

    const requestRender = () => {
      if (!frame) {
        frame = window.requestAnimationFrame(render)
      }
    }

    const handlePointerMove = (event: PointerEvent) => {
      const horizontal = event.clientX / Math.max(window.innerWidth, 1) - 0.5
      const vertical = event.clientY / Math.max(window.innerHeight, 1) - 0.5
      targetX = horizontal * 14
      targetY = vertical * 10 - 2
      requestRender()
    }

    const handlePointerLeave = () => {
      targetX = RESTING_X
      targetY = RESTING_Y
      requestRender()
    }

    const handleScroll = () => {
      targetScroll = Math.min(window.scrollY / 520, 1)
      requestRender()
    }

    window.addEventListener("pointermove", handlePointerMove, { passive: true })
    document.addEventListener("mouseleave", handlePointerLeave)
    window.addEventListener("blur", handlePointerLeave)
    window.addEventListener("scroll", handleScroll, { passive: true })
    handleScroll()

    return () => {
      if (frame) {
        window.cancelAnimationFrame(frame)
      }
      window.removeEventListener("pointermove", handlePointerMove)
      document.removeEventListener("mouseleave", handlePointerLeave)
      window.removeEventListener("blur", handlePointerLeave)
      window.removeEventListener("scroll", handleScroll)
      root.style.removeProperty("--ambient-shift-x")
      root.style.removeProperty("--ambient-shift-y")
      root.style.removeProperty("--ambient-scroll")
    }
  }, [])
}
