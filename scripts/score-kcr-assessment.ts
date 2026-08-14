import { readFile, writeFile } from "node:fs/promises"
import { basename, resolve } from "node:path"

import {
  calculateKcrAssessment,
  KcrAssessmentRequestError,
} from "../src/domain/kcr-v1/scoring-engine.ts"

const [inputArgument, outputArgument] = process.argv.slice(2)

if (!inputArgument) {
  console.error("用法：npm run score:kcr -- <input.json> [output.json]")
  process.exitCode = 2
} else {
  const inputPath = resolve(inputArgument)

  try {
    const request: unknown = JSON.parse(await readFile(inputPath, "utf8"))
    const result = calculateKcrAssessment(request)

    if (outputArgument) {
      const outputPath = resolve(outputArgument)
      await writeFile(
        outputPath,
        `${JSON.stringify(result, null, 2)}\n`,
        "utf8"
      )
      console.log(
        `评分完成：${basename(inputPath)}；完整结果已写入 ${outputPath}`
      )
    }

    console.table([
      {
        企业: result.companyId,
        基线分: result.baselineScore ?? "数据不足",
        等级: result.riskLevelLabel,
        证据覆盖率: `${result.evidenceCoverage * 100}%`,
        置信度: `${result.confidence * 100}%`,
        红旗: result.redFlags.length,
        复核状态: result.reviewStatus,
      },
    ])
    console.table(
      result.dimensions.map((dimension) => ({
        维度: dimension.label,
        分数: dimension.score ?? "数据不足",
        等级: dimension.riskLevelLabel,
        评分权重覆盖率: `${Math.round(dimension.scoreWeightCoverage * 10000) / 100}%`,
      }))
    )
    console.log(`运行标识：${result.runId}；模型：${result.modelVersion}`)
  } catch (error) {
    if (error instanceof KcrAssessmentRequestError) {
      console.error(`评分失败：${basename(inputPath)}`)
      for (const detail of error.details) console.error(`- ${detail}`)
      process.exitCode = 1
    } else {
      throw error
    }
  }
}
