# 行业风险存储接口 v1

当前发布快照来自仓库内 SQLite 与生成的运行时 JSON。数据库属于输入证据层，评分结果由后端按方法版本计算，不回写覆盖原始值。

## 必需实体与字段

| 实体                | 必需字段                                                                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| company             | `id`、`name`、`stockCode`、`peerGroupId`、`chainSegment`                                                                                                |
| indicator           | `id`、`label`、`dimensionId`、`direction`、`definition`、`formulaDescription`                                                                           |
| observation         | `id`、`companyId`、`indicatorId`、`metricName`、`periodStart/periodEnd/asOf`、`numericValue/textValue`、`unit`、`sourceId`、`confidence`、`limitations` |
| source              | `id`、`institution`、`title`、`url`、`publicationDate/accessedAt`、`sourceType`                                                                         |
| coverage            | `companyId`、`indicatorId`、`status`、`reason`、`recommendedNextSource`                                                                                 |
| event               | `id`、`companyId`、`eventType`、`date`、`title`、`url`、`relatedIndicatorId`、`confidence`                                                              |
| narrative corpus    | `companyId`、`reportPeriod`、`reportSection`、`sourceId`、`textLocator`、`extractedText`、`extractorVersion`                                            |
| narrative annual statistic | `industryGroupId`、`year`、`metricKey`、`sampleSize`、`mean`、`minimum`、`maximum`、`standardDeviation`                                      |
| temporal graph edge | `sourceEntityId`、`targetEntityId`、`relationType`、`validFrom`、`validTo`、`confidence`、`sourceId`、`extractionVersion`                               |

## 约束

- `numericValue` 与 `textValue` 至少一个存在；缺失记录使用 coverage 原因，禁止写入 0 作为占位。
- 所有用于评分的 observation 必须能追溯到 source 和期间。
- 新闻语料与财报叙事语料分表/分类型保存，禁止在导入器中合并。
- 财报叙事结果必须按 `companyId + reportPeriod + methodVersion + dimensionId` 唯一标识，并保留 `score/status/missingReason/sourceIds`；在结果表正式迁移前仅允许由后端返回 `data-pending` 派生结构，不得写入占位分数。
- 时间图谱边必须带有效期、来源和抽取版本；缺少关系语义时不得生成边。
- `enterprise-event` 的结构化投影只允许连接已存在的 `event.relatedIndicatorId`、指标分类和事件 URL；不得由标题关键词临时生成因果边。
- `external-subject` 快照必须同时具备目标企业股票代码、外部主体关系证据和外部事件证据。只有企业节点不得标记为该视图可用。
- SQLite 发布前必须启用并通过 `PRAGMA foreign_key_check`，同时写入非零 `user_version`。当前历史快照尚未迁移的限制必须保留在发布说明中。

## 变更流程

字段变更须按顺序更新：数据库迁移/导入器 → domain model → 后端 service → API response → 前端 guard → UI → contract tests。任何一步缺失都不得合并。

## 2026-08-27 财报叙事结构变更影响

PostgreSQL 迁移 `004`–`006` 已新增财报叙事方法、年度文档、年度原始观测、同业年度统计及审计记录。当前发布视图只展示原始年度指数及其行业区间，不将其改写为0–100正式叙事评分，也不进入R05–R22客观总分。

本次没有修改 SQLite 表、列、索引；94家核心快照仍是可复核的发布输入，新增结构只进入PostgreSQL叙事schema与脱敏运行时快照。

本地和服务器导入必须按迁移顺序执行，并以 `dataVersion + companyId + year + metricKey` 保持年度观测唯一。任何代理专利值必须保留 `patentProxy`、来源、置信度与限制；数据库或脱敏快照均不得包含付费原始响应、财报全文或私有文件路径。
