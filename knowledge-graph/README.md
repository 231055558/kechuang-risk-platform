# 寒武纪金融事件演化知识图谱

本模块是科创风险平台“风险传导”能力的独立实现。它遵守仓库现有投资者产品合同：
图谱关系由后端快照提供，前端不自行制造因果边或风险传播关系。

## 包含内容

- `frontend/`：双知识图谱交互页面。
- `backend/src/`：R01-R22 图谱构建、FEE-KBG、关系权重和条件事件演化。
- `backend/tools/`：构建、校验、Neo4j 同步、API、脱敏快照和 Edge 可见表格采集工具。
- `backend/config/`：寒武纪试点规则和 Neo4j Schema。
- `backend/edge_extension/`：只读取当前页面可见表格的 Edge 扩展。
- `demo/`：无需生产数据库即可运行和修改的脱敏快照。

不包含密码、付费原始响应、生产 SQLite、数据库备份、Cookie 或本机路径。

## 立即运行演示图谱

```powershell
cd knowledge-graph/backend
python tools/serve_fee_kbg_preview.py `
  --db ../demo/cambricon_fee_kbg_demo.sqlite `
  --run-id cambricon_fee_kbg_20260826_v1 `
  --port 8766
```

打开 `http://127.0.0.1:8766/`。

## 如何修改

1. 布局、颜色和交互：修改 `frontend/risk-knowledge-graph.html`。
2. 节点类型和关系名称：修改 `backend/config/neo4j_fee_kbg_schema_20260826.json`。
3. 事件识别、权重和条件演化：修改 `backend/config/fee_kbg_cambricon_pilot_20260826.json`。
4. 构图算法：修改 `backend/src/fee_kbg.py`。
5. 演示节点/关系：修改 `demo/cambricon_fee_kbg_snapshot.json`，再用
   `backend/tools/snapshot_bundle.py import` 生成新的演示 SQLite。

条件事件演化边必须满足：从已发生事件出发、目标是预测场景、记录触发条件/概率/时间范围，
并且目标严重度严格高于前序事件。预测场景不表示已经发生。

## 使用完整本地数据重建

将兼容的本地数据库放到 `backend/data/risk_data.sqlite`（该文件被忽略），然后：

```powershell
cd knowledge-graph/backend
python tools/run_fee_kbg_pilot.py --run-id cambricon_fee_kbg_20260826_v1
python tools/verify_fee_kbg_pilot.py --run-id cambricon_fee_kbg_20260826_v1
```

同步到本机 Neo4j：

```powershell
$env:NEO4J_PASSWORD = Read-Host "Neo4j password"
python tools/sync_neo4j_graph.py `
  --run-id cambricon_fee_kbg_20260826_v1 `
  --mark-not-in-snapshot `
  --replace-relation-types
python tools/serve_risk_graph_api.py
```

## 验证

```powershell
cd knowledge-graph/backend
python -m unittest `
  tools.test_fee_kbg `
  tools.test_serve_risk_graph_api `
  tools.test_edge_capture_receiver
```

图谱用于风险研究和辅助研判，不构成事实性经营结论、法律意见或投资建议。
