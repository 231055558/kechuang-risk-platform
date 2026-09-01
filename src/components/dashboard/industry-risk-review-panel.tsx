import { useEffect, useMemo, useState } from "react"
import {
  ArrowRightIcon,
  CalendarDaysIcon,
  DatabaseZapIcon,
  ExternalLinkIcon,
  InfoIcon,
  RefreshCwIcon,
  ShieldCheckIcon,
} from "lucide-react"

import { IndustryRiskProfileDesk } from "@/components/dashboard/industry-risk-profile-desk"
import { GlassPanel } from "@/components/dashboard/shared"
import { Reveal } from "@/components/motion/workflow-transition"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type {
  IndustryRiskAssessmentApiResponse,
  IndustryRiskCompanyDirectoryResponse,
} from "@/domain/industry-risk-v1/index.ts"
import {
  fetchIndustryRiskAssessment,
  fetchIndustryRiskCompanies,
} from "@/lib/industry-risk-api"
import { displayIndustryLabel } from "@/lib/industry-label"
import "@/styles/investor-overview.css"

type DirectoryState =
  | { status: "loading" }
  | { status: "success"; value: IndustryRiskCompanyDirectoryResponse }
  | { status: "error"; message: string }

type AssessmentState =
  | { status: "idle" | "loading" }
  | { status: "success"; value: IndustryRiskAssessmentApiResponse }
  | { status: "error"; message: string }

type InvestorView = "reports" | "realtime" | "events" | "intelligence"

export function IndustryRiskReviewPanel({
  companyId,
  onNavigate,
}: {
  companyId: string
  onNavigate?: (view: InvestorView) => void
}) {
  const [directoryAttempt, setDirectoryAttempt] = useState(0)
  const [assessmentAttempt, setAssessmentAttempt] = useState(0)
  const [directory, setDirectory] = useState<DirectoryState>({
    status: "loading",
  })
  const [assessment, setAssessment] = useState<AssessmentState>({
    status: "idle",
  })

  useEffect(() => {
    const controller = new AbortController()
    void fetchIndustryRiskCompanies({ signal: controller.signal })
      .then((value) => setDirectory({ status: "success", value }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setDirectory({
          status: "error",
          message:
            error instanceof Error ? error.message : "行业样本暂时无法加载。",
        })
      })
    return () => controller.abort()
  }, [directoryAttempt])

  useEffect(() => {
    if (!companyId || directory.status !== "success") return
    const controller = new AbortController()
    void fetchIndustryRiskAssessment(companyId, { signal: controller.signal })
      .then((value) => setAssessment({ status: "success", value }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setAssessment({
          status: "error",
          message:
            error instanceof Error ? error.message : "企业评估暂时无法加载。",
        })
      })
    return () => controller.abort()
  }, [assessmentAttempt, companyId, directory.status])

  const peerCompanies = useMemo(() => {
    if (directory.status !== "success") return []
    const selected = directory.value.companies.find(
      (company) => company.companyId === companyId
    )
    if (!selected) return []
    return directory.value.companies
      .filter(
        (company) => company.benchmarkGroupId === selected.benchmarkGroupId
      )
      .sort(
        (left, right) =>
          (right.totalRiskScore ?? -1) - (left.totalRiskScore ?? -1) ||
          left.stockCode.localeCompare(right.stockCode)
      )
  }, [companyId, directory])

  if (directory.status === "loading") {
    return (
      <WorkspaceState icon={DatabaseZapIcon} message="正在读取行业风险样本…" />
    )
  }

  if (directory.status === "error") {
    return (
      <WorkspaceState
        icon={InfoIcon}
        message={directory.message}
        action={
          <Button
            variant="outline"
            onClick={() => {
              setDirectory({ status: "loading" })
              setDirectoryAttempt((value) => value + 1)
            }}
          >
            <RefreshCwIcon data-icon="inline-start" />
            重新加载
          </Button>
        }
      />
    )
  }

  const summary = directory.value.companies.find(
    (company) => company.companyId === companyId
  )
  const selectedRank =
    peerCompanies.findIndex((company) => company.companyId === companyId) + 1

  return (
    <div className="investor-overview" aria-labelledby="industry-risk-title">
      <Reveal>
        <header className="investor-overview__header">
          <div>
            <h2 id="industry-risk-title">
              {summary?.companyName ?? "当前企业"}风险总览
            </h2>
          </div>
          <div className="investor-overview__context">
            <Badge
              variant="outline"
              className="investor-overview__industry-badge"
            >
              {displayIndustryLabel(summary?.benchmarkGroupLabel)}
            </Badge>
          </div>
        </header>
      </Reveal>

      <section className="industry-risk-assessment" aria-live="polite">
        {assessment.status === "success" &&
        assessment.value.company.id === companyId ? (
          <RiskOverviewContent
            response={assessment.value}
            selectedRank={selectedRank}
            onNavigate={onNavigate}
          />
        ) : assessment.status === "error" ? (
          <WorkspaceState
            icon={InfoIcon}
            message={assessment.message}
            action={
              <Button
                variant="outline"
                onClick={() => setAssessmentAttempt((value) => value + 1)}
              >
                重新加载
              </Button>
            }
          />
        ) : (
          <WorkspaceState
            icon={DatabaseZapIcon}
            message={`正在计算 ${summary?.companyName ?? "当前企业"} 的同业风险位置…`}
          />
        )}
      </section>
    </div>
  )
}

