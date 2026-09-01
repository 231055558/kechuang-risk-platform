import unifiedData from "@/data/industry/r01-r22-unified.json"
import r08MilestoneEnrichmentData from "@/data/industry/r08-milestone-enrichment.json"
import r20ControllerEnrichmentData from "@/data/industry/r20-controller-enrichment.json"
import {
  attachIndustryRiskR08MilestoneEnrichment,
  attachIndustryRiskR20ControllerEnrichment,
  scoreIndustryRiskDataset,
  type IndustryRiskCompany,
  type IndustryRiskDataset,
  type IndustryRiskIndicatorId,
  type IndustryRiskObservation,
  type IndustryRiskSource,
  type R08MilestoneEnrichment,
  type R20ControllerEnrichment,
} from "@/domain/industry-risk-v1/index.ts"
import type {
  CanonicalRiskDimensionId,
  CommonPlaybookItem,
  CompanyDetail,
  CompanyIntelligence,
  CompanySummary,
  EvidenceItem,
  EvidenceScoringBinding,
  IndicatorObservation,
  IndicatorTaxonomy,
  ManifestRecord,
  RealTimeDataSet,
  RealTimeSignal,
  RiskAssessment,
  RiskIndicator,
  RiskLevel,
  TabValue,
  TechnologyScoringCompanyState,
} from "@/types/risk"
import {
  deduplicatePublicEvents,
  toPublicEventCopy,
} from "@/lib/public-event-copy"
import { displayIndustryLabel } from "@/lib/industry-label"

const dataset = attachIndustryRiskR08MilestoneEnrichment(
  attachIndustryRiskR20ControllerEnrichment(
    unifiedData as IndustryRiskDataset,
    r20ControllerEnrichmentData as R20ControllerEnrichment
  ),
  r08MilestoneEnrichmentData as R08MilestoneEnrichment
)
const snapshotAt = dataset.metadata.sourceDate || "2026-08-19"
const fallbackSourceUrl = "https://www.sse.com.cn/"

const dimensionDefinitions: Array<{
  id: CanonicalRiskDimensionId
  label: string
  indicatorIds: IndustryRiskIndicatorId[]
}> = [
  {
    id: "narrative",
    label: "叙事风险",
    indicatorIds: ["R01", "R02", "R03", "R04"],
  },
  {
    id: "technology",
    label: "技术",
    indicatorIds: ["R05", "R06", "R07", "R08", "R09"],
  },
  {
    id: "compliance",
    label: "合规",
    indicatorIds: ["R10", "R11", "R12"],
  },
  {
    id: "finance",
    label: "财务与融资风险",
    indicatorIds: ["R13", "R14", "R15", "R16"],
  },
  {
    id: "external",
    label: "外部风险",
    indicatorIds: ["R17", "R18", "R19"],
  },
  {
    id: "personnel",
    label: "人员风险",
    indicatorIds: ["R20", "R21", "R22"],
  },
]

const dimensionByIndicator = new Map(
  dimensionDefinitions.flatMap((dimension) =>
    dimension.indicatorIds.map(
      (indicatorId) => [indicatorId, dimension] as const
    )
  )
)
const indicatorById = new Map(
  dataset.indicators.map((indicator) => [indicator.id, indicator])
)
const sourceById = new Map(dataset.sources.map((source) => [source.id, source]))
const companyById = new Map(
  dataset.companies.map((company) => [company.id, company])
)
const peerGroupById = new Map(
  (dataset.metadata.peerGroups ?? []).map((group) => [group.id, group])
)
const industryAssessments = scoreIndustryRiskDataset(dataset)
const industryAssessmentByCompany = new Map(
  industryAssessments.map((assessment) => [assessment.companyId, assessment])
)

function normalizeDate(value: string | null | undefined) {
  const match = value?.match(/^\d{4}-\d{2}-\d{2}/)
  return match?.[0] ?? snapshotAt
}

function observationDate(observation: IndustryRiskObservation) {
  return (
    observation.asOfDate ??
    observation.periodEnd ??
    observation.periodStart ??
    snapshotAt
  )
}

function compareObservationRecency(
  left: IndustryRiskObservation,
  right: IndustryRiskObservation
) {
  return observationDate(right).localeCompare(observationDate(left))
}

function scoreToLevel(score: number): RiskLevel {
  if (score >= 75) return "high"
  if (score >= 60) return "medium-high"
  if (score >= 40) return "attention"
  return "low"
}

function evidenceIdForSource(sourceId: string) {
  return `r01-evidence:${sourceId}`
}

function evidenceIdForEvent(eventId: string) {
  return `r01-event-evidence:${eventId}`
}

function sourceReliability(
  source: IndustryRiskSource
): EvidenceItem["sourceReliability"] {
  const text = `${source.sourceType} ${source.institution}`
  if (/上交所|交易所/.test(text)) return "exchange"
  if (/年报|定期报告|招股/.test(text)) return "filing"
  if (/政府|监管|官方|联邦公报|清单/.test(text)) return "official"
  return "media"
}

function companyObservations(companyId: string) {
  return dataset.observations.filter((item) => item.companyId === companyId)
}

function companySupplementaryObservations(companyId: string) {
  return (dataset.supplementaryObservations ?? []).filter(
    (item) => item.companyId === companyId
  )
}

type RawEvent = {
  id: string
  companyId: string
  indicatorId: IndustryRiskIndicatorId
  eventType: string
  date: string
  title: string
  url: string
  sourceName: string
  notes: string
  confidence: number
  kind: "deep-search" | "screening" | "inquiry" | "litigation"
}

