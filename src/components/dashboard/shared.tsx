import type { ComponentProps, ReactNode } from "react"
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  Clock3Icon,
  ExternalLinkIcon,
  FileQuestionIcon,
  LoaderCircleIcon,
} from "lucide-react"

import {
  LiquidGlassSurface,
  type LiquidGlassVariant,
} from "@/components/liquid"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  formatEvidenceSupport,
  isEffectiveEvidence,
} from "@/lib/source-governance"
import type {
  AssessmentReviewStatus,
  CompanyDetail,
  EventSeverity,
  EventStatus,
  EvidenceItem,
  EvidenceSupportStrength,
  IntelligenceVerificationStatus,
  RiskLevel,
} from "@/types/risk"

const riskLabels: Record<RiskLevel, string> = {
  low: "低风险",
  attention: "关注",
  "medium-high": "中高风险",
  high: "高风险",
}

const severityLabels: Record<EventSeverity, string> = {
  watch: "观察",
  medium: "中危",
  high: "高危",
}

const statusLabels: Record<EventStatus, string> = {
  pending: "待处理",
  "in-progress": "处理中",
  done: "已完成",
}

const verificationLabels: Record<IntelligenceVerificationStatus, string> = {
  verified: "已验证",
  partial: "部分验证",
  pending: "待核验",
}

const supportStyles: Record<EvidenceSupportStrength, string> = {
  direct: "status-success",
  inferred: "status-info",
  background: "status-neutral",
  pending: "status-warning",
}

export function GlassPanel({
  children,
  className,
  surfaceClassName,
  variant = "panel",
  ...props
}: ComponentProps<"section"> & {
  surfaceClassName?: string
  variant?: LiquidGlassVariant
}) {
  return (
    <LiquidGlassSurface
      variant={variant}
      className={cn("glass-panel-surface", surfaceClassName)}
      padding="0"
    >
      <section className={className} {...props}>
        {children}
      </section>
    </LiquidGlassSurface>
  )
}

export function SectionHeader({
  title,
  description,
  action,
  tone = "blue",
}: {
  title: string
  description?: string
  action?: ReactNode
  tone?: "blue" | "cyan" | "violet" | "teal" | "amber" | "rose"
}) {
  return (
    <div className="section-heading" data-tone={tone}>
      <div>
        <h2>{title}</h2>
        {description ? <p>{description}</p> : null}
      </div>
      {action}
    </div>
  )
}

export function RiskBadge({ level }: { level: RiskLevel }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "status-badge",
        level === "high"
          ? "status-danger"
          : level === "medium-high"
            ? "status-warning"
            : level === "low"
              ? "status-success"
              : "status-neutral"
      )}
    >
      {riskLabels[level]}
    </Badge>
  )
}

export function SeverityBadge({ severity }: { severity: EventSeverity }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "status-badge",
        severity === "high"
          ? "status-danger"
          : severity === "medium"
            ? "status-warning"
            : "status-neutral"
      )}
    >
      {severityLabels[severity]}
    </Badge>
  )
}

export function StatusBadge({ status }: { status: EventStatus }) {
  const Icon =
    status === "done"
      ? CheckCircle2Icon
      : status === "in-progress"
        ? LoaderCircleIcon
        : Clock3Icon

  return (
    <Badge
      variant="outline"
      className={cn(
        "status-badge",
        status === "done"
          ? "status-success"
          : status === "in-progress"
            ? "status-info"
            : "status-neutral"
      )}
    >
      <Icon aria-hidden="true" />
      {statusLabels[status]}
    </Badge>
  )
}

export function VerificationBadge({
  status,
}: {
  status: IntelligenceVerificationStatus
}) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "status-badge",
        status === "verified"
          ? "status-success"
          : status === "partial"
            ? "status-warning"
            : "status-neutral"
      )}
    >
      {verificationLabels[status]}
    </Badge>
  )
}

export function SupportBadge({
  strength,
}: {
  strength: EvidenceSupportStrength | undefined
}) {
  const normalized = strength ?? "pending"

  return (
    <Badge
      variant="outline"
      className={cn("status-badge", supportStyles[normalized])}
    >
      {formatEvidenceSupport(strength)}
    </Badge>
  )
}

export function ReviewStatusBadge({
  status,
  assessableDimensionCount,
}: {
  status: AssessmentReviewStatus
  assessableDimensionCount?: number
}) {
  const labels: Record<AssessmentReviewStatus, string> = {
    reviewed: "已复核",
    "manual-review": "需人工复核",
    "insufficient-evidence": "证据不足",
  }
  const label =
    status === "insufficient-evidence" && assessableDimensionCount === 0
      ? "待建立观测"
      : labels[status]

  return (
    <Badge
      variant="outline"
      className={cn(
        "status-badge",
        status === "reviewed"
          ? "status-success"
          : status === "manual-review"
            ? "status-warning"
            : "status-neutral"
      )}
    >
      {status === "reviewed" ? (
        <CheckCircle2Icon aria-hidden="true" />
      ) : (
        <AlertTriangleIcon aria-hidden="true" />
      )}
      {label}
    </Badge>
  )
}

export function EvidenceList({
  detail,
  evidenceIds,
  limit,
  emptyText = "当前没有可展示的证据记录。",
}: {
  detail: CompanyDetail
  evidenceIds: string[]
  limit?: number
  emptyText?: string
}) {
  const evidenceMap = new Map(detail.evidence.map((item) => [item.id, item]))
  const records = [...new Set(evidenceIds)]
    .map((id) => evidenceMap.get(id))
    .filter((item): item is EvidenceItem => Boolean(item))
    .slice(0, limit)

  if (records.length === 0) {
    return <EmptyState title="暂无证据" description={emptyText} />
  }

  return (
    <div className="evidence-list">
      {records.map((item) => (
        <article
          key={item.id}
          className="evidence-row"
          data-support={item.supportStrength ?? "pending"}
        >
          <div className="evidence-row-main">
            <div className="evidence-row-meta">
              <SupportBadge strength={item.supportStrength} />
              <span>{item.sourceName}</span>
              <span>{item.publishedAt}</span>
            </div>
            <h3>{item.title}</h3>
            <p>{item.summary}</p>
            {item.supportStrength === "inferred" && item.inferenceBasis ? (
              <div className="inference-note">
                <strong>推导依据：</strong>
                {item.inferenceBasis}
              </div>
            ) : null}
            {!isEffectiveEvidence(item) ? (
              <div className="coverage-note">
                该记录作为{formatEvidenceSupport(item.supportStrength)}
                展示，不计入评分证据覆盖率。
              </div>
            ) : null}
          </div>
          <Button variant="outline" size="icon-sm" asChild>
            <a
              href={item.sourceUrl}
              target="_blank"
              rel="noreferrer"
              aria-label={`打开来源：${item.title}`}
            >
              <ExternalLinkIcon />
            </a>
          </Button>
        </article>
      ))}
    </div>
  )
}

export function EmptyState({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <div className="empty-state" role="status">
      <FileQuestionIcon aria-hidden="true" />
      <div>
        <strong>{title}</strong>
        <p>{description}</p>
      </div>
    </div>
  )
}
