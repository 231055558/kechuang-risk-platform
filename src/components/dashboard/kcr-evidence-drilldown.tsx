import {
  ChevronDownIcon,
  ExternalLinkIcon,
  FileCheck2Icon,
  Link2Icon,
  ShieldCheckIcon,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import type { KcrAssessmentApiResponse } from "@/domain/kcr-v1/assessment-api.ts"
import type {
  KcrAssessmentDimensionResult,
  KcrAssessmentEvidenceInput,
  KcrAssessmentEvidenceReference,
  KcrAssessmentIndicatorResult,
} from "@/domain/kcr-v1/scoring-engine.ts"
import { formatSourceDate } from "@/lib/date-format"

type KcrEvidenceDrilldownProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  dimension: KcrAssessmentDimensionResult
  indicators: KcrAssessmentIndicatorResult[]
  evidenceCatalog: KcrAssessmentApiResponse["evidenceCatalog"]
  methodVersion: string
  dataCutoff: string
}

const percentFormatter = new Intl.NumberFormat("zh-CN", {
  style: "percent",
  maximumFractionDigits: 2,
})

const sourceTierLabels: Record<
  KcrAssessmentEvidenceInput["sourceTier"],
  string
> = {
  regulator: "监管来源",
  exchange: "交易所",
  "company-filing": "公司公告",
  "official-company": "公司官网",
  "commercial-api": "商业数据",
  research: "研究资料",
  media: "媒体资料",
  manual: "人工材料",
}

const supportStrengthLabels: Record<
  KcrAssessmentEvidenceReference["supportStrength"],
  string
> = {
  direct: "直接证据",
  inferred: "推断证据",
  background: "背景材料",
}

const dataStatusLabels: Record<
  KcrAssessmentIndicatorResult["dataStatus"],
  string
> = {
  complete: "数据完整",
  partial: "部分覆盖",
  missing: "数据缺失",
}

export function KcrEvidenceDrilldown({
  open,
  onOpenChange,
  dimension,
  indicators,
  evidenceCatalog,
  methodVersion,
  dataCutoff,
}: KcrEvidenceDrilldownProps) {
  const evidenceById = new Map(
    evidenceCatalog.map((evidence) => [evidence.id, evidence])
  )
  const referencedEvidenceIds = new Set(
    indicators.flatMap((indicator) =>
      indicator.evidence.map((reference) => reference.evidenceId)
    )
  )

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="method-sheet kcr-evidence-sheet sm:max-w-4xl">
        <SheetHeader className="kcr-evidence-sheet-header">
          <div className="kcr-evidence-sheet-kicker">
            <ShieldCheckIcon aria-hidden="true" />
            KCR V3 可解释证据链
          </div>
          <SheetTitle>{dimension.label}指标与证据</SheetTitle>
          <SheetDescription>
            展示团队工作簿中的指标评分、固定权重、贡献公式和来源定位；没有在前端重新计算分数。
          </SheetDescription>
        </SheetHeader>

        <div className="sheet-scroll-content kcr-evidence-sheet-scroll">
          <section
            className="kcr-evidence-dimension-summary"
            aria-label="维度摘要"
          >
            <KcrDrilldownStat
              label="维度分"
              value={dimension.score === null ? "—" : `${dimension.score}`}
              note={`${dimension.riskLevelLabel}风险`}
            />
            <KcrDrilldownStat
              label="评分指标"
              value={`${indicators.length} 项`}
              note={`固定权重 ${dimension.totalWeight}`}
            />
            <KcrDrilldownStat
              label="证据覆盖"
              value={percentFormatter.format(dimension.evidenceCoverage)}
              note={`${referencedEvidenceIds.size} 条来源`}
            />
            <KcrDrilldownStat
              label="证据置信度"
              value={percentFormatter.format(dimension.confidence)}
              note="与风险分独立"
            />
          </section>

          <p className="kcr-evidence-formula-note">
            <FileCheck2Icon aria-hidden="true" />
            {dimension.formulaTrace}
          </p>

          <section className="kcr-indicator-drilldown" aria-label="指标列表">
            <div className="kcr-evidence-section-heading">
              <div>
                <span>第二层 · 指标</span>
                <h3>展开指标查看评分依据</h3>
              </div>
              <Badge variant="outline">{indicators.length} 项</Badge>
            </div>

            <div className="kcr-indicator-details-list">
              {indicators.map((indicator, index) => (
                <details key={indicator.id} open={index === 0}>
                  <summary>
                    <span className="kcr-indicator-summary-id">
                      {indicator.id}
                    </span>
                    <span className="kcr-indicator-summary-copy">
                      <strong>{indicator.label}</strong>
                      <small>
                        固定权重 {indicator.weight} ·{" "}
                        {dataStatusLabels[indicator.dataStatus]}
                      </small>
                    </span>
                    <span className="kcr-indicator-summary-score">
                      <strong>{indicator.riskScore ?? "—"}</strong>
                      <small>风险分</small>
                    </span>
                    <ChevronDownIcon aria-hidden="true" />
                  </summary>

                  <div className="kcr-indicator-detail-body">
                    <dl className="kcr-indicator-metrics">
                      <div>
                        <dt>总分贡献</dt>
                        <dd>{indicator.weightedContribution ?? "—"}</dd>
                      </div>
                      <div>
                        <dt>证据置信度</dt>
                        <dd>
                          {percentFormatter.format(
                            indicator.evidenceConfidence
                          )}
                        </dd>
                      </div>
                      <div>
                        <dt>覆盖系数</dt>
                        <dd>
                          {percentFormatter.format(indicator.coverageFactor)}
                        </dd>
                      </div>
                      <div>
                        <dt>证据引用</dt>
                        <dd>{indicator.evidence.length} 条</dd>
                      </div>
                    </dl>

                    <div className="kcr-indicator-rationale">
                      <span>工作簿评分依据</span>
                      <p>{indicator.rationale}</p>
                      <code>{indicator.formulaTrace}</code>
                    </div>

                    <div className="kcr-indicator-evidence-list">
                      <div className="kcr-evidence-subheading">
                        <Link2Icon aria-hidden="true" />
                        <strong>来源证据</strong>
                      </div>
                      {indicator.evidence.map((reference, referenceIndex) => {
                        const evidence = evidenceById.get(reference.evidenceId)
                        if (!evidence) return null

                        return (
                          <KcrEvidenceCard
                            key={`${indicator.id}-${reference.evidenceId}-${referenceIndex}`}
                            evidence={evidence}
                            reference={reference}
                          />
                        )
                      })}
                    </div>
                  </div>
                </details>
              ))}
            </div>
          </section>
        </div>

        <div className="sheet-action-bar kcr-evidence-sheet-footer">
          <span>方法 {methodVersion}</span>
          <span>数据截至 {formatSourceDate(dataCutoff)}</span>
        </div>
      </SheetContent>
    </Sheet>
  )
}

