import type { HTMLAttributes } from "react"

type MathMLProps = HTMLAttributes<HTMLElement> & {
  display?: "block" | "inline"
}

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      math: MathMLProps
      mfrac: MathMLProps
      mi: MathMLProps
      mn: MathMLProps
      mo: MathMLProps
      mrow: MathMLProps
      msub: MathMLProps
      mtext: MathMLProps
      munderover: MathMLProps
    }
  }
}

declare module "react/jsx-runtime" {
  namespace JSX {
    interface IntrinsicElements {
      math: MathMLProps
      mfrac: MathMLProps
      mi: MathMLProps
      mn: MathMLProps
      mo: MathMLProps
      mrow: MathMLProps
      msub: MathMLProps
      mtext: MathMLProps
      munderover: MathMLProps
    }
  }
}
