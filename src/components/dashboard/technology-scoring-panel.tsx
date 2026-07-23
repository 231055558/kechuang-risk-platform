import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react"
import {
  AlertTriangleIcon,
  CalculatorIcon,
  CheckCircle2Icon,
  CircleDashedIcon,
  DatabaseZapIcon,
  FileCheck2Icon,
  GaugeIcon,
  LoaderCircleIcon,
  PencilIcon,
  PlusIcon,
  RotateCcwIcon,
  ServerCogIcon,
  ShieldAlertIcon,
  Trash2Icon,
} from "lucide-react"

import { SupportBadge } from "@/components/dashboard/shared"
import { LiquidGlassSurface } from "@/components/liquid"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { isCandidateDataSource } from "@/lib/source-governance"
import { cn } from "@/lib/utils"
import type {
  CompanyDetail,
  EvidenceItem,
  TechnologyIncidentInput,
  TechnologyRiskEvidenceReference,
  TechnologyRiskIndicatorId,
  TechnologyRiskScoreRequest,
  TechnologyRiskScoreResult,
  TechnologyScoringCompanyState,
} from "@/types/risk"

type TechnologyScoringPanelProps = {
  detail: CompanyDetail
  companyState?: TechnologyScoringCompanyState
  storageWarning: string
  createToken: number
  onCreateRequestHandled: () => void
  onSaveDraft: (request: TechnologyRiskScoreRequest) => boolean
  onScore: (
    request: TechnologyRiskScoreRequest
  ) => Promise<TechnologyRiskScoreResult>
  onClear: () => boolean
}

type NumberField = {
  key: string
  label: string
  kind: "number"
  unit?: string
  min: number
  max?: number
  step?: number
  integer?: boolean
  hint?: string
}

type BooleanField = {
  key: string
  label: string
  kind: "boolean"
  hint?: string
}

type IndicatorField = NumberField | BooleanField

type IndicatorDefinition = {
  id: TechnologyRiskIndicatorId
  label: string
  group: string
  weight: number
  description: string
  fields: IndicatorField[]
}

type EditorValue = string | boolean
type EditorValues = Record<string, EditorValue>
type EvidenceDraft = {
  selected: boolean
  locator: string
  inferenceBasis: string
}
type EvidenceDraftMap = Record<string, EvidenceDraft>

