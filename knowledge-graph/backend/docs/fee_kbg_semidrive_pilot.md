# 芯驰科技 FEE-KBG 试点

本试点的目标企业为北京芯驰半导体科技股份有限公司（非上市企业内部标识：
`PRIVATE-SEMIDRIVE`）。快照与寒武纪使用同一主数据库和 Neo4j，但每家公司拥有
独立版本号；共享供应商、风险指标和风险类别通过多快照成员关系统一复用。

## 免费公开数据范围

本批数据全部通过 Edge 可见页面和既有免费官方来源核验，没有调用付费接口：

- 芯驰科技官网企业介绍：法律主体、研发中心、产品与量产概况。
- 芯驰科技官网合作伙伴：安谋科技、新思科技、铿腾电子、台积电、通富微电、
  日月光等知识产权、电子设计自动化、晶圆代工和封装测试伙伴。
- 芯驰科技官网管理层与融资公告：仇雨菁、张强、程泰毅及 C 轮产业投资机构。
- 芯驰科技官网客户合作公告：华阳通用、德赛西威、延锋国际。
- 公开行业媒体：2019 年不正当竞争诉讼、2023 年智能驾驶芯片业务中止及组织调整。
- 合作伙伴与政府官方来源：安谋科技历史治理事件、新思科技出口限制及撤销、
  铿腾电子出口合规处罚；台积电年度报告披露的地震生产损失。

Edge 原始留痕位于 `data/edge_captures/`，结构化转换位于
`data/structured_exports/`。这些原始文件不上传 GitHub；主库保存处理结果和来源引用。

## 快照内容

`semidrive_fee_kbg_20260827_v1` 当前包含：

- 75 个节点、142 条关系；
- 3 个企业自身已发生事件、4 个高影响风险源；
- 6 个带方向、条件、概率、期限和严重度递增的可能演化场景；
- 16 个重要外部主体，其中 4 个主体形成 5 条核验风险传导路径；
- 10 个官网供应链或技术伙伴、3 个官网客户和 3 名核心管理人员；
- 6 个缺少持股比例的融资机构仅作为待复核候选，不进入默认阈值。

外部主体权重中的“关系规模”对芯驰采用配置化关键依赖分级，依据官网合作类别区分
晶圆代工、核心知识产权、电子设计自动化和封装测试的重要性；该分级不代表采购占比。

## 构建与校验

```powershell
Set-Location D:\codex\risk_crawler_architecture
python tools\seed_semidrive_pilot.py
python tools\run_fee_kbg_pilot.py `
  --run-id semidrive_fee_kbg_20260827_v1 `
  --stock-code PRIVATE-SEMIDRIVE `
  --config config\fee_kbg_semidrive_pilot_20260827.json
python tools\verify_fee_kbg_pilot.py --run-id semidrive_fee_kbg_20260827_v1
```

仅预览 SQLite 快照：

```powershell
python tools\serve_fee_kbg_preview.py `
  --run-id semidrive_fee_kbg_20260827_v1 `
  --port 8766
```

同步两家公司到 Neo4j：

```powershell
$secure = Read-Host "Neo4j password" -AsSecureString
$env:NEO4J_PASSWORD = [System.Net.NetworkCredential]::new("", $secure).Password
.\tools\refresh_fee_kbg_semidrive.ps1 `
  -RunId semidrive_fee_kbg_20260827_v1
```

同步脚本会先迁移寒武纪快照的多快照成员关系，再同步芯驰，避免共享节点覆盖另一家公司。

## 已知缺口与付费边界

- 免费来源尚未取得恩智浦诉讼的完整案号、裁判结果和当前效力。
- 融资公告披露了投资机构，但没有公开持股比例，因此不计算正式股权权重。
- 未取得完整财务报表、客户交易金额和各供应商采购占比。
- 同花顺、天眼查或其他付费数据源必须在调用前单独获得用户批准并估算费用；
  当前单次付费上限为人民币 35 元，未经再次确认不得调用。

知识图谱只表达证据支持的风险暴露与条件演化，不构成事实性经营结论、法律意见或投资建议。
