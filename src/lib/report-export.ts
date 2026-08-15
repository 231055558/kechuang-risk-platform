import { calculateResponseRate } from "./risk-metrics.ts"
import { formatEvidenceSupport } from "./source-governance.ts"
import { formatSourceDateTime } from "./date-format.ts"
import type { KcrAssessmentApiResponse } from "../domain/kcr-v1/assessment-api.ts"
import type { KcrActionTask } from "../domain/kcr-v1/model.ts"
import type {
  CompanyDetail,
  EvidenceScoringBinding,
  ManifestRecord,
  RiskAssessment,
  RiskAssessmentDimension,
  RiskEvent,
} from "../types/risk.ts"

function neutralizeCsvFormula(value: string) {
  const firstCharacterCode = value.charCodeAt(0)
  const startsWithControlCharacter =
    firstCharacterCode <= 0x1f || firstCharacterCode === 0x7f
  let formulaPrefixIndex = 0

  while (formulaPrefixIndex < value.length) {
    const characterCode = value.charCodeAt(formulaPrefixIndex)
    if (characterCode > 0x20 && characterCode !== 0x7f) {
      break
    }
    formulaPrefixIndex += 1
  }

  const startsWithFormula = ["=", "+", "-", "@"].includes(
    value[formulaPrefixIndex] ?? ""
  )

  return startsWithControlCharacter || startsWithFormula ? `'${value}` : value
}

function escapeCsv(value: string | number) {
  const text = neutralizeCsvFormula(String(value)).replaceAll('"', '""')
  return `"${text}"`
}

interface ExportSourceReference {
  referenceId: string
  role: string
  evidenceId: string
  sourceName: string
  title: string
  publishedAt: string
  sourceUrl: string
  supportStrength: string
  scoringEligibility: "是" | "否"
  relatedIndicatorIds: string[]
  observationPeriods: string[]
  locators: string[]
  relatedEventIds: string[]
  relatedDimensionLabels: string[]
}

function unique(values: string[]) {
  return [...new Set(values)]
}

function appendRelation(
  relations: Map<string, string[]>,
  key: string,
  value: string
) {
  relations.set(key, unique([...(relations.get(key) ?? []), value]))
}

interface ExportScoringLink {
  indicatorId: string
  period: string
  locator: string
}

function createExportScoringLinks(
  detail: CompanyDetail,
  evidenceId: string,
  evidenceBindings: EvidenceScoringBinding[]
) {
  const runtimeLinks = evidenceBindings
    .filter(
      (binding) =>
        binding.companyId === detail.id &&
        binding.evidenceId === evidenceId &&
        Boolean(binding.indicatorId.trim()) &&
        Boolean(binding.period.trim()) &&
        Boolean(binding.locator.trim())
    )
    .map((binding) => ({
      indicatorId: binding.indicatorId,
      period: binding.period,
      locator: binding.locator,
    }))
  const linksByIdentity = new Map<string, ExportScoringLink>()

  runtimeLinks.forEach((link) => {
    const normalizedLink = {
      indicatorId: link.indicatorId.trim(),
      period: link.period.trim(),
      locator: link.locator.trim(),
    }
    const identity = [
      normalizedLink.indicatorId,
      normalizedLink.period,
      normalizedLink.locator,
    ].join("\u0000")

    linksByIdentity.set(identity, normalizedLink)
  })

  return [...linksByIdentity.values()]
}

