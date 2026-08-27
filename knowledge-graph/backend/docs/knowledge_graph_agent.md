# 风险知识图谱 Agent

该 Agent 复用现有采集链路，**不重复采集数据，也不让 LLM 直接生成事实或风险分**。它只将已经留痕、解析和标准化的数据投影为可审计的风险知识图谱。

## 输入与输出

输入来自当前 SQLite 中的：

- `companies`：企业及统一身份信息；
- `entities`、`entity_relations`：实体抽取与关系抽取结果；
- `indicator_scores`：已有指标计算结果；
- 证据、来源与复核字段：用于回溯、置信度控制和人工复核。

输出为五张图谱表：

- `knowledge_graph_runs`：一次图谱运行/快照元数据；
- `knowledge_graph_nodes`：规范化节点的当前状态；
- `knowledge_graph_edges`：规范化有向边的当前状态；
- `knowledge_graph_snapshot_nodes`、`knowledge_graph_snapshot_edges`：每个运行版本中包含的节点和边；
- `knowledge_graph_validation_issues`：孤立点、低置信度、断边和企业无关系等校验结果。

## 运行

```powershell
Set-Location knowledge-graph/backend
python tools\run_knowledge_graph_agent.py --run-id cambricon_kg_20260818 --company "中科寒武纪科技股份有限公司"
```

默认只纳入已经通过自动阈值、无需人工复核的实体和关系。若需要查看全部候选图谱：

```powershell
python tools\run_knowledge_graph_agent.py --run-id cambricon_kg_candidate_20260818 --company "中科寒武纪科技股份有限公司" --include-unreviewed
```

## 当前映射

现有采集类型会投影到风险图谱 Schema，例如：

- `company` → `company`；
- `patent`、`technology_route`、`product` → `technical_asset`；
- `supplier`、`customer` → `supply_chain`；
- `person` → `personnel_structure`；
- `sanction_entity`、`controlled_component` → `sanctions_event`；
- `related_entity` → `personnel_risk_event`；
- 指标计算结果 → `financial_indicator`，通过 `has_risk_indicator` 边挂在企业节点。

关系会转换为可计算的有向关系，例如 `has_patent` → `owns`、`has_supplier` → `procures_from`、`has_person` → `employs`、`screening_match` → `restricted_by`、`related_to` → `associated_risk`。

## 后续接入

指标纯文本处理和指标计算完成后，只需要继续写入既有 `indicator_scores` 表。Agent 下次运行会自动把每个企业最新指标结果投影为指标节点和 `has_risk_indicator` 边，无需修改图谱写入逻辑。

## Neo4j 部署与同步（4.1 / 4.2 Schema）

`修改意见.pdf` 的第 4.1 / 4.2 节已固化在 `config/neo4j_risk_schema_20260818.json`。它定义企业和 18 类风险节点的 Neo4j Label，以及“拥有、雇佣、采购、受罚、收函、涉诉、受限、持股、离职”等有向关系。当前采集链路的额外实体仍会保留为 `SupplementalEntity`，不会丢失来源事实。

图谱 Agent 会再将 22 个风险指标投影为第 4.1 节规定的节点类型及第 4.2 节关系，例如：监管处罚 → `ComplianceEvent` / `PENALIZED_BY`，研发投入 → `RDInvestment` / `INVESTS_IN`，募投里程碑 → `RDProject` / `COMMITS_TO`，股权稳定性 → `EquityStructure` / `HELD_BY`，人员稳定性 → `PersonnelMobility` / `LEAVES`。若指标已有分数但上游尚未保留对应外部主体或事件，图中保留带计算依据的指标节点；不会凭空创建监管机构、法院、金融机构、国家地区或个人节点。

对结构化事实证据，Agent 还会构建第 4.2 节的可追溯多跳路径。例如：`企业-受罚-监管事件-监管机构`、`企业-涉诉-诉讼事件-法院/对手方`、`企业-融资-融资事实-金融机构`、`企业-受限-制裁事实-国家地区/受管制零部件`。外部主体只会由证据字段（如处罚机关、执行法院、当事人、国别）生成，并携带来源证据 ID。质量校验会拒绝“监管关系未指向监管机构”“裁判关系未指向法院”“海外经营关系未指向地区”的不符合 Schema 边。

推荐本机使用 Neo4j Desktop：新建本地 DBMS，密码自行保存，然后启动数据库。在 Neo4j Browser 中确认能执行 `RETURN 1;`；Bolt 默认地址为 `bolt://localhost:7687`，浏览器界面通常是 `http://localhost:7474`。

安装连接驱动并初始化 Schema：

```powershell
Set-Location knowledge-graph/backend
python -m pip install -r requirements-neo4j.txt
$env:NEO4J_PASSWORD = "请替换为你的Neo4j密码"
python tools\sync_neo4j_graph.py --init-only
```

每次采集、指标计算和 SQLite 图谱快照完成后，按运行 ID 增量同步：

```powershell
python tools\run_knowledge_graph_agent.py --run-id cambricon_kg_20260818 --company "中科寒武纪科技股份有限公司"
python tools\sync_neo4j_graph.py --run-id cambricon_kg_20260818
```

同步器以 `knowledge_graph_nodes`、`knowledge_graph_edges` 和指定快照为唯一来源：节点的 `node_key`、关系的 `edge_key` 都是稳定 `MERGE` 键；置信度、人工复核、来源实体/关系 ID、快照运行 ID 一并写入 Neo4j。默认不删除历史节点和边。如需把旧成员仅标记为不属于当前快照（仍保留审计历史），追加 `--mark-not-in-snapshot`。

## 动态前端与本地 Graph API

`knowledge-graph/frontend/risk-knowledge-graph.html` 不内嵌生产节点或风险分。它通过同源 API 从 Neo4j 读取当前快照；Neo4j 密码仅在 Python 服务进程中使用，浏览器不会获得凭据。

先完成图谱同步，然后在 PowerShell 启动服务：

```powershell
$env:NEO4J_PASSWORD = Read-Host "Neo4j password"
python tools\serve_risk_graph_api.py
```

在浏览器打开 `http://127.0.0.1:8765/`，不要再用 `file:///` 方式直接打开 HTML。服务默认只监听本机回环地址，并且 API 只允许固定的只读图查询：`/api/health`、`/api/companies`、`/api/graph`。

新爬虫或 Excel 数据入库后的统一刷新链路为：

```powershell
$env:NEO4J_PASSWORD = Read-Host "Neo4j password"
.\tools\refresh_graph_and_neo4j.ps1
```

该脚本依次执行 Excel 去重导入、SQLite 图谱重建、Neo4j 同步。若本次只有爬虫数据、没有新 Excel，执行：

```powershell
.\tools\refresh_graph_and_neo4j.ps1 -SkipWorkbookImport
```
