import type {
  IndustryRiskCompanyAssessment,
  IndustryRiskCompanyDirectoryResponse,
  IndustryRiskMetricScore,
} from "@/domain/industry-risk-v1"

export interface InvestorPeerPosition {
  score: number | null
  rank: number | null
  sampleSize: number
  riskPercentile: number | null
  peerMean: number | null
  lowerRiskQuartile: number | null
  deltaFromMean: number | null
  deltaFromLowerRiskQuartile: number | null
}

export type InvestorSignalStatus = "triggered" | "watch" | "monitor"

export interface InvestorRiskSignal {
  indicatorId: string
  label: string
  riskScore: number
  riskPercentile: number
  sampleSize: number
  sourceCount: number
  status: InvestorSignalStatus
  statusLabel: "已触发" | "临界观察" | "常规监测"
  thresholdLabel: string
}

export interface InvestorResearchReadiness {
  key: "ready" | "verify" | "insufficient"
  label: "可进入深度研判" | "需增强核验" | "数据不足"
  detail: string
}

export type InvestmentPerspectiveId = "institution" | "individual" | "bank"

export interface InvestmentPerspectiveContent {
  id: InvestmentPerspectiveId
  label: string
  question: string
  headline: string
  summary: string
  facts: Array<{ label: string; value: string; detail: string }>
  requiredChecks: string[]
  operatingConstraints: string[]
  executionSteps: Array<{
    title: string
    action: string
    requiredMaterial: string
    deliverable: string
    verification: string
  }>
}

function round(value: number, digits = 2) {
  return Number(value.toFixed(digits))
}

function mean(values: number[]) {
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null
}

function quantile(values: number[], probability: number) {
  if (!values.length) return null
  const sorted = [...values].sort((left, right) => left - right)
  const position = (sorted.length - 1) * Math.min(1, Math.max(0, probability))
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  if (lower === upper) return sorted[lower]
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower)
}

export function calculateInvestorPeerPosition(
  directory: IndustryRiskCompanyDirectoryResponse,
  companyId: string
): InvestorPeerPosition {
  const selected = directory.companies.find(
    (company) => company.companyId === companyId
  )
  if (!selected) {
    return {
      score: null,
      rank: null,
      sampleSize: 0,
      riskPercentile: null,
      peerMean: null,
      lowerRiskQuartile: null,
      deltaFromMean: null,
      deltaFromLowerRiskQuartile: null,
    }
  }

  const peers = directory.companies
    .filter(
      (company) =>
        company.benchmarkGroupId === selected.benchmarkGroupId &&
        company.totalRiskScore !== null
    )
    .sort(
      (left, right) =>
        (right.totalRiskScore ?? -Infinity) -
        (left.totalRiskScore ?? -Infinity)
    )
  const values = peers.flatMap((company) =>
    company.totalRiskScore === null ? [] : [company.totalRiskScore]
  )
  const score = selected.totalRiskScore
  const rank = peers.findIndex((company) => company.companyId === companyId) + 1
  const peerMean = mean(values)
  const lowerRiskQuartile = quantile(values, 0.25)

  if (score === null || rank < 1) {
    return {
      score,
      rank: null,
      sampleSize: values.length,
      riskPercentile: null,
      peerMean: peerMean === null ? null : round(peerMean),
      lowerRiskQuartile:
        lowerRiskQuartile === null ? null : round(lowerRiskQuartile),
      deltaFromMean: null,
      deltaFromLowerRiskQuartile: null,
    }
  }

  const riskPercentile =
    values.length < 2 ? null : ((values.length - rank) / (values.length - 1)) * 100
  return {
    score,
    rank,
    sampleSize: values.length,
    riskPercentile: riskPercentile === null ? null : round(riskPercentile, 0),
    peerMean: peerMean === null ? null : round(peerMean),
    lowerRiskQuartile:
      lowerRiskQuartile === null ? null : round(lowerRiskQuartile),
    deltaFromMean: peerMean === null ? null : round(score - peerMean),
    deltaFromLowerRiskQuartile:
      lowerRiskQuartile === null ? null : round(score - lowerRiskQuartile),
  }
}

function signalStatus(riskPercentile: number): {
  status: InvestorSignalStatus
  statusLabel: InvestorRiskSignal["statusLabel"]
  thresholdLabel: string
} {
  if (riskPercentile >= 0.75) {
    return {
      status: "triggered",
      statusLabel: "已触发",
      thresholdLabel: "同业风险分位 ≥ P75",
    }
  }
  if (riskPercentile >= 0.6) {
    return {
      status: "watch",
      statusLabel: "临界观察",
      thresholdLabel: "同业风险分位 P60–P75",
    }
  }
  return {
    status: "monitor",
    statusLabel: "常规监测",
    thresholdLabel: "同业风险分位 < P60",
  }
}

