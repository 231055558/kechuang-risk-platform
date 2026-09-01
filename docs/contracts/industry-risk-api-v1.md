# 行业风险 API 合同 v1

## 端点

- `GET /api/v1/industry-risk/companies`
- `GET /api/v1/industry-risk/companies/{companyId}/assessment`
- `POST /api/v1/industry-risk/companies/{companyId}/ai-guidance`
- `GET /api/v1/industry-risk/graph`（旧证据图端点，产品页不再默认使用）
- `GET /api/v1/narrative-risk/industry-trends`（94家年报原始叙事指数与行业范围）

风险传导使用独立的 `risk-graph-api-v1` 合同和 `/api/v1/risk-graphs/*` 端点，不复用旧行业证据图。

权威 TypeScript 类型位于 `src/domain/industry-risk-v1/assessment-api.ts`，前端运行时解析位于 `src/lib/industry-risk-api.ts`。后端增加字段时，两处和测试必须在同一 PR 内更新。

## Assessment 响应

| 字段                                      | 语义                                              | 可为空 |
| ----------------------------------------- | ------------------------------------------------- | ------ |
| `contract`                                | 投资者产品语义与合同版本                          | 否     |
| `assessment.metrics[].rawValue`           | 原始观测值                                        | 是     |
| `assessment.metrics[].riskPercentile`     | 同口径同业风险分位，0–1                           | 是     |
| `assessment.metrics[].riskScore`          | 当前方法单指标风险分，0–100                       | 是     |
| `assessment.metrics[].missingReason`      | 未评分原因；已评分时为 null                       | 是     |
| `assessment.metrics[].sampleSize`         | 同口径样本数                                      | 否     |
| `assessment.metrics[].formulaTrace`       | 本次结果公式追踪                                  | 否     |
| `assessment.metrics[].limitation`         | 方法和数据限制                                    | 否     |
| `assessment.financialReportNarrativeRisk` | 财报叙事三维度状态与结果；语料未接入时分数为 null | 否     |
| `observations`                            | 当前企业原始指标观测                              | 否     |
| `coverage`                                | R01–R22 覆盖状态                                  | 否     |
| `events`                                  | 结构化近期事件                                    | 否     |
| `narrativeNews`                           | 资讯展示语料                                      | 否     |
| `reportAvailability`                      | 正式报告覆盖                                      | 是     |
| `provenance`                              | 数据来源、截止日和范围                            | 否     |

## 前端禁止字段

投资者页面和其新 DTO 禁止出现：`owner`、`dueDate`、`taskStatus`、`pendingAction`、`responsibleDepartment`。新闻和事件的关联只表示研究关联，不表示已进入评分。

投资研判的机构、个人和银行视角，以及企业风险应对建议，均由同一 assessment 响应派生：只能使用已校验的风险分、同业分位、缺失原因、来源数量和事件，不新增无法追溯的结论字段。企业降险建议属于展示层规则，不写回 observation 或评分结果。

## AI增强建议响应

`POST /api/v1/industry-risk/companies/{companyId}/ai-guidance` 只接受 `institution`、`individual`、`bank`、`enterprise-response` 四种视角。浏览器只提交视角，后端必须按 `companyId` 自行读取权威 assessment，禁止接受前端提交的风险分、分位或事件作为模型依据。

响应使用 `KCR-AI-GUIDANCE-2026.09-v1`，`provider` 必须明确标识为 `openai` 或 `deepseek`。每条建议必须返回服务端装配的 `evidence[]`，包括指标编号、标签、正式评分/缺失状态、风险分、同业风险分位、来源数量和缺失原因。模型只生成摘要、理由、补充动作和人工验证方法；指标引用必须由服务端白名单复核，不能由模型生成来源、分数或缺失状态。

AI链路必须满足：

- 使用结构化输出并在服务端再次运行时校验；
- 模型请求不保存为可续接会话；OpenAI 与 DeepSeek 使用各自独立的服务端 API Key，禁止跨 provider 自动复用；
- 自定义 Responses API 代理必须使用可验证的 HTTPS；只允许本机回环地址在开发环境使用明文 HTTP，禁止跳过证书校验；
- 不发送 `narrativeNews`、新闻正文、付费原始响应、风险图谱或用户个人资产信息；
- 不改变 `IndustryRiskAssessmentApiResponse`，不写回 observation、coverage、评分或图谱；
- 模型不可用、超时或输出越界时返回明确错误，原规则研判和风险应对继续可用；
- 禁止输出买入、卖出、目标价、收益预测、仓位、授信额度、利率、审批结论、责任人、截止日期、任务状态或工单。

## 财报叙事结构

`assessment.financialReportNarrativeRisk` 使用方法版本 `KCR-FINANCIAL-NARRATIVE-2026.08-v1`，固定包含三个维度：

1. `management-tone`：管理层语调；
2. `innovation-talk-action-gap`：创新“多言寡行”；
3. `effective-information-uncertainty`：有效信息与不确定性。

约束如下：

- `corpus` 必须为 `annual-report`；
- 新闻字段只服务资讯展示，`newsExcludedFromScore` 必须为 `true`；
- 财报语料或结果缺失时，维度 `score` 和总 `score` 必须为 `null`，状态为 `data-pending`；
- 财报叙事不进入 R05–R22 客观风险总分，`affectsObjectiveScore` 必须为 `false`；
- 旧 R01–R04 代理观测不得改名或映射成上述三个正式维度结果。

## 行业叙事年度响应

- `observations[].value` 是直接计算得到的原始指数，不是0–100风险分；
- `industryStatistics` 必须按同业组、年度和指标返回均值、最小值、最大值及样本量；
- 企业缺失年度保持 `null + missingReason`，折线显示断点；
- 响应不得包含年报全文、私有归档路径或付费原始数据。

## 后续预留

正式财报叙事的接口结构已经在 assessment 响应中建约；后续接入语料与结果时必须保持该结构，不能复用新闻字段或旧 R01–R04 代理观测伪装实现。时间演化/GNN 仍未纳入该合同。
