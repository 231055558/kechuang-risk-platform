import { useEffect, useMemo, useState } from "react"
import {
  ArrowDownIcon,
  ArrowUpIcon,
  BarChart3Icon,
  DatabaseZapIcon,
  FlaskConicalIcon,
  InfoIcon,
  RefreshCwIcon,
} from "lucide-react"

import { GlassPanel } from "@/components/dashboard/shared"
import { IndustryRiskKnowledgeGraph } from "@/components/dashboard/industry-risk-knowledge-graph"
import { Reveal } from "@/components/motion/workflow-transition"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type {
  IndustryRiskAssessmentApiResponse,
  IndustryRiskCompanyDirectoryResponse,
} from "@/domain/industry-risk-v1/index.ts"
import {
  fetchIndustryRiskAssessment,
  fetchIndustryRiskCompanies,
} from "@/lib/industry-risk-api"

type DirectoryState =
  | { status: "loading" }
  | { status: "success"; value: IndustryRiskCompanyDirectoryResponse }
  | { status: "error"; message: string }

type AssessmentState =
  | { status: "idle" | "loading" }
  | { status: "success"; value: IndustryRiskAssessmentApiResponse }
  | { status: "error"; message: string }

const numberFormatter = new Intl.NumberFormat("zh-CN", {
  maximumFractionDigits: 4,
})
const percentFormatter = new Intl.NumberFormat("zh-CN", {
  style: "percent",
  maximumFractionDigits: 1,
})

function candidateScore(
  company: IndustryRiskCompanyDirectoryResponse["companies"][number],
  method: "entropy" | "critic"
) {
  return (
    company.candidateAggregates.find((item) => item.method === method)?.score ??
    null
  )
}

function scoreTone(score: number | null) {
  if (score === null) return "unknown"
  if (score >= 65) return "critical"
  if (score >= 55) return "high"
  if (score >= 45) return "medium"
  return "low"
}

function sourceForMetric(
  response: IndustryRiskAssessmentApiResponse,
  sourceId: string | null
) {
  return response.sources.find((source) => source.id === sourceId)
}

