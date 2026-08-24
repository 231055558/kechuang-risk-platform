import {
  ArrowLeftRightIcon,
  Building2Icon,
  FileTextIcon,
  GitBranchIcon,
  LandmarkIcon,
  LayoutDashboardIcon,
  LightbulbIcon,
  ListChecksIcon,
  RadioTowerIcon,
  ShieldCheckIcon,
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
    group: "研判工作台",
    description: "面向客户展示企业风险结论、重点风险、同业位置与最新事件",
    icon: LayoutDashboardIcon,
    target: { view: "overview" },
  },
  {
    id: "realtime-intelligence",
    label: "风险资讯",
    group: "研判工作台",
    description: "浏览数据库已收录的公告、报告、诉讼、监管与研究资讯",
    icon: RadioTowerIcon,
    target: { view: "realtime" },
  },
  {
    id: "risk-reports",
    label: "风险报告",
    group: "研判工作台",
    description: "查看面向客户的报告摘要、最新正式报告与可下载材料",
    icon: FileTextIcon,
    target: { view: "reports" },
  },
  {
    id: "event-register",
    label: "事件清单",
    group: "事件处理",
    description: "识别、核验并跟踪当前企业的风险事件与处置状态",
    icon: ListChecksIcon,
    target: { view: "events", operationsSection: "events" },
  },
  {
    id: "risk-transmission",
    label: "风险传导",
    group: "事件处理",
    description: "查看风险源、传导环节、业务影响与响应动作之间的关联",
    icon: GitBranchIcon,
    target: { view: "events", operationsSection: "transmission" },
  },
  {
    id: "enterprise-governance",
    label: "企业处置",
    group: "事件处理",
    description: "围绕责任角色、优先级和可核验材料推进企业处置闭环",
    icon: ShieldCheckIcon,
    target: { view: "events", operationsSection: "governance" },
  },
  {
    id: "company-detail",
    label: "企业详情",
    group: "企业研究",
    description: "企业档案、指标观测、生命周期与证据档案",
    icon: Building2Icon,
    target: { view: "intelligence", researchSection: "profile" },
  },
  {
    id: "comparison",
    label: "对比分析",
    group: "企业研究",
    description: "基于共同口径和证据的六维差异比较",
    icon: ArrowLeftRightIcon,
    target: { view: "compare" },
  },
  {
    id: "investment-constraints",
    label: "投资约束",
    group: "投资约束与建议",
    description: "将风险结论转化为投资前提、限制条件与持续监测要求",
    icon: LandmarkIcon,
    target: { view: "events", operationsSection: "investment" },
  },
  {
    id: "investment-advice",
    label: "投资建议",
    group: "投资约束与建议",
    description: "依据企业风险指数和高影响指标自动生成建议动作",
    icon: LightbulbIcon,
    target: { view: "events", operationsSection: "advice" },
  },
]

export const navGroups: NavGroup[] = [
  "研判工作台",
  "事件处理",
  "企业研究",
  "投资约束与建议",
]

export function resolveActiveNavigationItem(
  activeView: TabValue,
  _researchSection: ResearchSection,
  operationsSection: OperationsSection
): NavigationItemId {
  if (activeView === "events") {
    if (operationsSection === "transmission") {
      return "risk-transmission"
    }

    if (operationsSection === "governance") {
      return "enterprise-governance"
    }

    if (operationsSection === "investment") {
      return "investment-constraints"
    }

    if (operationsSection === "advice") {
      return "investment-advice"
    }

    return "event-register"
  }

  if (activeView === "intelligence") {
    return "company-detail"
  }

  if (activeView === "compare") {
    return "comparison"
  }

  if (activeView === "realtime") {
    return "realtime-intelligence"
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
