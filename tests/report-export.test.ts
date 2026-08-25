import assert from "node:assert/strict"
import test from "node:test"

import {
  createEventProgressMetric,
  createEventsCsvContent,
  createPngAssessmentMethodText,
  createPngSourceReferenceText,
  createRiskSummaryPrintHtml,
  downloadBlob,
  printFrameAndRemoveAfterPrint,
} from "../src/lib/report-export.ts"
import type {
  CompanyDetail,
  EvidenceScoringBinding,
  ManifestRecord,
  RiskAssessment,
  RiskEvent,
} from "../src/types/risk.ts"

function createCompanyDetail(
  overrides: Partial<CompanyDetail> = {}
): CompanyDetail {
  return {
    id: "test-company",
    name: "测试企业",
    sector: "测试行业",
    description: "用于报告导出测试的最小企业记录。",
    headquarters: "杭州",
    stage: "测试阶段",
    riskIndex: 0,
    benchmarkCompanyId: "benchmark-company",
    snapshotAt: "2026-07-17",
    metrics: {
      highRiskEvents: 0,
      mediumRiskEvents: 0,
      responseRate: 0,
      evidenceCoverage: 0,
      monitoredSources: 0,
      currentHighRiskType: "待复核",
    },
    dimensions: [],
    lifecycle: [],
    trend: [],
    aiCoverage: {
      ingestedSourceTypes: [],
      extractedSignals: [],
    },
    comparisonNote: "测试对比说明。",
    evidence: [],
    events: [],
    transmissionGraph: {
      keyInsight: "测试传导说明。",
      nodes: [],
      edges: [],
    },
    governance: [],
    ...overrides,
  }
}

function createRiskAssessment(
  overrides: Partial<RiskAssessment> = {}
): RiskAssessment {
  return {
    methodVersion: "test-method-v1",
    label: "风险辅助研判指数",
    score: null,
    scoreLabel: "部分指标待补充",
    dimensions: [],
    assessableDimensionCount: 0,
    effectiveEvidenceCoverage: 0,
    indicatorAvailability: 0,
    reviewStatus: "insufficient-evidence",
    scoreBasisLabel: "R05–R22 客观指标自动计算",
    reviewedAt: "2026-07-17",
    disclaimer: "不构成证券投资建议。",
    ...overrides,
  }
}

function createManifestRecord(
  overrides: Partial<ManifestRecord> = {}
): ManifestRecord {
  return {
    snapshotAt: "2026-07-17",
    version: "manifest-v1",
    coverage: [],
    totalEvidence: 0,
    totalEvents: 0,
    sourceStats: [],
    note: "公开信息快照。",
    ...overrides,
  }
}

const detail = createCompanyDetail({
  id: "formula-test",
  name: '=HYPERLINK("https://example.com")',
})

const assessment = createRiskAssessment({
  scoreLabel: "+SUM(1,1)",
  assessableDimensionCount: 4,
  effectiveEvidenceCoverage: 75,
  methodVersion: " \t=METHOD()",
  disclaimer: "\n-2+3",
})

const manifest = createManifestRecord({
  indicatorVersion: "indicator-v1",
  disclaimer: "不构成证券投资建议。",
})

function event(overrides: Partial<RiskEvent>): RiskEvent {
  return {
    id: "event-1",
    companyId: detail.id,
    riskType: "@RISK",
    severity: "high",
    status: "in-progress",
    sourceType: "\r+SOURCE",
    stage: "测试",
    description: "-10+20",
    evidenceIds: [],
    aiSummary: "",
    recommendedAction: "\t=ACTION()",
    identifiedAt: "2026-07-17",
    ...overrides,
  }
}

