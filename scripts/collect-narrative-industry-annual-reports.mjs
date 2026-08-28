import { createHash } from "node:crypto"
import { mkdir, readFile, stat, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"

const ROOT = resolve(import.meta.dirname, "..")
const DATASET_PATH = resolve(
  ROOT,
  "src/data/industry/r01-r22-unified.json"
)
const MANIFEST_PATH = resolve(
  ROOT,
  "config/narrative-risk-industry-annual-reports.json"
)
const ARCHIVE_ROOT = resolve(
  ROOT,
  "private/narrative-risk/industry-annual/reports"
)
const QUERY_ENDPOINT =
  "https://query.sse.com.cn/security/stock/queryCompanyBulletin.do"
const MIRROR_QUERY_ENDPOINT =
  "https://np-anotice-stock.eastmoney.com/api/security/ann"
const YEARS = [2021, 2022, 2023, 2024, 2025]
const AS_OF_DATE = "2026-08-27"

function sleep(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds))
}

async function fetchWithRetry(url, options = {}, attempts = 4) {
  let lastError
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(30_000),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return response
    } catch (error) {
      lastError = error
      if (attempt < attempts) await sleep(attempt * 700)
    }
  }
  throw lastError
}

function bulletinQueryUrl(stockCode) {
  const parameters = new URLSearchParams({
    isPagination: "true",
    productId: stockCode,
    securityType: "0101,120100,020100,020200,120200",
    reportType: "ALL",
    beginDate: "2022-01-01",
    endDate: AS_OF_DATE,
    "pageHelp.pageSize": "100",
    "pageHelp.pageNo": "1",
    "pageHelp.beginPage": "1",
    "pageHelp.endPage": "10",
    "pageHelp.cacheSize": "10",
  })
  return `${QUERY_ENDPOINT}?${parameters}`
}

function selectAnnualReports(rows) {
  return YEARS.flatMap((year) => {
    const titlePattern = new RegExp(
      `${year}年年度报告(?:（(?:修订版|更新版|更正版)）)?$`
    )
    const match = rows.find(
      (row) =>
        typeof row.TITLE === "string" &&
        titlePattern.test(row.TITLE) &&
        !/摘要|英文版/.test(row.TITLE) &&
        typeof row.URL === "string" &&
        row.URL.endsWith(".pdf")
    )
    return match ? [{ year, row: match }] : []
  })
}

function mirrorQueryUrl(stockCode) {
  const parameters = new URLSearchParams({
    sr: "-1",
    page_size: "100",
    page_index: "1",
    ann_type: "A",
    client_source: "web",
    stock_list: stockCode,
    f_node: "1",
    s_node: "1",
    begin_time: "2022-01-01",
    end_time: AS_OF_DATE,
  })
  return `${MIRROR_QUERY_ENDPOINT}?${parameters}`
}

function selectMirrorReports(rows) {
  return YEARS.flatMap((year) => {
    const titlePattern = new RegExp(
      `${year}年年度报告(?:（(?:修订版|更新版|更正版)）)?$`
    )
    const match = rows.find(
      (row) =>
        typeof row.title === "string" &&
        titlePattern.test(row.title) &&
        !/摘要|英文版/.test(row.title) &&
        typeof row.art_code === "string"
    )
    return match ? [{ year, row: match }] : []
  })
}

async function mapPool(values, concurrency, operation) {
  const results = new Array(values.length)
  let cursor = 0
  async function worker() {
    while (cursor < values.length) {
      const index = cursor
      cursor += 1
      results[index] = await operation(values[index], index)
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, worker)
  )
  return results
}

async function sha256File(path) {
  const content = await readFile(path)
  return createHash("sha256").update(content).digest("hex")
}