const indicatorDefinitions: IndicatorDefinition[] = [
  {
    id: "kci-006",
    label: "核心技术性能行业分位",
    group: "技术先进性",
    weight: 10,
    description: "统一工况、标准和产品代际后，记录核心性能的行业百分位。",
    fields: [
      {
        key: "industryPercentile",
        label: "行业百分位",
        kind: "number",
        unit: "%",
        min: 0,
        max: 100,
        hint: "0-100，数值越高代表技术能力越强。",
      },
    ],
  },
  {
    id: "kci-007",
    label: "核心论文质量与技术转化关联",
    group: "技术先进性",
    weight: 8,
    description: "同时核验研究质量、专利关联和产品或样机转化。",
    fields: [
      {
        key: "citationImpactScore",
        label: "引用影响力得分",
        kind: "number",
        unit: "分",
        min: 0,
        max: 100,
      },
      {
        key: "topResearchQualityScore",
        label: "高质量研究得分",
        kind: "number",
        unit: "分",
        min: 0,
        max: 100,
      },
      {
        key: "patentLinkageScore",
        label: "论文专利关联得分",
        kind: "number",
        unit: "分",
        min: 0,
        max: 100,
      },
      {
        key: "productConversionScore",
        label: "产品转化得分",
        kind: "number",
        unit: "分",
        min: 0,
        max: 100,
      },
      {
        key: "noCorePaperThreeYears",
        label: "连续三年无核心论文",
        kind: "boolean",
      },
      {
        key: "unableToMapCoreTechnology",
        label: "论文无法映射核心技术",
        kind: "boolean",
      },
    ],
  },
  {
    id: "kci-008",
    label: "核心专利质量与技术壁垒",
    group: "技术先进性",
    weight: 9,
    description: "评价专利族、权利稳定性和对主营技术的真实覆盖。",
    fields: [
      {
        key: "forwardCitationScore",
        label: "前向引用得分",
        kind: "number",
        unit: "分",
        min: 0,
        max: 100,
      },
      {
        key: "patentFamilyScore",
        label: "专利族布局得分",
        kind: "number",
        unit: "分",
        min: 0,
        max: 100,
      },
      {
        key: "claimAndLegalScore",
        label: "权利与法律状态得分",
        kind: "number",
        unit: "分",
        min: 0,
        max: 100,
      },
      {
        key: "technologyCoverageScore",
        label: "技术覆盖得分",
        kind: "number",
        unit: "分",
        min: 0,
        max: 100,
      },
      {
        key: "widespreadCorePatentFailure",
        label: "核心专利大面积失效或无法覆盖主营产品",
        kind: "boolean",
      },
    ],
  },
  {
    id: "kci-009",
    label: "持续创新能力",
    group: "技术先进性",
    weight: 8,
    description: "结合研发投入同业位置和核心技术有效更新周期。",
    fields: [
      {
        key: "researchInvestmentPeerScore",
        label: "研发投入同业得分",
        kind: "number",
        unit: "分",
        min: 0,
        max: 100,
      },
      {
        key: "updateCyclePeerScore",
        label: "更新周期同业得分",
        kind: "number",
        unit: "分",
        min: 0,
        max: 100,
      },
      {
        key: "noEffectiveUpdateThreeYears",
        label: "核心技术连续三年无有效更新",
        kind: "boolean",
      },
    ],
  },
  {
    id: "kci-010",
    label: "技术成熟与阶段兑现度",
    group: "技术成熟度",
    weight: 20,
    description: "使用证据化 TRL 和滚动周期内关键节点兑现率共同判断。",
    fields: [
      {
        key: "currentTrl",
        label: "当前 TRL",
        kind: "number",
        unit: "级",
        min: 1,
        max: 9,
        integer: true,
      },
      {
        key: "targetTrl",
        label: "目标 TRL",
        kind: "number",
        unit: "级",
        min: 1,
        max: 9,
        integer: true,
      },
      {
        key: "dueMilestones",
        label: "到期关键节点数",
        kind: "number",
        unit: "个",
        min: 1,
        integer: true,
      },
      {
        key: "completedOnTimeMilestones",
        label: "按期完成节点数",
        kind: "number",
        unit: "个",
        min: 0,
        integer: true,
      },
      {
        key: "selfAssessedWithoutExperimentEvidence",
        label: "TRL 仅为自评且无实验或示范证据",
        kind: "boolean",
      },
    ],
  },
  {
    id: "kci-011",
    label: "工程化与商业转化率",
    group: "技术成熟度",
    weight: 15,
    description: "按项目去重，核验进入中试、客户验收、量产或持续运营的比例。",
    fields: [
      {
        key: "completedProjects",
        label: "已完成研发项目数",
        kind: "number",
        unit: "个",
        min: 1,
        integer: true,
      },
      {
        key: "convertedProjects",
        label: "已转化项目数",
        kind: "number",
        unit: "个",
        min: 0,
        integer: true,
      },
    ],
  },
  {
    id: "kci-012",
    label: "独立验证与关键测试有效性",
    group: "技术可靠和安全性",
    weight: 18,
    description: "按证据独立性加权，并核验关键功能、可靠性与安全测试。",
    fields: [
      {
        key: "criticalItemCount",
        label: "关键项总数",
        kind: "number",
        unit: "项",
        min: 1,
        integer: true,
      },
      {
        key: "thirdPartyCoveredItems",
        label: "第三方覆盖项数",
        kind: "number",
        unit: "项",
        min: 0,
        integer: true,
      },
      {
        key: "customerCoveredItems",
        label: "客户覆盖项数",
        kind: "number",
        unit: "项",
        min: 0,
        integer: true,
      },
      {
        key: "independentInternalCoveredItems",
        label: "独立内部质量团队覆盖项数",
        kind: "number",
        unit: "项",
        min: 0,
        integer: true,
      },
      {
        key: "selfTestCoveredItems",
        label: "研发自测覆盖项数",
        kind: "number",
        unit: "项",
        min: 0,
        integer: true,
      },
      {
        key: "requiredCriticalTests",
        label: "应执行关键测试数",
        kind: "number",
        unit: "项",
        min: 1,
        integer: true,
      },
      {
        key: "passedCriticalTests",
        label: "通过关键测试数",
        kind: "number",
        unit: "项",
        min: 0,
        integer: true,
      },
      {
        key: "mandatoryOrSafetyTestFailure",
        label: "存在强制或安全关键测试失败",
        kind: "boolean",
      },
    ],
  },
  {
    id: "kci-013",
    label: "关键技术外部依赖度",
    group: "技术可靠和安全性",
    weight: 12,
    description: "按高影响模块双倍权重，评价不可替代外部依赖和供应中断风险。",
    fields: [
      {
        key: "standardCriticalModules",
        label: "标准关键模块数",
        kind: "number",
        unit: "个",
        min: 0,
        integer: true,
      },
      {
        key: "highImpactCriticalModules",
        label: "高影响关键模块数",
        kind: "number",
        unit: "个",
        min: 0,
        integer: true,
      },
      {
        key: "irreplaceableExternalStandardModules",
        label: "不可替代外部标准模块数",
        kind: "number",
        unit: "个",
        min: 0,
        integer: true,
      },
      {
        key: "irreplaceableExternalHighImpactModules",
        label: "不可替代外部高影响模块数",
        kind: "number",
        unit: "个",
        min: 0,
        integer: true,
      },
      {
        key: "highImpactSingleSource",
        label: "存在不可替代高影响单一来源",
        kind: "boolean",
      },
      {
        key: "exportRestriction",
        label: "存在出口限制",
        kind: "boolean",
      },
      {
        key: "nonRenewableCriticalLicense",
        label: "关键许可证不可续期",
        kind: "boolean",
      },
    ],
  },
]

const indicatorDefinitionMap = new Map(
  indicatorDefinitions.map((definition) => [definition.id, definition])
)

function createEmptyRequest(companyId: string): TechnologyRiskScoreRequest {
  return {
    companyId,
    period: "",
    asOfDate: new Date().toISOString().slice(0, 10),
    indicators: {},
    incidents: [],
  }
}

function normalizeRequest(
  companyId: string,
  request: TechnologyRiskScoreRequest | null | undefined
) {
  if (!request || request.companyId !== companyId) {
    return createEmptyRequest(companyId)
  }

  return {
    ...request,
    indicators: { ...request.indicators },
    incidents: [...(request.incidents ?? [])],
  }
}

