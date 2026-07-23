import { useMemo, useState } from "react"
import {
  CalculatorIcon,
  ClipboardCheckIcon,
  FileSearchIcon,
  LoaderCircleIcon,
  RotateCcwIcon,
  SaveIcon,
  ScaleIcon,
} from "lucide-react"

import { SupportBadge } from "@/components/dashboard/shared"
import { LiquidGlassSurface } from "@/components/liquid"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { isCandidateDataSource } from "@/lib/source-governance"
import { cn } from "@/lib/utils"
import type {
  CompanyDetail,
  EvidenceSupportStrength,
  TechnologyBaselineCalibrationIndicatorId,
  TechnologyBaselineIndicatorId,
  TechnologyBaselineLifecycleStage,
  TechnologyBaselineMetricId,
  TechnologyBaselineQuantificationRequest,
  TechnologyBaselineQuantificationResult,
  TechnologyBaselineValues,
  TechnologyScoringCompanyState,
} from "@/types/risk"

type TechnologyBaselinePanelProps = {
  detail: CompanyDetail
  companyState?: TechnologyScoringCompanyState
  storageWarning: string
  onSaveDraft: (request: TechnologyBaselineQuantificationRequest) => boolean
  onQuantify: (
    request: TechnologyBaselineQuantificationRequest
  ) => Promise<TechnologyBaselineQuantificationResult>
  onClear: () => boolean
}

type BaselineField = {
  key: keyof TechnologyBaselineValues
  label: string
  unit: string
  min: number
  max?: number
  step?: number
}

type BaselineDefinition = {
  id: TechnologyBaselineIndicatorId
  label: string
  sourceCategory: string
  formula: string
  fields: BaselineField[]
}

type CalibrationDefinition = {
  id: TechnologyBaselineCalibrationIndicatorId
  label: string
  sourceCategory: string
  formula: string
  threshold: string | null
  fields: BaselineField[]
}

type EvidenceDraft = {
  evidenceId: string
  locator: string
  inferenceBasis: string
}

const lifecycleOptions: Array<{
  value: TechnologyBaselineLifecycleStage
  label: string
}> = [
  { value: "startup", label: "初创期" },
  { value: "growth", label: "成长期" },
  { value: "stable", label: "稳定期" },
]

const lifecycleWeights: Record<
  TechnologyBaselineLifecycleStage,
  Record<TechnologyBaselineIndicatorId, number>
> = {
  startup: {
    "tqi-001": 4,
    "tqi-002": 6,
    "tqi-003": 7,
    "tqi-004": 6,
    "tqi-005": 5,
    "tqi-006": 2,
  },
  growth: {
    "tqi-001": 3,
    "tqi-002": 6,
    "tqi-003": 6,
    "tqi-004": 5,
    "tqi-005": 3,
    "tqi-006": 2,
  },
  stable: {
    "tqi-001": 2,
    "tqi-002": 5,
    "tqi-003": 5,
    "tqi-004": 4,
    "tqi-005": 3,
    "tqi-006": 1,
  },
}

