import {
  ArchiveIcon,
  BadgeCheckIcon,
  BookOpenTextIcon,
  BoxesIcon,
  ChevronDownIcon,
  CpuIcon,
  ExternalLinkIcon,
  FileChartColumnIcon,
  FileCode2Icon,
  HistoryIcon,
  LandmarkIcon,
  NewspaperIcon,
  TelescopeIcon,
} from "lucide-react"

import {
  EmptyState,
  EvidenceList,
  GlassPanel,
  SectionHeader,
  VerificationBadge,
} from "@/components/dashboard/shared"
import { IndustryRiskReviewPanel } from "@/components/dashboard/industry-risk-review-panel"
import { IndicatorAnalysisTab } from "@/components/dashboard/indicator-analysis-tab"
import { TechnologyBaselinePanel } from "@/components/dashboard/technology-baseline-panel"
import { TechnologyScoringPanel } from "@/components/dashboard/technology-scoring-panel"
import { LiquidGlassSurface } from "@/components/liquid"
import { Reveal } from "@/components/motion/workflow-transition"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import companyResearchHighlightsData from "@/data/company-research-highlights.json"
import { isMachineReadableDate } from "@/lib/date-format"
import {
  formatDataSourceLabel,
  summarizeEvidenceGovernance,
} from "@/lib/source-governance"
import { cn } from "@/lib/utils"
import type {
  CompanyDetail,
  CompanyIntelligence,
  CompanyResearchHighlight,
  CompanyResearchHighlightType,
  EvidenceScoringBinding,
  IndicatorObservation,
  ResearchSourceStatus,
  ResearchSection,
  RiskAssessment,
  TechnologyRiskScoreRequest,
  TechnologyRiskScoreResult,
  TechnologyBaselineQuantificationRequest,
  TechnologyBaselineQuantificationResult,
  TechnologyScoringCompanyState,
} from "@/types/risk"

type IntelligenceTabProps = {
  detail: CompanyDetail
  intelligence: CompanyIntelligence
  section: ResearchSection
  onSectionChange: (section: ResearchSection) => void
  assessment: RiskAssessment
  observations: IndicatorObservation[]
  evidenceBindings: EvidenceScoringBinding[]
  defaultReviewer: string
  storageWarning: string
  technologyCompanyState?: TechnologyScoringCompanyState
  technologyStorageWarning: string
  createToken: number
  onCreateRequestHandled: () => void
  onSaveTechnologyDraft: (request: TechnologyRiskScoreRequest) => boolean
  onScoreTechnology: (
    request: TechnologyRiskScoreRequest
  ) => Promise<TechnologyRiskScoreResult>
  onClearTechnology: () => boolean
  onSaveTechnologyBaselineDraft: (
    request: TechnologyBaselineQuantificationRequest
  ) => boolean
  onQuantifyTechnologyBaseline: (
    request: TechnologyBaselineQuantificationRequest
  ) => Promise<TechnologyBaselineQuantificationResult>
  onClearTechnologyBaseline: () => boolean
  onSaveObservation: (
    observation: IndicatorObservation,
    evidenceBindings: EvidenceScoringBinding[]
  ) => boolean
  onDeleteObservation: (observationId: string) => boolean
  onSetDefaultReviewer: (reviewer: string) => boolean
  onResetScoring: () => boolean
}

const researchHighlightIcons = {
  新闻动态: NewspaperIcon,
  论文研究: BookOpenTextIcon,
  专利披露: BadgeCheckIcon,
  软件著作权: FileCode2Icon,
} satisfies Record<CompanyResearchHighlightType, typeof NewspaperIcon>

const researchSourceLabels: Record<ResearchSourceStatus, string> = {
  located: "来源已定位",
  limited: "口径受限",
  pending: "待补来源",
}

const researchHighlightsByCompany = new Map(
  (
    companyResearchHighlightsData as Array<{
      companyId: string
      highlights: CompanyResearchHighlight[]
    }>
  ).map((record) => [record.companyId, record.highlights])
)

