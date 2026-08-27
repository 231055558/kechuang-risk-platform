const indicatorLabels: Record<string, string> = {
  R01: "叙事热度与基本面背离",
  R02: "自身与第三方表述偏差",
  R03: "叙事稳定性",
  R04: "概念与主营业务关联度",
  PDQI: "叙事披露质量",
  ITAG: "创新叙事与行动匹配度",
  TONE: "管理者语调",
}

const metricLabels: Record<string, string> = {
  concept_related_revenue_share_pct: "概念相关业务收入占比",
  DTQ_fundamental_gap_proxy: "叙事热度与基本面背离值",
  formal_narrative_mean_adjacent_cosine: "正式报告叙事连续性",
  itag: "创新叙事与行动差距",
  ITAG_self_only: "企业自身创新叙事与行动差距",
  management_tone: "管理者语调得分",
  management_tone_stability_std: "管理者语调波动",
  objective_indicator_risk_score: "客观风险指标得分",
  pdqi: "叙事披露质量指数",
  self_third_party_exaggeration_density_gap: "自身与第三方夸张表述差异",
}

const variantLabels: Record<string, string> = {
  "cumulative-patent-proxy": "累计专利数量代理口径",
  "formal-industry-year-normalized": "同行业同年度标准化正式口径",
  "reference-range-[0.5,1.0]": "参考区间归一化代理口径",
  "IRAWC-CRITIC-2026.08-v2": "客观风险评分模型（2026 年 8 月第 2 版）",
  "IRAWC-CRITIC-2026.08-v3": "客观风险评分模型（2026 年 8 月第 3 版）",
  "QA-only-36": "36 条管理层问答口径",
  "TONE-QA-only-36": "36 条管理层问答语调口径",
  "TONE-QA-only": "仅管理层问答的语调口径",
  "TONE-legacy-QA-selection": "历史管理层问答筛选口径",
  "invalid-after-deduplicated-source-set": "来源去重后不可复核",
  "legacy-QA-selection": "历史管理层问答筛选口径",
  "代理值-非正式评分": "观察代理口径（不计分）",
  "可计算-文档方案二个体口径": "企业个体计算口径",
  "部分覆盖-代理值": "部分覆盖代理口径",
  可计算: "已按定义计算",
  缺失: "当前缺失",
  "可计算-辅助": "可计算的辅助观察口径",
  代理值: "观察代理口径",
  "代理值-严格事前": "严格事前观察代理口径",
}

const unitLabels: Record<string, string> = {
  "%": "百分比",
  "0-1": "0 至 1",
  "-1-to-1": "-1 至 1",
  dimensionless: "无量纲",
  "risk-score-0-100": "0 至 100 分",
  无量纲: "无量纲",
  比例: "比例",
  余弦相似度: "相似度",
  标准差: "标准差",
}

const validationLabels: Record<string, string> = {
  conditional: "条件可用",
  "conditional-deduplicated-QA-only-36":
    "来源已去重，采用 36 条管理层问答口径",
  "conditional-evidence-package-unavailable": "证据包不完整，条件可用",
  "objective-validated-narrative-QA-only-36":
    "客观指标已验证，叙事指标采用 36 条管理层问答口径",
  "formula-validated-evidence-conditional": "公式已核验，证据条件可用",
  missing: "数据缺失",
  "missing-industry-year-baseline": "缺少同行业同年度基准",
  "recomputed-deduplicated-proxy": "来源去重后已重算（代理值）",
  "recomputed-QA-only-36": "已按 36 条管理层问答重算",
  "versioned-engineering-proxy": "版本化工程代理值",
  "validated-from-governed-dataset": "治理数据已验证",
  "invalidated-after-source-deduplication": "来源去重后不可复核",
  "browser-confirmed-local-file-unavailable": "浏览器已确认，当前无本地文件",
  "conditional-local-file-unavailable": "条件核验，当前无本地文件",
  "derived-from-governed-dataset": "由治理数据集派生",
  "ego-confirmed-official-url-20260826": "浏览器已确认官方链接",
  "invalid-duplicate-source-id": "重复来源，已判无效",
  "legacy-audited": "历史口径已审计",
  "superseded-answer-count": "旧回答数量已被替代",
  validated: "已验证",
  unavailable: "无法取得",
  unverified: "尚未验证",
}

const coverageLabels: Record<string, string> = {
  "文档ITAG可计算/原DTQ仅代理或缺失":
    "企业个体口径可计算／原热度—基本面口径仅有代理值或缺失",
  "部分覆盖/代理": "部分覆盖／仅有代理值",
  原定义可计算: "可按原定义计算",
  去重后暂不可复核: "来源去重后暂不可复核",
  缺失: "当前缺失",
}