export function buildInvestorRiskSignals(
  assessment: IndustryRiskCompanyAssessment
): InvestorRiskSignal[] {
  return assessment.metrics
    .filter(
      (
        metric
      ): metric is IndustryRiskMetricScore & {
        riskScore: number
        riskPercentile: number
      } =>
        metric.kind === "weighted" &&
        metric.riskScore !== null &&
        metric.riskPercentile !== null
    )
    .map((metric) => ({
      indicatorId: metric.indicatorId,
      label: metric.label,
      riskScore: metric.riskScore,
      riskPercentile: metric.riskPercentile,
      sampleSize: metric.sampleSize,
      sourceCount: metric.sourceIds.length,
      ...signalStatus(metric.riskPercentile),
    }))
    .sort(
      (left, right) =>
        right.riskPercentile - left.riskPercentile ||
        right.riskScore - left.riskScore
    )
}

export function deriveInvestorResearchReadiness(
  assessment: IndustryRiskCompanyAssessment
): InvestorResearchReadiness {
  if (
    assessment.totalRiskScore === null ||
    assessment.weightedDataCoverage < 0.5
  ) {
    return {
      key: "insufficient",
      label: "数据不足",
      detail: "关键指标覆盖不足，当前只能形成风险缺口清单。",
    }
  }
  if (assessment.weightedDataCoverage < 0.8) {
    return {
      key: "verify",
      label: "需增强核验",
      detail: "已有相对风险结果，但重要缺口仍需原始来源补证。",
    }
  }
  return {
    key: "ready",
    label: "可进入深度研判",
    detail: "主要客观指标已覆盖，可结合估值和组合约束进一步研究。",
  }
}