function rawEventsForCompany(company: IndustryRiskCompany): RawEvent[] {
  const events: RawEvent[] = [
    ...(dataset.deepSearchEvents ?? [])
      .filter((item) => item.companyId === company.id)
      .map((item) => ({
        id: item.id,
        companyId: company.id,
        indicatorId: item.relatedIndicatorId ?? "R09",
        eventType: item.eventType || "企业披露事件",
        date: normalizeDate(item.eventDate),
        title: item.title,
        url: item.url ?? company.sourceUrl ?? fallbackSourceUrl,
        sourceName: item.sourceChannel || "公开披露",
        notes: item.notes,
        confidence: item.confidence,
        kind: "deep-search" as const,
      })),
    ...dataset.screeningHits
      .filter((item) => item.companyId === company.id)
      .map((item) => ({
        id: item.id,
        companyId: company.id,
        indicatorId: "R19" as const,
        eventType: "出口管制与限制清单命中",
        date: normalizeDate(item.startDate),
        title: `${item.listedName} · ${item.sourceList}`,
        url:
          item.sourceInformationUrl ??
          item.sourceListUrl ??
          item.noticeUrl ??
          fallbackSourceUrl,
        sourceName: item.sourceList,
        notes: `${item.matchScope}；${item.confidenceReason}`,
        confidence: item.confidence,
        kind: "screening" as const,
      })),
    ...dataset.inquiryEvidence
      .filter((item) => item.companyId === company.id)
      .map((item) => ({
        id: item.id,
        companyId: company.id,
        indicatorId: "R11" as const,
        eventType: item.countedAsInquiry ? "交易所问询" : "监管关注材料",
        date: normalizeDate(item.announcementDate),
        title: item.title,
        url: item.url ?? company.sourceUrl ?? fallbackSourceUrl,
        sourceName: "上海证券交易所",
        notes: `${item.topicKey}；${item.notes}`,
        confidence: item.confidence,
        kind: "inquiry" as const,
      })),
    ...dataset.litigationEvidence
      .filter((item) => item.companyId === company.id)
      .map((item) => ({
        id: item.id,
        companyId: company.id,
        indicatorId: "R12" as const,
        eventType: "诉讼司法事件",
        date: normalizeDate(item.hearingTime),
        title: item.cause || "诉讼事件",
        url: item.sourceUrl ?? company.sourceUrl ?? fallbackSourceUrl,
        sourceName: "公开司法信息",
        notes: `${item.role}；${item.limitations}`,
        confidence: item.confidence,
        kind: "litigation" as const,
      })),
  ]
  return deduplicatePublicEvents(events).sort((left, right) =>
    right.date.localeCompare(left.date)
  )
}

function eventSeverity(event: RawEvent): "high" | "medium" | "watch" {
  if (
    event.kind === "screening" ||
    /处罚|调查|重大|负面|诉讼|仲裁|无效|泄露/.test(
      `${event.eventType}${event.title}`
    )
  ) {
    return "high"
  }
  if (event.kind === "inquiry" || event.kind === "litigation") return "medium"
  return "watch"
}

function recommendationForIndicator(indicatorId: IndustryRiskIndicatorId) {
  const dimension = dimensionByIndicator.get(indicatorId)?.label ?? "风险"
  return `核对原始披露与后续公告，补充${dimension}口径所需的数值、主体范围和处置进展。`
}

function buildSourceEvidence(company: IndustryRiskCompany) {
  const observations = companyObservations(company.id)
  const supplementary = companySupplementaryObservations(company.id)
  const sourceIds = new Set<string>()
  for (const observation of observations) {
    sourceIds.add(observation.sourceId)
    observation.sourceIds?.forEach((id) => sourceIds.add(id))
  }
  supplementary.forEach((item) => {
    if (item.sourceId) sourceIds.add(item.sourceId)
  })

  return [...sourceIds].flatMap((sourceId): EvidenceItem[] => {
    const source = sourceById.get(sourceId)
    if (!source) return []
    const linkedObservations = observations.filter(
      (observation) =>
        observation.sourceId === sourceId ||
        observation.sourceIds?.includes(sourceId)
    )
    const relatedDimensions = [
      ...new Set(
        linkedObservations
          .map((item) => dimensionByIndicator.get(item.indicatorId)?.label)
          .filter((value): value is string => Boolean(value))
      ),
    ]
    const confidence = Math.max(
      source.redistribution === "licensed-derived" ? 0.65 : 0.75,
      ...linkedObservations.map((item) => item.confidence)
    )
    return [
      {
        id: evidenceIdForSource(sourceId),
        type: source.sourceType || "公开资料",
        title: source.title || `${company.shortName}公开资料`,
        sourceName: source.institution || "公开来源",
        sourceUrl: source.url ?? company.sourceUrl ?? fallbackSourceUrl,
        publishedAt: normalizeDate(source.publicationDate ?? source.accessedAt),
        capturedAt: normalizeDate(source.accessedAt),
        summary: source.notes || "用于 R01–R22 指标观测与数据覆盖。",
        sourceReliability: sourceReliability(source),
        recommendedUse: "用于指标观测、事件核验和证据追溯。",
        indicatorIds: [
          ...new Set(linkedObservations.map((item) => item.indicatorId)),
        ],
        relatedRiskDimension:
          relatedDimensions.length > 0 ? relatedDimensions : ["叙事风险"],
        relatedStage: ["上市运营"],
        confidence,
        supportStrength:
          source.redistribution === "licensed-derived"
            ? "background"
            : "direct",
        supportRationale:
          source.redistribution === "licensed-derived"
            ? "第三方派生线索，仅用于辅助核验。"
            : "公开来源直接披露或可按原公式重算。",
        scoringLinks: linkedObservations.slice(0, 20).map((observation) => ({
          indicatorId: observation.indicatorId,
          period: observationDate(observation),
          unit: observation.unit ?? "",
          locator: observation.sourcePage
            ? `第 ${observation.sourcePage} 页`
            : observation.metricName,
        })),
      },
    ]
  })
}