function createExportSourceReferences(
  detail: CompanyDetail,
  assessment: RiskAssessment,
  events: RiskEvent[],
  evidenceBindings: EvidenceScoringBinding[] = []
) {
  const evidenceById = new Map(
    detail.evidence.map((evidence) => [evidence.id, evidence])
  )
  const eventIdsByEvidenceId = new Map<string, string[]>()
  const dimensionLabelsByEvidenceId = new Map<string, string[]>()
  const automaticIndicatorIdsByEvidenceId = new Map<string, string[]>()

  events.forEach((event) => {
    unique(event.evidenceIds).forEach((evidenceId) =>
      appendRelation(eventIdsByEvidenceId, evidenceId, event.id)
    )
  })
  assessment.dimensions.forEach((dimension) => {
    unique(dimension.evidenceIds).forEach((evidenceId) => {
      appendRelation(dimensionLabelsByEvidenceId, evidenceId, dimension.label)
      if (
        dimension.score !== null &&
        dimension.scoreBasis === "technology-auto-score"
      ) {
        dimension.indicatorIds.forEach((indicatorId) =>
          appendRelation(
            automaticIndicatorIdsByEvidenceId,
            evidenceId,
            indicatorId
          )
        )
      }
    })
  })

  const referencedEvidenceIds = unique([
    ...assessment.dimensions.flatMap((dimension) => dimension.evidenceIds),
    ...events.flatMap((event) => event.evidenceIds),
    ...evidenceBindings
      .filter((binding) => binding.companyId === detail.id)
      .map((binding) => binding.evidenceId),
  ])
  const references: ExportSourceReference[] = referencedEvidenceIds.map(
    (evidenceId, index) => {
      const evidence = evidenceById.get(evidenceId)
      const relatedEventIds = eventIdsByEvidenceId.get(evidenceId) ?? []
      const relatedDimensionLabels =
        dimensionLabelsByEvidenceId.get(evidenceId) ?? []
      const scoringLinks = createExportScoringLinks(
        detail,
        evidenceId,
        evidenceBindings
      )
      const isEventSource = relatedEventIds.length > 0
      const automaticIndicatorIds =
        automaticIndicatorIdsByEvidenceId.get(evidenceId) ?? []
      const isAutomaticScoringEvidence = automaticIndicatorIds.length > 0
      const isScoringEvidence =
        isAutomaticScoringEvidence ||
        (relatedDimensionLabels.length > 0 && scoringLinks.length > 0)
      const isUnscoredObservationSource =
        scoringLinks.length > 0 && !isScoringEvidence

      return {
        referenceId: `SRC-${String(index + 1).padStart(3, "0")}`,
        role:
          isEventSource && isScoringEvidence
            ? "事件来源 + 评分证据"
            : isEventSource && isUnscoredObservationSource
              ? "事件来源 + 评分观测（未计分）"
              : isScoringEvidence
                ? "评分证据"
                : isUnscoredObservationSource
                  ? "评分观测来源（未计分）"
                  : "事件来源",
        evidenceId,
        sourceName: evidence?.sourceName ?? "来源记录缺失",
        title: evidence?.title ?? "未找到对应证据记录",
        publishedAt: evidence?.publishedAt ?? "",
        sourceUrl: evidence?.sourceUrl ?? "",
        supportStrength: formatEvidenceSupport(evidence?.supportStrength),
        scoringEligibility: isScoringEvidence ? "是" : "否",
        relatedIndicatorIds: unique([
          ...automaticIndicatorIds,
          ...scoringLinks.map((link) => link.indicatorId),
        ]),
        observationPeriods: unique(scoringLinks.map((link) => link.period)),
        locators: unique(scoringLinks.map((link) => link.locator)),
        relatedEventIds,
        relatedDimensionLabels,
      }
    }
  )
  const directReferenceByUrl = new Map<string, ExportSourceReference>()

  events.forEach((event) => {
    if (!event.sourceUrl) {
      return
    }

    const linkedEvidenceUrls = new Set(
      event.evidenceIds
        .map((evidenceId) => evidenceById.get(evidenceId)?.sourceUrl)
        .filter((sourceUrl): sourceUrl is string => Boolean(sourceUrl))
    )
    if (linkedEvidenceUrls.has(event.sourceUrl)) {
      return
    }

    const existingReference = directReferenceByUrl.get(event.sourceUrl)
    if (existingReference) {
      existingReference.relatedEventIds = unique([
        ...existingReference.relatedEventIds,
        event.id,
      ])
      return
    }

    const reference: ExportSourceReference = {
      referenceId: `SRC-${String(references.length + 1).padStart(3, "0")}`,
      role: "事件来源",
      evidenceId: "",
      sourceName: event.sourceName ?? event.sourceType,
      title: `${event.riskType}事件直接来源`,
      publishedAt: event.sourcePublishedAt ?? event.identifiedAt,
      sourceUrl: event.sourceUrl,
      supportStrength: "待治理",
      scoringEligibility: "否",
      relatedIndicatorIds: [],
      observationPeriods: [],
      locators: [],
      relatedEventIds: [event.id],
      relatedDimensionLabels: [],
    }
    references.push(reference)
    directReferenceByUrl.set(event.sourceUrl, reference)
  })

  return references
}

function referenceIdsForEvent(
  references: ExportSourceReference[],
  eventId: string
) {
  return references
    .filter((reference) => reference.relatedEventIds.includes(eventId))
    .map((reference) => reference.referenceId)
}

function referenceIdsForDimension(
  references: ExportSourceReference[],
  dimensionLabel: string
) {
  return references
    .filter((reference) =>
      reference.relatedDimensionLabels.includes(dimensionLabel)
    )
    .map((reference) => reference.referenceId)
}

function formatReferenceIds(referenceIds: string[]) {
  return referenceIds.length > 0 ? referenceIds.join("、") : "未关联可列示来源"
}

function formatDimensionScoreBasis(dimension: RiskAssessmentDimension) {
  if (dimension.score === null) {
    return "待建立评分依据"
  }

  if (dimension.scoreBasis === "technology-auto-score") {
    return "技术自动评分"
  }

  if (dimension.scoreBasis === "indicator-observation") {
    return "人工复核观测"
  }

  return "辅助研判分值"
}

function getAssessmentUseBoundary(assessment: RiskAssessment) {
  const hasTechnologyAutomaticScore = assessment.dimensions.some(
    (dimension) =>
      dimension.score !== null &&
      dimension.scoreBasis === "technology-auto-score"
  )

  if (!hasTechnologyAutomaticScore) {
    return assessment.disclaimer
  }

  return "技术风险自动评分仅使用已注册版本化规则、规定输入与合格证据；人工复核观测须具备单位、期间、复核记录和证据定位。缺失数据不补零，结果不替代人工尽调、监管认定或投资决策。"
}