export function buildInvestmentPerspective(
  assessment: IndustryRiskCompanyAssessment,
  perspective: InvestmentPerspectiveId
): InvestmentPerspectiveContent {
  const signals = buildInvestorRiskSignals(assessment)
  const triggered = signals.filter((signal) => signal.status === "triggered")
  const primary = signals[0]
  const coverage = Math.round(assessment.weightedDataCoverage * 100)
  const missing = 18 - assessment.weightedScoredIndicatorCount
  const financeIds = new Set(["R13", "R14", "R15", "R16"])
  const financeMetrics = assessment.metrics.filter(
    (metric) => financeIds.has(metric.indicatorId) && metric.riskScore !== null
  )

  if (perspective === "individual") {
    return {
      id: perspective,
      label: "个人投资者",
      question: "风险是否超出我的承受能力",
      headline:
        triggered.length > 0
          ? `当前有 ${triggered.length} 项风险处于同业 P75 以上，不能只看股价和总分。`
          : "当前未见P75以上风险，但仍需结合个人承受能力判断。",
      summary:
        "平台不掌握个人资产、负债和投资期限，因此不计算具体仓位；个人投资者应先确认最大可承受损失，再核验高分位风险的原始公告。",
      facts: [
        {
          label: "综合风险",
          value: scoreTextForPerspective(assessment.totalRiskScore),
          detail: "数值越高表示相对风险越高",
        },
        {
          label: "高分位信号",
          value: `${triggered.length} 项`,
          detail: primary ? `${primary.indicatorId} ${primary.label}` : "暂无",
        },
        {
          label: "数据缺口",
          value: `${missing} / 18`,
          detail: "缺失不能按低风险理解",
        },
      ],
      requiredChecks: [
        primary
          ? `打开原始来源核验 ${primary.indicatorId} ${primary.label}，不要只看平台摘要。`
          : "先核验最近一期定期报告和重大事项公告。",
        "明确自己的投资期限、最大可承受损失和是否使用杠杆。",
        "检查风险事件是否已被后续公告澄清、解决或进一步升级。",
      ],
      operatingConstraints: [
        "无法承受重大事件引发的跳空损失时，不应使用杠杆或集中持有单一标的。",
        "任何加减仓判断都应结合估值、流动性和个人组合，而不是直接使用风险分。",
        "P75以上信号新增、升级或失去原始证据解释时，应重新阅读公告并复核持仓理由。",
      ],
      executionSteps: [
        {
          title: "建立个人风险承受卡",
          action: "在交易前写明投资期限、最大可承受损失、是否使用杠杆以及退出投资逻辑的条件。",
          requiredMaterial: "个人资产负债、现金需求、持仓集中度和投资期限。",
          deliverable: "一页个人风险承受卡，不上传平台。",
          verification: "最大损失发生时不会影响必要生活支出或迫使高杠杆补仓。",
        },
        {
          title: "核验首要风险原始公告",
          action: primary
            ? `沿来源链接核对 ${primary.indicatorId} ${primary.label} 的主体、日期、影响范围和后续进展。`
            : "核验最近一期定期报告和重大事项公告。",
          requiredMaterial: "交易所公告、定期报告和监管/司法原文。",
          deliverable: "风险事实、公司回应和未解决问题三栏记录。",
          verification: "每项判断均能回到原始链接，不使用转述文章替代。",
        },
        {
          title: "检查单一持仓和杠杆暴露",
          action: "把该标的在个人可投资资产中的占比、融资余额和潜在跳空损失单独列示。",
          requiredMaterial: "当前持仓、成本、融资负债和可用现金。",
          deliverable: "持仓暴露表和无杠杆/有杠杆两种损失情景。",
          verification: "风险事件出现时无需依赖借款或被迫卖出其他必要资产。",
        },
        {
          title: "设置重新阅读清单",
          action: "在定期报告、处罚、诉讼、限制清单或核心人员公告出现后重新核验持仓理由。",
          requiredMaterial: "平台风险信号和对应原始公告。",
          deliverable: "保留、降低暴露或退出的理由记录。",
          verification: "结论基于新事实更新，而非仅因价格涨跌改变。",
        },
      ],
    }
  }

  if (perspective === "bank") {
    return {
      id: perspective,
      label: "银行授信",
      question: "是否具备授信审查条件",
      headline:
        financeMetrics.length < 4
          ? `R13–R16 仅 ${financeMetrics.length}/4 项可评估，尚不足以形成完整授信判断。`
          : triggered.length > 0
            ? `财务指标已覆盖，但 ${triggered.length} 项P75以上风险需进入专项授信审查。`
            : "财务指标已覆盖，可进入现金流、担保和偿债来源核验。",
      summary:
        "银行视角重点不是股票风险，而是第一还款来源、债务期限、担保增信和重大事件对现金流的影响；平台分数不能替代授信审批。",
      facts: [
        {
          label: "财务指标覆盖",
          value: `${financeMetrics.length} / 4`,
          detail: "营业收入、减值、融资成本、现金流",
        },
        {
          label: "整体数据覆盖",
          value: `${coverage}%`,
          detail: `${assessment.weightedScoredIndicatorCount}/18项已评分`,
        },
        {
          label: "专项审查信号",
          value: `${triggered.length} 项`,
          detail: primary ? `${primary.indicatorId} ${primary.label}` : "暂无",
        },
      ],
      requiredChecks: [
        "取得审计三表、最新财务报表、全部有息债务、授信、担保和或有负债明细。",
        "按未来12个月债务到期和经营现金流测算第一还款来源，不以账面现金单独替代。",
        primary
          ? `评估 ${primary.indicatorId} ${primary.label} 对订单、回款、资产和担保物的影响。`
          : "核验重大诉讼、处罚、出口限制和关键人员变化。",
      ],
      operatingConstraints: [
        "R13–R16原值、期间和来源未闭环前，不由平台输出授信额度或利率建议。",
        "把现金流覆盖、债务期限、交叉违约和重大风险事件纳入授信条件与贷后监测。",
        "诉讼、处罚或限制清单风险升级时，重新评估提款条件、担保覆盖和授信敞口。",
      ],
      executionSteps: [
        {
          title: "补齐贷前财务与债务底稿",
          action: "取得审计三表、最新报表、有息债务、授信、担保、或有负债和受限资产，并统一期间口径。",
          requiredMaterial: "审计报告、科目明细、征信、借款合同、担保合同和银行流水。",
          deliverable: "财务调整表、债务到期梯度和或有负债清单。",
          verification: "报表、征信、合同和流水之间的余额及利息能够勾稽。",
        },
        {
          title: "测算第一还款来源",
          action: "按经营回款、采购、研发、税费和债务到期编制13周及12个月现金流压力表。",
          requiredMaterial: "订单、回款计划、应收账龄、采购计划和债务到期表。",
          deliverable: "基准、回款延迟和成本上升三种现金流情景。",
          verification: "每笔到期债务对应确定的经营回款、续贷或其他资金来源。",
        },
        {
          title: "专项审查高分位风险",
          action: primary
            ? `评估 ${primary.indicatorId} ${primary.label} 对订单履约、回款、资产价值和担保物的传导。`
            : "核验合规、诉讼、供应链和人员重大风险。",
          requiredMaterial: "相关公告、合同、法律意见、客户和供应商说明。",
          deliverable: "专项风险备忘录及对偿债能力的影响路径。",
          verification: "影响能够落实到收入、成本、现金流或担保覆盖，而非停留在定性描述。",
        },
        {
          title: "形成授信条件和贷后触发器",
          action: "将现金流、债务期限、交叉违约、重大诉讼和限制清单变化写入授信审查及贷后监测。",
          requiredMaterial: "银行授信政策、合同条款和本次风险底稿。",
          deliverable: "授信条件清单、提款前提和贷后预警指标。",
          verification: "每个条件均有数据来源、检查频率和触发后的复审动作。",
        },
      ],
    }
  }

  return {
    id: "institution",
    label: "投资机构",
    question: "是否具备投委会决策条件",
    headline:
      assessment.totalRiskScore === null
        ? "当前数据不足，尚不能形成可提交投委会的风险结论。"
        : triggered.length > 0
          ? `存在 ${triggered.length} 项P75以上风险，投委会材料应附专项尽调结论。`
          : "未见P75以上风险，可在估值和组合约束下继续深度研究。",
    summary:
      "机构应把风险分拆到组合暴露、估值折价、交易结构和投后监控，而不是把单一总分直接转成投或不投。",
    facts: [
      {
        label: "综合风险",
        value: scoreTextForPerspective(assessment.totalRiskScore),
        detail: assessment.benchmarkGroupLabel,
      },
      {
        label: "P75以上信号",
        value: `${triggered.length} 项`,
        detail: primary ? `${primary.indicatorId} ${primary.label}` : "暂无",
      },
      {
        label: "证据覆盖",
        value: `${coverage}%`,
        detail: `${missing}项客观指标缺失`,
      },
    ],
    requiredChecks: [
      primary
        ? `对 ${primary.indicatorId} ${primary.label} 完成原始来源、影响范围和缓释措施专项尽调。`
        : "核验主要风险指标的原值、期间、口径和来源。",
      "把收入、现金流、供应链、诉讼和核心人员风险落到估值假设与下行情景。",
      "核对本标的与现有组合在行业、供应链、客户和政策风险上的集中暴露。",
    ],
    operatingConstraints: [
      "投委会材料必须同时呈现风险分、同业分位、数据缺口和原始来源，不使用单一总分替代判断。",
      "P75以上信号未完成专项尽调时，只能形成研究结论，不能标记为风险已消除。",
      "如采用分阶段投资、估值调整或保护条款，应明确对应的风险信号和验证条件。",
    ],
    executionSteps: [
      {
        title: "形成高风险指标专项尽调底稿",
        action: primary
          ? `围绕 ${primary.indicatorId} ${primary.label} 核验原始来源、影响主体、金额/产品范围、持续时间和公司缓释措施。`
          : "核验主要风险指标的原值、口径和来源。",
        requiredMaterial: "公告原文、合同/业务底稿、管理层说明和第三方验证材料。",
        deliverable: "事实确认、影响测算、未解决问题和缓释证据四部分专项底稿。",
        verification: "所有关键判断均有来源编号，未验证内容明确标记而非写成事实。",
      },
      {
        title: "测算组合集中与风险穿透",
        action: "把标的与现有组合在行业、客户、供应链、技术路线和政策风险上的共同暴露汇总。",
        requiredMaterial: "组合持仓、主要客户供应商、业务地区和风险指标。",
        deliverable: "单一标的、行业和共同风险因子三层暴露矩阵。",
        verification: "Top风险能够穿透到具体组合敞口，避免不同标的重复暴露被忽略。",
      },
      {
        title: "把风险写入估值和交易结构",
        action: "对高风险事项分别设置基准、恶化和缓释假设，评估收入、成本、现金流和估值倍数影响。",
        requiredMaterial: "估值模型、业务预测、高风险指标和专项尽调结果。",
        deliverable: "风险调整估值桥接表及关键假设敏感性分析。",
        verification: "估值变化能够对应到明确风险假设，不以任意折价替代分析。",
      },
      {
        title: "形成投委会风险接受清单",
        action: "逐项列明接受、附条件接受和暂不接受的风险，以及投后需要验证的证据。",
        requiredMaterial: "专项尽调、估值桥接、组合暴露和交易条款。",
        deliverable: "投委会风险清单、条件和复核触发器。",
        verification: "每项高分位风险都有明确结论，且结论与估值、条款或监控动作一致。",
      },
    ],
  }
}

function scoreTextForPerspective(score: number | null) {
  return score === null ? "待评估" : score.toFixed(2)
}