const definitions: BaselineDefinition[] = [
  {
    id: "tqi-001",
    label: "论文发表数量",
    sourceCategory: "论文与研究",
    formula: "年度 SCI/核心期刊论文数",
    fields: [
      {
        key: "papersPublished",
        label: "年度 SCI/核心期刊论文数",
        unit: "篇",
        min: 0,
        step: 1,
      },
    ],
  },
  {
    id: "tqi-002",
    label: "专利产出效率",
    sourceCategory: "专利与知识产权",
    formula: "累计有效发明专利授权量（科技部创新积分制 2.0 核心口径）",
    fields: [
      {
        key: "validInventionPatents",
        label: "累计有效发明专利授权量",
        unit: "件",
        min: 1,
        step: 1,
      },
    ],
  },
  {
    id: "tqi-003",
    label: "研发投入强度",
    sourceCategory: "研发投入",
    formula: "研发费用 / 营业收入 × 100%",
    fields: [
      {
        key: "researchDevelopmentExpense",
        label: "研发费用",
        unit: "与营业收入同口径",
        min: 0,
        step: 0.01,
      },
      {
        key: "operatingRevenue",
        label: "营业收入",
        unit: "与研发费用同口径",
        min: 0.01,
        step: 0.01,
      },
    ],
  },
  {
    id: "tqi-004",
    label: "人均知识产权效率",
    sourceCategory: "专利与知识产权",
    formula: "知识产权拥有件数 /（研发人员数 / 100）",
    fields: [
      {
        key: "totalIntellectualProperty",
        label: "知识产权拥有件数",
        unit: "件",
        min: 0,
        step: 1,
      },
      {
        key: "researchStaffCount",
        label: "研发人员数",
        unit: "人",
        min: 1,
        step: 1,
      },
    ],
  },
  {
    id: "tqi-005",
    label: "技术合同成交额",
    sourceCategory: "商业转化",
    formula: "年度技术合同成交总额",
    fields: [
      {
        key: "technologyContractTransactionAmount",
        label: "年度技术合同成交总额",
        unit: "万元",
        min: 0,
        step: 0.01,
      },
    ],
  },
  {
    id: "tqi-006",
    label: "年报技术风险关键词密度",
    sourceCategory: "年报文本",
    formula: "词典提取 + LLM/FinBERT 负面情感概率",
    fields: [
      {
        key: "annualReportRiskNegativeProbability",
        label: "负面情感概率",
        unit: "0–1",
        min: 0,
        max: 1,
        step: 0.001,
      },
    ],
  },
]

const calibrationDefinitions: CalibrationDefinition[] = [
  {
    id: "tqc-001",
    label: "论文发表数量",
    sourceCategory: "论文与研究",
    formula: "年度 SCI/核心期刊论文数",
    threshold: "低风险 >20 篇 · 中风险 5–20 篇 · 高风险 <5 篇",
    fields: [
      {
        key: "papersPublished",
        label: "年度 SCI/核心期刊论文数",
        unit: "篇",
        min: 0,
        step: 1,
      },
    ],
  },
  {
    id: "tqc-002",
    label: "专利申请数量",
    sourceCategory: "专利与知识产权",
    formula: "累计发明专利申请量",
    threshold: "低风险 >50 件 · 中风险 10–50 件 · 高风险 <10 件",
    fields: [
      {
        key: "patentApplications",
        label: "累计发明专利申请量",
        unit: "件",
        min: 0,
        step: 1,
      },
    ],
  },
  {
    id: "tqc-003",
    label: "专利授权率",
    sourceCategory: "专利与知识产权",
    formula: "累计发明专利授权量 / 累计发明专利申请量 × 100%",
    threshold: "低风险 >60% · 中风险 30–60% · 高风险 <30%",
    fields: [
      {
        key: "patentGrants",
        label: "累计发明专利授权量",
        unit: "件",
        min: 0,
        step: 1,
      },
      {
        key: "patentApplications",
        label: "累计发明专利申请量",
        unit: "件",
        min: 1,
        step: 1,
      },
    ],
  },
  {
    id: "tqc-004",
    label: "研发投入强度",
    sourceCategory: "研发投入",
    formula: "研发费用 / 营业收入 × 100%",
    threshold: "低风险 >15% · 中风险 5–15% · 高风险 <5%",
    fields: [
      {
        key: "researchDevelopmentExpense",
        label: "研发费用",
        unit: "与营业收入同口径",
        min: 0,
        step: 0.01,
      },
      {
        key: "operatingRevenue",
        label: "营业收入",
        unit: "与研发费用同口径",
        min: 0.01,
        step: 0.01,
      },
    ],
  },
  {
    id: "tqc-005",
    label: "无形资产占净资产比",
    sourceCategory: "财务结构",
    formula: "无形资产 / 净资产 × 100%",
    threshold: null,
    fields: [
      {
        key: "intangibleAssets",
        label: "无形资产",
        unit: "与净资产同口径",
        min: 0,
        step: 0.01,
      },
      {
        key: "netAssets",
        label: "净资产",
        unit: "与无形资产同口径",
        min: 0.01,
        step: 0.01,
      },
    ],
  },
  {
    id: "tqc-006",
    label: "技术成熟度（TRL）",
    sourceCategory: "技术成熟度",
    formula: "当前技术成熟度等级",
    threshold: "低风险 ≥7 级 · 中风险 4–6 级 · 高风险 ≤3 级",
    fields: [
      {
        key: "currentTrl",
        label: "当前技术成熟度（TRL）",
        unit: "级",
        min: 1,
        max: 9,
        step: 1,
      },
    ],
  },
  {
    id: "tqc-007",
    label: "核心技术产品收入占比",
    sourceCategory: "商业转化",
    formula: "核心技术产品收入 / 营业收入 × 100%",
    threshold: "低风险 >70% · 中风险 30–70% · 高风险 <30%",
    fields: [
      {
        key: "coreTechnologyProductRevenue",
        label: "核心技术产品收入",
        unit: "与营业收入同口径",
        min: 0,
        step: 0.01,
      },
      {
        key: "operatingRevenue",
        label: "营业收入",
        unit: "与产品收入同口径",
        min: 0.01,
        step: 0.01,
      },
    ],
  },
  {
    id: "tqc-008",
    label: "技术风险负面情感概率",
    sourceCategory: "年报文本",
    formula: "词典提取 + LLM/FinBERT 负面情感概率",
    threshold: "低风险 <0.2 · 中风险 0.2–0.5 · 高风险 >0.5",
    fields: [
      {
        key: "annualReportRiskNegativeProbability",
        label: "负面情感概率",
        unit: "0–1",
        min: 0,
        max: 1,
        step: 0.001,
      },
    ],
  },
]