function getNonInvestmentDisclaimer(
  assessment: RiskAssessment,
  manifest: ManifestRecord
) {
  return manifest.disclaimer?.trim() || getAssessmentUseBoundary(assessment)
}

interface BlobDownloadDependencies {
  createObjectURL: (blob: Blob) => string
  createLink: () => Pick<HTMLAnchorElement, "href" | "download" | "click">
  scheduleCleanup: (cleanup: () => void) => void
  revokeObjectURL: (url: string) => void
}

export function downloadBlob(
  blob: Blob,
  fileName: string,
  dependencies?: BlobDownloadDependencies
) {
  const lifecycle = dependencies ?? {
    createObjectURL: (value: Blob) => URL.createObjectURL(value),
    createLink: () => document.createElement("a"),
    scheduleCleanup: (cleanup: () => void) => {
      window.setTimeout(cleanup, 0)
    },
    revokeObjectURL: (url: string) => URL.revokeObjectURL(url),
  }
  const url = lifecycle.createObjectURL(blob)

  try {
    const link = lifecycle.createLink()
    link.href = url
    link.download = fileName
    link.click()
  } finally {
    lifecycle.scheduleCleanup(() => lifecycle.revokeObjectURL(url))
  }
}

export function createEventsCsvContent(
  detail: CompanyDetail,
  assessment: RiskAssessment,
  events: RiskEvent[],
  manifest: ManifestRecord,
  publicIntelligenceSnapshotAt?: string,
  evidenceBindings: EvidenceScoringBinding[] = []
) {
  const references = createExportSourceReferences(
    detail,
    assessment,
    events,
    evidenceBindings
  )
  const eventHeaders = [
    "事件ID",
    "企业",
    "风险类型",
    "风险等级",
    "处置状态",
    "识别日期",
    "来源类型",
    "事件描述",
    "建议动作",
    "证据引用",
    "事件直接来源",
  ]
  const eventRows =
    events.length > 0
      ? events.map((event) => [
          event.id,
          detail.name,
          event.riskType,
          event.severity,
          event.status,
          event.identifiedAt,
          event.sourceType,
          event.description,
          event.recommendedAction,
          formatReferenceIds(referenceIdsForEvent(references, event.id)),
          event.sourceUrl ?? "",
        ])
      : [
          [
            "当前快照暂无风险事件记录。",
            ...Array.from({ length: eventHeaders.length - 1 }, () => ""),
          ],
        ]
  const dimensionRows = assessment.dimensions.map((dimension) => [
    dimension.label,
    dimension.score ?? "待建立评分观测",
    formatDimensionScoreBasis(dimension),
    dimension.summary,
    formatReferenceIds(referenceIdsForDimension(references, dimension.label)),
  ])
  const sourceRows =
    references.length > 0
      ? references.map((reference) => [
          reference.referenceId,
          reference.role,
          reference.evidenceId,
          reference.supportStrength,
          reference.scoringEligibility,
          reference.relatedIndicatorIds.join("、"),
          reference.observationPeriods.join("、"),
          reference.locators.join("、"),
          reference.sourceName,
          reference.title,
          reference.publishedAt,
          reference.sourceUrl,
          reference.relatedEventIds.join("、"),
          reference.relatedDimensionLabels.join("、"),
        ])
      : [
          [
            "当前导出范围暂无可列示证据来源。",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
          ],
        ]
  const csvRows: Array<Array<string | number>> = [
    ["导出元数据", ""],
    ["字段", "值"],
    ["企业ID", detail.id],
    ["企业名称", detail.name],
    ["数据清单版本", manifest.version || "未提供"],
    ["指标口径版本", manifest.indicatorVersion || assessment.methodVersion],
    ["方法版本", assessment.methodVersion],
    ["研判数据截至", manifest.snapshotAt],
    ["公开情报更新至", publicIntelligenceSnapshotAt ?? "未提供"],
    ["评估复核日期", assessment.reviewedAt || manifest.snapshotAt],
    ["风险辅助研判指数", assessment.scoreLabel],
    ["评分基础", assessment.scoreBasisLabel],
    ["可评估维度", `${assessment.assessableDimensionCount}/6`],
    ["评分证据覆盖率", `${assessment.effectiveEvidenceCoverage}%`],
    ["方法说明", manifest.note || "未提供"],
    ["研判使用边界", getAssessmentUseBoundary(assessment)],
    ["非投资建议声明", getNonInvestmentDisclaimer(assessment, manifest)],
    [],
    ["风险事件"],
    eventHeaders,
    ...eventRows,
    [],
    ["六类风险研判引用"],
    ["维度", "辅助研判分值", "分值来源", "判断摘要", "证据引用"],
    ...dimensionRows,
    [],
    ["证据来源附录"],
    [
      "引用标识",
      "来源角色",
      "证据ID",
      "支持强度",
      "评分资格",
      "关联指标",
      "观测期间",
      "定位信息",
      "来源名称",
      "来源标题",
      "发布日期",
      "来源URL",
      "关联事件ID",
      "关联研判维度",
    ],
    ...sourceRows,
  ]
  const csv = csvRows
    .map((row) => row.map((value) => escapeCsv(value)).join(","))
    .join("\n")

  return `\uFEFF${csv}`
}

