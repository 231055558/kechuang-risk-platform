import type { CanonicalRiskDimensionId } from "@/types/risk"

export type QuantificationMethod =
  "technology-auto" | "local-score" | "review" | "calibration"

export type QuantificationReadiness = "ready" | "partial" | "pending"

export type LifecycleWeights = {
  startup: number
  growth: number
  stable: number
}

export type RiskQuantificationCatalogItem = {
  id: string
  indicatorId?: string
  dimension: CanonicalRiskDimensionId
  secondaryCategory: string
  label: string
  definition: string
  formula: string
  threshold: string
  dataSource: string
  frequency: string
  lifecycleWeights: LifecycleWeights
  method: QuantificationMethod
  readiness: QuantificationReadiness
  sourceVersion: "KTR-2026.07-v1" | "RIS-2026.07.21-v1"
  indicatorWeight?: number
  note?: string
}

const technologyDimensionWeights: LifecycleWeights = {
  startup: 30,
  growth: 25,
  stable: 20,
}

export const riskQuantificationCatalog: RiskQuantificationCatalogItem[] = [
  {
    id: "kci-001",
    indicatorId: "kci-001",
    dimension: "narrative",
    secondaryCategory: "估值叙事",
    label: "叙事驱动估值溢价率",
    definition:
      "识别企业估值倍数是否显著高于盈利或营收增长，避免把叙事热度误判为基本面兑现。",
    formula:
      "成熟盈利企业：PEG = PE / 净利润增长率；早期企业：PSG = PS / 营业收入增长率。",
    threshold:
      "PSG > 1 说明估值可能已透支未来营收增长，需结合行业和融资阶段复核。",
    dataSource: "企业财报、交易所公开行情与公开融资披露",
    frequency: "季度",
    lifecycleWeights: { startup: 5, growth: 7, stable: 5 },
    method: "review",
    readiness: "partial",
    sourceVersion: "RIS-2026.07.21-v1",
    note: "不同企业可获得的估值口径不同，先保留原始 PEG 或 PSG，再由研究员确认可比组。",
  },
  {
    id: "kci-002",
    indicatorId: "kci-002",
    dimension: "narrative",
    secondaryCategory: "叙事热度",
    label: "叙事热度基本面背离度",
    definition:
      "衡量市场讨论度、数字化叙事与实际营收增长之间是否出现持续背离。",
    formula:
      "DTQ = ln(数字化相关提问次数 + 1)；结合异常数字化披露与文本情感指标进行比对。",
    threshold: "先展示热度、营收增长与背离轨迹；正式风险区间需按行业样本校准。",
    dataSource: "互动易或 E 互动公开问答、企业季报、公开披露文本",
    frequency: "月度",
    lifecycleWeights: { startup: 3, growth: 4, stable: 3 },
    method: "calibration",
    readiness: "pending",
    sourceVersion: "RIS-2026.07.21-v1",
    note: "需要建立同业基准和文本抽取质检后才能进入自动评分。",
  },
  {
    id: "kci-003",
    indicatorId: "kci-003",
    dimension: "narrative",
    secondaryCategory: "叙事热度",
    label: "卖方机构叙事协同度",
    definition:
      "识别短期内卖方研究是否形成高度一致的核心叙事，作为共识拥挤和反转风险观察。",
    formula:
      "单篇研报 TONE =（积极语句 - 消极语句）/ 总语句数；以 BiasTONE 的反向标准差衡量协同度。",
    threshold: "标准差越小，协同度越高；正式阈值需由可授权的覆盖样本回测确定。",
    dataSource: "合规授权的卖方研报库与公开研究摘要",
    frequency: "季度",
    lifecycleWeights: { startup: 3, growth: 4, stable: 3 },
    method: "calibration",
    readiness: "pending",
    sourceVersion: "RIS-2026.07.21-v1",
    note: "研报全文属于授权数据，本地工作区仅保留可审计的分析结论。",
  },
  {
    id: "kci-004",
    indicatorId: "kci-004",
    dimension: "narrative",
    secondaryCategory: "技术叙事",
    label: "概念股标签关联度",
    definition:
      "观察热门概念相关业务是否形成可核验收入，防止概念标签与实际业务脱节。",
    formula: "概念相关业务营收 / 企业总营收 × 100%。",
    threshold: "低风险 >30%；中风险 10%–30%；高风险 <10%。",
    dataSource: "分业务收入明细、交易所概念分类与企业年报",
    frequency: "年度",
    lifecycleWeights: { startup: 2, growth: 3, stable: 2 },
    method: "local-score",
    readiness: "ready",
    sourceVersion: "RIS-2026.07.21-v1",
  },
  {
    id: "kci-005",
    indicatorId: "kci-005",
    dimension: "narrative",
    secondaryCategory: "技术叙事",
    label: "场景应用夸大度",
    definition:
      "比较企业宣传的场景覆盖与实际可验证的签约、交付和客户收入，识别场景叙事夸张。",
    formula:
      "结合宣传场景数、可验证项目与客户订单、前五大客户收入占比进行交叉核验。",
    threshold: "先形成企业原始事实台账；正式区间需统一场景定义和客户验证边界。",
    dataSource: "企业公告、年报、招投标记录、签约与验收公开材料",
    frequency: "年度",
    lifecycleWeights: { startup: 2, growth: 2, stable: 2 },
    method: "calibration",
    readiness: "pending",
    sourceVersion: "RIS-2026.07.21-v1",
  },
  {
    id: "kci-006",
    indicatorId: "kci-006",
    dimension: "technology",
    secondaryCategory: "技术先进性",
    label: "核心技术性能行业分位",
    definition:
      "在统一工况、标准和产品代际下衡量企业核心性能相对同赛道可比对象的位置。",
    formula:
      "选取 3–5 个关键性能参数，正负向标准化后形成综合性能分，再计算行业百分位 P。",
    threshold:
      "低风险 P≥75；中低 50≤P<75；中高 25≤P<50；高风险 P<25 或缺少关键测试证据。",
    dataSource: "公开技术报告、产品测试报告、国家或行业标准与同行公开测试数据",
    frequency: "按产品代际或重大版本更新",
    lifecycleWeights: technologyDimensionWeights,
    method: "technology-auto",
    readiness: "ready",
    sourceVersion: "KTR-2026.07-v1",
    indicatorWeight: 10,
  },
  {
    id: "kci-007",
    indicatorId: "kci-007",
    dimension: "technology",
    secondaryCategory: "技术先进性",
    label: "核心论文质量与技术转化关联",
    definition:
      "同时核验研究质量、论文与专利的关联，以及样机、TRL 或产品转化证据。",
    formula:
      "综合分 = 引用影响力×30% + 高质量研究×20% + 论文—专利关联×25% + 产品转化证据×25%。",
    threshold:
      "按同领域、同年份百分位：低风险 P≥75；中低 50–75；中高 25–50；高风险 P<25。",
    dataSource: "论文原文、Crossref 或 OpenAlex 元数据、专利与产品公开披露",
    frequency: "年度",
    lifecycleWeights: technologyDimensionWeights,
    method: "technology-auto",
    readiness: "ready",
    sourceVersion: "KTR-2026.07-v1",
    indicatorWeight: 8,
  },
  {
    id: "kci-008",
    indicatorId: "kci-008",
    dimension: "technology",
    secondaryCategory: "技术先进性",
    label: "核心专利质量与技术壁垒",
    definition:
      "评价核心专利族的引用质量、布局、权利稳定性与主营技术覆盖，不以专利数量替代技术壁垒。",
    formula:
      "综合分 = 前向引用行业分位×35% + 专利族与海外布局×25% + 权利与法律状态×20% + 技术覆盖×20%。",
    threshold:
      "低风险 P≥75；中低 50–75；中高 25–50；高风险 P<25，或核心专利失效、无效或不覆盖主营产品。",
    dataSource:
      "国家知识产权局、WIPO PATENTSCOPE、Google Patents 与企业公开披露",
    frequency: "季度",
    lifecycleWeights: technologyDimensionWeights,
    method: "technology-auto",
    readiness: "ready",
    sourceVersion: "KTR-2026.07-v1",
    indicatorWeight: 9,
  },
  {
    id: "kci-009",
    indicatorId: "kci-009",
    dimension: "technology",
    secondaryCategory: "技术先进性",
    label: "持续创新能力",
    definition:
      "结合研发投入的同业位置与核心技术有效更新周期，判断技术能力是否持续迭代。",
    formula:
      "持续创新得分 = 近 3 年研发投入强度同业分位及趋势×40% + 核心技术有效更新周期同业分位×60%。",
    threshold:
      "得分≥75 低风险；60–75 中低；40–60 中高；<40 高风险，连续 3 年无有效更新直接升高风险。",
    dataSource: "年报、审计财务披露、产品更新日志、技术白皮书与公开验证材料",
    frequency: "年度",
    lifecycleWeights: technologyDimensionWeights,
    method: "technology-auto",
    readiness: "ready",
    sourceVersion: "KTR-2026.07-v1",
    indicatorWeight: 8,
  },
  {
    id: "kci-010",
    indicatorId: "kci-010",
    dimension: "technology",
    secondaryCategory: "技术成熟度",
    label: "技术成熟与阶段兑现度（TRL）",
    definition:
      "衡量证据化 TRL 是否匹配当前阶段，并核验滚动周期内关键技术节点的兑现情况。",
    formula:
      "TRL 差距 Δ=max(0,目标 TRL−当前 TRL)；T=max(0,100−25×Δ)；综合成熟得分=60%×T+40%×节点兑现率。",
    threshold:
      "≥80 低风险；65–80 中低；50–65 中高；<50 高风险；仅自评且无实验或示范证据直接高风险。",
    dataSource: "研发计划、招股书或年报、测试报告、样机中试与示范项目材料",
    frequency: "按阶段节点",
    lifecycleWeights: technologyDimensionWeights,
    method: "technology-auto",
    readiness: "ready",
    sourceVersion: "KTR-2026.07-v1",
    indicatorWeight: 20,
  },
  {
    id: "kci-011",
    indicatorId: "kci-011",
    dimension: "technology",
    secondaryCategory: "技术成熟度",
    label: "工程化与商业转化率",
    definition:
      "识别已完成研发项目中真正进入中试、客户验收、量产或持续运营的比例。",
    formula:
      "滚动 3 年工程化转化率 = 进入中试、验收、量产或持续运营的项目数 / 已完成研发项目数 × 100%。",
    threshold: "≥60% 低风险；40%–60% 中低；20%–40% 中高；<20% 高风险。",
    dataSource: "项目清单、验收文件、客户或招投标披露、量产公告与持续运营记录",
    frequency: "年度",
    lifecycleWeights: technologyDimensionWeights,
    method: "technology-auto",
    readiness: "ready",
    sourceVersion: "KTR-2026.07-v1",
    indicatorWeight: 15,
  },
  {
    id: "kci-012",
    indicatorId: "kci-012",
    dimension: "technology",
    secondaryCategory: "技术可靠和安全性",
    label: "独立验证与关键测试有效性",
    definition:
      "综合衡量由独立主体完成的验证覆盖，以及关键功能、可靠性与安全测试的实际达标情况。",
    formula: "综合有效性 = 40%×独立验证覆盖率 V + 60%×关键测试达标率 K。",
    threshold:
      "≥90 低风险；75–90 中低；60–75 中高；<60 高风险；任一强制或安全关键测试失败直接高风险。",
    dataSource: "第三方测试或认证、客户验收、公开运行记录与企业质量测试报告",
    frequency: "按测试批次或产品版本",
    lifecycleWeights: technologyDimensionWeights,
    method: "technology-auto",
    readiness: "ready",
    sourceVersion: "KTR-2026.07-v1",
    indicatorWeight: 18,
  },
  {
    id: "kci-013",
    indicatorId: "kci-013",
    dimension: "technology",
    secondaryCategory: "技术可靠和安全性",
    label: "关键技术自主可控度（外部依赖度）",
    definition:
      "衡量核心系统对不可替代外部授权、闭源技术、单一供应商或受限制模块的依赖与替代能力。",
    formula:
      "外部依赖度 D = 无经验证替代方案且依赖外部单一来源的关键模块数 / 关键模块总数 × 100%。",
    threshold:
      "D≤10% 低风险；10%–30% 中低；30%–50% 中高；>50% 高风险；重大单一来源或出口限制直接高风险。",
    dataSource:
      "供应链与风险披露、BOM 或 SBOM、许可证清单、监管限制清单与替代验证材料",
    frequency: "季度或供应链重大变化时",
    lifecycleWeights: technologyDimensionWeights,
    method: "technology-auto",
    readiness: "ready",
    sourceVersion: "KTR-2026.07-v1",
    indicatorWeight: 12,
  },
  {
    id: "ktr-red-flag",
    dimension: "technology",
    secondaryCategory: "技术可靠和安全性",
    label: "重大技术质量事件指数",
    definition:
      "识别近 3 年已转化为实际损失的重大故障、召回、客户停运、数据泄露、安全事故或监管处罚。",
    formula: "事件得分 = 基础分×责任系数×时间系数；三年指数为各事件得分之和。",
    threshold:
      "0 为低风险；>0–2 中低；>2–5 中高；>5 高风险。任一 8 分事件、重大瞒报或重复重大事件直接高风险。",
    dataSource: "产品召回公告、事故调查、企业年报、招股书与重大事项公告",
    frequency: "事件发生后更新",
    lifecycleWeights: technologyDimensionWeights,
    method: "technology-auto",
    readiness: "ready",
    sourceVersion: "KTR-2026.07-v1",
    note: "红旗覆盖项，不占 8 个核心指标的 100% 常规权重。",
  },
  {
    id: "kci-014",
    indicatorId: "kci-014",
    dimension: "compliance",
    secondaryCategory: "监管合规",
    label: "监管处罚次数",
    definition:
      "统计近 3 年因网络安全、数据安全、个人信息保护、算法或隐私问题受到行政处罚的累计次数。",
    formula: "近 3 年行政处罚累计次数。",
    threshold: "低风险 0 次；中风险 1–2 次；高风险 ≥3 次。",
    dataSource: "监管部门处罚公告与国家企业信用信息公示系统",
    frequency: "年度",
    lifecycleWeights: { startup: 4, growth: 5, stable: 5 },
    method: "local-score",
    readiness: "ready",
    sourceVersion: "RIS-2026.07.21-v1",
  },
  {
    id: "kci-015",
    indicatorId: "kci-015",
    dimension: "compliance",
    secondaryCategory: "监管合规",
    label: "交易所问询次数",
    definition: "统计近 3 年收到的交易所问询函，反映信息披露质量与监管关注度。",
    formula: "近 3 年收到交易所问询函次数。",
    threshold: "低风险 0 次；中风险 1–2 次；高风险 ≥3 次。",
    dataSource: "交易所问询函公告系统与企业回复公告",
    frequency: "季度",
    lifecycleWeights: { startup: 3, growth: 5, stable: 5 },
    method: "local-score",
    readiness: "ready",
    sourceVersion: "RIS-2026.07.21-v1",
  },
  {
    id: "compliance-litigation",
    dimension: "compliance",
    secondaryCategory: "诉讼风险",
    label: "诉讼风险",
    definition:
      "综合衡量企业作为被告的诉讼频率及涉诉金额对营业收入的潜在冲击。",
    formula:
      "年度被告诉讼案件数 + 诉讼标的金额 / 营业收入 × 100%，两项共同复核。",
    threshold: "需建立案件口径、诉讼状态与财务影响的组合规则后才可评分。",
    dataSource: "裁判文书、企业重大诉讼披露与财务报表",
    frequency: "年度",
    lifecycleWeights: { startup: 3, growth: 5, stable: 5 },
    method: "calibration",
    readiness: "pending",
    sourceVersion: "RIS-2026.07.21-v1",
    note: "现有“败诉率”单项不能替代本表的诉讼频率与金额综合口径。",
  },
  {
    id: "kci-028",
    indicatorId: "kci-028",
    dimension: "finance",
    secondaryCategory: "现金流",
    label: "现金储备消耗周期",
    definition:
      "估算企业现有现金及等价物按当前月均经营性现金消耗速度可维持的月数。",
    formula:
      "期末现金及等价物 / 月均经营性现金净流出额（近 12 个月净流出额 / 12）。",
    threshold: "低风险 >24 月；中风险 12–24 月；高风险 <12 月。",
    dataSource: "资产负债表与现金流量表",
    frequency: "季度",
    lifecycleWeights: { startup: 6, growth: 5, stable: 5 },
    method: "local-score",
    readiness: "ready",
    sourceVersion: "RIS-2026.07.21-v1",
  },
  {
    id: "finance-revenue-growth",
    dimension: "finance",
    secondaryCategory: "经营增长",
    label: "营业收入增长率",
    definition:
      "观察企业营收同比变化，识别商业模式验证不足、持续负增长或增速骤降。",
    formula: "（本期营收 - 上期营收）/ 上期营收 × 100%。",
    threshold: "按企业阶段和行业增速建立同业分位与风险区间。",
    dataSource: "企业季报、年报与审计财务报表",
    frequency: "季度",
    lifecycleWeights: { startup: 5, growth: 4, stable: 3 },
    method: "calibration",
    readiness: "pending",
    sourceVersion: "RIS-2026.07.21-v1",
  },
  {
    id: "finance-roe",
    dimension: "finance",
    secondaryCategory: "经营增长",
    label: "净资产利润率（ROE）",
    definition:
      "衡量净利润对平均净资产的回报，反映自有资本获利能力的可持续性。",
    formula: "净利润 / [（期初所有者权益 + 期末所有者权益）/ 2] × 100%。",
    threshold:
      "按初创、成长、稳定阶段分别建立行业基准，不对亏损早期企业直接套用成熟企业阈值。",
    dataSource: "企业季报、年报与审计财务报表",
    frequency: "季度",
    lifecycleWeights: { startup: 1, growth: 2, stable: 7 },
    method: "calibration",
    readiness: "pending",
    sourceVersion: "RIS-2026.07.21-v1",
  },
  {
    id: "finance-intangible-impairment",
    dimension: "finance",
    secondaryCategory: "资产减值",
    label: "无形资产减值风险",
    definition:
      "观察专利、研发资本化等无形资产对总资产的占比及其技术迭代后的潜在减值压力。",
    formula: "无形资产合计 / 总资产 × 100%。",
    threshold: "需结合资产构成、减值测试与行业技术迭代周期建立风险区间。",
    dataSource: "企业年报资产负债表、附注与减值测试披露",
    frequency: "月度",
    lifecycleWeights: { startup: 2, growth: 2, stable: 5 },
    method: "calibration",
    readiness: "pending",
    sourceVersion: "RIS-2026.07.21-v1",
  },
  {
    id: "finance-goodwill-impairment",
    dimension: "finance",
    secondaryCategory: "资产减值",
    label: "商誉减值压力",
    definition:
      "观察并购形成商誉相对净资产的占比，识别业绩不及预期时的潜在减值压力。",
    formula: "商誉 / 净资产 × 100%。",
    threshold: "需结合并购标的兑现、减值测试与行业并购特征建立区间。",
    dataSource: "企业年报资产负债表、附注与商誉减值测试披露",
    frequency: "年度",
    lifecycleWeights: { startup: 1, growth: 2, stable: 4 },
    method: "calibration",
    readiness: "pending",
    sourceVersion: "RIS-2026.07.21-v1",
  },
  {
    id: "finance-financing-dependence",
    dimension: "finance",
    secondaryCategory: "融资能力",
    label: "融资性现金流依赖度",
    definition:
      "观察企业对外部融资的依赖，避免把融资流入直接等同于经营造血能力。",
    formula: "融资活动现金流净额 /（经营、融资、投资活动现金流绝对值之和）。",
    threshold:
      "需先定义零分母、经营现金流为负及极端值处理规则，再建立三档评分。",
    dataSource: "企业现金流量表与融资公告",
    frequency: "季度",
    lifecycleWeights: { startup: 5, growth: 5, stable: 6 },
    method: "calibration",
    readiness: "pending",
    sourceVersion: "RIS-2026.07.21-v1",
  },
  {
    id: "kci-034",
    indicatorId: "kci-034",
    dimension: "external",
    secondaryCategory: "供应链",
    label: "核心零部件国产化率",
    definition:
      "衡量关键零部件或原材料的国产替代程度，并关注进口依赖的实际暴露。",
    formula: "境外供应商采购金额 / 总采购金额；同时按核心模块识别可替代性。",
    threshold:
      "国产化率与进口依赖度风险方向需统一，完成模块重要性校准前不输出分数。",
    dataSource: "招股说明书供应链章节、年报、行业报告与公开采购披露",
    frequency: "年度",
    lifecycleWeights: { startup: 3, growth: 3, stable: 3 },
    method: "calibration",
    readiness: "pending",
    sourceVersion: "RIS-2026.07.21-v1",
  },
  {
    id: "kci-035",
    indicatorId: "kci-035",
    dimension: "external",
    secondaryCategory: "供应链",
    label: "供应商集中度",
    definition: "衡量企业采购是否集中于少数供应商，识别供应中断或议价风险。",
    formula: "前五大供应商采购额之和 / 企业总采购额 × 100%。",
    threshold: "低风险 <30%；中风险 30%–60%；高风险 >60%。",
    dataSource: "年报前五名供应商披露与招股说明书",
    frequency: "年度",
    lifecycleWeights: { startup: 3, growth: 3, stable: 3 },
    method: "local-score",
    readiness: "ready",
    sourceVersion: "RIS-2026.07.21-v1",
  },
  {
    id: "kci-038",
    indicatorId: "kci-038",
    dimension: "external",
    secondaryCategory: "地缘政治",
    label: "海外业务收入占比",
    definition:
      "观察海外业务收入暴露，提示企业受地缘政治、汇率和跨境监管影响的范围。",
    formula: "年度海外业务收入 / 企业总营业收入 × 100%。",
    threshold: "低风险 <10%；中风险 10%–40%；高风险 >40%。",
    dataSource: "年报分地区收入与招股说明书",
    frequency: "年度",
    lifecycleWeights: { startup: 2, growth: 2, stable: 2 },
    method: "local-score",
    readiness: "ready",
    sourceVersion: "RIS-2026.07.21-v1",
  },
  {
    id: "kci-039",
    indicatorId: "kci-039",
    dimension: "external",
    secondaryCategory: "地缘政治",
    label: "出口管制与制裁暴露度",
    definition:
      "识别企业及关联方的限制清单命中，并结合受管制关键技术或部件的影响程度。",
    formula:
      "清单命中数 + 受管制核心部件或技术数量 / 核心部件或技术总数 × 100%。",
    threshold:
      "当前本地规则仅对清单命中数分档：0 个低风险、1 个中风险、≥2 个高风险；影响度待补充校准。",
    dataSource: "BIS、OFAC、UVL、欧盟制裁清单与企业公告",
    frequency: "月度",
    lifecycleWeights: { startup: 2, growth: 2, stable: 2 },
    method: "local-score",
    readiness: "partial",
    sourceVersion: "RIS-2026.07.21-v1",
    note: "完成关键技术或部件影响度数据接入前，只对公开限制清单命中数评分。",
  },
  {
    id: "personnel-equity-dilution",
    dimension: "personnel",
    secondaryCategory: "控制权稳定性",
    label: "股权稀释程度",
    definition:
      "观察创始人或创始团队在融资、激励和上市后的持股变化与控制权稳定性。",
    formula:
      "创始人持股比例；同时记录实控人是否低于 34% 特别决议一票否决权阈值。",
    threshold:
      "34% 与 50% 为控制权观察线；正式风险等级需结合同轮融资、投票权安排和董事会控制权校准。",
    dataSource: "年报、招股书、股权变动公告与公司章程",
    frequency: "年度",
    lifecycleWeights: { startup: 5, growth: 3, stable: 3 },
    method: "calibration",
    readiness: "pending",
    sourceVersion: "RIS-2026.07.21-v1",
  },
  {
    id: "personnel-noncompete-coverage",
    dimension: "personnel",
    secondaryCategory: "知识保护",
    label: "竞业限制覆盖率",
    definition:
      "观察核心技术人员竞业限制协议的覆盖范围与法律可执行性，识别人员离职后的知识泄露暴露。",
    formula:
      "核心技术人员竞业协议覆盖率；结合协议有效性、保密措施和关键专利可迁移性复核。",
    threshold: "缺少可公开验证的协议覆盖与有效性数据，暂不建立自动分数。",
    dataSource: "公司制度披露、年报、劳动争议公告与研究访谈底稿",
    frequency: "年度",
    lifecycleWeights: { startup: 4, growth: 3, stable: 3 },
    method: "calibration",
    readiness: "pending",
    sourceVersion: "RIS-2026.07.21-v1",
  },
  {
    id: "personnel-core-technical-share",
    dimension: "personnel",
    secondaryCategory: "人才结构",
    label: "核心技术人员占比",
    definition:
      "衡量核心研发人员占全体员工的比例，观察企业是否维持技术驱动所需的人才储备。",
    formula: "研发人员数 / 总员工数 × 100%。",
    threshold:
      "应按行业、阶段和研发外包模式建立可比基准，避免将规模差异直接判为风险。",
    dataSource: "年报员工情况章节、招股书与企业公开披露",
    frequency: "年度",
    lifecycleWeights: { startup: 6, growth: 4, stable: 4 },
    method: "calibration",
    readiness: "pending",
    sourceVersion: "RIS-2026.07.21-v1",
  },
]

export const riskQuantificationCatalogByDimension = new Map(
  (
    [
      "narrative",
      "technology",
      "compliance",
      "finance",
      "external",
      "personnel",
    ] as CanonicalRiskDimensionId[]
  ).map((dimension) => [
    dimension,
    riskQuantificationCatalog.filter((item) => item.dimension === dimension),
  ])
)

export const riskQuantificationCatalogByIndicatorId = new Map(
  riskQuantificationCatalog
    .filter(
      (item): item is RiskQuantificationCatalogItem & { indicatorId: string } =>
        Boolean(item.indicatorId)
    )
    .map((item) => [item.indicatorId, item])
)
