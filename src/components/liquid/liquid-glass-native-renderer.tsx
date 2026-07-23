import { type RefObject, useLayoutEffect } from "react"
import LiquidGlass from "liquid-glass-react"

import type { LiquidGlassPreset } from "./liquid-glass-surface"

const STATIC_MOUSE_POSITION = { x: 0, y: 0 }
const STATIC_MOUSE_OFFSET = { x: 0, y: 0 }

interface LiquidGlassNativeRendererProps {
  preset: LiquidGlassPreset
  mouseContainer: RefObject<HTMLElement | null>
  trackPointer: boolean
  overLight: boolean
  onReady: () => void
}

export default function LiquidGlassNativeRenderer({
  preset,
  mouseContainer,
  trackPointer,
  overLight,
  onReady,
}: LiquidGlassNativeRendererProps) {
  useLayoutEffect(() => {
    onReady()
  }, [onReady])

  return (
    <div className="liquid-glass-effect-host" aria-hidden="true">
      <LiquidGlass
        displacementScale={preset.displacementScale}
        blurAmount={preset.blurAmount}
        saturation={preset.saturation}
        aberrationIntensity={preset.aberrationIntensity}
        elasticity={preset.elasticity}
        cornerRadius={preset.cornerRadius}
        mode={preset.mode}
        mouseContainer={mouseContainer}
        globalMousePos={trackPointer ? undefined : STATIC_MOUSE_POSITION}
        mouseOffset={trackPointer ? undefined : STATIC_MOUSE_OFFSET}
        overLight={overLight}
        padding="0"
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          width: "100%",
          height: "100%",
        }}
        className="liquid-glass-effect-core"
      >
        <span className="liquid-glass-effect-fill" />
      </LiquidGlass>
    </div>
  )
}