const allDefinitions = [...definitions, ...calibrationDefinitions]

function createRequest(
  detail: CompanyDetail,
  existing?: TechnologyBaselineQuantificationRequest | null
): TechnologyBaselineQuantificationRequest {
  if (existing?.companyId === detail.id) {
    return existing
  }

  return {
    companyId: detail.id,
    period: detail.snapshotAt.slice(0, 4),
    asOfDate: detail.snapshotAt.slice(0, 10),
    lifecycleStage: "growth",
    values: {},
    evidence: [],
  }
}

function createEvidenceDrafts(
  request: TechnologyBaselineQuantificationRequest
) {
  return Object.fromEntries(
    allDefinitions.map((definition) => {
      const reference = request.evidence.find(
        (item) => item.indicatorId === definition.id
      )
      return [
        definition.id,
        {
          evidenceId: reference?.evidenceId ?? "",
          locator: reference?.locator ?? "",
          inferenceBasis: reference?.inferenceBasis ?? "",
        } satisfies EvidenceDraft,
      ]
    })
  ) as Record<TechnologyBaselineMetricId, EvidenceDraft>
}

function isEligibleStrength(
  supportStrength: EvidenceSupportStrength | undefined
) {
  return supportStrength === "direct" || supportStrength === "inferred"
}

function getResultLabel(status: string) {
  const labels: Record<string, string> = {
    calculated: "已量化",
    missing: "待补原始值",
    "ineligible-evidence": "证据待补",
    "invalid-input": "输入无效",
  }
  return labels[status] ?? "待量化"
}

function getResultBadgeClass(status: string | undefined) {
  if (status === "calculated") {
    return "status-success"
  }
  if (status === "invalid-input") {
    return "status-danger"
  }
  if (status === "ineligible-evidence") {
    return "status-warning"
  }
  return "status-neutral"
}

function getRiskBandLabel(riskBand: "low" | "medium" | "high" | null) {
  if (riskBand === "low") {
    return "低风险"
  }
  if (riskBand === "medium") {
    return "中风险"
  }
  if (riskBand === "high") {
    return "高风险"
  }
  return "待阈值"
}

function getRiskBandClass(riskBand: "low" | "medium" | "high" | null) {
  if (riskBand === "low") {
    return "status-success"
  }
  if (riskBand === "medium") {
    return "status-warning"
  }
  if (riskBand === "high") {
    return "status-danger"
  }
  return "status-neutral"
}

