# iFinD-struct 集成评估

仓库：

```text
https://github.com/QianCJLU/iFinD-struct
```

本地位置：

```text
<path-to-ifind-struct>
```

## 结论

该工具与本系统高度契合，适合作为“同花顺 iFinD 企业库 PDF 结构化解析层”。

它能从 iFinD 企业分析报告中解析：

- 工商信息
- 股东信息
- 高管/主要人员
- 融资事件
- 招投标/客户
- 供应商
- 新闻舆情
- 专利
- 软著
- 商标
- 司法/风险原文段
- 缺失字段提示
- 公司级统计

## 注意

它自己的 SQLite 表结构不是本系统主库结构，所以不能直接替代本系统数据库。

推荐用法：

1. `pdf_downloader.py` 负责下载/登记 PDF。
2. `iFinD-struct` 负责将 PDF 解析结果写入唯一主库 `risk_data.sqlite` 的 iFinD 结构化表。
3. `ifind_adapter.py` 负责把解析结果转换为本系统 evidence。

## 运行示例

登记 PDF：

```powershell
python tools\pdf_downloader.py --local-pdf "<path-to-report.pdf>" --company "宇树科技股份有限公司" --source-name iFinD
```

解析 PDF：

```powershell
$env:PYTHONPATH="<path-to-ifind-struct-src>"
python -m ifind_report_parser.cli --source "data\pdfs\ifind" --db "data\risk_data.sqlite"
```

转换到风险系统主库：

```powershell
python tools\ifind_adapter.py --ifind-db data\risk_data.sqlite --risk-db data\risk_data.sqlite
```
