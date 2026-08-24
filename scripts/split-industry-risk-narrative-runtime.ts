import { readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"

import {
  INDUSTRY_RISK_NARRATIVE_RUNTIME_SCHEMA_VERSION,
  attachIndustryRiskNarrativeRuntime,
  assertIndustryRiskDataset,
  type IndustryRiskDataset,
  type IndustryRiskNarrativeRuntime,
} from "../src/domain/industry-risk-v1/index.ts"

export function splitIndustryRiskNarrativeRuntime(
  dataset: IndustryRiskDataset
) {
  const {
    narrativeNewsEvidence = [],
    narrativeNewsMetrics = [],
    ...baseDataset
  } = dataset
  const runtime: IndustryRiskNarrativeRuntime = {
    schemaVersion: INDUSTRY_RISK_NARRATIVE_RUNTIME_SCHEMA_VERSION,
    dataVersion: dataset.metadata.dataVersion,
    narrativeNewsEvidence,
    narrativeNewsMetrics,
  }
  assertIndustryRiskDataset(baseDataset)
  attachIndustryRiskNarrativeRuntime(baseDataset, runtime)
  return { baseDataset, runtime }
}

function main() {
  const [inputPath, baseOutputPath, narrativeOutputPath] = process.argv.slice(2)
  if (!inputPath || !baseOutputPath || !narrativeOutputPath) {
    console.error(
      "用法：npm run split:industry-risk-runtime -- combined.json base.json narrative.json"
    )
    process.exitCode = 1
    return
  }
  const dataset = JSON.parse(
    readFileSync(resolve(inputPath), "utf8")
  ) as IndustryRiskDataset
  const { baseDataset, runtime } = splitIndustryRiskNarrativeRuntime(dataset)
  writeFileSync(
    resolve(baseOutputPath),
    `${JSON.stringify(baseDataset, null, 2)}\n`
  )
  writeFileSync(
    resolve(narrativeOutputPath),
    `${JSON.stringify(runtime, null, 2)}\n`
  )
  console.log(
    `已拆分浏览器基础快照和叙事运行时：${runtime.narrativeNewsMetrics.length} 家企业、${runtime.narrativeNewsEvidence.length} 条新闻。`
  )
}

if (
  process.argv[1] &&
  import.meta.url === new URL(process.argv[1], "file:").href
) {
  main()
}
