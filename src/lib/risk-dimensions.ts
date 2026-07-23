import type { CanonicalRiskDimensionId } from "@/types/risk"

export const CANONICAL_RISK_DIMENSION_LABELS: Record<
  CanonicalRiskDimensionId,
  string
> = {
  narrative: "叙事风险",
  technology: "技术风险",
  compliance: "合规风险",
  finance: "财务与融资风险",
  external: "外部风险",
  personnel: "人员风险",
}

export const LEGACY_RISK_DIMENSION_GROUPS: Record<
  CanonicalRiskDimensionId,
  string[]
> = {
  narrative: [],
  technology: ["tech", "cyber", "ip"],
  compliance: ["data", "ethics", "regulatory"],
  finance: ["finance"],
  external: ["external"],
  personnel: [],
}

const DIMENSION_ALIASES: Record<CanonicalRiskDimensionId, string[]> = {
  narrative: ["narrative", "叙事", "叙事风险"],
  technology: [
    "technology",
    "tech",
    "cyber",
    "ip",
    "技术",
    "技术风险",
    "技术与算法",
    "网络安全",
    "知识产权",
  ],
  compliance: [
    "compliance",
    "data",
    "ethics",
    "regulatory",
    "合规",
    "合规风险",
    "数据合规",
    "科技伦理",
    "监管政策",
    "安全合规",
    "诉讼仲裁",
    "知识产权许可合规",
    "知识产权诉讼",
    "开源许可合规",
  ],
  finance: ["finance", "财务风险", "融资风险", "经营财务", "财务与融资风险"],
  external: [
    "external",
    "外部风险",
    "外部环境",
    "外部环境/地缘",
    "地缘政治风险",
    "供应链风险",
  ],
  personnel: ["personnel", "人员风险", "人才风险"],
}

const aliasRegistry = new Map<string, CanonicalRiskDimensionId>(
  (
    Object.entries(DIMENSION_ALIASES) as Array<
      [CanonicalRiskDimensionId, string[]]
    >
  ).flatMap(([id, aliases]) => aliases.map((alias) => [alias, id]))
)

export function getCanonicalRiskDimensionId(
  value: string | null | undefined
): CanonicalRiskDimensionId | null {
  const normalized = value?.trim()
  return normalized ? (aliasRegistry.get(normalized) ?? null) : null
}

export function getCanonicalRiskDimensionLabel(
  value: string | null | undefined
) {
  const id = getCanonicalRiskDimensionId(value)
  return id
    ? CANONICAL_RISK_DIMENSION_LABELS[id]
    : (value?.trim() ?? "未分类风险")
}

export function getCanonicalRiskDimensionIds(values: string[]) {
  return [
    ...new Set(
      values
        .map((value) => getCanonicalRiskDimensionId(value))
        .filter((value): value is CanonicalRiskDimensionId => Boolean(value))
    ),
  ]
}

export function getCanonicalRiskDimensionLabels(values: string[]) {
  return getCanonicalRiskDimensionIds(values).map(
    (id) => CANONICAL_RISK_DIMENSION_LABELS[id]
  )
}
