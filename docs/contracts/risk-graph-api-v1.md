# 风险传导图谱 API 合同 v1

运行时版本：`KCR-RISK-GRAPH-2026.08-v1`

## 产品边界

风险传导页只展示有证据的关系图谱及图谱控制。前端不得补画因果边、把缺失关系写成零风险，或把研发审核状态暴露给投资者。

两种视图严格分开：

| 视图               | 含义                                                        | 当前覆盖                                      |
| ------------------ | ----------------------------------------------------------- | --------------------------------------------- |
| `enterprise-event` | 企业自身已入库事件、已标注指标、风险领域和公开来源          | 77 家有结构化事件；寒武纪优先使用完整审计快照 |
| `external-subject` | 外部企业/人员发生事件，经已核验关联主体传导至目标企业的路径 | 94家目录内仅寒武纪；独立扩展试点另有芯驰科技  |

“同一效果”指相同 API、交互、图例和视觉编码，不表示每家企业具有相同节点数或相同关系。

## 端点

- `GET /api/v1/risk-graphs/companies`
- `GET /api/v1/risk-graphs/companies/{companyId}/views/{view}`
- 可选查询参数：`minWeight`，范围 `0.35–0.95`，默认 `0.5`

权威 TypeScript 类型位于 `src/domain/risk-graph-v1/api.ts`；后端装配位于 `server/risk-graph-service.ts`；前端运行时校验位于 `src/lib/risk-graph-api.ts`。三处和测试必须在同一 PR 内更新。

## 覆盖状态

每家公司、每个视图必须返回以下三态之一：

- `available`：图谱可展示；
- `unavailable`：缺少构图所需事实或关系证据；
- `service-unavailable`：已知快照存在，但图谱服务当前不可达。

`sourceMode` 说明数据如何形成：

- `audited-snapshot`：来自离线构建并落库的版本化快照；
- `structured-event-projection`：只连接现有事件、指标、领域与来源，不生成事件因果或未来演化；
- `none`：无图可展示。

缺失时 `nodes`、`edges` 必须为空，并提供 `missingReason`。前端不得用演示图替换缺失企业。

## 证据状态

节点和边使用 `evidenceState` 区分：

- `verified`：已入库事实或确定的指标分类关系；
- `inferred`：有明确规则或机制映射，但不是直接事实；
- `predictive`：条件化未来推演，不表示已经发生。

内部字段 `needs_review`、`review_reason`、`candidate`、内部校验结果不得进入对外 DTO。未通过审核的节点和与其相连的边必须在服务端过滤。

## 上游适配

Node 服务只通过 `GRAPH_API_ORIGIN` 连接 Python/Neo4j 图谱服务，浏览器不直接访问 Neo4j或其端口。平台iframe固定使用同源的 `risk-graph-workspace/`，Vite和生产Node服务再把该路径转发至图谱上游。默认本地上游为 `http://127.0.0.1:8766`；配置 `GRAPH_API_ORIGIN` 后，开发和生产服务复用该外部只读图谱服务，不再启动内置快照。

同源代理只允许工作站首页及 `/api/health`、`/api/companies`、`/api/fee-kbg`、`/api/fee-transmission`、`/api/event-transmission`、`/api/subject-panorama`、`/api/graph` 这些只读路径。禁止将其实现为任意URL开放代理。

图谱上游新增企业后，只要企业节点带 `stock_code` 与 `fee_kbg: true`，覆盖目录即可按股票代码自动识别，无需为每家公司改前端。

## 多企业快照

- 图谱程序、API、本体和前端工作站统一复用；每家公司拥有独立 `run_id`、节点成员和边成员，禁止把一家公司关系复制给另一家公司。
- SQLite/JSON版本化快照是可提交的事实来源，Neo4j只是可重建的查询投影。共享实体和关系在Neo4j中使用 `snapshot_run_ids[]` 记录多个快照成员关系。
- 重建某家公司时，只能移除该 `run_id` 的成员资格；仍属于其他快照的节点或边必须保持可用。`in_snapshot` 表示至少属于一个有效快照。
- 平台通过 `stock_code` 锁定当前企业；独立图谱工作站可以切换已加载快照。嵌入平台后不得切换到与当前公司上下文不一致的图谱。
- 当前已审计扩展试点为寒武纪 `688256` 与芯驰科技 `PRIVATE-SEMIDRIVE`。芯驰不属于94家上市公司目录，因此只在独立图谱工作站展示，不进入同业评分、排名或投资者报告。

## 泛化条件

企业自身事件图可由已有结构化事件自动投影，不要求人工逐家绘图。外部主体图至少需要：

1. 目标企业与外部企业/人员的关系类型、方向和来源；
2. 外部主体自身事件及其发生时间和公开来源；
3. 事件经关系传导到目标企业的机制、权重或审核结果；
4. 版本化快照标识和数据截止日。

这些事实缺失时，开发人员只能完善采集/导入/展示程序，不能替代数据组或金融组确认关系语义。

## PostgreSQL 运行时投影

运行时存储版本：`KCR-RISK-GRAPH-POSTGRES-2026.08-v1`

### 存储与访问边界

- PostgreSQL 是知识图谱服务唯一运行数据库；本地 SQLite 只作为采集、计算和迁移源。
- 浏览器不得直接连接 PostgreSQL。页面只能请求同源后端 API，数据库凭据只保存在云端环境变量。
- 不上传采集令牌、付费原始响应、浏览器会话或完整本地主数据库。
- PostgreSQL 保存已经校验的节点、方向关系、边权、置信度、来源引用和抽取版本。

### 运行时端点

- `GET /api/v1/risk-graph/health`
- `GET /api/v1/risk-graph/companies`
- `GET /api/v1/risk-graph/fee-transmission?company_key=...&min_weight=0.50`
- `GET /api/v1/risk-graph/subject-panorama?company_key=...&min_weight=0.50`

`min_weight` 仅允许 `0.35`、`0.50`、`0.75`。图谱视图由离线构建器生成并存入
PostgreSQL，前端不得自行生成传导边、因果关系、事件演化或权重。

这些端点服务独立图谱工作站；平台对外的 `risk-graphs` 端点及同源
`risk-graph-workspace/` 入口继续保持，浏览器不得直接访问数据库或上游端口。

### PostgreSQL 表

- `risk_graph_companies`：企业根节点、当前快照和运行版本。
- `risk_graph_snapshots`：企业、视图、权重阈值对应的完整 JSONB 图谱响应。
- `risk_graph_imports`：每次迁移的版本、来源、企业数和快照数审计。

导入必须在单一事务和 advisory lock 内完成。生产后端查询失败时返回明确的
`503`，不得回退到内置假数据或旧星型证据图。
