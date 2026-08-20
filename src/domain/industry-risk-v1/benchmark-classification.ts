import type { IndustryRiskCompany } from "./model.ts"

export interface IndustryRiskBenchmarkGroupDefinition {
  id: string
  label: string
  sourceLabel: string
  sourceCode: string
}

const semiconductorEquipmentCodes = new Set(["688012", "688037", "688072"])
const integratedCircuitManufacturingCodes = new Set(["688347", "688981"])

export const INDUSTRY_RISK_BENCHMARK_GROUPS: readonly IndustryRiskBenchmarkGroupDefinition[] =
  [
    {
      id: "chip-design",
      label: "芯片（数字+模拟芯片设计）",
      sourceLabel: "申万三级行业合并口径",
      sourceCode: "850814.SI + 850815.SI",
    },
    {
      id: "chemical-pharma",
      label: "化学制剂",
      sourceLabel: "申万三级行业",
      sourceCode: "851512.SI",
    },
    {
      id: "semiconductor-equipment",
      label: "半导体设备",
      sourceLabel: "申万三级行业",
      sourceCode: "850818.SI",
    },
    {
      id: "integrated-circuit-manufacturing",
      label: "集成电路制造",
      sourceLabel: "申万三级行业",
      sourceCode: "850816.SI",
    },
  ]

export function resolveIndustryRiskBenchmarkGroupId(
  company: IndustryRiskCompany
) {
  if (
    company.peerGroupId === "digital-chip" ||
    company.peerGroupId === "analog-chip"
  ) {
    return "chip-design"
  }
  if (company.peerGroupId === "pharma") return "chemical-pharma"
  if (semiconductorEquipmentCodes.has(company.stockCode)) {
    return "semiconductor-equipment"
  }
  if (integratedCircuitManufacturingCodes.has(company.stockCode)) {
    return "integrated-circuit-manufacturing"
  }
  return company.peerGroupId ?? "unclassified"
}

export function resolveIndustryRiskBenchmarkGroup(
  company: IndustryRiskCompany
): IndustryRiskBenchmarkGroupDefinition {
  const id = resolveIndustryRiskBenchmarkGroupId(company)
  return (
    INDUSTRY_RISK_BENCHMARK_GROUPS.find((group) => group.id === id) ?? {
      id,
      label: company.chainSegment || company.industry || "未分类行业",
      sourceLabel: "现有数据同业组",
      sourceCode: company.peerGroupId ?? "unclassified",
    }
  )
}
