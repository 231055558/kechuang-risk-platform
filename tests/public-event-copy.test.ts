import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  deduplicatePublicEvents,
  toPublicEventCopy,
} from "../src/lib/public-event-copy.ts"

const dataset = JSON.parse(
  readFileSync(
    new URL(
      "../src/data/industry/r01-r22-unified.json",
      import.meta.url
    ),
    "utf8"
  )
) as {
  litigationEvidence: Array<{
    id: string
    companyId: string
    cause: string
    hearingTime: string
    role: string
    limitations: string
    sourceUrl: string
    confidence: number
  }>
}

const internalWorkflowCopy =
  /待核对|待确认|待补充|待复核|人工复核|需人工|需阅读全文|等待后续正式披露|标题级事件扫描|方向=|应结合公告正文/

test("诉讼数据中的内部采集备注不会进入投资者资讯文案", () => {
  const internalRecords = dataset.litigationEvidence.filter((item) =>
    internalWorkflowCopy.test(`${item.role}；${item.limitations}`)
  )

  assert.equal(internalRecords.length, 14)
  for (const item of internalRecords) {
    const copy = toPublicEventCopy({
      kind: "litigation",
      eventType: "诉讼司法事件",
      title: item.cause,
      date: item.hearingTime,
      sourceName: "公开司法信息",
      notes: `${item.role}；${item.limitations}`,
      indicatorId: "R12",
    })

    assert.doesNotMatch(JSON.stringify(copy), internalWorkflowCopy)
    assert.match(copy.summary, /公开材料|公开公告/)
    assert.ok(copy.keyFacts.length >= 2)
  }
})

test("同一企业、日期和标题的重复事件只保留高置信记录", () => {
  const duplicateUrl =
    "https://www.sse.com.cn/disclosure/listedinfo/announcement/example.pdf"
  const events = deduplicatePublicEvents([
    {
      id: "deep-search",
      companyId: "star-688373",
      title: "公司关于子公司提起诉讼的公告",
      date: "2025-02-26",
      url: duplicateUrl,
      confidence: 0.98,
    },
    {
      id: "litigation",
      companyId: "star-688373",
      title: "公司关于子公司提起诉讼的公告",
      date: "2025-02-26",
      url: duplicateUrl,
      confidence: 0.9,
    },
  ])

  assert.deepEqual(events.map((event) => event.id), ["deep-search"])
})

test("问询记录不暴露内部主题代码和计数口径", () => {
  const copy = toPublicEventCopy({
    kind: "inquiry",
    eventType: "交易所问询",
    title: "年度报告信息披露监管问询函回复公告",
    date: "2026-05-20",
    sourceName: "上海证券交易所",
    notes: "2025-annual-report-inquiry；计入：年度报告信息披露监管问询，一个问询主题只计1次",
    indicatorId: "R11",
  })

  assert.doesNotMatch(JSON.stringify(copy), /annual-report-inquiry|计入：|只计1次/)
  assert.match(copy.summary, /交易所公开材料/)
})

test("运行时资讯映射必须经过公开文案与去重边界", () => {
  const source = readFileSync(
    new URL("../src/lib/data-r01.ts", import.meta.url),
    "utf8"
  )

  assert.match(source, /toPublicEventCopy\(/)
  assert.match(source, /deduplicatePublicEvents\(/)
  assert.doesNotMatch(source, /summary:\s*event\.notes/)
  assert.doesNotMatch(source, /keyFacts:\s*\[event\.eventType,\s*event\.notes/)
  assert.doesNotMatch(source, /aiSummary:\s*event\.notes/)
})
