import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react"
import {
  BadgeCheckIcon,
  CheckCircle2Icon,
  ClipboardPenIcon,
  FileSearchIcon,
  GaugeIcon,
  PencilIcon,
  PlusIcon,
  RotateCcwIcon,
  ShieldCheckIcon,
  Trash2Icon,
} from "lucide-react"

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
import {
  riskQuantificationCatalog,
  riskQuantificationCatalogByDimension,
  riskQuantificationCatalogByIndicatorId,
  type QuantificationMethod,
  type QuantificationReadiness,
  type RiskQuantificationCatalogItem,
} from "@/data/risk-quantification-catalog"
import { riskIndicators } from "@/lib/data"
import { CANONICAL_RISK_DIMENSION_LABELS } from "@/lib/risk-dimensions"
import { getScoringRule, previewObservationScore } from "@/lib/scoring-rules"
import { createStableId } from "@/lib/scoring-workspace"
import {
  formatEvidenceSupport,
  isEffectiveEvidence,
} from "@/lib/source-governance"
import { cn } from "@/lib/utils"
import type {
  CanonicalRiskDimensionId,
  CompanyDetail,
  EvidenceItem,
  EvidenceScoringBinding,
  IndicatorObservation,
  RiskAssessment,
} from "@/types/risk"

type ScoringWorkspaceProps = {
  detail: CompanyDetail
  assessment: RiskAssessment
  observations: IndicatorObservation[]
  evidenceBindings: EvidenceScoringBinding[]
  defaultReviewer: string
  storageWarning: string
  createToken: number
  onCreateRequestHandled: () => void
  onSaveObservation: (
    observation: IndicatorObservation,
    evidenceBindings: EvidenceScoringBinding[]
  ) => boolean
  onDeleteObservation: (observationId: string) => boolean
  onSetDefaultReviewer: (reviewer: string) => boolean
  onReset: () => boolean
}

type EvidenceDraft = {
  selected: boolean
  locator: string
  inferenceBasis: string
}

type EvidenceDraftMap = Record<string, EvidenceDraft>

const dimensionEntries = Object.entries(
  CANONICAL_RISK_DIMENSION_LABELS
) as Array<[CanonicalRiskDimensionId, string]>

const riskIndicatorById = new Map(
  riskIndicators.map((indicator) => [indicator.id, indicator])
)

const locallyScorableCatalogItems = riskQuantificationCatalog.filter(
  (item) =>
    item.method === "local-score" &&
    Boolean(item.indicatorId) &&
    getScoringRule(item.indicatorId!) !== null &&
    riskIndicatorById.has(item.indicatorId!)
)

function emptyEvidenceDraft(): EvidenceDraft {
  return {
    selected: false,
    locator: "",
    inferenceBasis: "",
  }
}

function observationStatusLabel(observation: IndicatorObservation) {
  if (observation.reviewStatus === "reviewed") {
    return "已复核"
  }
  return observation.status === "partial" ? "草稿不完整" : "待复核"
}

function scoreTone(score: number | undefined) {
  if (score === undefined) return "pending"
  if (score >= 75) return "high"
  if (score >= 60) return "medium"
  return "low"
}