test("CSV content neutralizes spreadsheet formulas and control-whitespace bypasses", () => {
  const csv = createEventsCsvContent(
    detail,
    assessment,
    [
      event({
        description: 'safe "quoted" text',
      }),
      event({
        id: "event-2",
        description: "-10+20",
        sourceType: "\tplain-control-prefix",
      }),
    ],
    manifest
  )

  assert.ok(csv.startsWith("\uFEFF"))
  assert.match(csv, /"'=HYPERLINK\(""https:\/\/example\.com""\)"/)
  assert.match(csv, /"'\+SUM\(1,1\)"/)
  assert.match(csv, /"'@RISK"/)
  assert.ok(csv.includes(`"'\r+SOURCE"`))
  assert.ok(csv.includes(`"'\tplain-control-prefix"`))
  assert.ok(csv.includes(`"'\t=ACTION()"`))
  assert.ok(csv.includes(`"' \t=METHOD()"`))
  assert.ok(csv.includes(`"'\n-2+3"`))
  assert.match(csv, /"safe ""quoted"" text"/)
  assert.match(csv, /"'-10\+20"/)
})

test("downloadBlob revokes its object URL only when scheduled cleanup runs", () => {
  const actions: string[] = []
  let cleanup: (() => void) | undefined
  const link = {
    href: "",
    download: "",
    click() {
      actions.push("click")
    },
  }

  downloadBlob(new Blob(["report"]), "report.csv", {
    createObjectURL() {
      actions.push("create")
      return "blob:report"
    },
    createLink() {
      return link
    },
    scheduleCleanup(callback) {
      actions.push("schedule")
      cleanup = callback
    },
    revokeObjectURL(url) {
      assert.equal(url, "blob:report")
      actions.push("revoke")
    },
  })

  assert.equal(link.href, "blob:report")
  assert.equal(link.download, "report.csv")
  assert.deepEqual(actions, ["create", "click", "schedule"])

  assert.ok(cleanup)
  cleanup()
  assert.deepEqual(actions, ["create", "click", "schedule", "revoke"])
})

test("print frame is removed by afterprint instead of a fixed timeout", () => {
  const actions: string[] = []
  let afterPrint: (() => void) | undefined
  const frame = {
    contentWindow: {
      addEventListener(
        type: string,
        listener: () => void,
        options: AddEventListenerOptions
      ) {
        assert.equal(type, "afterprint")
        assert.deepEqual(options, { once: true })
        actions.push("listen")
        afterPrint = listener
      },
      focus() {
        actions.push("focus")
      },
      print() {
        actions.push("print")
      },
    },
    remove() {
      actions.push("remove")
    },
  } as unknown as HTMLIFrameElement

  printFrameAndRemoveAfterPrint(frame)

  assert.deepEqual(actions, ["listen", "focus", "print"])
  assert.ok(afterPrint)
  afterPrint()
  assert.deepEqual(actions, ["listen", "focus", "print", "remove"])
})

test("print frame without a content window is removed immediately", () => {
  let removed = false
  const frame = {
    contentWindow: null,
    remove() {
      removed = true
    },
  } as unknown as HTMLIFrameElement

  printFrameAndRemoveAfterPrint(frame)

  assert.equal(removed, true)
})

test("event completion metric uses done events over total events", () => {
  assert.deepEqual(
    createEventProgressMetric([
      event({ status: "pending" }),
      event({ status: "in-progress" }),
      event({ status: "in-progress" }),
      event({ status: "done" }),
    ]),
    {
      label: "事件处置完成率",
      value: "25%",
    }
  )
})

const traceDetail = createCompanyDetail({
  id: "trace-test",
  name: "可信科技",
  sector: "人工智能",
  stage: "商业化扩张阶段",
  evidence: [
    {
      id: "evidence-1",
      type: "季度报告",
      title: "2026 年第一季度报告",
      sourceName: "交易所",
      sourceUrl: "https://example.com/report.pdf",
      publishedAt: "2026-04-30",
      summary: "经营与研发披露。",
      relatedRiskDimension: ["技术与算法"],
      relatedStage: ["商业化扩张阶段"],
      confidence: 0.96,
      indicatorIds: ["indicator-1"],
      supportStrength: "direct",
      scoringLinks: [
        {
          indicatorId: "indicator-1",
          period: "2026-Q1",
          unit: "万元",
          locator: "第 18 页，研发费用表",
        },
      ],
    },
  ],
})