function buildEventEvidence(events: RawEvent[]) {
  return events.map((event): EvidenceItem => {
    const publicCopy = toPublicEventCopy(event)
    return {
      id: evidenceIdForEvent(event.id),
      type: event.eventType,
      title: event.title,
      sourceName: event.sourceName,
      sourceUrl: event.url,
      publishedAt: event.date,
      capturedAt: snapshotAt,
      summary: publicCopy.summary,
      sourceReliability: event.url.includes("sse.com.cn")
        ? "exchange"
        : event.kind === "screening"
          ? "official"
          : "media",
      recommendedUse: "用于事件核验、风险传导和持续跟踪。",
      indicatorIds: [event.indicatorId],
      relatedRiskDimension: [
        dimensionByIndicator.get(event.indicatorId)?.label ?? "外部风险",
      ],
      relatedStage: ["上市运营"],
      confidence: event.confidence,
      supportStrength: event.confidence >= 0.85 ? "direct" : "background",
      supportRationale: "由统一事件表映射到 R01–R22 指标。",
    }
  })
}

function latestByIndicator(companyId: string) {
  const observations = companyObservations(companyId)
  return dataset.indicators.flatMap((indicator) => {
    const latest = observations
      .filter((item) => item.indicatorId === indicator.id)
      .sort(compareObservationRecency)[0]
    return latest ? [latest] : []
  })
}

function displayObservationValue(observation: IndustryRiskObservation) {
  if (observation.numericValue !== null) {
    return `${new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 4 }).format(observation.numericValue)}${observation.unit ? ` ${observation.unit}` : ""}`
  }
  return observation.textValue || observation.status
}

