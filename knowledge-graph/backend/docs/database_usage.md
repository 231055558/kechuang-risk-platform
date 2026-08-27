# 唯一主数据库说明

项目唯一事实数据库为：

```text
knowledge-graph/backend/data/risk_data.sqlite
```

所有结构化采集结果、解析结果、审核状态、指标计算、事件、图谱快照和迁移血缘均写入该文件。
原始 PDF、Excel、网页响应等大文件仍保存在 `data/` 子目录，主库保存路径、哈希、来源和解析结果。

## 表命名空间

- R01-R22 主数据：`companies`、`sources`、`indicator_catalog`、`observations`、
  `supplementary_observations`、`indicator_coverage` 等。
- 采集流水线：`crawler_companies`、`crawler_sources`、`crawler_indicators`、
  `crawler_evidence`、`crawler_pipeline_runs`、`crawler_indicator_scores` 等。
- iFinD 结构化解析：`documents`、`company_profiles`、`shareholders`、`people`、
  `patents`、`customers`、`news_events`、`raw_tables` 等。
- PDF 登记：`pdf_documents`。
- 处理数据归档：`processed_source_datasets`、`processed_source_records`。
- FEE-KBG 与图谱：`fee_*`、`knowledge_graph_*`。
- 统一迁移审计：`unified_database_migrations`。

采集代码通过 `src.database.CrawlerConnection` 自动访问 `crawler_*` 表，避免与 R01-R22 主表重名。

## 常用命令

```powershell
Set-Location knowledge-graph/backend

# 执行采集，处理结果进入主库 crawler_* 表
python -m src.pipeline --config config\source_registry.json --run-id demo

# 查询采集证据
python tools\query_database.py --db data\risk_data.sqlite --company 寒武纪 --evidence

# 构建和校验寒武纪图谱
python tools\run_fee_kbg_pilot.py --run-id cambricon_fee_kbg_20260826_v1
python tools\verify_fee_kbg_pilot.py --run-id cambricon_fee_kbg_20260826_v1

# 同步主库图谱快照到 Neo4j
python tools\sync_neo4j_graph.py --db data\risk_data.sqlite --run-id cambricon_fee_kbg_20260826_v1
```

## 约束

1. 不再创建 `risk_data_v2.sqlite`、`ifind_reports.sqlite`、`pdf_registry.sqlite` 等辅助数据库。
2. 新工具的数据库参数默认必须指向 `data/risk_data.sqlite`。
3. 外部数据库只能作为显式迁移输入，不能成为运行时依赖。
4. Neo4j 是主库图谱快照的可重建投影，不是独立事实来源。
5. 删除或迁移数据前必须先通过 `PRAGMA integrity_check` 和 `PRAGMA foreign_key_check`。