const traceAssessment = createRiskAssessment({
  score: 72,
  scoreLabel: "72",
  assessableDimensionCount: 4,
  effectiveEvidenceCoverage: 75,
  indicatorAvailability: 50,
  methodVersion: "KCR-2026.07-v2",
  reviewStatus: "reviewed",
  reviewedAt: "2026-07-14",
  disclaimer:
    "辅助研判不替代人工尽调、监管认定或投资决策，不构成证券投资建议。",
  dimensions: [
    {
      id: "technology",
      label: "技术风险",
      score: 72,
      level: "attention",
      assessable: true,
      scoreBasis: "indicator-observation",
      summary: "已完成观测与证据配对。",
      evidenceIds: ["evidence-1"],
      indicatorIds: ["indicator-1"],
      evidenceIndicatorPairCount: 1,
    },
  ],
})

const traceManifest = createManifestRecord({
  snapshotAt: "2026-07-14",
  version: "2026.07-governed-assessment-v5",
  indicatorVersion: "KCR-2026.07-v2 / 风险指标更新版1.xlsx",
  note: "公开信息快照，不做浏览器实时抓源。",
  disclaimer:
    "本平台输出用于企业风险研究与辅助研判，不构成监管认定、证券投资建议、收益承诺或对人工尽调的替代。",
})

function createEvidenceBinding(
  overrides: Partial<EvidenceScoringBinding> = {}
): EvidenceScoringBinding {
  return {
    id: "binding-1",
    observationId: "observation-1",
    companyId: traceDetail.id,
    indicatorId: "indicator-runtime",
    evidenceId: "evidence-1",
    period: "2026-Q2",
    unit: "%",
    locator: "第 22 页，研发投入占比表",
    createdAt: "2026-07-18T08:00:00.000Z",
    updatedAt: "2026-07-18T08:00:00.000Z",
    ...overrides,
  }
}