export function exportEventsCsv(
  detail: CompanyDetail,
  assessment: RiskAssessment,
  events: RiskEvent[],
  manifest: ManifestRecord,
  publicIntelligenceSnapshotAt?: string,
  evidenceBindings: EvidenceScoringBinding[] = []
) {
  downloadBlob(
    new Blob(
      [
        createEventsCsvContent(
          detail,
          assessment,
          events,
          manifest,
          publicIntelligenceSnapshotAt,
          evidenceBindings
        ),
      ],
      { type: "text/csv;charset=utf-8" }
    ),
    `${detail.id}-risk-events.csv`
  )
}

function escapeHtml(value: string | number) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}

export function createEventProgressMetric(events: RiskEvent[]) {
  return {
    label: "事件处置完成率",
    value: `${calculateResponseRate(events)}%`,
  }
}

export function printFrameAndRemoveAfterPrint(frame: HTMLIFrameElement) {
  const printWindow = frame.contentWindow
  if (!printWindow) {
    frame.remove()
    return
  }

  printWindow.addEventListener("afterprint", () => frame.remove(), {
    once: true,
  })
  printWindow.focus()
  printWindow.print()
}

export function createRiskSummaryPrintHtml(
  detail: CompanyDetail,
  assessment: RiskAssessment,
  events: RiskEvent[],
  manifest: ManifestRecord,
  publicIntelligenceSnapshotAt?: string,
  evidenceBindings: EvidenceScoringBinding[] = []
) {
  const latestEvents = [...events]
    .sort((left, right) => right.identifiedAt.localeCompare(left.identifiedAt))
    .slice(0, 5)
  const references = createExportSourceReferences(
    detail,
    assessment,
    latestEvents,
    evidenceBindings
  )
  const eventProgress = createEventProgressMetric(events)
  const recentEventRows =
    latestEvents.length > 0
      ? latestEvents
          .map(
            (item) =>
              `<tr><td>${escapeHtml(item.identifiedAt)}</td><td>${escapeHtml(item.riskType)}：${escapeHtml(item.description)}</td><td>${escapeHtml(item.status)}</td><td>${escapeHtml(item.recommendedAction)}</td><td class="source-ref">[${escapeHtml(formatReferenceIds(referenceIdsForEvent(references, item.id)))}]</td></tr>`
          )
          .join("")
      : '<tr><td colspan="5">当前快照暂无风险事件记录。</td></tr>'
  const sourceRows =
    references.length > 0
      ? references
          .map(
            (reference) =>
              `<tr><td class="source-ref">[${escapeHtml(reference.referenceId)}]</td><td>${escapeHtml(reference.role)}</td><td>${escapeHtml(reference.supportStrength)}</td><td>${escapeHtml(reference.scoringEligibility)}</td><td><strong>${escapeHtml(reference.sourceName)}</strong><br />${escapeHtml(reference.title)}<br />${escapeHtml(reference.publishedAt || "未提供")}<br /><span class="source-url">${escapeHtml(reference.sourceUrl || "来源记录缺失")}</span></td><td>${escapeHtml(reference.relatedIndicatorIds.join("、") || "无")}<br />${escapeHtml(reference.observationPeriods.join("、") || "无")}</td><td>${escapeHtml(reference.locators.join("、") || "无")}</td></tr>`
          )
          .join("")
      : '<tr><td colspan="7">当前导出范围暂无可列示证据来源。</td></tr>'

  return `<!doctype html>
    <html lang="zh-CN">
      <head>
        <meta charset="utf-8" />
        <title>${escapeHtml(detail.name)}风险摘要</title>
        <style>
          @page { size: A4; margin: 16mm; }
          * { box-sizing: border-box; }
          body { color: #172033; font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif; line-height: 1.6; }
          h1 { margin: 0; font-size: 28px; letter-spacing: 0; }
          h2 { margin: 24px 0 10px; font-size: 17px; letter-spacing: 0; }
          .meta { margin-top: 6px; color: #64748b; font-size: 12px; }
          .metrics { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-top: 20px; }
          .metric { border: 1px solid #dbe3ee; border-radius: 6px; padding: 10px; }
          .metric span { display: block; color: #64748b; font-size: 10px; }
          .metric strong { display: block; margin-top: 4px; font-size: 18px; }
          table { width: 100%; border-collapse: collapse; font-size: 11px; }
          tr { break-inside: avoid; }
          th, td { border-bottom: 1px solid #dbe3ee; padding: 8px 6px; text-align: left; vertical-align: top; }
          th { color: #475569; }
          .source-ref { white-space: nowrap; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
          .source-url { overflow-wrap: anywhere; font-size: 9px; }
          .boundary { margin-top: 22px; border: 1px solid #dbe3ee; border-radius: 6px; padding: 10px; color: #475569; font-size: 10px; }
          .boundary div + div { margin-top: 4px; }
        </style>
      </head>
      <body>
        <h1>${escapeHtml(detail.name)} 科创企业风险摘要</h1>
        <div class="meta">${escapeHtml(detail.sector)} · ${escapeHtml(detail.stage)} · 研判数据截至 ${escapeHtml(manifest.snapshotAt)} · 公开情报更新至 ${escapeHtml(publicIntelligenceSnapshotAt ? formatSourceDateTime(publicIntelligenceSnapshotAt) : "未提供")} · 方法版本 ${escapeHtml(assessment.methodVersion)} · 评分基础 ${escapeHtml(assessment.scoreBasisLabel)} · 数据清单版本 ${escapeHtml(manifest.version || "未提供")}</div>
        <div class="metrics">
          <div class="metric"><span>${escapeHtml(assessment.label)}</span><strong>${escapeHtml(assessment.scoreLabel)}</strong></div>
          <div class="metric"><span>可评估维度</span><strong>${assessment.assessableDimensionCount}/6</strong></div>
          <div class="metric"><span>评分证据覆盖率</span><strong>${assessment.effectiveEvidenceCoverage}%</strong></div>
          <div class="metric"><span>${escapeHtml(eventProgress.label)}</span><strong>${escapeHtml(eventProgress.value)}</strong></div>
        </div>
        <h2>六类风险研判</h2>
        <table><thead><tr><th>维度</th><th>辅助研判分值</th><th>分值来源</th><th>评分证据</th><th>判断摘要</th><th>证据引用</th></tr></thead><tbody>
          ${assessment.dimensions.map((item) => `<tr><td>${escapeHtml(item.label)}</td><td>${item.score ?? "待建立评分观测"}</td><td>${escapeHtml(formatDimensionScoreBasis(item))}</td><td>${item.evidenceIds.length} 条</td><td>${escapeHtml(item.summary)}</td><td class="source-ref">[${escapeHtml(formatReferenceIds(referenceIdsForDimension(references, item.label)))}]</td></tr>`).join("")}
        </tbody></table>
        <h2>近期风险事件</h2>
        <table><thead><tr><th>日期</th><th>事件</th><th>状态</th><th>建议动作</th><th>证据引用</th></tr></thead><tbody>
          ${recentEventRows}
        </tbody></table>
        <h2>证据来源附录</h2>
        <table><thead><tr><th>引用</th><th>来源角色</th><th>支持强度</th><th>评分资格</th><th>来源记录</th><th>指标 / 期间</th><th>定位</th></tr></thead><tbody>
          ${sourceRows}
        </tbody></table>
        <div class="boundary">
          <div><strong>方法说明：</strong>${escapeHtml(manifest.note || "未提供")}</div>
          <div><strong>评分基础：</strong>${escapeHtml(assessment.scoreBasisLabel)}</div>
          <div><strong>研判使用边界：</strong>${escapeHtml(getAssessmentUseBoundary(assessment))}</div>
          <div><strong>非投资建议声明：</strong>${escapeHtml(getNonInvestmentDisclaimer(assessment, manifest))}</div>
        </div>
      </body>
    </html>`
}

