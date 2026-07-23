import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const testDirectory = dirname(fileURLToPath(import.meta.url))
const projectRoot = join(testDirectory, "..")

function readProjectFile(path: string) {
  return readFileSync(join(projectRoot, path), "utf8")
}

test("mobile dashboard controls expose at least 44px touch targets", () => {
  const businessStyles = readProjectFile("src/styles/business.css")
  const pageStyles = readProjectFile("src/styles/pages.css")
  const eventsSource = readProjectFile(
    "src/components/dashboard/events-tab.tsx"
  )

  assert.match(
    businessStyles,
    /@media \(max-width: 767px\) \{[\s\S]*?\.section-tabs \[data-slot="tabs-trigger"\][\s\S]*?min-width:\s*44px;[\s\S]*?min-height:\s*44px;/
  )
  assert.match(
    pageStyles,
    /\.compare-card-selector,[\s\S]*?\.event-register-status \[data-slot="select-trigger"\],[\s\S]*?min-width:\s*44px;[\s\S]*?min-height:\s*44px;/
  )
  assert.match(
    pageStyles,
    /\.assessment-method-action\[data-slot="button"\]\[data-variant="outline"\]\s*\{[\s\S]*?min-height:\s*44px;/
  )
  assert.match(
    pageStyles,
    /\.compare-company-menu \[data-slot="select-item"\],[\s\S]*?\.event-select-menu \[data-slot="select-item"\][\s\S]*?min-height:\s*44px;/
  )
  assert.equal(eventsSource.match(/className="event-select-menu"/g)?.length, 4)
})

test("comparison metrics and event counts use tabular numerals", () => {
  const businessStyles = readProjectFile("src/styles/business.css")
  const compareSource = readProjectFile(
    "src/components/dashboard/compare-tab.tsx"
  )
  const eventsSource = readProjectFile(
    "src/components/dashboard/events-tab.tsx"
  )

  assert.match(
    businessStyles,
    /\.tabular-number\s*\{[\s\S]*?font-variant-numeric:\s*tabular-nums;/
  )
  assert.ok(
    (compareSource.match(/\btabular-number\b/g) ?? []).length >= 8,
    "comparison scores, percentages, coverage and evidence counts should use tabular numerals"
  )
  assert.ok(
    (eventsSource.match(/\btabular-number\b/g) ?? []).length >= 4,
    "event counts and rendered dates should use tabular numerals"
  )
})

test("event dates render with the same zh-CN conventions as risk dynamics", () => {
  const eventsSource = readProjectFile(
    "src/components/dashboard/events-tab.tsx"
  )

  assert.match(eventsSource, /new Intl\.DateTimeFormat\("zh-CN"/)
  assert.match(eventsSource, /formatEventDate\(event\.identifiedAt\)/)
  assert.match(eventsSource, /formatEventDate\(selectedEvent\.identifiedAt\)/)
  assert.match(
    eventsSource,
    /formatEventDateTime\(\s*selectedEvent\.sourcePublishedAt\s*\)/
  )
  assert.match(eventsSource, /dateTime=\{selectedEvent\.sourcePublishedAt\}/)
  assert.doesNotMatch(eventsSource, />\s*\{event\.identifiedAt\}\s*<\/time>/)
  assert.doesNotMatch(eventsSource, /\{selectedEvent\.identifiedAt\}\s*·/)
  assert.doesNotMatch(eventsSource, /\$\{selectedEvent\.sourcePublishedAt\}/)
})