export function TechnologyBaselinePanel({
  detail,
  companyState,
  storageWarning,
  onSaveDraft,
  onQuantify,
  onClear,
}: TechnologyBaselinePanelProps) {
  const [request, setRequest] = useState(() =>
    createRequest(detail, companyState?.baselineDraftRequest)
  )
  const [evidenceDrafts, setEvidenceDrafts] = useState(() =>
    createEvidenceDrafts(
      createRequest(detail, companyState?.baselineDraftRequest)
    )
  )
  const [runState, setRunState] = useState<
    "idle" | "running" | "success" | "error"
  >("idle")
  const [message, setMessage] = useState("")

  const latestResult = companyState?.latestBaselineResult ?? null
  const eligibleEvidence = useMemo(
    () =>
      detail.evidence.filter(
        (evidence) =>
          !isCandidateDataSource(evidence.sourceName) &&
          isEligibleStrength(evidence.supportStrength)
      ),
    [detail.evidence]
  )
  const evidenceById = useMemo(
    () => new Map(detail.evidence.map((evidence) => [evidence.id, evidence])),
    [detail.evidence]
  )
  const lifecycleLabel =
    lifecycleOptions.find((item) => item.value === request.lifecycleStage)
      ?.label ?? "未选择"
  const totalLifecycleWeight =
    request.lifecycleStage === "startup"
      ? 30
      : request.lifecycleStage === "growth"
        ? 25
        : 20
  const quantifiedCount = latestResult?.quantifiedIndicatorCount ?? 0
  const quantifiedWeight = latestResult?.quantifiedWeight ?? 0
  const calibratedCount = latestResult?.calibratedIndicatorCount ?? 0

  const updateValue = (key: keyof TechnologyBaselineValues, value: string) => {
    setRequest((current) => ({
      ...current,
      values: {
        ...current.values,
        [key]: value.trim() === "" ? undefined : Number(value),
      },
    }))
    setRunState("idle")
    setMessage("")
  }

  const updateEvidence = (
    indicatorId: TechnologyBaselineMetricId,
    patch: Partial<EvidenceDraft>
  ) => {
    setEvidenceDrafts((current) => ({
      ...current,
      [indicatorId]: {
        ...current[indicatorId],
        ...patch,
      },
    }))
    setRunState("idle")
    setMessage("")
  }

  const buildRequest = (): TechnologyBaselineQuantificationRequest => ({
    ...request,
    evidence: allDefinitions.flatMap((definition) => {
      const draft = evidenceDrafts[definition.id]
      const evidence = evidenceById.get(draft.evidenceId)
      if (!evidence) {
        return []
      }

      return [
        {
          indicatorId: definition.id,
          evidenceId: evidence.id,
          locator: draft.locator.trim(),
          supportStrength: evidence.supportStrength ?? "pending",
          inferenceBasis:
            evidence.supportStrength === "inferred"
              ? draft.inferenceBasis.trim()
              : undefined,
        },
      ]
    }),
  })

  const validateReadyIndicators = () => {
    for (const definition of allDefinitions) {
      const startedFields = definition.fields.filter(
        (field) => request.values[field.key] !== undefined
      )
      if (startedFields.length === 0) {
        continue
      }
      if (startedFields.length !== definition.fields.length) {
        const missingFields = definition.fields
          .filter((field) => request.values[field.key] === undefined)
          .map((field) => field.label)
          .join("、")
        return `“${definition.label}”已开始录入，请补全：${missingFields}。`
      }

      const draft = evidenceDrafts[definition.id]
      const evidence = evidenceById.get(draft.evidenceId)
      if (!evidence || !isEligibleStrength(evidence.supportStrength)) {
        return `“${definition.label}”已录入原始值，请绑定直接披露或具完整推导依据的证据。`
      }
      if (!draft.locator.trim()) {
        return `请填写“${definition.label}”证据的页码、章节或表格位置。`
      }
      if (
        evidence.supportStrength === "inferred" &&
        !draft.inferenceBasis.trim()
      ) {
        return `“${definition.label}”使用推导证据时，必须补充完整推导依据。`
      }
    }

    return null
  }

  const handleSave = () => {
    const saved = onSaveDraft(buildRequest())
    setRunState(saved ? "success" : "error")
    setMessage(
      saved
        ? "技术原始量化草稿已保存到当前浏览器。"
        : "草稿已在当前页面生效，但浏览器无法保存本次修改。"
    )
  }

  const handleQuantify = async () => {
    const validationError = validateReadyIndicators()
    if (validationError) {
      setRunState("error")
      setMessage(validationError)
      return
    }

    setRunState("running")
    setMessage("")
    try {
      const result = await onQuantify(buildRequest())
      setRunState("success")
      setMessage(
        `已完成正式量化 ${result.quantifiedIndicatorCount}/6 项、专项校准 ${result.calibratedIndicatorCount}/8 项；专项阈值仅用于单项观测，本次不会更新技术风险分或雷达图。`
      )
    } catch (error) {
      setRunState("error")
      setMessage(
        error instanceof Error
          ? error.message
          : "技术原始量化暂时不可用，请稍后重试。"
      )
    }
  }

  const handleClear = () => {
    if (!window.confirm(`确认清除 ${detail.name} 的技术原始量化草稿和结果吗？`)) {
      return
    }

    const saved = onClear()
    const initial = createRequest(detail)
    setRequest(initial)
    setEvidenceDrafts(createEvidenceDrafts(initial))
    setRunState(saved ? "success" : "error")
    setMessage(
      saved
        ? "已清除当前企业的技术原始量化数据。"
        : "数据已在当前页面清除，但浏览器无法保存本次修改。"
    )
  }

  return (
    <section
      className="technology-baseline-workspace"
      aria-labelledby="technology-baseline-title"
    >
      <div className="technology-baseline-heading">
        <div>
          <div className="technology-baseline-kicker">
            <Badge variant="outline" className="status-badge status-info">
              <ClipboardCheckIcon aria-hidden="true" />
              Excel 正式口径
            </Badge>
            <span>TQB-2026.07-v5</span>
          </div>
          <h2 id="technology-baseline-title">技术量化与专项校准</h2>
          <p>
            依据《2026_07_21风险指标体系》保留六项正式技术量化，并将技术专表中已有阈值的观测项自动映射为单项风险档位。专项校准不生成综合分，也不会替代正式技术风险评分。
          </p>
        </div>
        <div className="technology-baseline-actions">
          <Button variant="outline" onClick={handleClear}>
            <RotateCcwIcon data-icon="inline-start" />
            清除量化
          </Button>
        </div>
      </div>

      {storageWarning ? (
        <div className="scoring-storage-warning" role="status">
          {storageWarning}
        </div>
      ) : null}

      <LiquidGlassSurface
        variant="card"
        refractive
        className="technology-baseline-summary-glass"
        padding="0"
      >
        <div className="technology-baseline-summary">
          <article>
            <div>
              <FileSearchIcon aria-hidden="true" />
              正式指标
            </div>
            <strong>6 项</strong>
            <p>只保留 Excel 已定义名称和公式</p>
          </article>
          <article>
            <div>
              <CalculatorIcon aria-hidden="true" />
              已量化
            </div>
            <strong>{quantifiedCount}/6</strong>
            <p>原始值、证据和精确定位齐全</p>
          </article>
          <article>
            <div>
              <ClipboardCheckIcon aria-hidden="true" />
              专项校准
            </div>
            <strong>{calibratedCount}/8</strong>
            <p>
              7 项阈值映射 + 1 项公式观测
            </p>
          </article>
          <article>
            <div>
              <ScaleIcon aria-hidden="true" />
              雷达图口径
            </div>
            <strong>{lifecycleLabel}</strong>
            <p>
              正式量化权重 {quantifiedWeight}/{totalLifecycleWeight}；专项校准不写入雷达图
            </p>
          </article>
        </div>
      </LiquidGlassSurface>

      <div className="technology-baseline-meta">
        <label className="scoring-field">
          <span>量化期间</span>
          <Input
            value={request.period}
            onChange={(event) => {
              setRequest((current) => ({
                ...current,
                period: event.target.value,
              }))
              setRunState("idle")
              setMessage("")
            }}
            placeholder="例如 2025"
          />
        </label>
        <label className="scoring-field">
          <span>数据截止日期</span>
          <Input
            type="date"
            value={request.asOfDate}
            onChange={(event) => {
              setRequest((current) => ({
                ...current,
                asOfDate: event.target.value,
              }))
              setRunState("idle")
              setMessage("")
            }}
          />
        </label>
        <label className="scoring-field">
          <span>企业生命周期</span>
          <select
            className="technology-baseline-select"
            value={request.lifecycleStage}
            onChange={(event) => {
              setRequest((current) => ({
                ...current,
                lifecycleStage: event.target
                  .value as TechnologyBaselineLifecycleStage,
              }))
              setRunState("idle")
              setMessage("")
            }}
          >
            {lifecycleOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="technology-baseline-list">
        <section
          className="technology-baseline-group"
          aria-labelledby="technology-baseline-official"
        >
          <header className="technology-baseline-group-heading">
            <div>
              <span id="technology-baseline-official">正式原始量化指标</span>
              <p>
                每一项都需先填全公式输入，再绑定直接披露或具完整推导链的证据。背景材料、待核验和候选来源不会参与量化。
              </p>
            </div>
            <strong>6 项</strong>
          </header>

          {definitions.map((definition) => {
            const result = latestResult?.indicatorResults.find(
              (item) => item.indicatorId === definition.id
            )
            const draft = evidenceDrafts[definition.id]
            const selectedEvidence = evidenceById.get(draft.evidenceId)
            const lifecycleWeight =
              lifecycleWeights[request.lifecycleStage][definition.id]

            return (
              <article key={definition.id} className="technology-baseline-row">
                <div className="technology-baseline-row-heading">
                  <div>
                    <span>
                      {definition.sourceCategory} · {definition.id.toUpperCase()}
                    </span>
                    <h3>{definition.label}</h3>
                  </div>
                  <div className="technology-baseline-row-badges">
                    <Badge
                      variant="outline"
                      className="status-badge status-info"
                    >
                      生命周期权重 {lifecycleWeight}%
                    </Badge>
                    <Badge
                      variant="outline"
                      className={cn(
                        "status-badge",
                        getResultBadgeClass(result?.status)
                      )}
                    >
                      {result ? getResultLabel(result.status) : "待量化"}
                    </Badge>
                  </div>
                </div>
                <p className="technology-baseline-formula">{definition.formula}</p>

                <div className="technology-baseline-inputs">
                  {definition.fields.map((field) => (
                    <label key={field.key} className="scoring-field">
                      <span>{field.label}</span>
                      <div className="technology-baseline-number">
                        <Input
                          type="number"
                          min={field.min}
                          max={field.max}
                          step={field.step}
                          value={
                            request.values[field.key] === undefined
                              ? ""
                              : String(request.values[field.key])
                          }
                          onChange={(event) =>
                            updateValue(field.key, event.target.value)
                          }
                          aria-label={`${definition.label}：${field.label}`}
                        />
                        <small>{field.unit}</small>
                      </div>
                    </label>
                  ))}
                </div>

                <div className="technology-baseline-evidence">
                  <label className="scoring-field">
                    <span>支持证据</span>
                    <select
                      className="technology-baseline-select"
                      value={draft.evidenceId}
                      onChange={(event) =>
                        updateEvidence(definition.id, {
                          evidenceId: event.target.value,
                          locator: "",
                          inferenceBasis: "",
                        })
                      }
                    >
                      <option value="">选择直接或推导证据</option>
                      {eligibleEvidence.map((evidence) => (
                        <option key={evidence.id} value={evidence.id}>
                          {evidence.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="scoring-field">
                    <span>精确定位</span>
                    <Input
                      value={draft.locator}
                      onChange={(event) =>
                        updateEvidence(definition.id, {
                          locator: event.target.value,
                        })
                      }
                      placeholder="页码、章节或表格位置"
                    />
                  </label>
                  {selectedEvidence ? (
                    <div className="technology-baseline-evidence-note">
                      <SupportBadge strength={selectedEvidence.supportStrength} />
                      <span>{selectedEvidence.sourceName}</span>
                    </div>
                  ) : (
                    <div className="technology-baseline-evidence-note">
                      <span>
                        {eligibleEvidence.length === 0
                          ? "当前企业没有可用于量化的已治理证据。"
                          : "选择证据后填写页码、章节或表格位置。"}
                      </span>
                    </div>
                  )}
                  {selectedEvidence?.supportStrength === "inferred" ? (
                    <label className="scoring-field technology-baseline-inference">
                      <span>推导依据</span>
                      <Input
                        value={draft.inferenceBasis}
                        onChange={(event) =>
                          updateEvidence(definition.id, {
                            inferenceBasis: event.target.value,
                          })
                        }
                        placeholder="说明原始披露与该数值之间的推导链"
                      />
                    </label>
                  ) : null}
                </div>

                {result ? (
                  <div className="technology-baseline-result">
                    <div>
                      <strong>
                        {result.status === "calculated"
                          ? result.displayValue
                          : getResultLabel(result.status)}
                      </strong>
                      <span>{result.formulaTrace}</span>
                    </div>
                    {result.validationErrors.length > 0 ? (
                      <small>{result.validationErrors.join("；")}</small>
                    ) : null}
                  </div>
                ) : null}
              </article>
            )
          })}
        </section>

        <section
          className="technology-baseline-group"
          aria-labelledby="technology-baseline-calibration"
        >
          <header className="technology-baseline-group-heading">
            <div>
              <span id="technology-baseline-calibration">技术专表专项校准</span>
              <p>
                7 项采用技术专表既有阈值自动映射为低、中、高风险及 25/60/85 标准分；无形资产占净资产比只保留公式观测。相同原始字段会与正式量化同步，但每项仍需保留自己的证据定位。
              </p>
            </div>
            <strong>8 项</strong>
          </header>

          {calibrationDefinitions.map((definition) => {
            const result = latestResult?.calibrationIndicatorResults.find(
              (item) => item.indicatorId === definition.id
            )
            const draft = evidenceDrafts[definition.id]
            const selectedEvidence = evidenceById.get(draft.evidenceId)

            return (
              <article key={definition.id} className="technology-baseline-row">
                <div className="technology-baseline-row-heading">
                  <div>
                    <span>
                      {definition.sourceCategory} · {definition.id.toUpperCase()}
                    </span>
                    <h3>{definition.label}</h3>
                  </div>
                  <div className="technology-baseline-row-badges">
                    <Badge
                      variant="outline"
                      className={cn(
                        "status-badge",
                        getResultBadgeClass(result?.status)
                      )}
                    >
                      {result ? getResultLabel(result.status) : "待校准"}
                    </Badge>
                    {definition.threshold ? (
                      <Badge
                        variant="outline"
                        className={cn(
                          "status-badge",
                          getRiskBandClass(result?.riskBand ?? null)
                        )}
                      >
                        {getRiskBandLabel(result?.riskBand ?? null)}
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="status-badge status-info">
                        公式观测
                      </Badge>
                    )}
                  </div>
                </div>
                <p className="technology-baseline-formula">{definition.formula}</p>
                {definition.threshold ? (
                  <p className="technology-baseline-calibration-note">
                    {definition.threshold}
                  </p>
                ) : (
                  <p className="technology-baseline-calibration-note">
                    技术专表未给出可审计阈值：本项只展示公式结果，不生成风险档位或标准分。
                  </p>
                )}

                <div className="technology-baseline-inputs">
                  {definition.fields.map((field) => (
                    <label key={field.key} className="scoring-field">
                      <span>{field.label}</span>
                      <div className="technology-baseline-number">
                        <Input
                          type="number"
                          min={field.min}
                          max={field.max}
                          step={field.step}
                          value={
                            request.values[field.key] === undefined
                              ? ""
                              : String(request.values[field.key])
                          }
                          onChange={(event) =>
                            updateValue(field.key, event.target.value)
                          }
                          aria-label={`${definition.label}：${field.label}`}
                        />
                        <small>{field.unit}</small>
                      </div>
                    </label>
                  ))}
                </div>

                <div className="technology-baseline-evidence">
                  <label className="scoring-field">
                    <span>支持证据</span>
                    <select
                      className="technology-baseline-select"
                      value={draft.evidenceId}
                      onChange={(event) =>
                        updateEvidence(definition.id, {
                          evidenceId: event.target.value,
                          locator: "",
                          inferenceBasis: "",
                        })
                      }
                    >
                      <option value="">选择直接或推导证据</option>
                      {eligibleEvidence.map((evidence) => (
                        <option key={evidence.id} value={evidence.id}>
                          {evidence.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="scoring-field">
                    <span>精确定位</span>
                    <Input
                      value={draft.locator}
                      onChange={(event) =>
                        updateEvidence(definition.id, {
                          locator: event.target.value,
                        })
                      }
                      placeholder="页码、章节或表格位置"
                    />
                  </label>
                  {selectedEvidence ? (
                    <div className="technology-baseline-evidence-note">
                      <SupportBadge strength={selectedEvidence.supportStrength} />
                      <span>{selectedEvidence.sourceName}</span>
                    </div>
                  ) : (
                    <div className="technology-baseline-evidence-note">
                      <span>
                        {eligibleEvidence.length === 0
                          ? "当前企业没有可用于量化的已治理证据。"
                          : "选择证据后填写页码、章节或表格位置。"}
                      </span>
                    </div>
                  )}
                  {selectedEvidence?.supportStrength === "inferred" ? (
                    <label className="scoring-field technology-baseline-inference">
                      <span>推导依据</span>
                      <Input
                        value={draft.inferenceBasis}
                        onChange={(event) =>
                          updateEvidence(definition.id, {
                            inferenceBasis: event.target.value,
                          })
                        }
                        placeholder="说明原始披露与该数值之间的推导链"
                      />
                    </label>
                  ) : null}
                </div>

                {result ? (
                  <div className="technology-baseline-result">
                    <div>
                      <strong>
                        {result.status === "calculated"
                          ? result.displayValue
                          : getResultLabel(result.status)}
                      </strong>
                      <span>{result.formulaTrace}</span>
                    </div>
                    {result.status === "calculated" && result.riskBand ? (
                      <div className="technology-baseline-result-badges">
                        <Badge
                          variant="outline"
                          className={cn(
                            "status-badge",
                            getRiskBandClass(result.riskBand)
                          )}
                        >
                          {getRiskBandLabel(result.riskBand)}
                        </Badge>
                        <Badge variant="outline" className="status-badge status-info">
                          标准分 {result.standardizedRiskScore}
                        </Badge>
                      </div>
                    ) : null}
                    {result.thresholdTrace ? (
                      <p className="technology-baseline-threshold">
                        {result.thresholdTrace}
                      </p>
                    ) : null}
                    {result.validationErrors.length > 0 ? (
                      <small>{result.validationErrors.join("；")}</small>
                    ) : null}
                  </div>
                ) : null}
              </article>
            )
          })}
        </section>
      </div>

      <div className="technology-baseline-submit">
        <div>
          {runState === "running" ? (
            <LoaderCircleIcon className="animate-spin" aria-hidden="true" />
          ) : (
            <CalculatorIcon aria-hidden="true" />
          )}
          <span role={message ? "status" : undefined}>
            {message ||
              "运行后保存公式轨迹、证据绑定和专项阈值结果；只有已复核的正式技术评分会进入雷达图。"}
          </span>
        </div>
        <div>
          <Button
            variant="outline"
            onClick={handleSave}
            disabled={runState === "running"}
          >
            <SaveIcon data-icon="inline-start" />
            保存草稿
          </Button>
          <Button onClick={handleQuantify} disabled={runState === "running"}>
            <CalculatorIcon data-icon="inline-start" />
            运行量化与校准
          </Button>
        </div>
      </div>

      <p className="technology-baseline-disclaimer">
        {latestResult?.disclaimer ||
          "当前版本仅将技术专表中已给出的单项阈值用于专项校准。专项校准不自动构成综合风险结论；正式技术评分与雷达图仍需按 KTR 方法完成证据审查与人工复核。"}
      </p>
    </section>
  )
}