test("zero-event CSV keeps independent metadata, method, snapshot, and disclaimer", () => {
  const csv = createEventsCsvContent(
    traceDetail,
    traceAssessment,
    [],
    traceManifest
  )

  assert.match(csv, /"导出元数据"/)
  assert.match(csv, /"数据更新至","2026-07-14"/)
  assert.match(csv, /"方法版本","KCR-2026\.07-v2"/)
  assert.match(csv, /"研判数据截至","2026-07-14"/)
  assert.doesNotMatch(csv, /数据清单版本|2026\.07-governed-assessment-v5/)
  assert.match(csv, /"非投资建议声明","本平台输出用于企业风险研究与辅助研判/)
  assert.match(csv, /"当前快照暂无风险事件记录。"/)
  assert.match(csv, /"证据来源附录"/)
  assert.ok(csv.indexOf('"导出元数据"') < csv.indexOf('"风险事件"'))
})

test("customer exports expose the snapshot date without the internal manifest version", () => {
  const csv = createEventsCsvContent(
    traceDetail,
    traceAssessment,
    [],
    traceManifest
  )
  const html = createRiskSummaryPrintHtml(
    traceDetail,
    traceAssessment,
    [],
    traceManifest
  )

  assert.match(csv, /"数据更新至","2026-07-14"/)
  assert.doesNotMatch(csv, /数据清单版本|2026\.07-governed-assessment-v5/)
  assert.match(html, /研判数据截至 2026-07-14/)
  assert.doesNotMatch(html, /数据清单版本|2026\.07-governed-assessment-v5/)
})

test("missing dimension scores use the same explicit observation label as the UI", () => {
  const csv = createEventsCsvContent(
    traceDetail,
    createRiskAssessment({
      dimensions: [
        {
          id: "technology",
          label: "技术风险",
          score: null,
          level: null,
          assessable: false,
          scoreBasis: null,
          summary: "尚未形成正式评分观测。",
          evidenceIds: [],
          indicatorIds: [],
          evidenceIndicatorPairCount: 0,
        },
      ],
    }),
    [],
    traceManifest
  )

  assert.match(csv, /"技术风险","数据待补充"/)
})

test("automatic technology scoring is identified across CSV, print, and PNG exports", () => {
  const automaticAssessment = createRiskAssessment({
    score: 68,
    scoreLabel: "68",
    assessableDimensionCount: 1,
    scoreBasisLabel: "技术自动评分与指标计算",
    disclaimer: "系统按有效指标和来源数据自动计算风险结果。",
    dimensions: [
      {
        id: "technology",
        label: "技术风险",
        score: 68,
        level: "attention",
        assessable: true,
        scoreBasis: "technology-auto-score",
        summary: "技术风险已完成自动评分。",
        evidenceIds: ["evidence-1"],
        indicatorIds: ["kci-006"],
        evidenceIndicatorPairCount: 1,
      },
    ],
  })
  const csv = createEventsCsvContent(
    traceDetail,
    automaticAssessment,
    [],
    traceManifest
  )
  const html = createRiskSummaryPrintHtml(
    traceDetail,
    automaticAssessment,
    [],
    traceManifest
  )

  assert.match(csv, /"评分基础","技术自动评分与指标计算"/)
  assert.match(csv, /"维度","辅助研判分值","分值来源","判断摘要","证据引用"/)
  assert.match(csv, /"技术风险","68","技术自动评分"/)
  assert.match(
    csv,
    /"SRC-001","评分证据","evidence-1","直接披露","是","kci-006"/
  )
  assert.doesNotMatch(csv, /人工复核辅助分值/)
  assert.doesNotMatch(csv, /不声称分值由模型自动生成/)

  assert.match(html, /评分基础：<\/strong>技术自动评分与指标计算/)
  assert.match(html, /<th>辅助研判分值<\/th><th>分值来源<\/th>/)
  assert.match(html, /技术风险[\s\S]*技术自动评分/)
  assert.doesNotMatch(html, /人工复核辅助分值/)
  assert.doesNotMatch(html, /不声称分值由模型自动生成/)

  assert.equal(
    createPngAssessmentMethodText(automaticAssessment),
    "方法版本 test-method-v1 · 评分基础 技术自动评分与指标计算"
  )
})

test("CSV and print summary provide traceable source references", () => {
  const traceEvent = event({
    id: "trace-event",
    companyId: traceDetail.id,
    riskType: "技术风险",
    evidenceIds: ["evidence-1"],
  })
  const traceBindings = [
    createEvidenceBinding({
      indicatorId: "indicator-1",
      period: "2026-Q1",
      unit: "万元",
      locator: "第 18 页，研发费用表",
    }),
  ]
  const csv = createEventsCsvContent(
    traceDetail,
    traceAssessment,
    [traceEvent],
    traceManifest,
    undefined,
    traceBindings
  )
  const html = createRiskSummaryPrintHtml(
    traceDetail,
    traceAssessment,
    [traceEvent],
    traceManifest,
    undefined,
    traceBindings
  )

  const traceEventRow = csv
    .split("\n")
    .find((row) => row.startsWith('"trace-event"'))
  assert.ok(traceEventRow)
  assert.match(traceEventRow, /"SRC-001"/)
  assert.match(
    csv,
    /"SRC-001","事件来源 \+ 评分证据","evidence-1","直接披露","是","indicator-1","2026-Q1","第 18 页，研发费用表","交易所","2026 年第一季度报告","2026-04-30","https:\/\/example\.com\/report\.pdf"/
  )
  assert.match(
    csv,
    /"来源角色","证据ID","支持强度","评分资格","关联指标","观测期间","定位信息"/
  )
  assert.match(html, /证据来源附录/)
  assert.match(html, /\[SRC-001\]/)
  assert.match(html, /事件来源 \+ 评分证据/)
  assert.match(html, /直接披露/)
  assert.match(html, /indicator-1[\s\S]*2026-Q1/)
  assert.match(html, /第 18 页，研发费用表/)
  assert.match(html, /https:\/\/example\.com\/report\.pdf/)
  assert.match(html, /技术风险[\s\S]*SRC-001/)
})

test("PNG source label exposes the traceable reference identifier", () => {
  assert.equal(
    createPngSourceReferenceText(traceDetail, traceAssessment, [
      event({
        id: "trace-event",
        companyId: traceDetail.id,
        evidenceIds: ["evidence-1"],
      }),
    ]),
    "来源引用：SRC-001（详见同快照 CSV / 打印版证据来源附录）"
  )
})

test("runtime scoring bindings are merged into CSV and print source references", () => {
  const runtimeDetail = createCompanyDetail({
    ...traceDetail,
    evidence: traceDetail.evidence.map((evidence) => ({
      ...evidence,
      scoringLinks: [],
    })),
  })
  const runtimeAssessment = createRiskAssessment({
    ...traceAssessment,
    dimensions: traceAssessment.dimensions.map((dimension) => ({
      ...dimension,
      indicatorIds: ["indicator-runtime"],
    })),
  })
  const bindings = [createEvidenceBinding()]
  const csv = createEventsCsvContent(
    runtimeDetail,
    runtimeAssessment,
    [],
    traceManifest,
    undefined,
    bindings
  )
  const html = createRiskSummaryPrintHtml(
    runtimeDetail,
    runtimeAssessment,
    [],
    traceManifest,
    undefined,
    bindings
  )

  assert.match(
    csv,
    /"SRC-001","评分证据","evidence-1","直接披露","是","indicator-runtime","2026-Q2","第 22 页，研发投入占比表"/
  )
  assert.match(
    html,
    /评分证据[\s\S]*是[\s\S]*indicator-runtime[\s\S]*2026-Q2[\s\S]*第 22 页，研发投入占比表/
  )
})

test("runtime bindings are deduplicated and limited to the exported company", () => {
  const bindings = [
    createEvidenceBinding({
      indicatorId: "indicator-1",
      period: "2026-Q1",
      unit: "万元",
      locator: "第 18 页，研发费用表",
    }),
    createEvidenceBinding({
      id: "binding-duplicate",
      observationId: "observation-duplicate",
      indicatorId: "indicator-1",
      period: "2026-Q1",
      unit: "万元",
      locator: "第 18 页，研发费用表",
    }),
    createEvidenceBinding({
      id: "binding-other-company",
      observationId: "observation-other-company",
      companyId: "other-company",
      indicatorId: "indicator-foreign",
      period: "2026-Q3",
      locator: "第 99 页",
    }),
  ]
  const csv = createEventsCsvContent(
    traceDetail,
    traceAssessment,
    [],
    traceManifest,
    undefined,
    bindings
  )

  assert.equal(csv.match(/indicator-1/g)?.length, 1)
  assert.equal(csv.match(/2026-Q1/g)?.length, 1)
  assert.equal(csv.match(/第 18 页，研发费用表/g)?.length, 1)
  assert.doesNotMatch(csv, /indicator-foreign|2026-Q3|第 99 页/)
})

test("PNG source references include runtime-only evidence bindings", () => {
  const runtimeAssessment = createRiskAssessment({
    dimensions: [],
  })
  const bindings = [createEvidenceBinding()]
  const csv = createEventsCsvContent(
    traceDetail,
    runtimeAssessment,
    [],
    traceManifest,
    undefined,
    bindings
  )

  assert.equal(
    createPngSourceReferenceText(traceDetail, runtimeAssessment, [], bindings),
    "来源引用：SRC-001（详见同快照 CSV / 打印版证据来源附录）"
  )
  assert.match(
    csv,
    /"SRC-001","评分观测来源（未计分）","evidence-1","直接披露","否","indicator-runtime","2026-Q2","第 22 页，研发投入占比表"/
  )
})
