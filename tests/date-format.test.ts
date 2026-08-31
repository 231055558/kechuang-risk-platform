import assert from "node:assert/strict"
import test from "node:test"

import {
  formatSourceDateTime,
  formatSourceEventTime,
  formatSourceListTime,
  formatSourceSidebarTime,
  isDateOnly,
  isMachineReadableDate,
} from "../src/lib/date-format.ts"

test("date-only source disclosures never invent a midnight publication time", () => {
  assert.equal(isDateOnly("2026-04-24"), true)
  assert.equal(formatSourceListTime("2026-04-24"), "仅披露日期")
  assert.equal(formatSourceEventTime("2026-04-24"), "2026-04-24")
  assert.doesNotMatch(formatSourceDateTime("2026-04-24"), /00:00/)
  assert.doesNotMatch(formatSourceSidebarTime("2026-04-24"), /00:00/)
})

test("timestamped source disclosures retain their clock time", () => {
  const value = "2026-07-02T10:30:00+08:00"

  assert.equal(isDateOnly(value), false)
  assert.match(formatSourceDateTime(value), /10:30/)
  assert.equal(formatSourceEventTime(value), "2026-07-02 10:30")
  assert.equal(formatSourceListTime(value), "10:30")
  assert.equal(formatSourceSidebarTime(value), "10:30")
})

test("source dates stay in the Asia/Shanghai snapshot timezone", () => {
  const value = "2026-07-02T10:30:00+08:00"

  assert.match(formatSourceDateTime(value), /07\/02 10:30/)
  assert.equal(formatSourceListTime(value), "10:30")
})

test("machine-readable date precision excludes narrative date labels", () => {
  assert.equal(isMachineReadableDate("2026"), true)
  assert.equal(isMachineReadableDate("2026-05"), true)
  assert.equal(isMachineReadableDate("2026-05-18"), true)
  assert.equal(isMachineReadableDate("2025 年度口径"), false)
})
