import type { LucideIcon } from "lucide-react"

import type { OperationsSection, ResearchSection, TabValue } from "@/types/risk"

export type NavGroup = "研判工作台" | "事件处理" | "企业研究" | "投资约束与建议"

export type NavigationItemId =
  | "risk-assessment"
  | "realtime-intelligence"
  | "risk-reports"
  | "event-register"
  | "risk-transmission"
  | "enterprise-governance"
  | "company-detail"
  | "comparison"
  | "investment-constraints"
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
