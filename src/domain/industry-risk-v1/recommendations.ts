import type {
  IndustryRiskCompanyAssessment,
  IndustryRiskMetricScore,
} from "./scoring-engine.ts"

export const INDUSTRY_RISK_ACTION_VERSION = "IR-ACTION-2026.08-v0" as const

export type IndustryRiskActionPriority = "立即处理" | "重点推进" | "持续监测"

export interface IndustryRiskRecommendation {
  indicatorId: IndustryRiskMetricScore["indicatorId"]
  indicatorLabel: string
  riskScore: number
  priority: IndustryRiskActionPriority
  title: string
  action: string
  trigger: string
}

interface IndustryRiskActionRule {
  title: string
  action: string
}

const ACTION_RULES: Record<
  IndustryRiskMetricScore["indicatorId"],
  IndustryRiskActionRule
> = {
  R01: {
    title: "控制市场叙事与基本面偏离",
    action: "同步跟踪新闻热度与经营指标，明显背离时降低对短期市场叙事的依赖。",
  },
  R02: {
    title: "统一外部评价与公司披露口径",
    action: "汇总第三方负面观点及公司回应，优先处理差异最大的事实与口径。",
  },
  R03: {
    title: "跟踪经营叙事稳定性",
    action: "对比连续报告期的战略、产品与经营表述，定位发生实质变化的事项。",
  },
  R04: {
    title: "降低概念标签依赖",
    action:
      "将概念标签拆解到真实产品、客户与收入贡献，避免用市场标签替代经营表现。",
  },
  R05: {
    title: "强化核心专利质量管理",
    action:
      "建立核心专利、有效状态与产品对应清单，优先处理失效、争议和替代技术风险。",
  },
  R06: {
    title: "稳定核心技术人才供给",
    action: "持续跟踪核心研发人员占比、关键岗位缺口与团队承载能力。",
  },
  R07: {
    title: "提高研发投入转化效率",
    action:
      "将研发投入与产品里程碑、收入增长及成果产出联动跟踪，控制低效投入。",
  },
  R08: {
    title: "推进研发与募投里程碑兑现",
    action:
      "为延期或变更项目明确完成节点、资金安排和责任动作，并持续更新进展。",
  },
  R09: {
    title: "处置技术与知识产权事件",
    action: "按产品影响和法律状态管理技术争议，提前准备替代方案与处置路径。",
  },
  R10: {
    title: "降低监管处罚暴露",
    action: "按处罚事项建立整改清单，跟踪完成状态并防止同类问题重复发生。",
  },
  R11: {
    title: "闭环交易所关注事项",
    action: "归纳问询核心问题、回复承诺和后续变化，持续跟踪承诺事项落实情况。",
  },
  R12: {
    title: "控制诉讼损失与经营影响",
    action: "跟踪案件进展、涉案金额和业务影响，对重大案件设置专项预警。",
  },
  R13: {
    title: "改善收入增长质量",
    action: "拆解产品、客户和地区收入变化，优先处理增长放缓与集中度上升问题。",
  },
  R14: {
    title: "控制无形资产减值风险",
    action: "跟踪无形资产对应业务的收入与现金流表现，提前识别减值压力。",
  },
  R15: {
    title: "降低融资成本压力",
    action: "优化债务期限和融资渠道，持续跟踪利息负担、再融资条件与资金成本。",
  },
  R16: {
    title: "提升经营现金流安全边际",
    action: "强化回款、营运资金与短期偿债管理，优先保障关键经营支出。",
  },
  R17: {
    title: "降低关键供应链进口依赖",
    action: "建立关键物料替代供应、库存缓冲和交付预案，跟踪单一来源依赖。",
  },
  R18: {
    title: "管理海外业务集中风险",
    action: "按地区、客户和币种跟踪海外收入，配置回款、合规与汇率应对措施。",
  },
  R19: {
    title: "应对出口管制与制裁暴露",
    action:
      "建立主体、产品和供应链限制清单，逐项明确许可要求、替代方案与应急路径。",
  },
  R20: {
    title: "保持控制权与治理稳定",
    action: "跟踪股权稀释、表决权和实际控制变化，提前评估重大融资与减持影响。",
  },
  R21: {
    title: "隔离高管关联风险",
    action:
      "建立高管关联事项与企业风险清单，强化关联交易、任职和利益冲突管理。",
  },
  R22: {
    title: "稳定关键管理与技术人员",
    action: "为关键岗位建立继任、激励和离职预警机制，降低核心人员变化冲击。",
  },
}

function actionPriority(score: number): IndustryRiskActionPriority {
  if (score >= 65) return "立即处理"
  if (score >= 55) return "重点推进"
  return "持续监测"
}

export function generateIndustryRiskRecommendations(
  assessment: IndustryRiskCompanyAssessment,
  limit = 3
): IndustryRiskRecommendation[] {
  return assessment.metrics
    .filter(
      (metric): metric is IndustryRiskMetricScore & { riskScore: number } =>
        metric.kind === "weighted" && metric.riskScore !== null
    )
    .sort((left, right) => right.riskScore - left.riskScore)
    .slice(0, limit)
    .map((metric) => {
      const rule = ACTION_RULES[metric.indicatorId]
      return {
        indicatorId: metric.indicatorId,
        indicatorLabel: metric.label,
        riskScore: metric.riskScore,
        priority: actionPriority(metric.riskScore),
        title: rule.title,
        action: rule.action,
        trigger: `${metric.indicatorId} ${metric.label}风险分 ${metric.riskScore}`,
      }
    })
}

export function buildIndustryRiskConclusion(
  assessment: IndustryRiskCompanyAssessment
) {
  const recommendations = generateIndustryRiskRecommendations(assessment, 3)
  const score = assessment.totalRiskScore
  if (score === null) {
    return `${assessment.companyName}当前未形成综合风险指数。`
  }

  const level =
    score >= 65
      ? "高风险"
      : score >= 55
        ? "较高风险"
        : score >= 45
          ? "中等风险"
          : "较低风险"
  const drivers = recommendations.map((item) => item.indicatorLabel).join("、")

  return `${assessment.companyName}综合风险指数为 ${score}，处于${level}区间。${drivers ? `当前主要风险来自${drivers}。` : ""}`
}