export function printRiskSummary(
  detail: CompanyDetail,
  assessment: RiskAssessment,
  events: RiskEvent[],
  manifest: ManifestRecord,
  publicIntelligenceSnapshotAt?: string,
  evidenceBindings: EvidenceScoringBinding[] = []
) {
  const frame = document.createElement("iframe")
  frame.setAttribute("title", `${detail.name} 风险摘要打印`)
  frame.style.position = "fixed"
  frame.style.width = "1px"
  frame.style.height = "1px"
  frame.style.opacity = "0"
  frame.style.pointerEvents = "none"
  document.body.appendChild(frame)

  const printDocument = frame.contentDocument
  if (!printDocument) {
    frame.remove()
    return
  }

  printDocument.open()
  printDocument.write(
    createRiskSummaryPrintHtml(
      detail,
      assessment,
      events,
      manifest,
      publicIntelligenceSnapshotAt,
      evidenceBindings
    )
  )
  printDocument.close()

  frame.addEventListener("load", () => printFrameAndRemoveAfterPrint(frame), {
    once: true,
  })
}

export function createKcrAssessmentPrintHtml(
  response: KcrAssessmentApiResponse,
  actionTasks: readonly KcrActionTask[] = [],
  companyLabel = "寒武纪"
) {
  const { assessment, evidenceCatalog, provenance } = response
  const companyTasks = actionTasks.filter(
    (task) =>
      task.companyId === assessment.companyId &&
      task.snapshotId === assessment.runId
  )
  const evidenceById = new Map(
    evidenceCatalog.map((evidence) => [evidence.id, evidence])
  )
  const dimensionRows = assessment.dimensions
    .map(
      (dimension) =>
        `<tr><td>${escapeHtml(dimension.label)}</td><td>${escapeHtml(dimension.score ?? "缺失")}</td><td>${escapeHtml(dimension.riskLevelLabel)}</td><td>${escapeHtml(`${Math.round(dimension.evidenceCoverage * 10000) / 100}%`)}</td><td>${escapeHtml(`${Math.round(dimension.confidence * 10000) / 100}%`)}</td><td>${escapeHtml(dimension.formulaTrace)}</td></tr>`
    )
    .join("")
  const redFlagRows =
    assessment.redFlags.length > 0
      ? assessment.redFlags
          .map(
            (redFlag) =>
              `<tr><td>${escapeHtml(redFlag.priority)}</td><td>${escapeHtml(redFlag.eventId)}</td><td>${escapeHtml(redFlag.title)}</td><td>${escapeHtml(redFlag.summary)}</td><td>${escapeHtml(redFlag.evidenceIds.join("、"))}</td><td>否</td></tr>`
          )
          .join("")
      : '<tr><td colspan="6">当前快照没有红旗事件。</td></tr>'
  const indicatorRows = assessment.indicatorResults
    .map(
      (indicator) =>
        `<tr><td>${escapeHtml(indicator.id)}</td><td>${escapeHtml(indicator.label)}</td><td>${escapeHtml(indicator.riskScore ?? "缺失")}</td><td>${escapeHtml(indicator.weight)}</td><td>${escapeHtml(indicator.dataStatus)}</td><td>${escapeHtml(indicator.evidence.map((item) => `${item.evidenceId}（${item.locator}）`).join("；") || "无")}</td><td>${escapeHtml(indicator.rationale)}</td></tr>`
    )
    .join("")
  const evidenceRows = evidenceCatalog
    .map(
      (evidence) =>
        `<tr><td class="mono">${escapeHtml(evidence.id)}</td><td>${escapeHtml(evidence.sourceTier)}</td><td><strong>${escapeHtml(evidence.sourceName)}</strong><br />${escapeHtml(evidence.title)}</td><td>${escapeHtml(evidence.publishedAt ?? "未提供")}</td><td>${escapeHtml(evidence.locator)}</td><td class="source-url">${evidence.sourceUrl ? `<a href="${escapeHtml(evidence.sourceUrl)}">${escapeHtml(evidence.sourceUrl)}</a>` : "未提供公开链接"}</td></tr>`
    )
    .join("")
  const taskRows =
    companyTasks.length > 0
      ? companyTasks
          .map((task) => {
            const evidenceIds =
              assessment.redFlags.find(
                (redFlag) => redFlag.eventId === task.sourceId
              )?.evidenceIds ?? []
            return `<tr><td>${escapeHtml(task.priority)}</td><td>${escapeHtml(task.title)}</td><td>${escapeHtml(task.owner ?? "待分配")}</td><td>${escapeHtml(task.dueDate)}</td><td>${escapeHtml(task.status)}</td><td>${escapeHtml(`${task.sourceType}:${task.sourceId}`)}</td><td>${escapeHtml(evidenceIds.join("、") || "无")}</td></tr>`
          })
          .join("")
      : '<tr><td colspan="7">当前浏览器尚未从红旗生成处置任务。</td></tr>'
  const defaultRows = provenance.engineeringDefaults
    .map(
      (item) =>
        `<li><strong>${escapeHtml(item.label)}：</strong>${escapeHtml(item.value)}（待团队确认）</li>`
    )
    .join("")

  const citedEvidenceCount = new Set(
    assessment.indicatorResults.flatMap((indicator) => indicator.evidenceIds)
  ).size
  const unresolvedEvidenceIds = assessment.indicatorResults
    .flatMap((indicator) => indicator.evidenceIds)
    .filter((evidenceId) => !evidenceById.has(evidenceId))

  return `<!doctype html>
    <html lang="zh-CN">
      <head>
        <meta charset="utf-8" />
        <title>${escapeHtml(companyLabel)} KCR V3 风险评估报告</title>
        <style>
          @page { size: A4; margin: 14mm; }
          * { box-sizing: border-box; }
          body { color: #172033; font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif; line-height: 1.55; }
          h1 { margin: 0; font-size: 26px; }
          h2 { margin: 24px 0 9px; font-size: 16px; break-after: avoid; }
          .meta { margin-top: 7px; color: #64748b; font-size: 10px; }
          .metrics { display: grid; grid-template-columns: repeat(4, 1fr); gap: 7px; margin: 18px 0; }
          .metric { border: 1px solid #dbe3ee; border-radius: 7px; padding: 9px; }
          .metric span { display: block; color: #64748b; font-size: 9px; }
          .metric strong { display: block; margin-top: 3px; font-size: 17px; }
          table { width: 100%; border-collapse: collapse; font-size: 9px; }
          tr { break-inside: avoid; }
          th, td { border-bottom: 1px solid #dbe3ee; padding: 6px 5px; text-align: left; vertical-align: top; }
          th { color: #475569; background: #f7f9fc; }
          .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; white-space: nowrap; }
          .source-url { overflow-wrap: anywhere; font-size: 8px; }
          .boundary { margin-top: 20px; border: 1px solid #dbe3ee; border-radius: 7px; padding: 10px; color: #475569; font-size: 9px; }
          .boundary p { margin: 4px 0; }
          .boundary ul { margin: 6px 0 0; padding-left: 18px; }
        </style>
      </head>
      <body>
        <h1>${escapeHtml(companyLabel)} KCR V3 风险评估报告</h1>
        <div class="meta">企业 ${escapeHtml(assessment.companyId)} · 方法 ${escapeHtml(assessment.methodVersion)} · 模型 ${escapeHtml(assessment.modelVersion)} · 评估日期 ${escapeHtml(assessment.assessmentAt)} · 数据截至 ${escapeHtml(assessment.dataCutoff)} · 运行标识 ${escapeHtml(assessment.runId)}</div>
        <div class="metrics">
          <div class="metric"><span>客观风险基线</span><strong>${escapeHtml(assessment.baselineScore ?? "数据不足")}</strong></div>
          <div class="metric"><span>风险等级</span><strong>${escapeHtml(assessment.riskLevelLabel)}风险</strong></div>
          <div class="metric"><span>证据覆盖率</span><strong>${escapeHtml(`${Math.round(assessment.evidenceCoverage * 10000) / 100}%`)}</strong></div>
          <div class="metric"><span>证据置信度</span><strong>${escapeHtml(`${Math.round(assessment.confidence * 10000) / 100}%`)}</strong></div>
        </div>
        <h2>五维客观风险</h2>
        <table><thead><tr><th>维度</th><th>分数</th><th>等级</th><th>证据覆盖</th><th>置信度</th><th>公式轨迹</th></tr></thead><tbody>${dimensionRows}</tbody></table>
        <h2>独立红旗事件</h2>
        <table><thead><tr><th>优先级</th><th>事件 ID</th><th>标题</th><th>摘要</th><th>证据引用</th><th>改写基线</th></tr></thead><tbody>${redFlagRows}</tbody></table>
        <h2>18 项评分指标与证据链</h2>
        <table><thead><tr><th>ID</th><th>指标</th><th>风险分</th><th>权重</th><th>数据状态</th><th>证据与位置</th><th>评分依据</th></tr></thead><tbody>${indicatorRows}</tbody></table>
        <h2>处置任务</h2>
        <table><thead><tr><th>优先级</th><th>任务</th><th>责任角色</th><th>截止日期</th><th>状态</th><th>来源</th><th>证据</th></tr></thead><tbody>${taskRows}</tbody></table>
        <h2>证据来源附录（${evidenceCatalog.length} 条目录 / ${citedEvidenceCount} 条评分引用）</h2>
        <table><thead><tr><th>ID</th><th>来源级别</th><th>来源</th><th>发布日期</th><th>位置</th><th>公开链接</th></tr></thead><tbody>${evidenceRows}</tbody></table>
        <div class="boundary">
          <p><strong>方法来源：</strong>${escapeHtml(provenance.methodSourceLabel)}；当前状态为候选方法。</p>
          <p><strong>数据来源：</strong>${escapeHtml(provenance.assessmentInputSourceLabel)}。</p>
          <p><strong>引用完整性：</strong>${unresolvedEvidenceIds.length === 0 ? "评分引用均能在证据目录中解析。" : `有 ${unresolvedEvidenceIds.length} 条引用未解析。`}</p>
          <p><strong>工程默认：</strong></p><ul>${defaultRows}</ul>
          <p><strong>使用边界：</strong>${escapeHtml(assessment.disclaimer)}</p>
        </div>
      </body>
    </html>`
}

