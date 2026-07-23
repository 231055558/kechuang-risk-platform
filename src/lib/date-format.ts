const dateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/
const machineReadableDatePattern = /^\d{4}(?:-\d{2}(?:-\d{2})?)?$/
const sourceTimeZone = "Asia/Shanghai"

const compactDateFormatter = new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit",
  day: "2-digit",
  timeZone: sourceTimeZone,
})

const fullDateFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "long",
  day: "numeric",
  timeZone: sourceTimeZone,
})

const dateTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: sourceTimeZone,
})

const timeFormatter = new Intl.DateTimeFormat("zh-CN", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: sourceTimeZone,
})

export function isDateOnly(value: string) {
  return dateOnlyPattern.test(value)
}

export function isMachineReadableDate(value: string) {
  return machineReadableDatePattern.test(value)
}

export function formatSourceDateTime(value: string) {
  const date = parseSourceDate(value)
  if (!date) {
    return value
  }

  return isDateOnly(value)
    ? compactDateFormatter.format(date)
    : dateTimeFormatter.format(date)
}

export function formatSourceDate(value: string) {
  const date = parseSourceDate(value)
  return date ? fullDateFormatter.format(date) : value
}

export function formatSourceListTime(value: string) {
  if (isDateOnly(value)) {
    return "仅披露日期"
  }

  const date = parseSourceDate(value)
  return date ? timeFormatter.format(date) : value
}

export function formatSourceSidebarTime(value: string) {
  if (isDateOnly(value)) {
    const date = parseSourceDate(value)
    return date ? compactDateFormatter.format(date) : value
  }

  const date = parseSourceDate(value)
  return date ? timeFormatter.format(date) : value
}

function parseSourceDate(value: string) {
  const date = new Date(
    isDateOnly(value) ? `${value}T00:00:00+08:00` : value
  )
  return Number.isNaN(date.getTime()) ? null : date
}
