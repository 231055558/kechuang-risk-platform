# 企业风险传导知识图谱 API 合同 v1

运行时版本：`KCR-RISK-GRAPH-POSTGRES-2026.08-v1`

## 存储与访问边界

- PostgreSQL 是知识图谱服务唯一运行数据库；本地 SQLite 只作为采集、计算和迁移源。
- 浏览器不得直接连接 PostgreSQL。页面只能请求同源后端 API，数据库凭据只保存在云端环境变量。
- 不上传采集令牌、付费原始响应、浏览器会话或完整本地主数据库。
- PostgreSQL 保存已经校验的节点、方向关系、边权、置信度、来源引用和抽取版本。

## 端点

- `GET /api/v1/risk-graph/health`
- `GET /api/v1/risk-graph/companies`
- `GET /api/v1/risk-graph/fee-transmission?company_key=...&min_weight=0.50`
- `GET /api/v1/risk-graph/subject-panorama?company_key=...&min_weight=0.50`

`min_weight` 仅允许 `0.35`、`0.50`、`0.75`。图谱视图由离线构建器生成并存入
PostgreSQL，前端不得自行生成传导边、因果关系、事件演化或权重。

## PostgreSQL 表

- `risk_graph_companies`：企业根节点、当前快照和运行版本。
- `risk_graph_snapshots`：企业、视图、权重阈值对应的完整 JSONB 图谱响应。
- `risk_graph_imports`：每次迁移的版本、来源、企业数和快照数审计。

导入必须在单一事务和 advisory lock 内完成。生产后端查询失败时返回明确的
`503`，不得回退到内置假数据或旧星型证据图。