export function printKcrAssessmentReport(
  response: KcrAssessmentApiResponse,
  actionTasks: readonly KcrActionTask[] = [],
  companyLabel = "寒武纪"
) {
  const frame = document.createElement("iframe")
  frame.setAttribute("title", `${companyLabel} KCR V3 风险评估报告打印`)
  frame.style.position = "fixed"
  frame.style.width = "1px"
  frame.style.height = "1px"
  frame.style.opacity = "0"
  frame.style.pointerEvents = "none"
  document.body.appendChild(frame)

  const printDocument = frame.contentDocument
  if (!printDocument) {
    frame.remove()
    return
  }

  printDocument.open()
  printDocument.write(
    createKcrAssessmentPrintHtml(response, actionTasks, companyLabel)
  )
  printDocument.close()
  frame.addEventListener("load", () => printFrameAndRemoveAfterPrint(frame), {
    once: true,
  })
}

function wrapCanvasText(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
) {
  const lines: string[] = []
  let line = ""

  for (const character of text) {
    const nextLine = `${line}${character}`
    if (context.measureText(nextLine).width > maxWidth && line) {
      lines.push(line)
      line = character
    } else {
      line = nextLine
    }
  }

  if (line) {
    lines.push(line)
  }

  return lines
}

export function createPngSourceReferenceText(
  detail: CompanyDetail,
  assessment: RiskAssessment,
  events: RiskEvent[],
  evidenceBindings: EvidenceScoringBinding[] = []
) {
  const referenceIds = createExportSourceReferences(
    detail,
    assessment,
    events,
    evidenceBindings
  ).map((reference) => reference.referenceId)

  if (referenceIds.length === 0) {
    return "来源引用：当前导出范围暂无可列示证据来源"
  }

  const visibleReferenceIds = referenceIds.slice(0, 8)
  const remainingLabel =
    referenceIds.length > visibleReferenceIds.length
      ? ` 等 ${referenceIds.length} 条`
      : ""

  return `来源引用：${visibleReferenceIds.join("、")}${remainingLabel}（详见同快照 CSV / 打印版证据来源附录）`
}

