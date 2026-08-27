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
- 时间图谱边必须带有效期、来源和抽取版本；缺少关系语义时不得生成边。
- SQLite 发布前必须启用并通过 `PRAGMA foreign_key_check`，同时写入非零 `user_version`。当前历史快照尚未迁移的限制必须保留在发布说明中。

## 变更流程

字段变更须按顺序更新：数据库迁移/导入器 → domain model → 后端 service → API response → 前端 guard → UI → contract tests。任何一步缺失都不得合并。
