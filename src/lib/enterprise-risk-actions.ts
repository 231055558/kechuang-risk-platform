import type { IndustryRiskCompanyAssessment } from "@/domain/industry-risk-v1"
import { buildInvestorRiskSignals } from "./investor-decision.ts"

export type EnterpriseActionHorizon = "0–3个月" | "3–12个月" | "12个月以上"

export interface EnterpriseRiskAction {
  indicatorId: string
  riskLabel: string
  riskPercentile: number
  title: string
  action: string
  deliverable: string
  validation: string
  horizon: EnterpriseActionHorizon
}

interface EnterpriseActionTemplate {
  title: string
  action: string
  deliverable: string
  validation: string
  horizon: EnterpriseActionHorizon
}

const actionTemplates: Record<string, EnterpriseActionTemplate> = {
  R05: {
    title: "完成核心专利与产品权利链核验",
    action: "按核心产品建立专利族、权利人、发明人、法律状态和关键权利要求映射，补做自由实施分析。",
    deliverable: "核心产品—专利族—权利状态矩阵及自由实施检索报告。",
    validation: "核心产品权利链覆盖率达到100%，高风险专利逐项形成处理意见。",
    horizon: "3–12个月",
  },
  R06: {
    title: "补齐核心技术岗位与备份梯队",
    action: "识别不可替代岗位、关键知识和单点依赖，为核心岗位建立备份人员与知识交接清单。",
    deliverable: "核心岗位清单、知识地图和备份梯队表。",
    validation: "所有关键岗位至少具备一名可接替人员，核心资料完成归档。",
    horizon: "3–12个月",
  },
  R07: {
    title: "将研发投入改造成阶段门管理",
    action: "把主要研发项目拆成样片、验证、客户导入和量产节点，逐项绑定预算消耗与退出条件。",
    deliverable: "研发项目阶段门台账及预算—里程碑偏差表。",
    validation: "所有重点项目均有可验收节点，单节点延期能够追溯原因和资源调整。",
    horizon: "3–12个月",
  },
  R08: {
    title: "对延期和变更项目执行专项复盘",
    action: "逐项核对原计划、实际进度、客户验证、资金用途和延期原因，重新冻结基准计划。",
    deliverable: "延期项目复盘报告与更新后的里程碑基线。",
    validation: "所有延期项目明确剩余节点、验收证据和停止投入条件。",
    horizon: "0–3个月",
  },
  R09: {
    title: "关闭重大技术与知识产权事件敞口",
    action: "对争议专利、质量事件和技术纠纷建立事实、损失、产品影响和替代方案清单。",
    deliverable: "技术事件影响评估及产品替代/修复方案。",
    validation: "重大事件均完成产品范围、预计损失和处置路径核验。",
    horizon: "0–3个月",
  },
  R10: {
    title: "完成监管处罚根因整改",
    action: "按处罚事项回溯制度、审批、证据留存和复核缺口，更新控制点并抽样验证。",
    deliverable: "处罚事项根因分析、控制点清单和抽样复核记录。",
    validation: "同类控制点抽样无重复缺陷，新增披露可追溯至原始证据。",
    horizon: "0–3个月",
  },
  R11: {
    title: "建立交易所问询复发防线",
    action: "将历史问询拆解为财务、业务、关联交易和信披主题，形成披露前交叉核验清单。",
    deliverable: "问询主题库及定期报告披露前检查表。",
    validation: "历史高频问询主题在下一份定期报告中均有证据索引。",
    horizon: "0–3个月",
  },
  R12: {
    title: "统一诉讼进展、敞口和会计口径",
    action: "逐案核对案由、进展、争议金额、预计损失和关联方关系，并统一公告与财务计提依据。",
    deliverable: "诉讼案件台账、损失区间评估和披露口径说明。",
    validation: "重大案件金额、阶段和预计负债能够在法务、财务与公告之间勾稽一致。",
    horizon: "0–3个月",
  },
  R13: {
    title: "拆解收入增长质量与客户兑现",
    action: "按客户、产品和合同拆分订单、交付、验收、回款及退货，识别一次性收入和高集中度来源。",
    deliverable: "收入桥接表、客户集中度表和订单转化漏斗。",
    validation: "主要收入均可追溯至合同、交付、验收和回款证据。",
    horizon: "0–3个月",
  },
  R14: {
    title: "执行无形资产减值压力复核",
    action: "按项目更新商业化进度、未来现金流、折现率和技术替代假设，识别需减值资产。",
    deliverable: "无形资产项目级减值测试底稿。",
    validation: "高风险项目均完成敏感性分析并与董事会批准预算勾稽。",
    horizon: "3–12个月",
  },
  R15: {
    title: "重排债务期限并压降综合融资成本",
    action: "穿透列示借款、债券、租赁和担保的余额、利率、期限与限制条款，优先置换高成本短债。",
    deliverable: "债务到期梯度、综合资金成本表和再融资方案。",
    validation: "未来12个月到期债务均有明确资金来源，高成本融资逐项形成置换结论。",
    horizon: "3–12个月",
  },
  R16: {
    title: "建立经营现金流与短债联动预警",
    action: "滚动测算回款、采购、研发和融资现金流，按压力情景检验短债覆盖和最低现金余额。",
    deliverable: "13周现金流预测、短债到期表和压力情景结果。",
    validation: "现金缺口能够提前识别并对应到确定的融资或回款措施。",
    horizon: "0–3个月",
  },
  R17: {
    title: "穿透关键供应商与进口依赖",
    action: "按核心产品BOM识别供应商国别、生产地、单一来源器件、交期和可替代供应商。",
    deliverable: "核心BOM—供应商—国别—替代方案矩阵。",
    validation: "关键物料国别和单一来源识别率达到100%，高风险物料至少形成一条替代路径。",
    horizon: "3–12个月",
  },
  R18: {
    title: "分拆海外收入与回款风险",
    action: "按国家、客户、币种和结算方式拆解海外收入，核验制裁、汇率、税务和回款敞口。",
    deliverable: "海外收入暴露矩阵和重点客户回款计划。",
    validation: "主要海外客户均完成最终用户、结算路径和逾期风险核验。",
    horizon: "3–12个月",
  },
  R19: {
    title: "建立出口管制产品级影响矩阵",
    action: "将实体清单、ECCN、受限IP/EDA工具、供应商和客户逐项映射到核心产品与收入。",
    deliverable: "产品—BOM—ECCN—受限主体—收入影响矩阵。",
    validation: "核心产品映射覆盖率达到100%，每项受限依赖均有许可证、替代或停止使用结论。",
    horizon: "0–3个月",
  },
  R20: {
    title: "稳定控制权与重大事项表决安排",
    action: "穿透股权、表决权、一致行动和质押安排，模拟融资与减持后的控制权变化。",
    deliverable: "控制权穿透图和融资/减持稀释情景表。",
    validation: "重大融资和减持情景均明确控制权边界及公司治理影响。",
    horizon: "12个月以上",
  },
  R21: {
    title: "清理高管关联企业与交易暴露",
    action: "核对高管关联企业、任职、股权和交易往来，统一关联方识别、定价和回避表决口径。",
    deliverable: "高管关联方清单、关联交易台账和定价依据。",
    validation: "高风险关联主体全部完成关系、金额、定价和审批证据核验。",
    horizon: "0–3个月",
  },
  R22: {
    title: "降低关键人员单点流失风险",
    action: "对核心管理和技术人员建立留任、接替和知识交接机制，并监测异常变动。",
    deliverable: "关键人员风险地图、接替计划和知识交接清单。",
    validation: "所有关键岗位具备接替方案，离任事件能够在披露与交接记录间核验。",
    horizon: "3–12个月",
  },
}

export function buildEnterpriseRiskActions(
  assessment: IndustryRiskCompanyAssessment,
  limit = 8
): EnterpriseRiskAction[] {
  return buildInvestorRiskSignals(assessment)
    .flatMap((signal) => {
      const template = actionTemplates[signal.indicatorId]
      return template
        ? [
            {
              indicatorId: signal.indicatorId,
              riskLabel: signal.label,
              riskPercentile: signal.riskPercentile,
              ...template,
            },
          ]
        : []
    })
    .slice(0, limit)
}