export function createPngAssessmentMethodText(assessment: RiskAssessment) {
  return `方法版本 ${assessment.methodVersion} · 评分基础 ${assessment.scoreBasisLabel}`
}

function createPngDimensionScoreText(dimension: RiskAssessmentDimension) {
  if (dimension.score === null) {
    return "待建立评分依据"
  }

  return `${dimension.score} · ${
    dimension.scoreBasis === "technology-auto-score"
      ? "技术自动"
      : dimension.scoreBasis === "indicator-observation"
        ? "人工复核"
        : "辅助研判"
  }`
}

export function exportRiskSummaryPng(
  detail: CompanyDetail,
  assessment: RiskAssessment,
  events: RiskEvent[],
  manifest: ManifestRecord,
  publicIntelligenceSnapshotAt?: string,
  evidenceBindings: EvidenceScoringBinding[] = []
) {
  const canvas = document.createElement("canvas")
  canvas.width = 1600
  canvas.height = 900
  const context = canvas.getContext("2d")
  if (!context) {
    return
  }

  context.fillStyle = "#f7f9fc"
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.fillStyle = "#2457d6"
  context.fillRect(0, 0, 14, canvas.height)
  context.fillStyle = "#172033"
  context.font =
    '700 54px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif'
  context.fillText(detail.name, 78, 96)
  context.fillStyle = "#64748b"
  context.font =
    '25px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif'
  context.fillText(
    `${detail.sector} · ${detail.stage} · 研判截至 ${manifest.snapshotAt} · 情报更新至 ${publicIntelligenceSnapshotAt ? formatSourceDateTime(publicIntelligenceSnapshotAt) : "未提供"}`,
    78,
    142
  )
  context.font =
    '20px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif'
  context.fillText(createPngAssessmentMethodText(assessment), 78, 178)

  const eventProgress = createEventProgressMetric(events)
  const metrics = [
    [assessment.label, assessment.scoreLabel],
    ["可评估维度", `${assessment.assessableDimensionCount}/6`],
    ["评分证据覆盖率", `${assessment.effectiveEvidenceCoverage}%`],
    [eventProgress.label, eventProgress.value],
  ]
  metrics.forEach(([label, value], index) => {
    const x = 78 + index * 300
    context.fillStyle = "#ffffff"
    context.strokeStyle = "#dbe3ee"
    context.lineWidth = 2
    context.beginPath()
    context.roundRect(x, 210, 276, 124, 10)
    context.fill()
    context.stroke()
    context.fillStyle = "#64748b"
    context.font =
      '18px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif'
    context.fillText(label, x + 20, 246)
    context.fillStyle = "#172033"
    context.font =
      '700 38px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif'
    context.fillText(value, x + 20, 303)
  })

  context.fillStyle = "#172033"
  context.font =
    '700 28px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif'
  context.fillText("六类风险研判", 78, 400)

  assessment.dimensions.forEach((dimension, index) => {
    const y = 456 + index * 58
    context.fillStyle = "#334155"
    context.font =
      '600 20px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif'
    context.fillText(dimension.label, 78, y)
    context.fillStyle = "#e5eaf2"
    context.fillRect(270, y - 20, 610, 20)
    if (dimension.score === null) {
      context.fillStyle = "#64748b"
      context.font =
        '18px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif'
      context.fillText(createPngDimensionScoreText(dimension), 900, y)
    } else {
      context.fillStyle =
        dimension.score >= 75
          ? "#c9343d"
          : dimension.score >= 60
            ? "#d67a16"
            : "#2457d6"
      context.fillRect(270, y - 20, 6.1 * dimension.score, 20)
      context.fillStyle = "#172033"
      context.fillText(createPngDimensionScoreText(dimension), 900, y)
    }
  })

  const latestEvent = [...events].sort((left, right) =>
    right.identifiedAt.localeCompare(left.identifiedAt)
  )[0]
  const visibleEvents = latestEvent ? [latestEvent] : []
  context.fillStyle = "#172033"
  context.font =
    '700 28px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif'
  context.fillText("近期事件", 1040, 400)
  context.fillStyle = "#475569"
  context.font =
    '21px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif'
  const conclusion = latestEvent
    ? `${latestEvent.identifiedAt} · ${latestEvent.riskType}：${latestEvent.description}`
    : "当前快照暂无风险事件记录。"
  wrapCanvasText(context, conclusion, 470)
    .slice(0, 8)
    .forEach((line, index) => context.fillText(line, 1040, 452 + index * 34))

  context.fillStyle = "#475569"
  context.font =
    '15px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif'
  wrapCanvasText(
    context,
    createPngSourceReferenceText(
      detail,
      assessment,
      visibleEvents,
      evidenceBindings
    ),
    1420
  )
    .slice(0, 2)
    .forEach((line, index) => context.fillText(line, 78, 804 + index * 20))

  context.fillStyle = "#64748b"
  context.font =
    '15px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif'
  wrapCanvasText(
    context,
    getNonInvestmentDisclaimer(assessment, manifest),
    1420
  )
    .slice(0, 2)
    .forEach((line, index) => context.fillText(line, 78, 852 + index * 20))

  canvas.toBlob((blob) => {
    if (blob) {
      downloadBlob(blob, `${detail.id}-risk-summary.png`)
    }
  }, "image/png")
}
