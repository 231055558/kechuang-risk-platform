# 可编辑演示快照

- `cambricon_fee_kbg_snapshot.json`：可审阅、可版本控制的节点与关系快照。
- `cambricon_fee_kbg_demo.sqlite`：由同一 JSON 生成，供本地预览 API 直接读取。

修改 JSON 后重新生成 SQLite：

```powershell
cd knowledge-graph/backend
python tools/snapshot_bundle.py import `
  --json ../demo/cambricon_fee_kbg_snapshot.json `
  --sqlite-out ../demo/cambricon_fee_kbg_demo.new.sqlite
```

工具默认拒绝覆盖已有文件。确认新文件后再自行替换旧演示快照。

生成后可使用 `backend/tools/sync_neo4j_graph.py --db` 将新 SQLite 投影到个人 Neo4j。
不要只修改个人 Neo4j 而不提交 JSON/配置，否则其他协作者无法复现这些变化。