function createLocalId(prefix: string) {
  if (
    typeof globalThis.crypto !== "undefined" &&
    typeof globalThis.crypto.randomUUID === "function"
  ) {
    return `${prefix}-${globalThis.crypto.randomUUID()}`
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function isEvidenceEligible(evidence: EvidenceItem) {
  return (
    !isCandidateDataSource(evidence.sourceName) &&
    (evidence.supportStrength === "direct" ||
      evidence.supportStrength === "inferred")
  )
}

function emptyEvidenceDraft(): EvidenceDraft {
  return {
    selected: false,
    locator: "",
    inferenceBasis: "",
  }
}

function resultTone(score: number | null) {
  if (score === null) return "status-neutral"
  if (score >= 75) return "status-danger"
  if (score >= 60) return "status-warning"
  if (score >= 40) return "status-info"
  return "status-success"
}

function formatDateTime(value: string | undefined) {
  if (!value) return "尚未运行"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
}

function getIndicatorInput(
  request: TechnologyRiskScoreRequest,
  indicatorId: TechnologyRiskIndicatorId
) {
  const input = request.indicators[indicatorId]
  if (!input) {
    return undefined
  }

  return {
    evidence: input.evidence,
    values: input.values as unknown as Record<string, number | boolean>,
  }
}

export function TechnologyScoringPanel({
  detail,
  companyState,
  storageWarning,
  createToken,
  onCreateRequestHandled,
  onSaveDraft,
  onScore,
  onClear,
}: TechnologyScoringPanelProps) {
  const [request, setRequest] = useState(() =>
    normalizeRequest(detail.id, companyState?.draftRequest)
  )
  const [indicatorDialogOpen, setIndicatorDialogOpen] = useState(false)
  const [selectedIndicatorId, setSelectedIndicatorId] =
    useState<TechnologyRiskIndicatorId>("kci-006")
  const [editorValues, setEditorValues] = useState<EditorValues>({})
  const [evidenceDrafts, setEvidenceDrafts] = useState<EvidenceDraftMap>({})
  const [indicatorError, setIndicatorError] = useState("")
  const [incidentDialogOpen, setIncidentDialogOpen] = useState(false)
  const [incidentId, setIncidentId] = useState("")
  const [incidentDescription, setIncidentDescription] = useState("")
  const [incidentDate, setIncidentDate] = useState("")
  const [incidentSeverity, setIncidentSeverity] = useState("")
  const [incidentResponsibility, setIncidentResponsibility] =
    useState<TechnologyIncidentInput["responsibility"]>("primary")
  const [incidentConcealed, setIncidentConcealed] = useState(false)
  const [incidentRepeated, setIncidentRepeated] = useState(false)
  const [incidentEvidenceDrafts, setIncidentEvidenceDrafts] =
    useState<EvidenceDraftMap>({})
  const [incidentError, setIncidentError] = useState("")
  const [runState, setRunState] = useState<
    "idle" | "saving" | "scoring" | "success" | "error"
  >("idle")
  const [panelMessage, setPanelMessage] = useState("")
  const lastCreateTokenRef = useRef(0)

  const latestResult = companyState?.latestResult ?? null
  const selectedDefinition =
    indicatorDefinitionMap.get(selectedIndicatorId) ?? indicatorDefinitions[0]
  const savedIndicatorIds = Object.keys(
    request.indicators
  ) as TechnologyRiskIndicatorId[]
  const configuredWeight = indicatorDefinitions
    .filter((definition) => savedIndicatorIds.includes(definition.id))
    .reduce((total, definition) => total + definition.weight, 0)
  const scoredCount =
    latestResult?.indicatorResults.filter((item) => item.status === "scored")
      .length ?? 0
  const resultByIndicator = useMemo(
    () =>
      new Map(
        (latestResult?.indicatorResults ?? []).map((result) => [
          result.indicatorId,
          result,
        ])
      ),
    [latestResult]
  )

  const updateEvidenceDraft = (
    evidenceId: string,
    patch: Partial<EvidenceDraft>
  ) => {
    setEvidenceDrafts((current) => ({
      ...current,
      [evidenceId]: {
        ...(current[evidenceId] ?? emptyEvidenceDraft()),
        ...patch,
      },
    }))
    setIndicatorError("")
  }

  const updateIncidentEvidenceDraft = (
    evidenceId: string,
    patch: Partial<EvidenceDraft>
  ) => {
    setIncidentEvidenceDrafts((current) => ({
      ...current,
      [evidenceId]: {
        ...(current[evidenceId] ?? emptyEvidenceDraft()),
        ...patch,
      },
    }))
    setIncidentError("")
  }

  const openIndicatorEditor = (indicatorId: TechnologyRiskIndicatorId) => {
    const definition =
      indicatorDefinitionMap.get(indicatorId) ?? indicatorDefinitions[0]
    const existing = getIndicatorInput(request, indicatorId)
    const values = Object.fromEntries(
      definition.fields.map((field) => {
        const existingValue = existing?.values[field.key]
        return [
          field.key,
          field.kind === "boolean"
            ? existingValue === true
            : typeof existingValue === "number"
              ? String(existingValue)
              : "",
        ]
      })
    ) as EditorValues
    const evidence = Object.fromEntries(
      detail.evidence.map((item) => {
        const reference = existing?.evidence.find(
          (candidate) => candidate.evidenceId === item.id
        )
        return [
          item.id,
          {
            selected: Boolean(reference),
            locator: reference?.locator ?? "",
            inferenceBasis: reference?.inferenceBasis ?? "",
          },
        ]
      })
    )

    setSelectedIndicatorId(indicatorId)
    setEditorValues(values)
    setEvidenceDrafts(evidence)
    setIndicatorError("")
    setIndicatorDialogOpen(true)
  }

  useEffect(() => {
    if (createToken === 0 || createToken <= lastCreateTokenRef.current) {
      return
    }
    lastCreateTokenRef.current = createToken
    const firstMissing =
      indicatorDefinitions.find(
        (definition) => !savedIndicatorIds.includes(definition.id)
      ) ?? indicatorDefinitions[0]
    openIndicatorEditor(firstMissing.id)
    onCreateRequestHandled()
    // The token is an explicit command issued by the overview CTA.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createToken, onCreateRequestHandled])

  const validateEvidenceDrafts = (drafts: EvidenceDraftMap) => {
    const selected = detail.evidence.filter(
      (evidence) => drafts[evidence.id]?.selected
    )
    if (selected.length === 0) {
      return "至少绑定一条直接披露或推导证据。"
    }
    for (const evidence of selected) {
      if (!isEvidenceEligible(evidence)) {
        return `“${evidence.title}”不满足评分证据准入规则。`
      }
      const draft = drafts[evidence.id]
      if (!draft?.locator.trim()) {
        return `请填写“${evidence.title}”的页码、章节或表格位置。`
      }
      if (
        evidence.supportStrength === "inferred" &&
        !draft.inferenceBasis.trim()
      ) {
        return `请补充“${evidence.title}”的完整推导依据。`
      }
    }
    return null
  }

  const buildEvidenceReferences = (
    drafts: EvidenceDraftMap
  ): TechnologyRiskEvidenceReference[] =>
    detail.evidence
      .filter((evidence) => drafts[evidence.id]?.selected)
      .map((evidence) => ({
        evidenceId: evidence.id,
        locator: drafts[evidence.id].locator.trim(),
        supportStrength: evidence.supportStrength ?? "pending",
        inferenceBasis:
          evidence.supportStrength === "inferred"
            ? drafts[evidence.id].inferenceBasis.trim()
            : undefined,
      }))

  const saveIndicator = () => {
    const values: Record<string, number | boolean> = {}
    for (const field of selectedDefinition.fields) {
      const value = editorValues[field.key]
      if (field.kind === "boolean") {
        values[field.key] = value === true
        continue
      }
      if (typeof value !== "string" || !value.trim()) {
        setIndicatorError(`请填写“${field.label}”。`)
        return
      }
      const parsed = Number(value)
      if (!Number.isFinite(parsed)) {
        setIndicatorError(`“${field.label}”必须是有效数值。`)
        return
      }
      if (parsed < field.min || (field.max !== undefined && parsed > field.max)) {
        setIndicatorError(
          `“${field.label}”必须在 ${field.min}${field.max !== undefined ? `-${field.max}` : " 以上"} 范围内。`
        )
        return
      }
      if (field.integer && !Number.isInteger(parsed)) {
        setIndicatorError(`“${field.label}”必须是整数。`)
        return
      }
      values[field.key] = parsed
    }

    const evidenceError = validateEvidenceDrafts(evidenceDrafts)
    if (evidenceError) {
      setIndicatorError(evidenceError)
      return
    }

    const nextIndicators = {
      ...request.indicators,
      [selectedIndicatorId]: {
        values,
        evidence: buildEvidenceReferences(evidenceDrafts),
      },
    }
    setRequest((current) => ({
      ...current,
      indicators: nextIndicators,
    }))
    setIndicatorDialogOpen(false)
    setPanelMessage(
      `${selectedDefinition.label}已加入草稿；运行后端评分后才会更新雷达图。`
    )
    setRunState("idle")
  }

  const removeIndicator = (indicatorId: TechnologyRiskIndicatorId) => {
    const nextIndicators = { ...request.indicators }
    delete nextIndicators[indicatorId]
    setRequest((current) => ({ ...current, indicators: nextIndicators }))
    setPanelMessage("已从当前草稿移除该指标，保存草稿后生效。")
    setRunState("idle")
  }

  const openIncidentEditor = (incident?: TechnologyIncidentInput) => {
    setIncidentId(incident?.id ?? createLocalId("technology-incident"))
    setIncidentDescription(incident?.description ?? "")
    setIncidentDate(incident?.occurredAt ?? "")
    setIncidentSeverity(
      typeof incident?.severity === "number" ? String(incident.severity) : ""
    )
    setIncidentResponsibility(incident?.responsibility ?? "primary")
    setIncidentConcealed(incident?.concealed ?? false)
    setIncidentRepeated(incident?.repeatedSeriousIncident ?? false)
    setIncidentEvidenceDrafts(
      Object.fromEntries(
        detail.evidence.map((evidence) => {
          const reference = incident?.evidence.find(
            (candidate) => candidate.evidenceId === evidence.id
          )
          return [
            evidence.id,
            {
              selected: Boolean(reference),
              locator: reference?.locator ?? "",
              inferenceBasis: reference?.inferenceBasis ?? "",
            },
          ]
        })
      )
    )
    setIncidentError("")
    setIncidentDialogOpen(true)
  }

  const saveIncident = () => {
    if (!incidentDescription.trim()) {
      setIncidentError("请填写事故或重大技术失效描述。")
      return
    }
    if (!incidentDate || Number.isNaN(Date.parse(incidentDate))) {
      setIncidentError("请填写有效的发生日期。")
      return
    }
    const severity = Number(incidentSeverity)
    if (!Number.isFinite(severity) || severity < 0 || severity > 10) {
      setIncidentError("严重度必须是 0-10 之间的数值。")
      return
    }
    const evidenceError = validateEvidenceDrafts(incidentEvidenceDrafts)
    if (evidenceError) {
      setIncidentError(evidenceError)
      return
    }

    const nextIncident: TechnologyIncidentInput = {
      id: incidentId,
      occurredAt: incidentDate,
      severity,
      responsibility: incidentResponsibility,
      description: incidentDescription.trim(),
      concealed: incidentConcealed,
      repeatedSeriousIncident: incidentRepeated,
      evidence: buildEvidenceReferences(incidentEvidenceDrafts),
    }
    setRequest((current) => ({
      ...current,
      incidents: [
        ...(current.incidents ?? []).filter((item) => item.id !== incidentId),
        nextIncident,
      ],
    }))
    setIncidentDialogOpen(false)
    setPanelMessage("重大技术事故已加入草稿，将在后端评分时计算风险下限。")
  }

  const removeIncident = (id: string) => {
    setRequest((current) => ({
      ...current,
      incidents: (current.incidents ?? []).filter((item) => item.id !== id),
    }))
    setPanelMessage("已从当前草稿移除事故记录。")
  }

  const validateRequestMetadata = () => {
    if (!request.period.trim()) {
      return "请填写评分期间，例如 2026-Q2。"
    }
    if (!request.asOfDate || Number.isNaN(Date.parse(request.asOfDate))) {
      return "请填写有效的数据截止日期。"
    }
    if (savedIndicatorIds.length === 0) {
      return "请至少录入一项技术风险指标。"
    }
    return null
  }

  const handleSaveDraft = () => {
    setRunState("saving")
    const saved = onSaveDraft({
      ...request,
      companyId: detail.id,
      period: request.period.trim(),
    })
    setRunState(saved ? "success" : "error")
    setPanelMessage(
      saved
        ? "技术风险草稿已保存。修改后的草稿需要重新运行后端评分才会进入研判。"
        : "草稿已在当前页面保留，但浏览器无法写入本地存储。"
    )
  }

  const handleScore = async () => {
    const validationError = validateRequestMetadata()
    if (validationError) {
      setRunState("error")
      setPanelMessage(validationError)
      return
    }

    setRunState("scoring")
    setPanelMessage("正在向技术风险评分接口提交原始观测与证据定位…")
    try {
      const result = await onScore({
        ...request,
        companyId: detail.id,
        period: request.period.trim(),
      })
      setRunState("success")
      setPanelMessage(
        result.status === "scored"
          ? `后端评分完成，技术风险为 ${result.score} 分，已更新当前企业研判。`
          : `评分接口已完成校验，当前覆盖权重为 ${result.coveredWeight}%，未达到 70% 的正式出分门槛。`
      )
    } catch (error) {
      setRunState("error")
      setPanelMessage(
        error instanceof Error
          ? error.message
          : "技术风险评分接口暂时不可用，请稍后重试。"
      )
    }
  }

  const handleClear = () => {
    if (
      !window.confirm(
        `确认清除 ${detail.name} 的技术风险草稿和自动评分结果吗？`
      )
    ) {
      return
    }
    const saved = onClear()
    setRequest(createEmptyRequest(detail.id))
    setRunState(saved ? "success" : "error")
    setPanelMessage(
      saved
        ? "已清除当前企业的技术风险自动评分数据。"
        : "数据已在当前页面清除，但浏览器无法保存本次修改。"
    )
  }

  return (
    <section
      className="technology-scoring-workspace"
      aria-labelledby="technology-scoring-title"
    >
      <div className="technology-scoring-heading">
        <div>
          <div className="technology-scoring-kicker">
            <Badge variant="outline" className="status-badge status-info">
              <ServerCogIcon aria-hidden="true" />
              后端自动评分
            </Badge>
            <span>KTR-2026.07-v1</span>
          </div>
          <h2 id="technology-scoring-title">技术风险自动评分工作台</h2>
          <p>
            按既定八项技术指标录入原始变量，绑定可核验证据和精确位置，再由后端接口统一计算。未提交的内容保持缺失，不使用推测值补齐。
          </p>
        </div>
        <div className="technology-scoring-actions">
          <Button variant="outline" onClick={handleClear}>
            <RotateCcwIcon data-icon="inline-start" />
            清除本企业
          </Button>
          <Button onClick={() => openIndicatorEditor("kci-006")}>
            <PlusIcon data-icon="inline-start" />
            录入技术指标
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
        className="technology-scoring-summary-glass"
        padding="0"
      >
        <div className="technology-scoring-summary">
          <TechnologySummary
            icon={DatabaseZapIcon}
            label="已录入指标"
            value={`${savedIndicatorIds.length}/8`}
            note={`草稿口径权重 ${configuredWeight}%`}
          />
          <TechnologySummary
            icon={FileCheck2Icon}
            label="已计分指标"
            value={`${scoredCount}/8`}
            note="仅统计证据与输入均有效的指标"
          />
          <TechnologySummary
            icon={GaugeIcon}
            label="覆盖权重"
            value={`${latestResult?.coveredWeight ?? 0}%`}
            note="达到 70% 后形成技术风险分"
          />
          <TechnologySummary
            icon={ShieldAlertIcon}
            label="技术风险"
            value={
              latestResult?.score === null ||
              latestResult?.score === undefined
                ? "待计算"
                : `${latestResult.score}`
            }
            note={
              latestResult?.score === null
                ? "覆盖不足，暂不进入雷达图"
                : latestResult
                  ? "已进入当前企业风险研判"
                  : "尚未运行后端评分"
            }
            tone={resultTone(latestResult?.score ?? null)}
          />
        </div>
      </LiquidGlassSurface>

      <div className="technology-scoring-meta">
        <label className="scoring-field">
          <span>评分期间</span>
          <Input
            value={request.period}
            onChange={(event) => {
              setRequest((current) => ({
                ...current,
                period: event.target.value,
              }))
              setRunState("idle")
            }}
            placeholder="例如 2026-Q2"
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
            }}
          />
        </label>
        <div className="technology-scoring-meta-note">
          <CalculatorIcon aria-hidden="true" />
          <div>
            <strong>评分规则固定在服务端</strong>
            <span>前端只提交原始变量、证据引用和定位，不自行改写权重。</span>
          </div>
        </div>
      </div>

      <div className="technology-indicator-stack">
        {indicatorDefinitions.map((definition) => {
          const configured = savedIndicatorIds.includes(definition.id)
          const result = resultByIndicator.get(definition.id)
          return (
            <article
              key={definition.id}
              className="technology-indicator-row"
              data-configured={configured}
              data-status={result?.status ?? "not-run"}
            >
              <div className="technology-indicator-weight">
                <span>{definition.weight}%</span>
                <small>权重</small>
              </div>
              <div className="technology-indicator-main">
                <div className="technology-indicator-title">
                  <div>
                    <span>
                      {definition.group} · {definition.id.toUpperCase()}
                    </span>
                    <h3>{definition.label}</h3>
                  </div>
                  <Badge
                    variant="outline"
                    className={cn(
                      "status-badge",
                      result?.status === "scored"
                        ? resultTone(result.riskScore)
                        : configured
                          ? "status-info"
                          : "status-neutral"
                    )}
                  >
                    {result?.status === "scored"
                      ? `${result.riskScore} 分`
                      : result?.status === "invalid-input"
                        ? "输入无效"
                        : result?.status === "ineligible-evidence"
                          ? "证据不准入"
                          : configured
                            ? "草稿已录入"
                            : "待录入"}
                  </Badge>
                </div>
                <p>{definition.description}</p>
                {result ? (
                  <div className="technology-indicator-result">
                    <span>{result.formulaTrace}</span>
                    {result.validationErrors.length > 0 ? (
                      <small>{result.validationErrors.join("；")}</small>
                    ) : null}
                  </div>
                ) : null}
              </div>
              <div className="technology-indicator-actions">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => openIndicatorEditor(definition.id)}
                >
                  <PencilIcon data-icon="inline-start" />
                  {configured ? "编辑" : "录入"}
                </Button>
                {configured ? (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => removeIndicator(definition.id)}
                    aria-label={`移除${definition.label}`}
                  >
                    <Trash2Icon aria-hidden="true" />
                  </Button>
                ) : null}
              </div>
            </article>
          )
        })}
      </div>

      <section className="technology-incident-section">
        <div className="technology-incident-heading">
          <div>
            <span className="eyebrow">可选风险叠加</span>
            <h3>重大技术事故与失效记录</h3>
            <p>
              具备有效证据的事故会按严重度、责任和时间衰减计算风险下限；隐瞒或重复严重事故可触发高风险。
            </p>
          </div>
          <Button variant="outline" onClick={() => openIncidentEditor()}>
            <PlusIcon data-icon="inline-start" />
            添加事故
          </Button>
        </div>
        {(request.incidents ?? []).length > 0 ? (
          <div className="technology-incident-list">
            {(request.incidents ?? []).map((incident) => (
              <article key={incident.id}>
                <div>
                  <strong>{incident.description}</strong>
                  <span>
                    {incident.occurredAt} · 严重度 {incident.severity}/10 ·{" "}
                    {incident.evidence.length} 条证据
                  </span>
                </div>
                <div>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => openIncidentEditor(incident)}
                    aria-label={`编辑事故：${incident.description}`}
                  >
                    <PencilIcon aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => removeIncident(incident.id)}
                    aria-label={`移除事故：${incident.description}`}
                  >
                    <Trash2Icon aria-hidden="true" />
                  </Button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="technology-incident-empty">
            <CircleDashedIcon aria-hidden="true" />
            当前草稿未录入具备评分证据的重大技术事故。
          </div>
        )}
      </section>

      <div className="technology-scoring-submit">
        <div aria-live="polite">
          {runState === "scoring" ? (
            <LoaderCircleIcon className="animate-spin" aria-hidden="true" />
          ) : runState === "error" ? (
            <AlertTriangleIcon aria-hidden="true" />
          ) : runState === "success" ? (
            <CheckCircle2Icon aria-hidden="true" />
          ) : (
            <ServerCogIcon aria-hidden="true" />
          )}
          <span>
            {panelMessage ||
              `最近运行：${formatDateTime(latestResult?.generatedAt)}。草稿保存在当前浏览器，正式分数由后端接口生成。`}
          </span>
        </div>
        <div>
          <Button variant="outline" onClick={handleSaveDraft}>
            保存草稿
          </Button>
          <Button onClick={handleScore} disabled={runState === "scoring"}>
            {runState === "scoring" ? (
              <LoaderCircleIcon
                className="animate-spin"
                data-icon="inline-start"
              />
            ) : (
              <CalculatorIcon data-icon="inline-start" />
            )}
            运行后端评分
          </Button>
        </div>
      </div>

      {latestResult ? (
        <section className="technology-result-audit">
          <div className="technology-result-audit-heading">
            <div>
              <span className="eyebrow">审计结果</span>
              <h3>
                {latestResult.status === "scored"
                  ? `技术风险 ${latestResult.score} 分`
                  : "覆盖不足，暂不形成正式技术风险分"}
              </h3>
            </div>
            <Badge
              variant="outline"
              className={cn(
                "status-badge",
                latestResult.status === "scored"
                  ? resultTone(latestResult.score)
                  : "status-warning"
              )}
            >
              覆盖权重 {latestResult.coveredWeight}%
            </Badge>
          </div>
          <dl className="technology-result-meta">
            <div>
              <dt>模型版本</dt>
              <dd>{latestResult.modelVersion}</dd>
            </div>
            <div>
              <dt>基础风险分</dt>
              <dd>{latestResult.baseScore ?? "未形成"}</dd>
            </div>
            <div>
              <dt>事故风险下限</dt>
              <dd>{latestResult.incidentOverlay.riskFloor}</dd>
            </div>
            <div>
              <dt>运行 ID</dt>
              <dd>{latestResult.runId}</dd>
            </div>
          </dl>
          <details>
            <summary>查看事故叠加与红旗说明</summary>
            <p>{latestResult.incidentOverlay.formulaTrace}</p>
            {latestResult.forcedHighReasons.length > 0 ? (
              <ul>
                {latestResult.forcedHighReasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            ) : (
              <p>本次运行未触发强制高风险红旗。</p>
            )}
          </details>
        </section>
      ) : null}

      <Dialog
        open={indicatorDialogOpen}
        onOpenChange={setIndicatorDialogOpen}
      >
        <DialogContent className="scoring-dialog technology-indicator-dialog glass-strong sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>{selectedDefinition.label}</DialogTitle>
            <DialogDescription>
              {selectedDefinition.group} · 权重 {selectedDefinition.weight}%
              。所有原始变量和证据定位均会随请求提交给后端评分接口。
            </DialogDescription>
          </DialogHeader>

          <div className="technology-dialog-layout">
            <section>
              <h3>原始观测变量</h3>
              <div className="technology-field-grid">
                {selectedDefinition.fields.map((field) =>
                  field.kind === "number" ? (
                    <label key={field.key} className="scoring-field">
                      <span>{field.label}</span>
                      <div className="technology-number-input">
                        <Input
                          type="number"
                          inputMode={field.integer ? "numeric" : "decimal"}
                          min={field.min}
                          max={field.max}
                          step={field.step ?? (field.integer ? 1 : "any")}
                          value={
                            typeof editorValues[field.key] === "string"
                              ? String(editorValues[field.key])
                              : ""
                          }
                          onChange={(event) => {
                            setEditorValues((current) => ({
                              ...current,
                              [field.key]: event.target.value,
                            }))
                            setIndicatorError("")
                          }}
                        />
                        {field.unit ? <span>{field.unit}</span> : null}
                      </div>
                      {field.hint ? <small>{field.hint}</small> : null}
                    </label>
                  ) : (
                    <label key={field.key} className="technology-boolean-field">
                      <input
                        type="checkbox"
                        checked={editorValues[field.key] === true}
                        onChange={(event) => {
                          setEditorValues((current) => ({
                            ...current,
                            [field.key]: event.target.checked,
                          }))
                          setIndicatorError("")
                        }}
                      />
                      <span>
                        <strong>{field.label}</strong>
                        {field.hint ? <small>{field.hint}</small> : null}
                      </span>
                    </label>
                  )
                )}
              </div>
            </section>

            <section>
              <h3>评分证据与定位</h3>
              <p className="technology-dialog-note">
                直接披露和具备完整推导链的证据可计分；背景、待核验和待授权来源仅展示，不可选择。
              </p>
              <EvidenceDraftList
                detail={detail}
                drafts={evidenceDrafts}
                onChange={updateEvidenceDraft}
              />
            </section>
          </div>

          {indicatorError ? (
            <div className="scoring-dialog-note" role="alert">
              {indicatorError}
            </div>
          ) : null}

          <DialogFooter className="scoring-dialog-footer">
            <Button
              variant="outline"
              onClick={() => setIndicatorDialogOpen(false)}
            >
              取消
            </Button>
            <Button onClick={saveIndicator}>
              <CheckCircle2Icon data-icon="inline-start" />
              加入评分草稿
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={incidentDialogOpen} onOpenChange={setIncidentDialogOpen}>
        <DialogContent className="scoring-dialog technology-incident-dialog glass-strong sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>重大技术事故与失效记录</DialogTitle>
            <DialogDescription>
              事故只有在日期、严重度、责任和有效证据均完整时，才会进入后端风险叠加计算。
            </DialogDescription>
          </DialogHeader>

          <div className="scoring-form-grid">
            <label className="scoring-field scoring-field-wide">
              <span>事故或失效描述</span>
              <textarea
                className="scoring-textarea"
                value={incidentDescription}
                onChange={(event) => {
                  setIncidentDescription(event.target.value)
                  setIncidentError("")
                }}
                placeholder="描述事实、影响范围和当前处置状态"
              />
            </label>
            <label className="scoring-field">
              <span>发生日期</span>
              <Input
                type="date"
                value={incidentDate}
                onChange={(event) => {
                  setIncidentDate(event.target.value)
                  setIncidentError("")
                }}
              />
            </label>
            <label className="scoring-field">
              <span>严重度（0-10）</span>
              <Input
                type="number"
                min={0}
                max={10}
                step="any"
                value={incidentSeverity}
                onChange={(event) => {
                  setIncidentSeverity(event.target.value)
                  setIncidentError("")
                }}
              />
            </label>
            <label className="scoring-field">
              <span>企业责任</span>
              <Select
                value={incidentResponsibility}
                onValueChange={(value) =>
                  setIncidentResponsibility(
                    value as TechnologyIncidentInput["responsibility"]
                  )
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="primary">主要责任</SelectItem>
                    <SelectItem value="secondary">次要责任</SelectItem>
                    <SelectItem value="indirect">间接责任</SelectItem>
                    <SelectItem value="none">无责任</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </label>
            <div className="technology-incident-flags">
              <label>
                <input
                  type="checkbox"
                  checked={incidentConcealed}
                  onChange={(event) =>
                    setIncidentConcealed(event.target.checked)
                  }
                />
                存在隐瞒情形
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={incidentRepeated}
                  onChange={(event) =>
                    setIncidentRepeated(event.target.checked)
                  }
                />
                重复严重事故
              </label>
            </div>
          </div>

          <section>
            <h3>事故证据与定位</h3>
            <EvidenceDraftList
              detail={detail}
              drafts={incidentEvidenceDrafts}
              onChange={updateIncidentEvidenceDraft}
            />
          </section>

          {incidentError ? (
            <div className="scoring-dialog-note" role="alert">
              {incidentError}
            </div>
          ) : null}

          <DialogFooter className="scoring-dialog-footer">
            <Button
              variant="outline"
              onClick={() => setIncidentDialogOpen(false)}
            >
              取消
            </Button>
            <Button onClick={saveIncident}>加入事故草稿</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}

function TechnologySummary({
  icon: Icon,
  label,
  value,
  note,
  tone = "status-info",
}: {
  icon: typeof GaugeIcon
  label: string
  value: string
  note: string
  tone?: string
}) {
  return (
    <article>
      <div>
        <Icon aria-hidden="true" />
        <span>{label}</span>
      </div>
      <strong className={tone}>{value}</strong>
      <p>{note}</p>
    </article>
  )
}

function EvidenceDraftList({
  detail,
  drafts,
  onChange,
}: {
  detail: CompanyDetail
  drafts: EvidenceDraftMap
  onChange: (evidenceId: string, patch: Partial<EvidenceDraft>) => void
}) {
  return (
    <div className="scoring-evidence-list">
      {detail.evidence.map((evidence) => {
        const draft = drafts[evidence.id] ?? emptyEvidenceDraft()
        const eligible = isEvidenceEligible(evidence)
        return (
          <article
            key={evidence.id}
            className="scoring-evidence-option"
            data-selected={draft.selected}
            data-eligible={eligible}
          >
            <label className="scoring-evidence-select">
              <input
                type="checkbox"
                checked={draft.selected}
                disabled={!eligible}
                onChange={(event) =>
                  onChange(evidence.id, { selected: event.target.checked })
                }
              />
              <span>
                <strong>{evidence.title}</strong>
                <small>
                  {evidence.sourceName} · {evidence.publishedAt}
                </small>
              </span>
              <SupportBadge strength={evidence.supportStrength} />
            </label>
            <p>{evidence.summary}</p>
            {draft.selected ? (
              <div className="scoring-evidence-fields">
                <label className="scoring-field">
                  <span>页码、章节或表格位置</span>
                  <Input
                    value={draft.locator}
                    onChange={(event: ChangeEvent<HTMLInputElement>) =>
                      onChange(evidence.id, { locator: event.target.value })
                    }
                    placeholder="例如：招股书第 128 页，表 6-3"
                  />
                </label>
                {evidence.supportStrength === "inferred" ? (
                  <label className="scoring-field">
                    <span>完整推导依据</span>
                    <textarea
                      className="scoring-textarea"
                      value={draft.inferenceBasis}
                      onChange={(event) =>
                        onChange(evidence.id, {
                          inferenceBasis: event.target.value,
                        })
                      }
                      placeholder="说明原始披露如何推导出本项观测值"
                    />
                  </label>
                ) : null}
              </div>
            ) : null}
          </article>
        )
      })}
    </div>
  )
}
