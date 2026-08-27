# Edge 可见表格补数扩展

该扩展用于补充外部主体全景图所需的股东、高管、供应商、客户、关联企业及主体事件。
它只读取当前页面中用户可见的 HTML 表格，不读取密码、Cookie、LocalStorage 或隐藏接口。

## 安装扩展

1. 在 Edge 打开 `edge://extensions/`。
2. 打开“开发人员模式”。
3. 选择“加载解压缩的扩展”。
4. 选择目录：`knowledge-graph/backend/edge_extension`。

## 启动本地接收器

```powershell
Set-Location knowledge-graph/backend
.\tools\start_edge_capture_receiver.ps1
```

健康检查地址为 `http://127.0.0.1:8770/health`。接收器只监听本机回环地址。

## 采集流程

1. 在浏览器中打开已授权且用户可见的主体数据页面。
2. 点击扩展“Risk KG Visible Table Capture”。
3. 填写目标企业，默认为寒武纪。
4. 选择页面来源权限：公开免费、已授权且本次不产生费用、可能产生费用。
5. 点击“读取可见表格”，确认需要的表格和数据类型。
6. 点击“发送到本地项目”。

原始页面留痕写入 `data/edge_captures/`，转换结果写入
`data/structured_exports/<dataset_type>/`，默认仍需人工复核。

标记为“可能产生费用”的页面只保存原始留痕，不会写入结构化导入目录。必须取得用户明确批准后，
才能另行处理或调用相应付费数据源。

## 导入数据链

```powershell
$py = (Get-Command python -ErrorAction Stop).Source
& $py -m src.pipeline --config config\edge_capture_registry.json --run-id cambricon_edge_review_YYYYMMDD
```

导入后重新运行寒武纪 FEE-KBG 构建、校验和 Neo4j 同步。未经复核的主体关系可以进入全景候选层，
但不能直接生成风险传导链。