function KcrDrilldownStat({
  label,
  value,
  note,
}: {
  label: string
  value: string
  note: string
}) {
  return (
    <article>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </article>
  )
}

function KcrEvidenceCard({
  evidence,
  reference,
}: {
  evidence: KcrAssessmentEvidenceInput
  reference: KcrAssessmentEvidenceReference
}) {
  return (
    <article
      className="kcr-evidence-card"
      data-support={reference.supportStrength}
    >
      <div className="kcr-evidence-card-heading">
        <div>
          <Badge variant="outline">
            {supportStrengthLabels[reference.supportStrength]}
          </Badge>
          <Badge variant="outline">
            {sourceTierLabels[evidence.sourceTier]}
          </Badge>
        </div>
        {evidence.sourceUrl ? (
          <a
            href={evidence.sourceUrl}
            target="_blank"
            rel="noreferrer noopener"
            aria-label={`打开来源：${evidence.title}`}
          >
            查看原文
            <ExternalLinkIcon aria-hidden="true" />
          </a>
        ) : (
          <span className="kcr-evidence-no-link">无公开链接</span>
        )}
      </div>

      <h4>{evidence.title}</h4>
      <p className="kcr-evidence-source-meta">
        <span>{evidence.sourceName}</span>
        <span>
          {evidence.publishedAt
            ? formatSourceDate(evidence.publishedAt)
            : "发布日期未披露"}
        </span>
      </p>

      <dl className="kcr-evidence-locators">
        <div>
          <dt>本指标引用位置</dt>
          <dd>{reference.locator}</dd>
        </div>
        <div>
          <dt>来源覆盖范围</dt>
          <dd>{evidence.locator}</dd>
        </div>
      </dl>

      {reference.supportStrength === "inferred" && reference.inferenceBasis ? (
        <p className="kcr-evidence-inference">
          <strong>推断依据：</strong>
          {reference.inferenceBasis}
        </p>
      ) : null}
      {reference.supportStrength === "background" ? (
        <p className="kcr-evidence-background-note">
          背景材料仅用于交叉核验，不单独满足评分证据准入。
        </p>
      ) : null}
    </article>
  )
}