const formulaLabels: Record<string, string> = {
  "1/4×[IS_norm+RDD+(1-RCA)+DSR]":
    "四项等权平均：创新表述强度归一化值＋风险词密度＋（1－模糊词密度）＋数字披露密度",
  "[ln(本季绩效说明会叙事提问数+全文媒体数+1)-ln(上季同口径+1)]-营收同比增速/100":
    "本季叙事热度的自然对数增量，减去营业收入同比增速",
  "ln(1+Talk)-ln(1+当年发明专利申请数)，Talk=MD&A创新词频/有效词数×1000":
    "创新词密度与当年发明专利申请数分别取自然对数后相减；创新词密度按管理层讨论与分析章节每千个有效词计算",
  "|公司自述夸张性词数/公司自述有效词数-第三方夸张性词数/第三方有效词数|":
    "公司自述夸张词密度与第三方夸张词密度之差的绝对值",
  "Jieba分词后词频向量余弦相似度；R03风险代理=1-相邻期平均相似度":
    "中文分词后计算词频向量相似度；稳定性风险代理值等于 1 减去相邻报告期平均相似度",
  "固定窗口内各场业绩说明会TONE总体标准差；TONE=(POSPCT-NEGPCT)/(POSPCT+NEGPCT)":
    "固定窗口内各场业绩说明会管理者语调得分的标准差；语调得分为正向词占比与负向词占比之差，除以两者之和",
  "知识产权收入/总营收×100%": "知识产权收入占营业收入的百分比",
  "ln(1+Talk)-ln(1+PatentProxy)":
    "创新词密度与专利数量代理值分别取自然对数后相减",
  "(POS-NEG)/(POS+NEG)":
    "正向词数量与负向词数量之差，除以两者之和",
  "(云端产品线+边缘产品线+IP授权及软件收入)/总营收×100%":
    "云端产品线、边缘产品线、知识产权授权及软件收入之和，占营业收入的百分比",
  "ln(1+Talk)-ln(1+当年发明专利申请数)":
    "创新词密度与当年发明专利申请数分别取自然对数后相减",
  "车规芯片相关收入/总营收×100%":
    "车规芯片相关收入占营业收入的百分比",
  "被问询单笔DPU交易收入/2023年前三季度营收×100%":
    "被问询的单笔数据处理器交易收入，占 2023 年前三季度营业收入的百分比",
}

const narrativeTokenReplacements: Array<[RegExp, string]> = [
  [/invalidated-after-source-deduplication/g, "来源去重后不可复核"],
  [/IS_min\/IS_max/g, "创新表述强度的行业年度最小值与最大值"],
  [/raw_numeric_value/g, "原始数值字段"],
  [/MD&A/g, "管理层讨论与分析章节"],
  [/QA-only/g, "仅管理层问答"],
  [/QA/g, "管理层问答"],
  [/Z-score/g, "标准分"],
  [/DTQ/g, "叙事热度与基本面背离"],
  [/ITAG/g, "创新叙事与行动差距"],
  [/TONE/g, "管理者语调"],
  [/PDQI/g, "叙事披露质量指数"],
  [/R01/g, "叙事热度与基本面背离"],
  [/R02/g, "自身与第三方表述偏差"],
  [/R03/g, "叙事稳定性"],
  [/R04/g, "概念与主营业务关联度"],
  [/\bNULL\b/gi, "空值"],
]

export function getNarrativeIndicatorLabel(indicatorId: string | null) {
  return indicatorId
    ? (indicatorLabels[indicatorId] ?? "辅助观察指标")
    : "辅助观察指标"
}

export function getNarrativeMetricLabel(
  metricName: string,
  indicatorId: string | null
) {
  return metricLabels[metricName] ?? getNarrativeIndicatorLabel(indicatorId)
}

export function getNarrativeVariantLabel(variant: string | null) {
  if (!variant) return "未注明口径"
  return variantLabels[variant] ?? "自定义审计口径"
}

export function getNarrativeUnitLabel(unit: string | null) {
  if (!unit) return null
  return unitLabels[unit] ?? "自定义单位"
}

export function getNarrativeValidationLabel(status: string | null) {
  if (!status) return "未标注验证状态"
  return validationLabels[status] ?? "待进一步核验"
}

export function getNarrativeCoverageLabel(status: string) {
  return coverageLabels[status] ?? localizeNarrativeText(status)
}

export function getNarrativeConfidenceLabel(level: string | null) {
  if (!level || level === "NA") return "未评定"
  return level
}

export function getNarrativeFormulaLabel(formula: string) {
  const known = formulaLabels[formula]
  if (known) return known

  const objectiveMatch = formula.match(
    /^r_rel=([^；]+)；r=100×\(.+\)=([^；]+)$/
  )
  if (objectiveMatch) {
    return `相对风险分位为 ${objectiveMatch[1]}；加权后的客观风险分为 ${objectiveMatch[2]}`
  }

  const localized = localizeNarrativeText(formula)
  const containsInternalNotation =
    localized.includes("_") ||
    localized.includes("[") ||
    localized.includes("]") ||
    /\b[A-Za-z]{2,}\b/.test(localized)
  return containsInternalNotation
    ? "计算方法已在审计底稿中留存"
    : localized
}

export function localizeNarrativeText(text: string | null) {
  if (!text) return ""
  return narrativeTokenReplacements.reduce(
    (localized, [pattern, replacement]) => localized.replace(pattern, replacement),
    text
  )
}