async function queryCompany(company) {
  const queryUrl = bulletinQueryUrl(company.stockCode)
  try {
    const [response, mirrorResponse] = await Promise.all([
      fetchWithRetry(queryUrl, {
        headers: {
          Accept: "application/json, text/javascript, */*; q=0.01",
          Referer: `https://www.sse.com.cn/assortment/stock/list/info/announcement/index.shtml?productId=${company.stockCode}`,
          "User-Agent": "Mozilla/5.0 narrative-risk-research/1.0",
        },
      }),
      fetchWithRetry(mirrorQueryUrl(company.stockCode), {
        headers: {
          Accept: "application/json, text/plain, */*",
          Referer: "https://data.eastmoney.com/",
          "User-Agent": "Mozilla/5.0 narrative-risk-research/1.0",
        },
      }),
    ])
    const [payload, mirrorPayload] = await Promise.all([
      response.json(),
      mirrorResponse.json(),
    ])
    const rows = Array.isArray(payload.result)
      ? payload.result
      : Array.isArray(payload.pageHelp?.data)
        ? payload.pageHelp.data
        : []
    const selected = selectAnnualReports(rows)
    const mirrorSelected = selectMirrorReports(mirrorPayload.data?.list ?? [])
    return YEARS.map((year) => {
      const match = selected.find((item) => item.year === year)?.row
      const mirrorMatch = mirrorSelected.find((item) => item.year === year)?.row
      return {
        companyId: company.id,
        companyName: company.shortName,
        stockCode: company.stockCode,
        peerGroupId: company.peerGroupId,
        year,
        title: match?.TITLE ?? `${company.shortName}${year}年年度报告`,
        publicationDate: match?.SSEDATE ?? null,
        officialUrl: match ? `https://www.sse.com.cn${match.URL}` : null,
        mirrorUrl: mirrorMatch
          ? `https://pdf.dfcfw.com/pdf/H2_${mirrorMatch.art_code}_1.pdf`
          : null,
        discoveryStatus: match ? "已定位" : "未找到",
        archiveStatus: match ? "待归档" : "不适用或未披露",
        byteSize: null,
        sha256: null,
      }
    })
  } catch (error) {
    return YEARS.map((year) => ({
      companyId: company.id,
      companyName: company.shortName,
      stockCode: company.stockCode,
      peerGroupId: company.peerGroupId,
      year,
      title: `${company.shortName}${year}年年度报告`,
      publicationDate: null,
      officialUrl: null,
      mirrorUrl: null,
      discoveryStatus: "查询失败",
      archiveStatus: "查询失败",
      byteSize: null,
      sha256: null,
      error: error instanceof Error ? error.message : String(error),
    }))
  }
}

async function archiveReport(report) {
  if (!report.officialUrl && !report.mirrorUrl) return report
  const archivePath = resolve(
    ARCHIVE_ROOT,
    report.companyId,
    `${report.year}.pdf`
  )
  try {
    let fileStat
    try {
      fileStat = await stat(archivePath)
    } catch {
      let content
      let lastError
      for (const downloadUrl of [report.mirrorUrl, report.officialUrl].filter(
        Boolean
      )) {
        try {
          const response = await fetchWithRetry(downloadUrl, {
            headers: {
              Accept: "application/pdf",
              Referer: downloadUrl.includes("dfcfw")
                ? "https://data.eastmoney.com/"
                : "https://www.sse.com.cn/",
              "User-Agent": "Mozilla/5.0 narrative-risk-research/1.0",
            },
          })
          const candidate = Buffer.from(await response.arrayBuffer())
          if (candidate.subarray(0, 4).equals(Buffer.from("%PDF"))) {
            content = candidate
            break
          }
          lastError = new Error("返回内容不是PDF")
        } catch (error) {
          lastError = error
        }
      }
      if (!content) throw lastError ?? new Error("没有可用下载地址")
      await mkdir(dirname(archivePath), { recursive: true })
      await writeFile(archivePath, content)
      fileStat = await stat(archivePath)
    }
    return {
      ...report,
      archiveStatus: "已归档",
      byteSize: fileStat.size,
      sha256: await sha256File(archivePath),
    }
  } catch (error) {
    return {
      ...report,
      archiveStatus: "归档失败",
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

async function main() {
  const dataset = JSON.parse(await readFile(DATASET_PATH, "utf8"))
  const companies = dataset.companies.map((company) => ({
    id: company.id,
    shortName: company.shortName,
    stockCode: company.stockCode,
    peerGroupId: company.peerGroupId,
  }))
  const discoveredGroups = await mapPool(companies, 4, queryCompany)
  const discovered = discoveredGroups.flat()
  const archived = await mapPool(discovered, 5, archiveReport)
  const manifest = {
    schemaVersion: "KCR-NARRATIVE-INDUSTRY-ANNUAL-2026.08-v1",
    asOfDate: AS_OF_DATE,
    sourcePlatform: "上海证券交易所",
    companyCount: companies.length,
    targetYearCount: companies.length * YEARS.length,
    reports: archived,
    audit: {
      located: archived.filter((item) => item.officialUrl).length,
      archived: archived.filter((item) => item.archiveStatus === "已归档")
        .length,
      unavailable: archived.filter((item) => !item.officialUrl).length,
      failed: archived.filter((item) => item.archiveStatus === "归档失败")
        .length,
    },
  }
  await writeFile(
    MANIFEST_PATH,
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8"
  )
  console.log(JSON.stringify(manifest.audit))
}

await main()
