import { readFile, writeFile } from "node:fs/promises"
import { basename, resolve } from "node:path"

import { importKcrWorkbookBuffer } from "../src/importers/kcr-workbook.ts"

const [inputArgument, outputArgument] = process.argv.slice(2)

if (!inputArgument) {
  console.error(
    "用法：npm run import:kcr-workbook -- <input.xlsx> [output.json]"
  )
  process.exitCode = 2
} else {
  const inputPath = resolve(inputArgument)
  const result = await importKcrWorkbookBuffer(await readFile(inputPath))

  if (!result.ok) {
    console.error(`导入失败：${basename(inputPath)}`)
    for (const problem of result.errors) {
      console.error(
        `[${problem.code}] ${problem.sheet}${problem.row ? ` 第${problem.row}行` : ""}${problem.column ? ` ${problem.column}` : ""}：${problem.message}`
      )
    }
    process.exitCode = 1
  } else {
    const payload = JSON.stringify(
      { ...result.value, importWarnings: result.warnings },
      null,
      2
    )
    if (outputArgument) {
      const outputPath = resolve(outputArgument)
      await writeFile(outputPath, `${payload}\n`, "utf8")
      console.log(
        `导入成功：${result.value.summary.weightedIndicatorCount} 个加权指标、${result.value.summary.narrativeIndicatorCount} 个叙事校验项；已写入 ${outputPath}`
      )
    } else {
      console.log(payload)
    }
  }
}
