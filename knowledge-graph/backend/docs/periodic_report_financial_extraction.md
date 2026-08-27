# 年报/季报 PDF 下载与财务表格抽取

## 已实现

### 1. 上交所定期报告发现/下载器

脚本：

```text
tools\download_periodic_reports.py
```

用途：

- 从上交所单只股票静态公告源中筛选定期报告标题。
- 识别年度报告、半年度报告、季度报告。
- 下载 PDF 并登记到唯一主库 `risk_data.sqlite` 的 `pdf_documents` 表。
- 输出 manifest。

示例：

```powershell
python tools\download_periodic_reports.py --stock-code 688012 --company "中微半导体设备（上海）股份有限公司" --limit 3
```

当前测试结果：

- 成功从公告列表发现 `2026年第一季度报告`。
- PDF 直连下载被上交所 CDN bot 防护拦截，返回 HTML 防护页，不是 PDF。

因此生产方案需要：

- 优先使用巨潮资讯/交易所历史接口的可下载 PDF；
- 或使用浏览器会话下载；
- 或接受用户已有 PDF 后通过 `pdf_downloader.py` 登记。

### 2. 财务表格抽取器

脚本：

```text
tools\extract_financial_pdf.py
```

核心模块：

```text
src\financial_pdf.py
```

默认只从 PDF 表格中抽取，避免把正文日期、新闻标题误判成财务数字。

当前识别字段：

- 营业收入
- 研发费用/研发投入
- 资产总计
- 无形资产
- 负债合计
- 净利润
- 经营活动产生的现金流量净额
- 海外/境内收入候选
- 主营业务/分部收入候选
- 前五大供应商采购额候选

示例：

```powershell
python tools\extract_financial_pdf.py --pdf "<path-to-report.pdf>" --company "某企业" --extract-sections
```

输出：

```text
data\financial_extracts\
data\annual_report_extracts\
```

并把财务字段和年报字段候选转换成本系统 evidence。财务字段标签为：

```text
financial_pdf
financial_numeric
```

年报字段候选会带页码/表格号，标签包括：

```text
business_segment
equity_structure
personnel_change
supplier_data
rd_project
technology_evidence
trl_evidence
```

这些字段用于覆盖率和人工复核，不直接改变指标公式。

## 批量抽取已登记 PDF

从主库 `risk_data.sqlite` 读取已登记 PDF，批量抽取并写回同一主库：

```powershell
python tools\extract_registered_pdfs.py --risk-db data\risk_data.sqlite --registry-db data\risk_data.sqlite --extract-sections
```

如果系统 Python 缺 `pdfplumber`，使用 Codex 捆绑 Python 或安装依赖后再运行。

## 重要限制

iFinD 企业库 PDF 不是标准年报，财务字段分布和格式不稳定。默认表格模式对样例 iFinD PDF 不产生财务字段，这是正确的保守行为。

如果启用文本后备：

```powershell
python tools\extract_financial_pdf.py --pdf "..." --company "..." --include-text-fallback
```

可能误把日期年份或新闻标题中的数字当财务数值，因此只建议对 iFinD 企业库 PDF 等非标准年报做人工检查时使用。

## 下一步

要让财务指标稳定落地，下一步应补：

1. 巨潮资讯/交易所历史定期报告下载源。
2. 浏览器会话下载器，绕开静态 PDF 直连防护。
3. 继续细化年报章节边界，减少章节候选重复。
4. 对主营构成、供应商、股东表做结构化行列抽取。
5. 接入人工复核结果回写，确认后再参与后续规则计算。