function RiskOverviewContent({
  response,
  selectedRank,
  onNavigate,
}: {
  response: IndustryRiskAssessmentApiResponse
  selectedRank: number
  onNavigate?: (view: InvestorView) => void
}) {
  const recentEvents = [...response.events]
    .sort((left, right) => (right.date ?? "").localeCompare(left.date ?? ""))
    .slice(0, 3)

  return (
    <>
      <IndustryRiskProfileDesk
        response={response}
        selectedRank={selectedRank}
      />

      <div className="investor-overview__lower-grid">
        <section className="investor-overview__events">
          <header>
            <div>
              <h3>近期事件</h3>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onNavigate?.("realtime")}
            >
              全部资讯 <ArrowRightIcon data-icon="inline-end" />
            </Button>
          </header>
          {recentEvents.length ? (
            <ol>
              {recentEvents.map((event) => (
                <li key={event.id}>
                  <CalendarDaysIcon aria-hidden="true" />
                  <div>
                    <span>
                      {event.date ?? "日期待补充"} · {event.eventType}
                    </span>
                    <strong>{event.title}</strong>
                  </div>
                  {event.url ? (
                    <a
                      href={event.url}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`查看${event.title}原始来源`}
                    >
                      <ExternalLinkIcon aria-hidden="true" />
                    </a>
                  ) : null}
                </li>
              ))}
            </ol>
          ) : (
            <p className="investor-overview__empty">当前没有结构化近期事件。</p>
          )}
        </section>

        <aside className="investor-overview__next">
          <ShieldCheckIcon aria-hidden="true" />
          <div>
            <h3>继续核对指标依据</h3>
          </div>
          <Button onClick={() => onNavigate?.("intelligence")}>
            进入指标分析 <ArrowRightIcon data-icon="inline-end" />
          </Button>
        </aside>
      </div>
    </>
  )
}

function WorkspaceState({
  icon: Icon,
  message,
  action,
}: {
  icon: typeof DatabaseZapIcon
  message: string
  action?: React.ReactNode
}) {
  return (
    <Reveal>
      <GlassPanel
        className="industry-risk-state"
        variant="floating"
        role="status"
      >
        <Icon aria-hidden="true" />
        <p>{message}</p>
        {action}
      </GlassPanel>
    </Reveal>
  )
}