function formatUpdatedAt(value: string | undefined) {
  if (!value) return "尚未保存"
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

function evidenceSortValue(evidence: EvidenceItem, indicatorId: string) {
  const related = evidence.indicatorIds?.includes(indicatorId) ? 0 : 1
  const eligible = isEffectiveEvidence(evidence) ? 0 : 1
  return related * 10 + eligible
}

function methodLabel(method: QuantificationMethod) {
  switch (method) {
    case "technology-auto":
      return "技术专项自动评分"
    case "local-score":
      return "本地证据评分"
    case "review":
      return "人工研判"
    case "calibration":
      return "待规则校准"
  }
}

function readinessLabel(readiness: QuantificationReadiness) {
  switch (readiness) {
    case "ready":
      return "可评分"
    case "partial":
      return "可观察"
    case "pending":
      return "待校准"
  }
}

function lifecycleWeightLabel(item: RiskQuantificationCatalogItem) {
  const { startup, growth, stable } = item.lifecycleWeights
  return `初创 ${startup}% · 成长 ${growth}% · 稳定 ${stable}%`
}

export function ScoringWorkspace({
  detail,
  assessment,
  observations,
  evidenceBindings,
  defaultReviewer,
  storageWarning,
  createToken,
  onCreateRequestHandled,
  onSaveObservation,
  onDeleteObservation,
  onSetDefaultReviewer,
  onReset,
}: ScoringWorkspaceProps) {
  const companyObservations = useMemo(
    () =>
      observations
        .filter((observation) => observation.companyId === detail.id)
        .sort((left, right) => {
          const indicatorComparison = left.indicatorId.localeCompare(
            right.indicatorId
          )
          return indicatorComparison || right.period.localeCompare(left.period)
        }),
    [detail.id, observations]
  )
  const reviewedCount = companyObservations.filter(
    (observation) => observation.reviewStatus === "reviewed"
  ).length
  const pendingCount = companyObservations.length - reviewedCount
  const observationsByIndicatorId = useMemo(() => {
    const next = new Map<string, IndicatorObservation[]>()

    for (const observation of companyObservations) {
      const current = next.get(observation.indicatorId) ?? []
      current.push(observation)
      next.set(observation.indicatorId, current)
    }

    return next
  }, [companyObservations])
  const [dialogOpen, setDialogOpen] = useState(false)
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [observationId, setObservationId] = useState("")
  const [indicatorId, setIndicatorId] = useState("")
  const [rawValue, setRawValue] = useState("")
  const [period, setPeriod] = useState("")
  const [note, setNote] = useState("")
  const [evidenceDrafts, setEvidenceDrafts] = useState<EvidenceDraftMap>({})
  const [reviewer, setReviewer] = useState(defaultReviewer)
  const [reviewDeclaration, setReviewDeclaration] = useState(false)
  const [formError, setFormError] = useState("")
  const lastCreateTokenRef = useRef(0)
  const previousCompanyIdRef = useRef(detail.id)

  const selectedIndicator = riskIndicatorById.get(indicatorId)
  const selectedCatalogItem =
    riskQuantificationCatalogByIndicatorId.get(indicatorId)
  const selectedRule = indicatorId ? getScoringRule(indicatorId) : null
  const scorePreview = indicatorId
    ? previewObservationScore(indicatorId, rawValue)
    : { score: null, error: "请先选择正式指标。" }
  const selectedEvidence = detail.evidence.filter(
    (evidence) => evidenceDrafts[evidence.id]?.selected
  )

  const resetDialog = () => {
    setStep(1)
    setObservationId(createStableId("observation"))
    setIndicatorId("")
    setRawValue("")
    setPeriod("")
    setNote("")
    setEvidenceDrafts({})
    setReviewer(defaultReviewer)
    setReviewDeclaration(false)
    setFormError("")
  }

  const openCreateDialog = (presetIndicatorId = "") => {
    resetDialog()
    if (presetIndicatorId) {
      setIndicatorId(presetIndicatorId)
    }
    setDialogOpen(true)
  }

  const openEditDialog = (observation: IndicatorObservation) => {
    const stableObservationId = observation.id || createStableId("observation")
    const drafts = Object.fromEntries(
      detail.evidence.map((evidence) => {
        const binding = evidenceBindings.find(
          (item) =>
            item.observationId === observation.id &&
            item.evidenceId === evidence.id
        )
        const selected =
          observation.evidenceIds.includes(evidence.id) &&
          isEffectiveEvidence(evidence)
        return [
          evidence.id,
          {
            selected,
            locator: selected ? (binding?.locator ?? "") : "",
            inferenceBasis: selected ? (binding?.inferenceBasis ?? "") : "",
          },
        ]
      })
    )

    setStep(1)
    setObservationId(stableObservationId)
    setIndicatorId(observation.indicatorId)
    setRawValue(observation.value ?? "")
    setPeriod(observation.period)
    setNote(observation.note)
    setEvidenceDrafts(drafts)
    setReviewer(observation.reviewedBy || defaultReviewer)
    setReviewDeclaration(false)
    setFormError("")
    setDialogOpen(true)
  }

  useEffect(() => {
    if (createToken === 0 || createToken <= lastCreateTokenRef.current) {
      return
    }
    lastCreateTokenRef.current = createToken
    openCreateDialog()
    onCreateRequestHandled()
    // The token is an explicit command from the overview CTA.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createToken, onCreateRequestHandled])

  useEffect(() => {
    if (previousCompanyIdRef.current === detail.id) {
      return
    }
    previousCompanyIdRef.current = detail.id
    setDialogOpen(false)
  }, [detail.id])

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
    setFormError("")
  }

  const validateObservationBasics = (allowBlankValue: boolean) => {
    if (!selectedIndicator || !selectedRule) {
      return "请选择具备版本化评分规则的正式指标。"
    }
    if (!period.trim()) {
      return "请填写观测期间，例如 2026-Q2 或 2026年度。"
    }
    if (!rawValue.trim()) {
      return allowBlankValue ? null : "请填写观测值。"
    }
    return scorePreview.error
  }

  const validateEvidence = () => {
    if (selectedEvidence.length === 0) {
      return "至少绑定一条可计分的直接披露或推导证据。"
    }

    for (const evidence of selectedEvidence) {
      const draft = evidenceDrafts[evidence.id]
      if (!draft?.locator.trim()) {
        return `请补充“${evidence.title}”的页码、章节或表格位置。`
      }
      if (
        evidence.supportStrength === "inferred" &&
        !draft.inferenceBasis.trim()
      ) {
        return `请写明“${evidence.title}”如何推导出该指标观测值。`
      }
    }

    return null
  }

  const goToEvidenceStep = () => {
    const error = validateObservationBasics(false)
    if (error) {
      setFormError(error)
      return
    }
    setFormError("")
    setStep(2)
  }

  const goToReviewStep = () => {
    const error = validateEvidence()
    if (error) {
      setFormError(error)
      return
    }
    setFormError("")
    setStep(3)
  }

  const saveWorkspaceObservation = (reviewed: boolean) => {
    const basicError = validateObservationBasics(!reviewed)
    if (basicError) {
      setFormError(basicError)
      return
    }
    if (!selectedRule || !selectedIndicator) {
      setFormError("该指标的评分规则不可用。")
      return
    }

    if (reviewed) {
      const evidenceError = validateEvidence()
      if (evidenceError) {
        setFormError(evidenceError)
        setStep(2)
        return
      }
      if (!reviewer.trim()) {
        setFormError("请填写复核人。")
        return
      }
      if (!reviewDeclaration) {
        setFormError("请确认复核声明后再完成复核。")
        return
      }
    }

    const now = new Date().toISOString()
    const selectedEvidenceIds = selectedEvidence.map((evidence) => evidence.id)
    const normalizedScore =
      rawValue.trim() && !scorePreview.error
        ? (scorePreview.score ?? undefined)
        : undefined
    const nextObservation: IndicatorObservation = {
      id: observationId || createStableId("observation"),
      companyId: detail.id,
      indicatorId: selectedIndicator.id,
      status: normalizedScore === undefined ? "partial" : "available",
      value: rawValue.trim() || null,
      unit: selectedRule.unit,
      normalizedScore,
      normalizationRuleVersion: selectedRule.version,
      reviewStatus: reviewed ? "reviewed" : "pending",
      reviewedBy: reviewed ? reviewer.trim() : "",
      reviewedAt: reviewed ? now : "",
      period: period.trim(),
      evidenceIds: selectedEvidenceIds,
      note: note.trim(),
    }
    const nextBindings = selectedEvidence.map((evidence) => {
      const draft = evidenceDrafts[evidence.id] ?? emptyEvidenceDraft()
      const existing = evidenceBindings.find(
        (binding) =>
          binding.observationId === nextObservation.id &&
          binding.evidenceId === evidence.id
      )
      return {
        id: existing?.id || createStableId("binding"),
        observationId: nextObservation.id!,
        companyId: detail.id,
        indicatorId: selectedIndicator.id,
        evidenceId: evidence.id,
        period: period.trim(),
        unit: selectedRule.unit,
        locator: draft.locator.trim(),
        inferenceBasis:
          evidence.supportStrength === "inferred"
            ? draft.inferenceBasis.trim()
            : undefined,
        createdAt: existing?.createdAt || now,
        updatedAt: now,
      } satisfies EvidenceScoringBinding
    })

    if (reviewed) {
      onSetDefaultReviewer(reviewer.trim())
    }
    onSaveObservation(nextObservation, nextBindings)
    setDialogOpen(false)
  }

  const handleDelete = (observation: IndicatorObservation) => {
    if (
      !observation.id ||
      !window.confirm(
        `确认删除 ${periodLabel(observation)} 的评分观测吗？此操作会同时移除证据绑定。`
      )
    ) {
      return
    }
    onDeleteObservation(observation.id)
  }

  const handleReset = () => {
    if (
      window.confirm(
        "确认恢复初始评分数据吗？当前浏览器内录入的评分观测将被清除。"
      )
    ) {
      onReset()
    }
  }

  return (
    <section className="scoring-workspace" aria-labelledby="scoring-title">
      <div className="scoring-workspace-heading">
        <div>
          <span className="eyebrow">企业研究 · 指标观测</span>
          <h2 id="scoring-title">六类风险量化工作台</h2>
          <p>
            技术风险采用 KTR-2026.07-v1 专项后端评分；其余维度按 2026-07-21
            指标体系展示。只有具备规则、有效证据定位和人工复核的记录才进入雷达图。
          </p>
        </div>
        <div className="scoring-workspace-actions">
          <Button variant="outline" onClick={handleReset}>
            <RotateCcwIcon data-icon="inline-start" />
            恢复初始评分
          </Button>
          <Button onClick={() => openCreateDialog()}>
            <PlusIcon data-icon="inline-start" />
            新建评分观测
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
        className="scoring-summary-glass"
        padding="0"
      >
        <div className="scoring-summary-grid">
          <ScoringSummary
            icon={GaugeIcon}
            label="已覆盖维度"
            value={`${assessment.assessableDimensionCount}/6`}
            note="至少四维才显示综合指数"
          />
          <ScoringSummary
            icon={BadgeCheckIcon}
            label="本地可计分项"
            value={`${locallyScorableCatalogItems.length} 项`}
            note="需完成证据绑定与人工复核"
          />
          <ScoringSummary
            icon={ClipboardPenIcon}
            label="已复核 / 草稿"
            value={`${reviewedCount} / ${pendingCount}`}
            note="草稿不会进入当前评分"
          />
          <ScoringSummary
            icon={ShieldCheckIcon}
            label="有效证据覆盖率"
            value={`${assessment.effectiveEvidenceCoverage}%`}
            note="按唯一有效来源 URL 计算"
          />
        </div>
      </LiquidGlassSurface>

      <div className="scoring-dimension-stack">
        {dimensionEntries.map(([dimensionId, dimensionLabel]) => {
          const items =
            riskQuantificationCatalogByDimension.get(dimensionId) ?? []
          const dimensionAssessment = assessment.dimensions.find(
            (dimension) => dimension.id === dimensionId
          )
          const directScoringCount = items.filter(
            (item) =>
              item.method === "technology-auto" || item.method === "local-score"
          ).length
          const calibrationCount = items.filter(
            (item) => item.method === "calibration" || item.method === "review"
          ).length

          return (
            <section
              key={dimensionId}
              className="scoring-dimension-group"
              data-dimension={dimensionId}
            >
              <header className="scoring-dimension-header">
                <div>
                  <span>{`${items.length} 项量化指标 · ${directScoringCount} 项可直接建立评分 · ${calibrationCount} 项待校准`}</span>
                  <h3>{dimensionLabel}</h3>
                </div>
                <Badge
                  variant="outline"
                  className={cn(
                    "status-badge",
                    dimensionAssessment?.assessable
                      ? "status-success"
                      : "status-neutral"
                  )}
                >
                  {dimensionAssessment?.assessable
                    ? `${dimensionAssessment.score} 分`
                    : "待建立"}
                </Badge>
              </header>

              {items.length > 0 ? (
                <div className="scoring-observation-list">
                  {items.map((item) => {
                    const observation =
                      item.indicatorId === undefined
                        ? undefined
                        : observationsByIndicatorId.get(item.indicatorId)?.[0]
                    const indicator =
                      item.indicatorId === undefined
                        ? undefined
                        : riskIndicatorById.get(item.indicatorId)
                    const rule =
                      item.indicatorId === undefined
                        ? null
                        : getScoringRule(item.indicatorId)
                    const supportsLocalScoring =
                      item.method === "local-score" &&
                      Boolean(indicator) &&
                      rule !== null

                    return (
                      <QuantificationRow
                        key={item.id}
                        item={item}
                        observation={observation}
                        bindingCount={
                          observation?.id
                            ? evidenceBindings.filter(
                                (binding) =>
                                  binding.observationId === observation.id
                              ).length
                            : 0
                        }
                        supportsLocalScoring={supportsLocalScoring}
                        onCreate={
                          supportsLocalScoring && item.indicatorId
                            ? () => openCreateDialog(item.indicatorId)
                            : undefined
                        }
                        onEdit={
                          supportsLocalScoring && observation
                            ? () => openEditDialog(observation)
                            : undefined
                        }
                        onDelete={
                          supportsLocalScoring && observation
                            ? () => handleDelete(observation)
                            : undefined
                        }
                      />
                    )
                  })}
                </div>
              ) : (
                <div className="scoring-personnel-empty">
                  <FileSearchIcon aria-hidden="true" />
                  <div>
                    <strong>暂未配置量化指标</strong>
                    <p>该维度尚未纳入当前量化目录。</p>
                  </div>
                </div>
              )}
            </section>
          )
        })}
      </div>

      <p className="scoring-workspace-footnote">
        最后更新：{formatUpdatedAt(observationsUpdatedAt(companyObservations))}
        。评分记录仅保存在当前浏览器的
        localStorage，不会自动同步到服务器或其他设备。
      </p>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="scoring-dialog glass-strong sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>建立评分观测</DialogTitle>
            <DialogDescription>
              第 {step} 步，共 3 步：
              {step === 1
                ? "选择正式指标并录入企业观测。"
                : step === 2
                  ? "绑定有效证据并写明精确定位。"
                  : "预览标准化分数并完成人工复核。"}
            </DialogDescription>
          </DialogHeader>

          <ol className="scoring-stepper" aria-label="评分观测流程">
            {["录入观测", "绑定证据", "人工复核"].map((label, index) => {
              const itemStep = (index + 1) as 1 | 2 | 3
              return (
                <li
                  key={label}
                  data-state={
                    itemStep === step
                      ? "active"
                      : itemStep < step
                        ? "complete"
                        : "upcoming"
                  }
                >
                  <span>{itemStep}</span>
                  <strong>{label}</strong>
                </li>
              )
            })}
          </ol>

          {step === 1 ? (
            <div className="scoring-form-grid">
              <label className="scoring-field scoring-field-wide">
                <span>正式指标</span>
                <Select
                  value={indicatorId}
                  onValueChange={(value) => {
                    setIndicatorId(value)
                    setRawValue("")
                    setEvidenceDrafts({})
                    setFormError("")
                  }}
                >
                  <SelectTrigger aria-label="选择正式评分指标">
                    <SelectValue
                      placeholder={`选择 ${locallyScorableCatalogItems.length} 项本地可计分指标之一`}
                    />
                  </SelectTrigger>
                  <SelectContent position="popper" align="start">
                    {dimensionEntries.map(([dimensionId, dimensionLabel]) => {
                      const options = locallyScorableCatalogItems.filter(
                        (item) => item.dimension === dimensionId
                      )
                      return options.length > 0 ? (
                        <SelectGroup key={dimensionId}>
                          {options.map((item) => (
                            <SelectItem key={item.id} value={item.indicatorId!}>
                              {dimensionLabel} · {item.label}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      ) : null
                    })}
                  </SelectContent>
                </Select>
              </label>

              <label className="scoring-field">
                <span>{selectedRule?.valueLabel ?? "观测值"}</span>
                <Input
                  type="number"
                  inputMode="decimal"
                  value={rawValue}
                  onChange={(event) => {
                    setRawValue(event.target.value)
                    setFormError("")
                  }}
                  placeholder="输入可核验数值"
                  aria-invalid={Boolean(rawValue && scorePreview.error)}
                />
                {rawValue && scorePreview.error ? (
                  <small className="scoring-field-error">
                    {scorePreview.error}
                  </small>
                ) : null}
              </label>

              <div className="scoring-field">
                <span>固定单位</span>
                <div className="scoring-fixed-value">
                  {selectedRule?.unit ?? "选择指标后确定"}
                </div>
              </div>

              <label className="scoring-field">
                <span>观测期间</span>
                <Input
                  value={period}
                  onChange={(event) => {
                    setPeriod(event.target.value)
                    setFormError("")
                  }}
                  placeholder="例如 2026-Q2"
                />
              </label>

              <div className="scoring-field">
                <span>规则版本</span>
                <div className="scoring-fixed-value">
                  {selectedRule?.version ?? "选择指标后确定"}
                </div>
              </div>

              <label className="scoring-field scoring-field-wide">
                <span>观测说明</span>
                <textarea
                  className="scoring-textarea"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="记录口径边界、计算说明或需要继续核验的事项"
                  rows={3}
                />
              </label>

              {selectedIndicator && selectedRule ? (
                <div className="scoring-rule-preview scoring-field-wide">
                  <div>
                    <strong>
                      {selectedCatalogItem?.label ??
                        selectedIndicator.tertiaryRisk}
                    </strong>
                    <span>
                      {selectedCatalogItem?.threshold ??
                        selectedIndicator.threshold}
                    </span>
                  </div>
                  <dl>
                    <div>
                      <dt>低风险</dt>
                      <dd>{selectedRule.lowRiskDescription}</dd>
                    </div>
                    <div>
                      <dt>中风险</dt>
                      <dd>{selectedRule.mediumRiskDescription}</dd>
                    </div>
                    <div>
                      <dt>高风险</dt>
                      <dd>{selectedRule.highRiskDescription}</dd>
                    </div>
                  </dl>
                </div>
              ) : null}
            </div>
          ) : null}

          {step === 2 ? (
            <div className="scoring-evidence-step">
              <div className="scoring-dialog-note">
                背景材料、待核验证据和待授权候选来源会保留展示，但不能勾选计分。推导证据还须填写本次观测的完整推导依据。
              </div>
              <div className="scoring-evidence-list">
                {[...detail.evidence]
                  .sort(
                    (left, right) =>
                      evidenceSortValue(left, indicatorId) -
                      evidenceSortValue(right, indicatorId)
                  )
                  .map((evidence) => {
                    const eligible = isEffectiveEvidence(evidence)
                    const draft =
                      evidenceDrafts[evidence.id] ?? emptyEvidenceDraft()
                    return (
                      <article
                        key={evidence.id}
                        className="scoring-evidence-option"
                        data-eligible={eligible}
                        data-selected={draft.selected}
                      >
                        <label className="scoring-evidence-select">
                          <input
                            type="checkbox"
                            checked={draft.selected}
                            disabled={!eligible}
                            onChange={(event) =>
                              updateEvidenceDraft(evidence.id, {
                                selected: event.target.checked,
                              })
                            }
                          />
                          <span>
                            <strong>{evidence.title}</strong>
                            <small>
                              {evidence.sourceName} ·{" "}
                              {formatEvidenceSupport(evidence.supportStrength)}
                            </small>
                          </span>
                          <Badge
                            variant="outline"
                            className={cn(
                              "status-badge",
                              eligible ? "status-success" : "status-neutral"
                            )}
                          >
                            {eligible ? "可绑定计分" : "仅供背景"}
                          </Badge>
                        </label>
                        <p>{evidence.summary}</p>
                        {draft.selected ? (
                          <div className="scoring-evidence-fields">
                            <label className="scoring-field">
                              <span>页码、章节或表格位置</span>
                              <Input
                                value={draft.locator}
                                onChange={(event) =>
                                  updateEvidenceDraft(evidence.id, {
                                    locator: event.target.value,
                                  })
                                }
                                placeholder="例如 年报第 42 页，表 7"
                              />
                            </label>
                            {evidence.supportStrength === "inferred" ? (
                              <label className="scoring-field">
                                <span>本次观测推导依据</span>
                                <textarea
                                  className="scoring-textarea"
                                  value={draft.inferenceBasis}
                                  onChange={(
                                    event: ChangeEvent<HTMLTextAreaElement>
                                  ) =>
                                    updateEvidenceDraft(evidence.id, {
                                      inferenceBasis: event.target.value,
                                    })
                                  }
                                  placeholder="写明原始披露值、计算步骤与结论边界"
                                  rows={3}
                                />
                              </label>
                            ) : null}
                          </div>
                        ) : null}
                      </article>
                    )
                  })}
              </div>
            </div>
          ) : null}

          {step === 3 ? (
            <div className="scoring-review-step">
              <div
                className="scoring-score-preview"
                data-score={scoreTone(scorePreview.score ?? undefined)}
              >
                <span>标准化风险分值</span>
                <strong>{scorePreview.score ?? "—"}</strong>
                <p>
                  {selectedRule
                    ? `${selectedRule.valueLabel} ${rawValue}${selectedRule.unit}，按 ${selectedRule.version} 归一化。`
                    : "评分规则不可用。"}
                </p>
              </div>
              <dl className="scoring-review-summary">
                <div>
                  <dt>企业</dt>
                  <dd>{detail.name}</dd>
                </div>
                <div>
                  <dt>指标</dt>
                  <dd>
                    {selectedCatalogItem?.label ??
                      selectedIndicator?.tertiaryRisk ??
                      "—"}
                  </dd>
                </div>
                <div>
                  <dt>期间</dt>
                  <dd>{period}</dd>
                </div>
                <div>
                  <dt>有效证据</dt>
                  <dd>{selectedEvidence.length} 条</dd>
                </div>
              </dl>
              <label className="scoring-field">
                <span>复核人</span>
                <Input
                  value={reviewer}
                  onChange={(event) => {
                    setReviewer(event.target.value)
                    setFormError("")
                  }}
                  placeholder="填写本次人工复核人"
                />
              </label>
              <label className="scoring-review-declaration">
                <input
                  type="checkbox"
                  checked={reviewDeclaration}
                  onChange={(event) => {
                    setReviewDeclaration(event.target.checked)
                    setFormError("")
                  }}
                />
                <span>
                  我已核对原始来源、观测口径、期间、单位、证据定位和推导链，确认该记录可进入当前风险辅助研判。
                </span>
              </label>
            </div>
          ) : null}

          {formError ? (
            <div className="scoring-form-error" role="alert">
              {formError}
            </div>
          ) : null}

          <DialogFooter className="scoring-dialog-footer">
            <Button
              variant="outline"
              onClick={() => saveWorkspaceObservation(false)}
            >
              保存草稿
            </Button>
            {step > 1 ? (
              <Button
                variant="ghost"
                onClick={() =>
                  setStep((current) =>
                    current === 3 ? 2 : current === 2 ? 1 : current
                  )
                }
              >
                上一步
              </Button>
            ) : null}
            {step === 1 ? (
              <Button onClick={goToEvidenceStep}>下一步：绑定证据</Button>
            ) : step === 2 ? (
              <Button onClick={goToReviewStep}>下一步：预览复核</Button>
            ) : (
              <Button onClick={() => saveWorkspaceObservation(true)}>
                <CheckCircle2Icon data-icon="inline-start" />
                确认复核并更新评分
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}

function QuantificationRow({
  item,
  observation,
  bindingCount,
  supportsLocalScoring,
  onCreate,
  onEdit,
  onDelete,
}: {
  item: RiskQuantificationCatalogItem
  observation?: IndicatorObservation
  bindingCount: number
  supportsLocalScoring: boolean
  onCreate?: () => void
  onEdit?: () => void
  onDelete?: () => void
}) {
  const isTechnologyAuto = item.method === "technology-auto"

  return (
    <article className="scoring-quantification-row">
      <header className="scoring-quantification-heading">
        <div className="scoring-observation-main">
          <span>{item.secondaryCategory}</span>
          <h4>{item.label}</h4>
          <p>{item.definition}</p>
        </div>
        <div className="scoring-quantification-badges">
          <Badge
            variant="outline"
            className={cn(
              "status-badge",
              item.readiness === "ready"
                ? "status-success"
                : item.readiness === "partial"
                  ? "status-info"
                  : "status-warning"
            )}
          >
            {readinessLabel(item.readiness)}
          </Badge>
          <Badge variant="outline" className="status-badge status-neutral">
            {methodLabel(item.method)}
          </Badge>
        </div>
      </header>

      <dl className="scoring-quantification-spec">
        <div>
          <dt>量化公式</dt>
          <dd>{item.formula}</dd>
        </div>
        <div>
          <dt>风险阈值</dt>
          <dd>{item.threshold}</dd>
        </div>
        <div>
          <dt>数据来源</dt>
          <dd>{item.dataSource}</dd>
        </div>
        <div>
          <dt>更新频率</dt>
          <dd>{item.frequency}</dd>
        </div>
        <div>
          <dt>生命周期权重</dt>
          <dd>{lifecycleWeightLabel(item)}</dd>
        </div>
        <div>
          <dt>方法版本</dt>
          <dd>
            {item.sourceVersion}
            {item.indicatorWeight !== undefined
              ? ` · 专项权重 ${item.indicatorWeight}%`
              : ""}
          </dd>
        </div>
      </dl>

      {item.note ? (
        <p className="scoring-quantification-note">{item.note}</p>
      ) : null}

      <footer className="scoring-quantification-footer">
        {observation ? (
          <dl className="scoring-observation-values">
            <div>
              <dt>观测值</dt>
              <dd>
                {observation.value ?? "未填写"}
                {observation.value ? ` ${observation.unit}` : ""}
              </dd>
            </div>
            <div>
              <dt>期间</dt>
              <dd>{observation.period || "未填写"}</dd>
            </div>
            <div>
              <dt>标准化分数</dt>
              <dd>{observation.normalizedScore ?? "待预览"}</dd>
            </div>
            <div>
              <dt>有效证据</dt>
              <dd>{bindingCount} 条</dd>
            </div>
          </dl>
        ) : (
          <p className="scoring-quantification-empty">
            {isTechnologyAuto
              ? "该项通过下方技术专项工作台录入变量、绑定证据并调用后端评分；未完成前不会进入雷达图。"
              : supportsLocalScoring
                ? "尚未建立企业观测。录入后仍需绑定有效证据并由人工复核，才会进入当前评分。"
                : item.method === "review"
                  ? "可用于研究记录与人工研判；现阶段不以单项数值直接自动输出风险分。"
                  : "可收集原始数据，但尚缺行业基准、组合规则或授权数据校准，不会以不完整口径自动计分。"}
          </p>
        )}

        <div className="scoring-quantification-actions">
          {observation ? (
            <>
              <Badge
                variant="outline"
                className={cn(
                  "status-badge",
                  observation.reviewStatus === "reviewed"
                    ? "status-success"
                    : "status-warning"
                )}
              >
                {observationStatusLabel(observation)}
              </Badge>
              <span>{formatUpdatedAt(observation.updatedAt)}</span>
              {onEdit ? (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`编辑${item.label} ${observation.period}观测`}
                  title="编辑观测"
                  onClick={onEdit}
                >
                  <PencilIcon />
                </Button>
              ) : null}
              {onDelete ? (
                <Button
                  variant="destructive"
                  size="icon-sm"
                  aria-label={`删除${item.label} ${observation.period}观测`}
                  title="删除观测"
                  onClick={onDelete}
                >
                  <Trash2Icon />
                </Button>
              ) : null}
            </>
          ) : onCreate ? (
            <Button variant="outline" onClick={onCreate}>
              <PlusIcon data-icon="inline-start" />
              建立评分观测
            </Button>
          ) : (
            <span className="scoring-quantification-status-copy">
              {isTechnologyAuto ? "技术专项待录入" : methodLabel(item.method)}
            </span>
          )}
        </div>
      </footer>
    </article>
  )
}

function ScoringSummary({
  icon: Icon,
  label,
  value,
  note,
}: {
  icon: typeof GaugeIcon
  label: string
  value: string
  note: string
}) {
  return (
    <article>
      <div>
        <Icon aria-hidden="true" />
        <span>{label}</span>
      </div>
      <strong>{value}</strong>
      <p>{note}</p>
    </article>
  )
}

function periodLabel(observation: IndicatorObservation) {
  return observation.period
    ? `${observation.indicatorId}（${observation.period}）`
    : observation.indicatorId
}

function observationsUpdatedAt(observations: IndicatorObservation[]) {
  return observations
    .map((observation) => observation.updatedAt ?? observation.reviewedAt)
    .filter(Boolean)
    .sort()
    .at(-1)
}
