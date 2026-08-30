export type PublicEventKind =
  | "deep-search"
  | "screening"
  | "inquiry"
  | "litigation"

export type PublicEventCopyInput = {
  kind: PublicEventKind
  eventType: string
  title: string
  date: string
  sourceName: string
  notes: string
  indicatorId: string
}

export type PublicEventCopy = {
  summary: string
  keyFacts: string[]
}

const INTERNAL_WORKFLOW_COPY =
  /待核对|待确认|待补充|待复核|人工复核|需人工|需阅读全文|等待后续正式披露|标题级事件扫描|方向=|应结合公告正文/

function defaultSummary(event: PublicEventCopyInput) {
  if (event.kind === "litigation") {
    return `公开材料确认存在诉讼或仲裁事项，已纳入 ${event.indicatorId} 诉讼司法风险观察。`
  }
  if (event.kind === "inquiry") {
    return `交易所公开材料记录该事项，已纳入 ${event.indicatorId} 资本市场风险观察。`
  }
  if (event.kind === "screening") {
    return `官方清单记录相关主体，已纳入 ${event.indicatorId} 外部限制风险观察。`
  }
  return `公开披露记录该事件，已按${event.eventType}归档并关联 ${event.indicatorId}。`
}

export function toPublicEventCopy(
  event: PublicEventCopyInput
): PublicEventCopy {
  const notes = event.notes.trim()
  const summary =
    event.kind === "deep-search" &&
    notes &&
    !INTERNAL_WORKFLOW_COPY.test(notes)
      ? notes
      : defaultSummary(event)

  return {
    summary,
    keyFacts: [
      `${event.indicatorId} · ${event.eventType}`,
      `事件日期：${event.date}`,
      `来源：${event.sourceName}`,
    ],
  }
}

type DeduplicatedEvent = {
  id: string
  companyId: string
  title: string
  date: string
  url: string
  confidence: number
}

function eventIdentity(event: DeduplicatedEvent) {
  const normalizedTitle = event.title
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .replace(/[^\p{L}\p{N}]+/gu, "")
  return `${event.companyId}|${event.date}|${normalizedTitle}`
}

export function deduplicatePublicEvents<T extends DeduplicatedEvent>(
  events: T[]
): T[] {
  const selected = new Map<string, { index: number; event: T }>()

  events.forEach((event, index) => {
    const key = eventIdentity(event)
    const current = selected.get(key)
    if (!current || event.confidence > current.event.confidence) {
      selected.set(key, { index: current?.index ?? index, event })
    }
  })

  return [...selected.values()]
    .sort((left, right) => left.index - right.index)
    .map(({ event }) => event)
}