function buildCompanyDetail(company: IndustryRiskCompany): CompanyDetail {
  const assessment = industryAssessmentByCompany.get(company.id)
  const events = rawEventsForCompany(company)
  const sourceEvidence = buildSourceEvidence(company)
  const eventEvidence = buildEventEvidence(events)
  const evidence = [...sourceEvidence, ...eventEvidence]
  const coverage = dataset.coverage.filter(
    (item) => item.companyId === company.id
  )
  const coveredIndicatorCount = coverage.filter(
    (item) => !item.status.startsWith("NA")
  ).length
  const peerGroup = peerGroupById.get(company.peerGroupId ?? "")
  const peerCompanies =
    peerGroup?.companyIds ?? dataset.companies.map((item) => item.id)
  const companyIndex = peerCompanies.indexOf(company.id)
  const benchmarkCompanyId =
    peerCompanies[(companyIndex + 1) % peerCompanies.length] ?? company.id
  const scoredDimensions = dimensionDefinitions.map((dimension) => {
    const metrics =
      assessment?.metrics.filter(
        (metric) =>
          dimension.indicatorIds.includes(metric.indicatorId) &&
          metric.riskScore !== null
      ) ?? []
    const score = metrics.length
      ? Math.round(
          metrics.reduce((sum, metric) => sum + (metric.riskScore ?? 0), 0) /
            metrics.length
        )
      : null
    return { dimension, metrics, score }
  })
  const highEvents = events.filter((event) => eventSeverity(event) === "high")
  const mediumEvents = events.filter(
    (event) => eventSeverity(event) === "medium"
  )
  const latestObservations = latestByIndicator(company.id)
  const candidateScore =
    assessment?.candidateAggregates.find((item) => item.method === "critic")
      ?.score ?? 0
  const leadEvent = events[0]
  const leadEvidenceId = leadEvent
    ? evidenceIdForEvent(leadEvent.id)
    : evidence[0]?.id

  return {
    id: company.id,
    name: company.shortName,
    sector: displayIndustryLabel(
      assessment?.benchmarkGroupLabel ?? peerGroup?.label ?? company.chainSegment
    ),
    description: `${company.fullName}，纳入 ${peerGroup?.label ?? dataset.metadata.sectorLabel} R01–R22 统一风险样本。`,
    headquarters: "以公司正式披露为准",
    stage: "科创板上市运营",
    riskIndex: candidateScore,
    benchmarkCompanyId,
    snapshotAt,
    metrics: {
      highRiskEvents: highEvents.length,
      mediumRiskEvents: mediumEvents.length,
      responseRate: 0,
      evidenceCoverage: Math.round((coveredIndicatorCount / 22) * 100),
      monitoredSources: sourceEvidence.length,
      currentHighRiskType:
        scoredDimensions
          .filter((item) => item.score !== null)
          .sort((left, right) => (right.score ?? 0) - (left.score ?? 0))[0]
          ?.dimension.label ??
        (leadEvent
          ? dimensionByIndicator.get(leadEvent.indicatorId)?.label
          : "叙事风险") ??
        "叙事风险",
    },
    dimensions: scoredDimensions.map(({ dimension, metrics, score }) => ({
      id: dimension.id,
      label: dimension.label,
      score: score ?? 0,
      level: score === null ? "low" : scoreToLevel(score),
      weight: `${dimension.indicatorIds.length}/22`,
      summary:
        score === null
          ? "当前同业组尚无可比评分值，保留覆盖与原始观测。"
          : `由 ${metrics.map((metric) => metric.indicatorId).join("、")} 同业可比观测形成候选维度值。`,
      evidenceIds: metrics.flatMap((metric) =>
        metric.sourceId ? [evidenceIdForSource(metric.sourceId)] : []
      ),
      indicatorIds: dimension.indicatorIds,
    })),
    lifecycle: [
      {
        id: `${company.id}-listed`,
        label: "上市与信息披露",
        status: "passed",
        riskScore: 0,
        summary: "已纳入科创板上市公司公开披露范围。",
        keywords: ["合规"],
        change: company.listDate ?? "上市日期待核验",
        evidenceIds: sourceEvidence.slice(0, 1).map((item) => item.id),
      },
      {
        id: `${company.id}-current`,
        label: "持续经营与研发",
        status: "current",
        riskScore: candidateScore,
        summary: "按 R01–R22 持续监测经营、研发、合规和外部风险。",
        keywords: ["技术", "财务与融资风险", "外部风险"],
        change: `数据截至 ${snapshotAt}`,
        evidenceIds: sourceEvidence.slice(0, 4).map((item) => item.id),
      },
      {
        id: `${company.id}-review`,
        label: "下一次更新",
        status: "next",
        riskScore: 0,
        summary: "等待下一期报告、监管公告和重大事件更新。",
        keywords: ["人员风险", "叙事风险"],
        change: "按指标频率滚动更新",
        evidenceIds: [],
      },
    ],
    trend: Array.from({ length: 6 }, (_, index) => {
      const date = new Date(`${snapshotAt}T00:00:00+08:00`)
      date.setMonth(date.getMonth() - (5 - index))
      const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`
      const monthEvents = events.filter((event) => event.date.startsWith(month))
      return {
        month,
        riskIndex: candidateScore,
        highRiskEvents: monthEvents.filter(
          (event) => eventSeverity(event) === "high"
        ).length,
        mediumRiskEvents: monthEvents.filter(
          (event) => eventSeverity(event) === "medium"
        ).length,
        newEvents: monthEvents.length,
      }
    }),
    aiCoverage: {
      ingestedSourceTypes: [
        ...new Set(sourceEvidence.map((item) => item.type)),
      ],
      extractedSignals: [
        ...new Set(latestObservations.map((item) => item.metricName)),
      ].slice(0, 12),
    },
    disclosureMetrics: latestObservations.slice(0, 16).map((observation) => ({
      label:
        indicatorById.get(observation.indicatorId)?.label ??
        observation.metricName,
      value: displayObservationValue(observation),
      unit: observation.unit ?? undefined,
      period: observationDate(observation),
      sourceId: evidenceIdForSource(observation.sourceId),
      riskImplication: observation.limitations || observation.status,
    })),
    investmentView: {
      stance:
        candidateScore >= 65
          ? "优先控制高风险暴露"
          : candidateScore >= 55
            ? "重点推进风险缓释"
            : candidateScore >= 45
              ? "保持审慎并持续跟踪"
              : "维持常规风险监测",
      riskAppetite: "以 R01–R22 自动风险结果确定行动优先级",
      summary: `系统依据 ${assessment?.weightedScoredIndicatorCount ?? 0}/18 项有效指标自动形成风险结论，并按高影响指标生成行动建议。`,
      preInvestmentChecks: ["核验最新定期报告", "核验重大事件主体与金额"],
      dueDiligenceFocus: coverage
        .filter((item) => item.status.startsWith("NA"))
        .slice(0, 5)
        .map(
          (item) =>
            `${item.indicatorId} ${indicatorById.get(item.indicatorId)?.label ?? ""}`
        ),
      valuationConstraints: ["缺失指标不得按零处理", "候选分不得替代估值模型"],
      postInvestmentMonitoring: ["按季度更新财务观测", "重大事件实时预警"],
      stopLossTriggers: ["重大处罚或限制清单命中", "重大技术或知识产权事件"],
      evidenceIds: evidence.slice(0, 8).map((item) => item.id),
    },
    comparisonNote: "仅与同一同业组、同一报告期和同一指标口径的企业比较。",
    evidence,
    events: events.map((event) => {
      const publicCopy = toPublicEventCopy(event)
      return {
        id: event.id,
        companyId: company.id,
        riskType:
          dimensionByIndicator.get(event.indicatorId)?.label ?? "外部风险",
        severity: eventSeverity(event),
        status: "pending",
        sourceType: event.sourceName,
        stage: "持续监测",
        description: event.title,
        evidenceIds: [evidenceIdForEvent(event.id)],
        indicatorIds: [event.indicatorId],
        sourceName: event.sourceName,
        sourceUrl: event.url,
        sourcePublishedAt: event.date,
        investmentImpact:
          eventSeverity(event) === "high" ? "high" : "medium",
        aiSummary: publicCopy.summary,
        recommendedAction: recommendationForIndicator(event.indicatorId),
        identifiedAt: event.date,
      }
    }),
    transmissionGraph: {
      keyInsight: leadEvent
        ? `${leadEvent.eventType}可能通过经营、合规或供应链环节影响企业。`
        : "当前缺少结构化事件，保持持续监测。",
      nodes: [
        {
          id: `${company.id}-source`,
          label: leadEvent?.eventType ?? "公开信息变化",
          layer: "source",
          description: leadEvent?.title ?? "等待新的公开披露。",
          evidenceIds: leadEvidenceId ? [leadEvidenceId] : [],
        },
        {
          id: `${company.id}-mediator`,
          label: "指标与业务环节",
          layer: "mediator",
          description: leadEvent
            ? `关联 ${leadEvent.indicatorId}，需核验影响范围。`
            : "暂无已识别传导环节。",
          evidenceIds: leadEvidenceId ? [leadEvidenceId] : [],
        },
        {
          id: `${company.id}-impact`,
          label: "企业风险影响",
          layer: "impact",
          description: "结合后续公告、财务观测和处置进展判断。",
          evidenceIds: leadEvidenceId ? [leadEvidenceId] : [],
        },
        {
          id: `${company.id}-response`,
          label: "监测与响应",
          layer: "response",
          description: "建立责任人、更新时间和风险触发条件。",
          evidenceIds: [],
        },
      ],
      edges: [
        {
          source: `${company.id}-source`,
          target: `${company.id}-mediator`,
          strength: "strong",
        },
        {
          source: `${company.id}-mediator`,
          target: `${company.id}-impact`,
          strength: "medium",
        },
        {
          source: `${company.id}-impact`,
          target: `${company.id}-response`,
          strength: "medium",
        },
      ],
    },
    governance: dimensionDefinitions.map((dimension, index) => ({
      id: `${company.id}-governance-${dimension.id}`,
      riskType: dimension.label,
      title: `${dimension.label}行动`,
      priority: index < 2 ? "P1" : "P2",
      stage: "持续监测",
      problem: `当前覆盖 ${coverage.filter((item) => dimension.indicatorIds.includes(item.indicatorId) && !item.status.startsWith("NA")).length}/${dimension.indicatorIds.length} 项。`,
      action: "跟踪最新来源与指标变化，系统自动更新风险分和建议动作。",
      dataSupport: dimension.indicatorIds.join("、"),
      evidenceIds: evidence
        .filter((item) =>
          item.indicatorIds?.some((id) =>
            dimension.indicatorIds.includes(id as IndustryRiskIndicatorId)
          )
        )
        .slice(0, 4)
        .map((item) => item.id),
    })),
  }
}

export const riskIndicators: RiskIndicator[] = dataset.indicators.map(
  (indicator, index) => {
    const dimension = dimensionByIndicator.get(indicator.id)!
    const scoreReady = dataset.metadata.scoreReadyIndicatorIds.includes(
      indicator.id
    )
    return {
      id: indicator.id,
      sourceRow: indicator.sourceRow || index + 1,
      primaryRisk: dimension.label,
      secondaryRisk: indicator.label,
      tertiaryRisk: indicator.label,
      definition: indicator.definition,
      formula: indicator.rawValueFormula,
      threshold: "按同业组可比口径与指标规则自动更新",
      entityType: indicator.entityType,
      relatedEntities: indicator.relation,
      dataSource: indicator.academicSource || "公开披露与结构化数据库",
      frequency: indicator.updateFrequency,
      admissionStatus: scoreReady ? "validated" : "observation",
      admissionNote: scoreReady
        ? "至少一个同业组具备全样本可比观测。"
        : "保留为覆盖或事件观察项，不补零。",
    }
  }
)

export const indicatorTaxonomy: IndicatorTaxonomy = {
  sourceFile: "r01-r22-unified.json",
  methodVersion: "IRAWC-CRITIC-2026.08-v3",
  admissionGovernance: {
    decisionVersion: "R01-R22-ADM-2026.08-v1",
    decisionDate: snapshotAt,
    reviewerRole: "平台研究人员",
    basis: "统一采用 R01–R22；仅同业组内可比且来源可追溯的指标进入候选评分。",
  },
  primaryCount: dimensionDefinitions.length,
  secondaryCount: dataset.indicators.length,
  tertiaryCount: dataset.indicators.length,
  admissionCounts: {
    validated: riskIndicators.filter(
      (item) => item.admissionStatus === "validated"
    ).length,
    observation: riskIndicators.filter(
      (item) => item.admissionStatus === "observation"
    ).length,
    candidate: 0,
  },
  note: "R05–R22 为当前客观评分项；财报叙事三维度独立建约，新闻仅用于资讯展示；缺失值保持 NA。",
  groups: dimensionDefinitions.map((dimension) => {
    const indicators = riskIndicators.filter((item) =>
      dimension.indicatorIds.includes(item.id as IndustryRiskIndicatorId)
    )
    return {
      primary: dimension.label,
      secondaryCount: indicators.length,
      tertiaryCount: indicators.length,
      secondaryLabels: indicators.map((item) => item.secondaryRisk),
      metricSamples: indicators.slice(0, 1).map((item) => ({
        secondary: item.secondaryRisk,
        name: item.tertiaryRisk,
        definition: item.definition,
        threshold: item.threshold,
        source: item.dataSource,
        frequency: item.frequency,
        entityType: item.entityType,
      })),
    }
  }),
}

export const detailRegistry = Object.fromEntries(
  dataset.companies.map((company) => [company.id, buildCompanyDetail(company)])
) as Record<string, CompanyDetail>

function buildBaseAssessment(companyId: string): RiskAssessment {
  const industryAssessment = industryAssessmentByCompany.get(companyId)
  const dimensions = dimensionDefinitions.map((dimension) => {
    const scoredMetrics =
      industryAssessment?.metrics.filter(
        (metric) =>
          dimension.indicatorIds.includes(metric.indicatorId) &&
          metric.riskScore !== null
      ) ?? []
    const weightedDimension = industryAssessment?.dimensionScores.find(
      (item) => item.id === dimension.id
    )
    const score =
      dimension.id === "narrative"
        ? (industryAssessment?.financialReportNarrativeRisk.score ?? null)
        : (weightedDimension?.score ?? null)
    const evidenceIds = scoredMetrics.flatMap((metric) =>
      metric.sourceId ? [evidenceIdForSource(metric.sourceId)] : []
    )
    return {
      id: dimension.id,
      label: dimension.label,
      score,
      level: score === null ? null : scoreToLevel(score),
      assessable: score !== null,
      scoreBasis: score === null ? null : ("indicator-observation" as const),
      summary:
        score === null
          ? dimension.id === "narrative"
            ? "财报叙事按三个正式维度独立评估；新闻资讯不参与评分，当前结果尚待财报语料接入。"
            : "当前同业组尚无可比评分观测，展示原始覆盖与缺口。"
          : `由 ${scoredMetrics.map((metric) => metric.indicatorId).join("、")} 按CRITIC权重形成维度基准分。`,
      evidenceIds,
      indicatorIds: scoredMetrics.map((metric) => metric.indicatorId),
      evidenceIndicatorPairCount: evidenceIds.length,
    }
  })
  const assessableDimensionCount = dimensions.filter(
    (dimension) => dimension.assessable
  ).length
  const coverage = dataset.coverage.filter(
    (item) => item.companyId === companyId
  )
  const indicatorAvailability = Math.round(
    (coverage.filter((item) => !item.status.startsWith("NA")).length / 22) * 100
  )
  const totalRiskScore = industryAssessment?.totalRiskScore ?? null
  return {
    methodVersion:
      industryAssessment?.methodVersion ?? "IRAWC-CRITIC-2026.08-v3",
    label: "风险辅助研判指数",
    score: totalRiskScore,
    scoreLabel:
      totalRiskScore === null ? "数据不足" : `${totalRiskScore.toFixed(2)} 分`,
    dimensions,
    assessableDimensionCount,
    effectiveEvidenceCoverage: Math.round(
      (industryAssessment?.weightedDataCoverage ?? 0) * 100
    ),
    indicatorAvailability,
    reviewStatus:
      totalRiskScore === null ? "insufficient-evidence" : "reviewed",
    scoreBasisLabel: "R05–R22 客观指标自动计算",
    reviewedAt: snapshotAt,
    disclaimer:
      "总分按现有R05–R22指标、两级CRITIC和同业风险分位自动形成；缺失值不补零，行业样本用于相对风险比较。",
  }
}

export function buildAssessmentRegistry(
  observations: IndicatorObservation[] = [],
  evidenceBindings: EvidenceScoringBinding[] = [],
  technologyScoringCompanies: Readonly<
    Record<string, TechnologyScoringCompanyState | undefined>
  > = {}
) {
  void observations
  void evidenceBindings
  void technologyScoringCompanies
  return Object.fromEntries(
    dataset.companies.map((company) => [
      company.id,
      buildBaseAssessment(company.id),
    ])
  ) as Record<string, RiskAssessment>
}

export const assessmentRegistry = buildAssessmentRegistry()

export function buildCompanySummaries(
  assessments: Record<string, RiskAssessment>
) {
  return dataset.companies.map((company): CompanySummary => {
    const detail = detailRegistry[company.id]
    const assessment = assessments[company.id]
    const topRisks = assessment.dimensions
      .filter((dimension) => dimension.score !== null)
      .sort((left, right) => (right.score ?? 0) - (left.score ?? 0))
      .slice(0, 2)
      .map((dimension) => dimension.label)
    const highEvent = detail.events.find((event) => event.severity === "high")
    return {
      id: company.id,
      name: company.shortName,
      fullName: company.fullName,
      stockCode: company.stockCode,
      sector: detail.sector,
      stage: detail.stage,
      riskIndex: assessment.score,
      topRisks,
      snapshotAt,
      evidenceCount: detail.evidence.length,
      highRiskEvents: detail.metrics.highRiskEvents,
      mediumRiskEvents: detail.metrics.mediumRiskEvents,
      responseRate: 0,
      trendDelta: 0,
      benchmarkCompanyId: detail.benchmarkCompanyId,
      currentHighRiskEvent: highEvent?.description ?? "暂无已核验高风险事件",
    }
  })
}

export const companySummaries = buildCompanySummaries(assessmentRegistry)
export const defaultCompanyId = detailRegistry["star-688256"]
  ? "star-688256"
  : dataset.companies[0].id
export const defaultCompareId =
  detailRegistry[defaultCompanyId].benchmarkCompanyId

export const indicatorObservations: IndicatorObservation[] =
  dataset.companies.flatMap((company) => {
    const coverageByIndicator = new Map(
      dataset.coverage
        .filter((item) => item.companyId === company.id)
        .map((item) => [item.indicatorId, item])
    )
    return latestByIndicator(company.id).map((observation) => {
      const coverage = coverageByIndicator.get(observation.indicatorId)
      const value =
        observation.numericValue !== null
          ? String(observation.numericValue)
          : observation.textValue
      return {
        id: `r01-observation:${observation.id}`,
        companyId: company.id,
        indicatorId: observation.indicatorId,
        status: coverage?.usableForScoring
          ? "available"
          : coverage && !coverage.status.startsWith("NA")
            ? "partial"
            : "unavailable",
        value,
        unit: observation.unit ?? "",
        normalizationRuleVersion: "R01-R22-raw-v1",
        reviewStatus: coverage?.usableForScoring ? "reviewed" : "pending",
        reviewedBy: "统一数据导入",
        reviewedAt: snapshotAt,
        period: observationDate(observation),
        evidenceIds: sourceById.has(observation.sourceId)
          ? [evidenceIdForSource(observation.sourceId)]
          : [],
        note: observation.limitations || observation.status,
      }
    })
  })

export const companyIntelligence: CompanyIntelligence[] = dataset.companies.map(
  (company) => {
    const detail = detailRegistry[company.id]
    const primaryEvidence = detail.evidence[0]
    const patentObservation = latestByIndicator(company.id).find(
      (item) => item.indicatorId === "R05"
    )
    const patentSource = patentObservation
      ? sourceById.get(patentObservation.sourceId)
      : undefined
    const source: EvidenceItem = primaryEvidence ?? {
      id: `${company.id}-profile-source`,
      type: "公司信息",
      title: company.fullName,
      sourceName: "上海证券交易所",
      sourceUrl: company.sourceUrl ?? fallbackSourceUrl,
      publishedAt: snapshotAt,
      summary: "企业主体信息。",
      relatedRiskDimension: ["叙事风险"],
      relatedStage: ["上市运营"],
      confidence: company.confidence,
    }
    return {
      companyId: company.id,
      snapshotAt,
      profileFacts: [
        {
          id: `${company.id}-profile-stock`,
          label: "证券代码",
          value: company.stockCode,
          period: snapshotAt,
          summary: company.selectionReason,
          status: "verified",
          evidenceIds: primaryEvidence ? [primaryEvidence.id] : [],
        },
        {
          id: `${company.id}-profile-name`,
          label: "公司全称",
          value: company.fullName,
          period: snapshotAt,
          summary: company.chainSegment,
          status: "verified",
          evidenceIds: primaryEvidence ? [primaryEvidence.id] : [],
        },
        {
          id: `${company.id}-profile-peer`,
          label: "同业组",
          value: detail.sector,
          period: snapshotAt,
          summary: "同业候选评分仅在该组内比较。",
          status: "verified",
          evidenceIds: primaryEvidence ? [primaryEvidence.id] : [],
        },
      ],
      technologyAssets: [],
      patentWatch: patentObservation
        ? [
            {
              id: `${company.id}-patent-watch`,
              technicalTheme: "R05 专利质量代理",
              riskFocus:
                patentObservation.limitations || patentObservation.status,
              verificationStatus: "partial",
              countDisclosure: "公开披露可核验",
              summary: displayObservationValue(patentObservation),
              riskDimensionIds: ["technology"],
              evidenceIds: [evidenceIdForSource(patentObservation.sourceId)],
              source: {
                sourceName: patentSource?.institution ?? source.sourceName,
                sourceUrl: patentSource?.url ?? source.sourceUrl,
                publishedAt: normalizeDate(
                  patentSource?.publicationDate ?? patentSource?.accessedAt
                ),
                capturedAt: normalizeDate(patentSource?.accessedAt),
                reliability: patentSource
                  ? sourceReliability(patentSource)
                  : source.sourceReliability,
              },
            },
          ]
        : [],
      policyFunding: [],
      coverage: {
        profile: 3,
        technology: patentObservation ? 1 : 0,
        patent: patentObservation ? 1 : 0,
        policyFunding: 0,
        note: "由 R01–R22 统一数据生成；未接入字段保持空白。",
      },
    }
  }
)

export const companyIntelligenceRegistry = new Map(
  companyIntelligence.map((item) => [item.companyId, item])
)

const realtimeSignals: RealTimeSignal[] = dataset.companies.flatMap((company) =>
  rawEventsForCompany(company).map((event) => {
    const severity = eventSeverity(event)
    const dimension = dimensionByIndicator.get(event.indicatorId)
    const publicCopy = toPublicEventCopy(event)
    const category: RealTimeSignal["category"] =
      event.kind === "screening"
        ? "监管政策"
        : event.kind === "inquiry"
          ? "资本市场"
          : event.kind === "litigation"
            ? "监管政策"
            : event.indicatorId === "R09"
              ? "技术论文/专利"
              : "企业披露"
    return {
      id: `signal:${event.id}`,
      scope: "company",
      companyIds: [company.id],
      category,
      severity,
      title: event.title,
      summary: publicCopy.summary,
      keyFacts: publicCopy.keyFacts,
      historicalContext: `该事件按 ${event.date} 的公开材料归档。`,
      aiInsight: `关联 ${event.indicatorId} ${indicatorById.get(event.indicatorId)?.label ?? ""}。`,
      potentialImpact: `${dimension?.label ?? "风险"}可能发生变化。`,
      recommendedAction: recommendationForIndicator(event.indicatorId),
      researchQuestions: [
        "主体、时间和影响范围是否完整？",
        "后续公告是否改变当前判断？",
      ],
      riskDimensionIds: dimension ? [dimension.id] : [],
      indicatorIds: [event.indicatorId],
      eventIds: [event.id],
      heatScore: severity === "high" ? 90 : severity === "medium" ? 65 : 40,
      sourceCount: 1,
      publishedAt: event.date,
      capturedAt: snapshotAt,
      sourceName: event.sourceName,
      sourceUrl: event.url,
      sourceLocator: event.title,
      sourceReliability: event.url.includes("sse.com.cn")
        ? "exchange"
        : event.kind === "screening"
          ? "official"
          : "media",
      verificationStatus: event.confidence >= 0.85 ? "verified" : "monitoring",
    }
  })
)

realtimeSignals.sort((left, right) =>
  right.publishedAt.localeCompare(left.publishedAt)
)

export const realtimeData: RealTimeDataSet = {
  snapshotAt: `${snapshotAt}T23:59:59+08:00`,
  note: "由当前 R01–R22 行业样本中的公开事件、监管问询、诉讼与限制清单信息统一生成。",
  dailyBrief: {
    date: snapshotAt,
    capturedAt: `${snapshotAt}T23:59:59+08:00`,
    summary: `当前覆盖 ${dataset.companies.length} 家企业和 ${realtimeSignals.length} 条结构化事件信号。`,
    prioritySignalIds: realtimeSignals
      .filter((signal) => signal.severity === "high")
      .slice(0, 10)
      .map((signal) => signal.id),
    pendingVerificationCount: realtimeSignals.filter(
      (signal) => signal.verificationStatus !== "verified"
    ).length,
    highImpactCompanyIds: [
      ...new Set(
        realtimeSignals
          .filter((signal) => signal.severity === "high")
          .flatMap((signal) => signal.companyIds)
      ),
    ],
  },
  signals: realtimeSignals,
}

export { realtimeSignals }

export const manifest: ManifestRecord = {
  snapshotAt,
  version: dataset.metadata.dataVersion,
  coverage: (dataset.metadata.peerGroups ?? []).map((group) => group.label),
  totalEvidence: Object.values(detailRegistry).reduce(
    (sum, detail) => sum + detail.evidence.length,
    0
  ),
  totalEvents: realtimeSignals.length,
  sourceStats: [
    { type: "结构化来源", count: dataset.sources.length },
    { type: "结构化公开事件", count: dataset.deepSearchEvents?.length ?? 0 },
    { type: "补充事实", count: dataset.supplementaryObservations?.length ?? 0 },
  ],
  officialSourceCount: dataset.sources.filter((source) =>
    /官方|上交所|交易所|联邦公报/.test(
      `${source.sourceType}${source.institution}`
    )
  ).length,
  filingSourceCount: dataset.sources.filter((source) =>
    /年报|定期报告|招股/.test(`${source.sourceType}${source.title}`)
  ).length,
  indicatorVersion: "R01–R22",
  disclaimer: "用于辅助研判，不构成投资建议或监管认定。",
  note: "数据按企业与行业样本统一归集；缺失值保持未提供，不以零替代。",
}

export const commonPlaybook: CommonPlaybookItem[] = dimensionDefinitions.map(
  (dimension, index) => ({
    riskType: dimension.label,
    title: `${dimension.label}标准动作`,
    priority: index < 2 ? "P1" : "P2",
    action: "跟踪原始来源、指标变化和后续事件，系统同步更新行动等级。",
    dataSupport: dimension.indicatorIds.join("、"),
  })
)

export function mapLegacyIndicatorIds(indicatorIds: string[] = []) {
  return [
    ...new Set(
      indicatorIds.filter((id) =>
        indicatorById.has(id as IndustryRiskIndicatorId)
      )
    ),
  ]
}

export function getCustomerVisibleIndicators(indicatorIds: string[] = []) {
  const requested = new Set(mapLegacyIndicatorIds(indicatorIds))
  return riskIndicators.filter((indicator) => requested.has(indicator.id))
}

export function getAdmittedIndicators(indicatorIds: string[] = []) {
  return getCustomerVisibleIndicators(indicatorIds).filter(
    (indicator) => indicator.admissionStatus === "validated"
  )
}

export function getObservationIndicators(indicatorIds: string[] = []) {
  return getCustomerVisibleIndicators(indicatorIds).filter(
    (indicator) => indicator.admissionStatus === "observation"
  )
}

export const tabs: Array<{ value: TabValue; label: string }> = [
  { value: "overview", label: "风险总览" },
  { value: "realtime", label: "风险资讯" },
  { value: "reports", label: "风险报告" },
  { value: "intelligence", label: "企业详情" },
  { value: "compare", label: "对比分析" },
  { value: "events", label: "事件处理" },
]

export function getCompanySummary(companyId: string) {
  return companySummaries.find((company) => company.id === companyId)
}

export function getCompanyDetail(companyId: string) {
  return detailRegistry[companyId] ?? detailRegistry[defaultCompanyId]
}

export function getCompanyIntelligence(companyId: string) {
  return (
    companyIntelligenceRegistry.get(companyId) ??
    companyIntelligenceRegistry.get(defaultCompanyId)!
  )
}

export function getCompanyAssessment(companyId: string) {
  return assessmentRegistry[companyId] ?? assessmentRegistry[defaultCompanyId]
}

export function getCompanyName(companyId: string) {
  return (
    getCompanySummary(companyId)?.name ??
    companyById.get(companyId)?.shortName ??
    companyId
  )
}
