import { IndustryRiskReviewPanel } from "@/components/dashboard/industry-risk-review-panel"
import type {
  CompanyDetail,
  RiskAssessment,
  RiskEvent,
  TabValue,
} from "@/types/risk"

type OverviewTabProps = {
  detail: CompanyDetail
  assessment: RiskAssessment
  events: RiskEvent[]
  timeRange: "3m" | "6m"
  riskLens: "all" | "priority" | "high"
  onNavigate: (view: TabValue) => void
  onRiskLensChange: (value: "all" | "priority" | "high") => void
  onTimeRangeChange: (value: "3m" | "6m") => void
  onOpenMethod: () => void
  onOpenEvent: (eventId: string) => void
  onCreateObservation: () => void
}

export function OverviewTab({ detail, onNavigate }: OverviewTabProps) {
  return (
    <div className="page-stack">
      <IndustryRiskReviewPanel companyId={detail.id} onNavigate={onNavigate} />
    </div>
  )
}
