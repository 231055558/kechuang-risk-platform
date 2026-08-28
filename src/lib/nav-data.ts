import {
  ArrowLeftRightIcon,
  ChartNoAxesCombinedIcon,
  FileTextIcon,
  GitBranchIcon,
  LandmarkIcon,
  LayoutDashboardIcon,
  LightbulbIcon,
  MessageSquareWarningIcon,
  RadioTowerIcon,
} from "lucide-react"

import type {
  NavigationItemId,
  NavigationTarget,
  NavGroup,
  NavItem,
} from "@/types/nav"
import type { OperationsSection, ResearchSection, TabValue } from "@/types/risk"

export const navItems: NavItem[] = [
  {
    id: "risk-assessment",
    label: "风险总览",
    group: "风险研判",
    description: "集中查看企业风险结论、同业位置、风险结构与近期事件",
    icon: LayoutDashboardIcon,
    target: { view: "overview" },
  },
  {
    id: "indicator-analysis",
    label: "指标分析",
    group: "风险研判",
    description: "查看 R05–R22 同业热力、原值、公式、证据与覆盖状态",
    icon: ChartNoAxesCombinedIcon,
    target: { view: "intelligence", researchSection: "metrics" },
  },
  {
    id: "narrative-risk",
    label: "叙事风险",
    group: "风险研判",
    description: "查看年报披露、创新叙事夸大与管理者语调的年度趋势",
    icon: MessageSquareWarningIcon,
    target: { view: "narrative" },
  },
  {
    id: "risk-transmission",
    label: "风险传导",
    group: "风险研判",
    description: "承载风险演化知识图谱及其筛选、检索与来源下钻",
    icon: GitBranchIcon,
    target: { view: "events", operationsSection: "transmission" },
  },
  {
    id: "realtime-intelligence",
    label: "风险资讯",
    group: "信息与比较",
    description: "浏览公开新闻、公告、诉讼和监管信息及其投资者影响",
    icon: RadioTowerIcon,
    target: { view: "realtime" },
  },
  {
    id: "comparison",
    label: "企业对比",
    group: "信息与比较",
    description: "基于共同指标口径比较企业风险结构和同业位置",
    icon: ArrowLeftRightIcon,
    target: { view: "compare" },
  },
  {
    id: "risk-reports",
    label: "企业报告",
    group: "输出与策略",
    description: "查看、打印和导出当前企业的完整风险报告与来源材料",
    icon: FileTextIcon,
    target: { view: "reports" },
  },
  {
    id: "investment-research",
    label: "投资研判",
    group: "输出与策略",
    description: "以风险证据、触发条件和数据充分度支持投资决策",
    icon: LandmarkIcon,
    target: { view: "events", operationsSection: "investment" },
  },
  {
    id: "investment-advice",
    label: "风险应对",
    group: "输出与策略",
    description: "形成投资前核验、持有期监测和重新评估条件",
    icon: LightbulbIcon,
    target: { view: "events", operationsSection: "advice" },
  },
]

export const navGroups: NavGroup[] = ["风险研判", "信息与比较", "输出与策略"]

export function resolveActiveNavigationItem(
  activeView: TabValue,
  _researchSection: ResearchSection,
  operationsSection: OperationsSection
): NavigationItemId {
  if (activeView === "events") {
    if (operationsSection === "investment") {
      return "investment-research"
    }

    if (operationsSection === "advice") {
      return "investment-advice"
    }

    return "risk-transmission"
  }

  if (activeView === "intelligence") {
    return "indicator-analysis"
  }

  if (activeView === "compare") {
    return "comparison"
  }

  if (activeView === "realtime") {
    return "realtime-intelligence"
  }

  if (activeView === "narrative") {
    return "narrative-risk"
  }

  if (activeView === "reports") {
    return "risk-reports"
  }

  return "risk-assessment"
}

export function getNavigationItem(id: NavigationItemId): NavItem {
  return navItems.find((item) => item.id === id) ?? navItems[0]
}

export function getNavigationItemIdForTarget(
  target: NavigationTarget
): NavigationItemId {
  const matched = navItems.find(
    (item) =>
      item.target.view === target.view &&
      item.target.researchSection === target.researchSection &&
      item.target.operationsSection === target.operationsSection
  )

  if (matched) {
    return matched.id
  }

  return resolveActiveNavigationItem(
    target.view,
    target.researchSection ?? "profile",
    target.operationsSection ?? "events"
  )
}
