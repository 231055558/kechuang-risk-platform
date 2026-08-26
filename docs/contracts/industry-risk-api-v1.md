# 行业风险 API 合同 v1

## 端点

- `GET /api/v1/industry-risk/companies`
- `GET /api/v1/industry-risk/companies/{companyId}/assessment`
- `GET /api/v1/industry-risk/graph`（旧证据图端点，产品页不再默认使用）

权威 TypeScript 类型位于 `src/domain/industry-risk-v1/assessment-api.ts`，前端运行时解析位于 `src/lib/industry-risk-api.ts`。后端增加字段时，两处和测试必须在同一 PR 内更新。

## Assessment 响应

| 字段                                  | 语义                        | 可为空 |
| ------------------------------------- | --------------------------- | ------ |
| `contract`                            | 投资者产品语义与合同版本    | 否     |
| `assessment.metrics[].rawValue`       | 原始观测值                  | 是     |
| `assessment.metrics[].riskPercentile` | 同口径同业风险分位，0–1     | 是     |
| `assessment.metrics[].riskScore`      | 当前方法单指标风险分，0–100 | 是     |
| `assessment.metrics[].missingReason`  | 未评分原因；已评分时为 null | 是     |
| `assessment.metrics[].sampleSize`     | 同口径样本数                | 否     |
| `assessment.metrics[].formulaTrace`   | 本次结果公式追踪            | 否     |
| `assessment.metrics[].limitation`     | 方法和数据限制              | 否     |
| `observations`                        | 当前企业原始指标观测        | 否     |
| `coverage`                            | R01–R22 覆盖状态            | 否     |
| `events`                              | 结构化近期事件              | 否     |
| `narrativeNews`                       | 资讯展示语料                | 否     |
| `reportAvailability`                  | 正式报告覆盖                | 是     |
| `provenance`                          | 数据来源、截止日和范围      | 否     |

## 前端禁止字段

投资者页面和其新 DTO 禁止出现：`owner`、`dueDate`、`taskStatus`、`pendingAction`、`responsibleDepartment`。新闻和事件的关联只表示研究关联，不表示已进入评分。

## 后续预留

正式财报叙事评分、动态图谱和 GNN 必须使用新版本端点/合同，不能复用新闻字段或旧星型证据图伪装实现。
