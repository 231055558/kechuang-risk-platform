import type { LucideIcon } from "lucide-react"

import type { OperationsSection, ResearchSection, TabValue } from "@/types/risk"

export type NavGroup = "风险研判" | "信息与比较" | "输出与策略"

export type NavigationItemId =
  | "risk-assessment"
  | "indicator-analysis"
  | "narrative-risk"
  | "realtime-intelligence"
  | "risk-reports"
  | "risk-transmission"
  | "comparison"
  | "investment-research"
  | "investment-advice"

export interface NavigationTarget {
  view: TabValue
  researchSection?: ResearchSection
  operationsSection?: OperationsSection
}

export interface NavItem {
  id: NavigationItemId
  label: string
  group: NavGroup
  description: string
  icon: LucideIcon
  target: NavigationTarget
}