export function IntelligenceTab({
  detail,
  intelligence,
  section,
  onSectionChange,
  technologyCompanyState,
  technologyStorageWarning,
  onCreateRequestHandled,
  onSaveTechnologyDraft,
  onScoreTechnology,
  onClearTechnology,
  onSaveTechnologyBaselineDraft,
  onQuantifyTechnologyBaseline,
  onClearTechnologyBaseline,
}: IntelligenceTabProps) {
  if (section === "metrics") {
    return <IndicatorAnalysisTab companyId={detail.id} />
  }

  const governance = summarizeEvidenceGovernance(detail.evidence)
  const researchHighlights = researchHighlightsByCompany.get(detail.id) ?? []
  const disclosureScrollHintId = `disclosure-table-scroll-hint-${detail.id}`

  return (
    <div className="page-stack">
      <Tabs
        value={section}
        onValueChange={(value) => onSectionChange(value as ResearchSection)}
        className="section-tabs research-section-tabs"
      >
        <TabsList aria-label="企业研究子页面">
          <TabsTrigger value="profile">企业档案</TabsTrigger>
          <TabsTrigger value="metrics">风险指标</TabsTrigger>
          <TabsTrigger value="lifecycle">生命周期</TabsTrigger>
          <TabsTrigger value="evidence">证据档案</TabsTrigger>
        </TabsList>

        <TabsContent value="profile">
          <div className="tab-content-stack">
            <Reveal>
              <GlassPanel
                className="research-profile-hero"
                surfaceClassName="research-hero-glass"
                variant="floating"
              >
                <div>
                  <span className="eyebrow">企业研究档案</span>
                  <h2>{detail.name}</h2>
                  <p>{detail.description}</p>
                </div>
                <dl>
                  <div>
                    <dt>行业</dt>
                    <dd>{detail.sector}</dd>
                  </div>
                  <div>
                    <dt>总部</dt>
                    <dd>{detail.headquarters}</dd>
                  </div>
                  <div>
                    <dt>阶段</dt>
                    <dd>{detail.stage}</dd>
                  </div>
                </dl>
              </GlassPanel>
            </Reveal>

            <Reveal>
              <section className="page-section">
                <SectionHeader
                  title="可核验企业事实"
                  tone="blue"
                  description="事实项保留核验状态、时间口径和证据引用；缺少完整披露时直接标注，而不补写推测值。"
                />
                {intelligence.profileFacts.length > 0 ? (
                  <div className="fact-list">
                    {intelligence.profileFacts.map((fact) => (
                      <article key={fact.id} className="fact-row">
                        <div className="fact-row-label">
                          <span>{fact.label}</span>
                          <VerificationBadge status={fact.status} />
                        </div>
                        <div className="fact-row-value">
                          <strong>{fact.value}</strong>
                          <span>{fact.period}</span>
                        </div>
                        <p>{fact.summary}</p>
                      </article>
                    ))}
                  </div>
                ) : (
                  <EmptyState
                    title="暂无可核验企业事实"
                    description="当前研究底稿尚未收录满足来源定位要求的企业事实。"
                  />
                )}
              </section>
            </Reveal>

            <Reveal>
              <section className="page-section">
                <SectionHeader
                  title="技术与产品资产"
                  tone="cyan"
                  description="描述公开可验证的产品、技术成熟度和研究边界，不将产品宣传直接转换为风险分数。"
                />
                {intelligence.technologyAssets.length > 0 ? (
                  <div className="asset-list">
                    {intelligence.technologyAssets.map((asset) => (
                      <article key={asset.id} className="asset-row">
                        <div className="asset-row-icon">
                          <BoxesIcon aria-hidden="true" />
                        </div>
                        <div>
                          <div className="asset-row-title">
                            <h3>{asset.name}</h3>
                            <Badge variant="outline">{asset.type}</Badge>
                            <Badge variant="outline">{asset.maturity}</Badge>
                          </div>
                          <p>{asset.summary}</p>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <EmptyState
                    title="暂无技术与产品资产记录"
                    description="当前研究底稿尚未形成可核验的产品、技术成熟度或资产边界记录。"
                  />
                )}
              </section>
            </Reveal>

            <Reveal>
              <section className="page-section">
                <SectionHeader
                  title="研究底稿索引"
                  tone="violet"
                  description="集中查看近期披露、论文与知识产权资料的来源定位和口径边界，可直接返回原始材料核对。"
                />
                {researchHighlights.length > 0 ? (
                  <div className="research-highlight-list">
                    {researchHighlights.map((highlight) => {
                      const Icon = researchHighlightIcons[highlight.type]

                      return (
                        <LiquidGlassSurface
                          key={highlight.id}
                          variant="card"
                          className="research-highlight-glass"
                          padding="0"
                        >
                          <article className="research-highlight-row">
                            <div
                              className={cn(
                                "research-highlight-icon",
                                `research-highlight-icon-${highlight.type}`
                              )}
                            >
                              <Icon aria-hidden="true" />
                            </div>
                            <div className="research-highlight-main">
                              <div className="research-highlight-heading">
                                <div>
                                  <div className="research-highlight-kicker">
                                    <span>{highlight.type}</span>
                                    <ResearchSourceBadge
                                      status={highlight.sourceStatus}
                                    />
                                    {isMachineReadableDate(highlight.asOf) ? (
                                      <time dateTime={highlight.asOf}>
                                        {highlight.asOf}
                                      </time>
                                    ) : (
                                      <span>{highlight.asOf}</span>
                                    )}
                                  </div>
                                  <h3>{highlight.title}</h3>
                                </div>
                                <strong className="research-highlight-value">
                                  {highlight.value}
                                </strong>
                              </div>
                              <p className="research-highlight-summary">
                                {highlight.summary}
                              </p>
                              <div className="research-highlight-foot">
                                <dl className="research-highlight-metadata">
                                  <div>
                                    <dt>来源定位</dt>
                                    <dd>{highlight.source.locator}</dd>
                                  </div>
                                  <div>
                                    <dt>口径边界</dt>
                                    <dd>{highlight.methodology}</dd>
                                  </div>
                                  {highlight.source.publicationNote ? (
                                    <div>
                                      <dt>发布日期</dt>
                                      <dd>
                                        {highlight.source.publicationNote}
                                      </dd>
                                    </div>
                                  ) : null}
                                </dl>
                                <Button variant="ghost" size="sm" asChild>
                                  <a
                                    href={highlight.source.sourceUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    aria-label={`打开${highlight.title}原始来源`}
                                  >
                                    {highlight.source.sourceName}
                                    <ExternalLinkIcon data-icon="inline-end" />
                                  </a>
                                </Button>
                              </div>
                            </div>
                          </article>
                        </LiquidGlassSurface>
                      )
                    })}
                  </div>
                ) : (
                  <EmptyState
                    title="暂无研究底稿索引"
                    description="当前企业尚未收录已定位来源的近期披露、论文或知识产权记录。"
                  />
                )}
              </section>
            </Reveal>

            <Reveal>
              <section className="page-section">
                <SectionHeader
                  title="政策、资金与专利观察"
                  tone="amber"
                  description="授权数据尚未接入的数量型结论只作为候选观察，不进入正式评分。"
                />
                <div className="research-two-column">
                  <section className="research-record-group">
                    <header>
                      <h3>政策与资金事项</h3>
                      <p>公开披露可核验内容与下一步检查项</p>
                    </header>
                    {intelligence.policyFunding.length > 0 ? (
                      <div className="compact-list">
                        {intelligence.policyFunding.map((item) => (
                          <article key={item.id}>
                            <div className="compact-list-title">
                              <h3>{item.title}</h3>
                              <VerificationBadge status={item.status} />
                            </div>
                            <p>{item.impact}</p>
                            <div className="next-check">
                              <strong>下一步：</strong>
                              {item.nextCheck}
                            </div>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <EmptyState
                        title="暂无政策与资金事项"
                        description="当前研究底稿没有满足核验要求的政策、补贴或融资事项。"
                      />
                    )}
                  </section>

                  <section className="research-record-group">
                    <header>
                      <h3>专利与权利边界观察</h3>
                      <p>不展示未经授权或无法确认来源的专利数量</p>
                    </header>
                    {intelligence.patentWatch.length > 0 ? (
                      <div className="compact-list">
                        {intelligence.patentWatch.map((item) => (
                          <article key={item.id}>
                            <div className="compact-list-title">
                              <h3>{item.technicalTheme}</h3>
                              <VerificationBadge
                                status={item.verificationStatus}
                              />
                            </div>
                            <p>{item.summary}</p>
                            <div className="candidate-source-note">
                              {formatDataSourceLabel(item.source.sourceName)}
                            </div>
                            <Button variant="link" asChild>
                              <a
                                href={item.source.sourceUrl}
                                target="_blank"
                                rel="noreferrer"
                              >
                                打开检索入口
                                <ExternalLinkIcon data-icon="inline-end" />
                              </a>
                            </Button>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <EmptyState
                        title="暂无专利与权利边界观察"
                        description="授权数据尚未接入，当前也没有能够由公开来源确认的观察记录。"
                      />
                    )}
                  </section>
                </div>
              </section>
            </Reveal>
          </div>
        </TabsContent>

        <TabsContent value="metrics">
          <div className="tab-content-stack">
            <IndustryRiskReviewPanel companyId={detail.id} />

            <Reveal>
              <section className="page-section">
                <SectionHeader
                  title="公开披露背景数据"
                  tone="blue"
                  description="这里展示可核验的披露值及研究含义，不等同于正式指标观测，也不参与当前分数。"
                />
                {(detail.disclosureMetrics ?? []).length > 0 ? (
                  <>
                    <p
                      id={disclosureScrollHintId}
                      className="disclosure-table-scroll-hint"
                    >
                      横向滑动查看更多列
                    </p>
                    <div
                      className="disclosure-table-wrap"
                      role="region"
                      tabIndex={0}
                      aria-label={`${detail.name}公开披露背景数据表`}
                      aria-describedby={disclosureScrollHintId}
                    >
                      <table className="business-table">
                        <thead>
                          <tr>
                            <th>披露项</th>
                            <th>披露值</th>
                            <th>期间</th>
                            <th>研究含义</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(detail.disclosureMetrics ?? []).map((metric) => (
                            <tr key={`${metric.label}-${metric.period}`}>
                              <th scope="row">{metric.label}</th>
                              <td>
                                <strong>
                                  {metric.value}
                                  {metric.unit ? ` ${metric.unit}` : ""}
                                </strong>
                              </td>
                              <td>{metric.period}</td>
                              <td>{metric.riskImplication}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                ) : (
                  <EmptyState
                    title="暂无公开披露背景数据"
                    description="当前研究底稿没有可核验且口径明确的披露值。"
                  />
                )}
              </section>
            </Reveal>

            <Reveal>
              <section className="technology-specialization">
                <details>
                  <summary>
                    <span className="technology-specialization-summary-main">
                      <span className="technology-specialization-icon">
                        <CpuIcon aria-hidden="true" />
                      </span>
                      <span>
                        <span className="technology-specialization-eyebrow">
                          技术专项量化与自动评分
                        </span>
                        <strong>KTR-2026.07-v1 专项评分区</strong>
                        <small>
                          8
                          个技术核心指标和重大技术质量事件红旗项使用独立变量、证据约束与后端评分接口。
                        </small>
                      </span>
                    </span>
                    <span className="technology-specialization-toggle">
                      <span>默认折叠</span>
                      <ChevronDownIcon aria-hidden="true" />
                    </span>
                  </summary>
                  <div className="technology-specialization-content">
                    <TechnologyScoringPanel
                      key={detail.id}
                      detail={detail}
                      companyState={technologyCompanyState}
                      storageWarning={technologyStorageWarning}
                      createToken={0}
                      onCreateRequestHandled={onCreateRequestHandled}
                      onSaveDraft={onSaveTechnologyDraft}
                      onScore={onScoreTechnology}
                      onClear={onClearTechnology}
                    />
                    <div className="technology-specialization-note">
                      历史与补充研究台账仅用于保存口径和辅助材料，不写入 KTR
                      正式评分，也不会直接改变六维雷达图。
                    </div>
                    <TechnologyBaselinePanel
                      key={`baseline-${detail.id}`}
                      detail={detail}
                      companyState={technologyCompanyState}
                      storageWarning={technologyStorageWarning}
                      onSaveDraft={onSaveTechnologyBaselineDraft}
                      onQuantify={onQuantifyTechnologyBaseline}
                      onClear={onClearTechnologyBaseline}
                    />
                  </div>
                </details>
              </section>
            </Reveal>
          </div>
        </TabsContent>

        <TabsContent value="lifecycle">
          <Reveal>
            <section className="page-section">
              <SectionHeader
                title="生命周期研究"
                tone="violet"
                description="用于说明风险问题随研发、验证、落地和扩张阶段如何变化；阶段分值为历史研究材料，不计入新版辅助研判指数。"
              />
              {detail.lifecycle.length > 0 ? (
                <div className="lifecycle-list">
                  {detail.lifecycle.map((stage, index) => (
                    <article
                      key={stage.id}
                      className="lifecycle-row"
                      data-current={stage.status === "current"}
                    >
                      <div className="lifecycle-index">{index + 1}</div>
                      <div className="lifecycle-row-main">
                        <div className="lifecycle-row-title">
                          <h3>{stage.label}</h3>
                          <Badge variant="outline">
                            {stage.status === "current"
                              ? "当前阶段"
                              : stage.status === "passed"
                                ? "已走过"
                                : "下一阶段"}
                          </Badge>
                        </div>
                        <p>{stage.summary}</p>
                        <div className="lifecycle-change">
                          <HistoryIcon aria-hidden="true" />
                          <span>{stage.change}</span>
                        </div>
                        <div className="keyword-list">
                          {stage.keywords.map((keyword) => (
                            <Badge key={keyword} variant="secondary">
                              {keyword}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <EmptyState
                  title="暂无生命周期研究记录"
                  description="当前企业尚未形成可核验的研发、验证、落地或扩张阶段记录。"
                />
              )}
            </section>
          </Reveal>
        </TabsContent>

        <TabsContent value="evidence">
          <div className="tab-content-stack">
            <Reveal>
              <LiquidGlassSurface
                variant="card"
                refractive
                className="research-stat-slab"
                padding="0"
              >
                <section className="evidence-stat-grid">
                  <ResearchStat
                    icon={FileChartColumnIcon}
                    label="证据记录"
                    value={governance.evidenceRecordCount}
                  />
                  <ResearchStat
                    icon={LandmarkIcon}
                    label="唯一来源 URL"
                    value={governance.uniqueSourceUrlCount}
                  />
                  <ResearchStat
                    icon={ArchiveIcon}
                    label="正式公开来源"
                    value={governance.formalPublicSourceCount}
                  />
                  <ResearchStat
                    icon={TelescopeIcon}
                    label="待授权候选来源"
                    value={governance.candidateSourceCount}
                  />
                </section>
              </LiquidGlassSurface>
            </Reveal>
            <Reveal>
              <section className="page-section">
                <SectionHeader
                  title="公开证据档案"
                  tone="teal"
                  description="重复 URL 可以被多条事实复用，但来源统计只计一次；背景材料和待核验记录不进入评分覆盖率。"
                />
                <EvidenceList
                  detail={detail}
                  evidenceIds={detail.evidence.map((item) => item.id)}
                />
              </section>
            </Reveal>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}

function ResearchSourceBadge({ status }: { status: ResearchSourceStatus }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "status-badge",
        status === "located"
          ? "status-success"
          : status === "limited"
            ? "status-warning"
            : "status-neutral"
      )}
    >
      {researchSourceLabels[status]}
    </Badge>
  )
}

function ResearchStat({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof ArchiveIcon
  label: string
  value: number
}) {
  return (
    <Card className="research-stat">
      <CardHeader>
        <CardDescription>
          <Icon aria-hidden="true" />
          {label}
        </CardDescription>
        <CardTitle>{value}</CardTitle>
      </CardHeader>
    </Card>
  )
}
