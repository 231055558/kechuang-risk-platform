import { readdir, writeFile } from "node:fs/promises"
import { extname, join, resolve } from "node:path"

import readExcelFile from "read-excel-file/node"

import {
  ENTERPRISE_EVIDENCE_CATALOG_SCHEMA_VERSION,
  assertEnterpriseEvidenceCatalog,
  type EnterpriseEvidenceArtifact,
  type EnterpriseEvidenceCatalog,
  type EnterpriseEvidenceCategory,
} from "../src/domain/enterprise-evidence-v1/index.ts"

const COMPANY_DIRECTORY = {
  cambricon: { companyId: "star-688256", displayName: "寒武纪" },
  deepseek: { companyId: "deepseek", displayName: "DeepSeek" },
  "fourth-paradigm": { companyId: "fourth-paradigm", displayName: "第四范式" },
  horizon: { companyId: "horizon", displayName: "地平线" },
  robosense: { companyId: "robosense", displayName: "速腾聚创" },
  unitree: { companyId: "unitree", displayName: "宇树科技" },
  百济神州: { companyId: "beigene", displayName: "百济神州" },
} as const

function classifyCategory(name: string): EnterpriseEvidenceCategory {
  if (/风险指标|可审计工作簿/.test(name)) return "risk-workbook"
  if (/年报|招股书/.test(name)) return "annual-reporting"
  if (/财务报表|主营构成/.test(name)) return "financial-reporting"
  if (/专利|商标|软件著作权/.test(name)) return "intellectual-property"
  if (/供应商|客户|竞品|中标|招标/.test(name)) {
    return "commercial-relations"
  }
  if (/开庭|裁判|立案/.test(name)) return "litigation"
  if (/行政许可|税务信用|进出口信用|资质证书|监管措施/.test(name)) {
    return "regulatory-compliance"
  }
  if (/融资|并购|投资|参控股|发行股票|定向增发|理财/.test(name)) {
    return "financing-investment"
  }
  if (/人员|团队|控制人|受益人|股东|变更记录|工商信息/.test(name)) {
    return "corporate-governance"
  }
  if (/\.zip$/i.test(name)) return "archive"
  return "company-profile"
}

function sourceClass(name: string): EnterpriseEvidenceArtifact["sourceClass"] {
  if (/风险指标|可审计工作簿/.test(name)) return "team-workbook"
  if (/年报|招股书/.test(name)) return "public-filing"
  if (/\.zip$/i.test(name)) return "private-archive"
  return "commercial-data-export"
}

function fileFormat(name: string): EnterpriseEvidenceArtifact["format"] {
  const extension = extname(name).toLowerCase()
  if (extension === ".xlsx") return "xlsx"
  if (extension === ".pdf") return "pdf"
  if (extension === ".zip") return "zip"
  throw new TypeError(`不支持的企业材料格式：${extension}`)
}

async function inspectWorkbook(path: string) {
  const sheets = await readExcelFile(path)
  return {
    sheetCount: sheets.length,
    nonEmptyRowCount: sheets.reduce(
      (total, sheet) =>
        total +
        sheet.data.filter((row) =>
          row.some((cell) => cell !== null && String(cell).trim() !== "")
        ).length,
      0
    ),
  }
}

async function buildCatalog(
  inputRoot: string
): Promise<EnterpriseEvidenceCatalog> {
  const artifacts: EnterpriseEvidenceArtifact[] = []
  for (const [folder, company] of Object.entries(COMPANY_DIRECTORY)) {
    const files = (
      await readdir(join(inputRoot, folder), { withFileTypes: true })
    )
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right, "zh-CN"))
    const ordinals = new Map<EnterpriseEvidenceCategory, number>()
    for (const name of files) {
      const format = fileFormat(name)
      const category = classifyCategory(name)
      const ordinal = (ordinals.get(category) ?? 0) + 1
      ordinals.set(category, ordinal)
      const workbook =
        format === "xlsx"
          ? await inspectWorkbook(join(inputRoot, folder, name))
          : { sheetCount: null, nonEmptyRowCount: null }
      artifacts.push({
        id: `artifact:${company.companyId}:${category}:${String(ordinal).padStart(2, "0")}`,
        companyId: company.companyId,
        category,
        format,
        ...workbook,
        sourceClass: sourceClass(name),
        redistribution: "private-metadata-only",
        ingestionStatus: "cataloged-not-ingested",
      })
    }
  }

  const companies = Object.values(COMPANY_DIRECTORY).map((company) => {
    const companyArtifacts = artifacts.filter(
      (artifact) => artifact.companyId === company.companyId
    )
    return {
      ...company,
      artifactCount: companyArtifacts.length,
      workbookCount: companyArtifacts.filter(
        (artifact) => artifact.format === "xlsx"
      ).length,
      categoryCounts: Object.fromEntries(
        [...new Set(companyArtifacts.map((artifact) => artifact.category))].map(
          (category) => [
            category,
            companyArtifacts.filter(
              (artifact) => artifact.category === category
            ).length,
          ]
        )
      ),
    }
  })
  const catalog: EnterpriseEvidenceCatalog = {
    schemaVersion: ENTERPRISE_EVIDENCE_CATALOG_SCHEMA_VERSION,
    sourceDate: "2026-08-18",
    sourceLabel: "学生提供的企业材料（仅公开派生元数据）",
    scopeNote:
      "目录仅记录企业、材料类别、格式、工作表数和非空行数；不包含文件名、路径、单元格值或授权材料原文。",
    companyCount: companies.length,
    artifactCount: artifacts.length,
    workbookCount: artifacts.filter((artifact) => artifact.format === "xlsx")
      .length,
    pdfCount: artifacts.filter((artifact) => artifact.format === "pdf").length,
    archiveCount: artifacts.filter((artifact) => artifact.format === "zip")
      .length,
    companies,
    artifacts,
  }
  assertEnterpriseEvidenceCatalog(catalog)
  return catalog
}

const [inputArgument, outputArgument] = process.argv.slice(2)
if (!inputArgument || !outputArgument) {
  console.error(
    "用法：npm run import:enterprise-evidence -- <企业信息目录> <output.json>"
  )
  process.exitCode = 2
} else {
  const catalog = await buildCatalog(resolve(inputArgument))
  const outputPath = resolve(outputArgument)
  await writeFile(outputPath, `${JSON.stringify(catalog, null, 2)}\n`, "utf8")
  console.log(
    `企业材料目录已生成：${catalog.companyCount} 家企业、${catalog.artifactCount} 份材料、${catalog.workbookCount} 个工作簿；已写入 ${outputPath}`
  )
}