export function IndustryRiskReviewPanel() {
  const [directoryAttempt, setDirectoryAttempt] = useState(0)
  const [assessmentAttempt, setAssessmentAttempt] = useState(0)
  const [directory, setDirectory] = useState<DirectoryState>({
    status: "loading",
  })
  const [assessment, setAssessment] = useState<AssessmentState>({
    status: "idle",
  })
  const [selectedCompanyId, setSelectedCompanyId] = useState("star-688256")

  useEffect(() => {
    const controller = new AbortController()
    void fetchIndustryRiskCompanies({ signal: controller.signal })
      .then((value) => {
        setDirectory({ status: "success", value })
        setSelectedCompanyId((current) =>
          value.companies.some((item) => item.companyId === current)
            ? current
            : (value.companies[0]?.companyId ?? "")
        )
      })
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
    if (!selectedCompanyId || directory.status !== "success") return
    const controller = new AbortController()
    void fetchIndustryRiskAssessment(selectedCompanyId, {
      signal: controller.signal,
    })
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
  }, [assessmentAttempt, directory.status, selectedCompanyId])

  const rankedCompanies = useMemo(() => {
    if (directory.status !== "success") return []
    return [...directory.value.companies].sort(
      (left, right) =>
        (candidateScore(right, "critic") ?? -1) -
        (candidateScore(left, "critic") ?? -1)
    )
  }, [directory])

  if (directory.status === "loading") {
    return (
      <Reveal>
        <GlassPanel
          className="industry-risk-state"
          variant="floating"
          role="status"
        >
          <DatabaseZapIcon aria-hidden="true" />
          <div>
            <strong>正在读取 10 家行业样本</strong>
            <p>加载毛同学提供的 R01–R22 脱敏数据底座。</p>
          </div>
        </GlassPanel>
      </Reveal>
    )
  }

  if (directory.status === "error") {
    return (
      <Reveal>
        <GlassPanel
          className="industry-risk-state"
          variant="floating"
          role="alert"
        >
          <InfoIcon aria-hidden="true" />
          <div>
            <strong>行业样本加载失败</strong>
            <p>{directory.message}</p>
          </div>
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
        </GlassPanel>
      </Reveal>
    )
  }

  const selectedSummary = directory.value.companies.find(
    (company) => company.companyId === selectedCompanyId
  )
  const selectCompany = (companyId: string) => {
    setAssessment({ status: "loading" })
    setSelectedCompanyId(companyId)
  }

  return (
    <>
      <Reveal>
        <GlassPanel
          className="industry-risk-workspace"
          surfaceClassName="industry-risk-workspace-glass"
          variant="floating"
          aria-labelledby="industry-risk-title"
        >
          <header className="industry-risk-header">
            <div>
              <span className="eyebrow">R01–R22 · 行业横截面试验</span>
              <h2 id="industry-risk-title">10 家芯片企业风险基线</h2>
              <p>
                已接入毛同学数据；当前仅 5
                项指标可评分，候选总分不等于正式结论。
              </p>
            </div>
            <div className="industry-risk-company-control">
              <label id="industry-company-label">查看企业</label>
              <Select value={selectedCompanyId} onValueChange={selectCompany}>
                <SelectTrigger aria-labelledby="industry-company-label">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper" align="end">
                  <SelectGroup>
                    {directory.value.companies.map((company) => (
                      <SelectItem
                        key={company.companyId}
                        value={company.companyId}
                      >
                        {company.companyName} · {company.stockCode}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
          </header>

          <div className="industry-risk-scope-strip">
            <span>{directory.value.sectorLabel}</span>
            <span>{directory.value.sampleSize} 家同业样本</span>
            <span>{directory.value.reportingPeriod}</span>
            <Badge variant="outline">行业风险 0.5 为会议占位值</Badge>
          </div>

          <div className="industry-risk-body">
            <aside
              className="industry-risk-ranking"
              aria-label="CRITIC 候选基线排序"
            >
              <div className="industry-risk-section-heading">
                <div>
                  <BarChart3Icon aria-hidden="true" />
                  <h3>同业位置</h3>
                </div>
                <Badge variant="outline">CRITIC 候选</Badge>
              </div>
              <ol>
                {rankedCompanies.map((company, index) => {
                  const score = candidateScore(company, "critic")
                  return (
                    <li key={company.companyId}>
                      <button
                        type="button"
                        data-active={company.companyId === selectedCompanyId}
                        onClick={() => selectCompany(company.companyId)}
                        aria-label={`查看 ${company.companyName}，候选分 ${score ?? "缺失"}`}
                      >
                        <span>{index + 1}</span>
                        <div>
                          <strong>{company.companyName}</strong>
                          <small>{company.chainSegment}</small>
                          <i style={{ width: `${score ?? 0}%` }} />
                        </div>
                        <b data-tone={scoreTone(score)}>{score ?? "—"}</b>
                      </button>
                    </li>
                  )
                })}
              </ol>
            </aside>

            <section className="industry-risk-assessment" aria-live="polite">
              {assessment.status === "success" ? (
                <IndustryRiskAssessmentContent response={assessment.value} />
              ) : assessment.status === "error" ? (
                <div className="industry-risk-assessment-state" role="alert">
                  <InfoIcon aria-hidden="true" />
                  <p>{assessment.message}</p>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setAssessment({ status: "loading" })
                      setAssessmentAttempt((value) => value + 1)
                    }}
                  >
                    重新计算
                  </Button>
                </div>
              ) : (
                <div className="industry-risk-assessment-state" role="status">
                  <DatabaseZapIcon aria-hidden="true" />
                  <p>
                    正在计算 {selectedSummary?.companyName ?? "所选企业"}{" "}
                    的同业位置…
                  </p>
                </div>
              )}
            </section>
          </div>
        </GlassPanel>
      </Reveal>
      <IndustryRiskKnowledgeGraph
        key={selectedCompanyId}
        selectedCompanyId={selectedCompanyId}
      />
    </>
  )
}

function IndustryRiskAssessmentContent({
  response,
}: {
  response: IndustryRiskAssessmentApiResponse
}) {
  const { assessment, company } = response
  return (
    <>
      <div className="industry-risk-company-summary">
        <div>
          <span>{company.chainSegment}</span>
          <h3>{company.shortName}</h3>
          <p>{company.fullName}</p>
        </div>
        <div className="industry-risk-candidate-scores">
          {assessment.candidateAggregates.map((aggregate) => (
            <article
              key={aggregate.method}
              data-tone={scoreTone(aggregate.score)}
            >
              <span>{aggregate.method === "critic" ? "CRITIC" : "熵权"}</span>
              <strong>{aggregate.score ?? "—"}</strong>
              <small>5 项部分候选</small>
            </article>
          ))}
        </div>
      </div>

      <div className="industry-risk-metric-grid">
        {assessment.metrics.map((metric) => {
          const source = sourceForMetric(response, metric.sourceId)
          const DirectionIcon =
            metric.direction === "higher-is-riskier"
              ? ArrowUpIcon
              : ArrowDownIcon
          return (
            <article
              key={metric.indicatorId}
              data-tone={scoreTone(metric.riskScore)}
            >
              <div className="industry-risk-metric-title">
                <Badge variant="outline">{metric.indicatorId}</Badge>
                <DirectionIcon aria-hidden="true" />
              </div>
              <h4>{metric.label}</h4>
              <div className="industry-risk-metric-value">
                <strong>
                  {metric.rawValue === null
                    ? "—"
                    : numberFormatter.format(metric.rawValue)}
                </strong>
                <span>{metric.unit}</span>
              </div>
              <dl>
                <div>
                  <dt>同业风险分位</dt>
                  <dd>
                    {metric.riskPercentile === null
                      ? "—"
                      : percentFormatter.format(metric.riskPercentile)}
                  </dd>
                </div>
                <div>
                  <dt>MVP 指标分</dt>
                  <dd>{metric.riskScore ?? "—"}</dd>
                </div>
              </dl>
              <details>
                <summary>公式、来源与限制</summary>
                <p>{metric.formulaTrace}</p>
                <p>
                  {source
                    ? `${source.institution} · ${source.title}`
                    : "来源待核验"}
                </p>
                <p>{metric.limitation}</p>
              </details>
            </article>
          )
        })}
      </div>

      <footer className="industry-risk-method-note">
        <FlaskConicalIcon aria-hidden="true" />
        <p>
          <strong>{assessment.methodVersion}</strong>
          <span>
            风险分 = 100 ×（0.5 × 行业风险 + 0.5 ×
            企业同业风险分位）；行业风险当前为 0.5 占位值。两套候选基线均非
            R05–R22 正式总分。
          </span>
        </p>
      </footer>
    </>
  )
}
