const regulatoryListRules = [
  {
    suffix:
      /\s*·\s*Entity List \(EL\)\s*-\s*Bureau of Industry and Security\s*$/i,
    source: /Entity List \(EL\).*Bureau of Industry and Security/i,
    label: "美国商务部工业与安全局实体清单",
  },
  {
    suffix:
      /\s*·\s*Non-SDN Chinese Military-Industrial Complex Companies List \(CMIC\)\s*-\s*Treasury Department\s*$/i,
    source:
      /Non-SDN Chinese Military-Industrial Complex Companies List \(CMIC\).*Treasury Department/i,
    label: "美国财政部中国军工复合体企业清单",
  },
] as const

const entityListNameLabels = new Map<string, string>([
  ["Cambricon Technologies Corporation Limited", "中科寒武纪科技股份有限公司"],
  ["Anhui Cambricon Information Technology Co., Ltd.", "安徽寒武纪信息科技有限公司"],
  ["Cambricon (Hong Kong) Co., Ltd.", "寒武纪（香港）有限公司"],
  ["Cambricon (Kunshan) Information Technology Co., Ltd.", "寒武纪（昆山）信息科技有限公司"],
  ["Cambricon (Nanjing) Information Technology Co., Ltd.", "寒武纪（南京）信息科技有限公司"],
  ["Cambricon (Xi’an) Integrated Circuit Co., Ltd.", "寒武纪（西安）集成电路有限公司"],
  ["Cambricon Jixingge (Nanjing) Technology Co., Ltd.", "寒武纪行歌（南京）科技有限公司"],
  ["Shanghai Cambricon Information Technology Co., Ltd.", "上海寒武纪信息科技有限公司"],
  ["Suzhou Cambricon Information Technology Co., Ltd.", "苏州寒武纪信息科技有限公司"],
  ["Xiong’an Cambricon Technology Co., Ltd.", "雄安寒武纪科技有限公司"],
  ["Semiconductor Manufacturing International Corporation", "中芯国际集成电路制造有限公司"],
  ["Semiconductor Manufacturing International Corporation (SMIC)", "中芯国际集成电路制造有限公司"],
])

export function getRiskNewsDisplayTitle(
  title: string,
  fallbackCompanyName = ""
) {
  const rule = regulatoryListRules.find(({ suffix }) => suffix.test(title))
  if (!rule) return title
  const originalName = title.replace(rule.suffix, "").trim()
  const fallbackName = fallbackCompanyName
    ? `${fallbackCompanyName}相关主体`
    : "相关主体"
  const displayName = entityListNameLabels.get(originalName) ?? fallbackName
  return `${displayName}被列入${rule.label}`
}

export function getRiskNewsDisplaySourceName(sourceName: string) {
  if (/^上交所公司公告\s*\/\s*Ego$/i.test(sourceName)) {
    return "上海证券交易所公司公告"
  }
  return (
    regulatoryListRules.find(({ source }) => source.test(sourceName))?.label ??
    sourceName
  )
}
