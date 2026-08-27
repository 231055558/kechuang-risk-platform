# PDF 下载、登记与结构化抽取流程

PDF 统一存放目录：

```text
knowledge-graph/backend/data/pdfs/
```

同花顺企业信息 PDF 投放目录：

```text
<path-to-authorized-ifind-reports>
```

## 同花顺 iFinD 企业库 PDF 自动接入

将同花顺导出的企业库 PDF 放入 `同花顺企业信息` 目录后，可以直接运行：

```powershell
cd knowledge-graph/backend
python -m src.pipeline --config config\ifind_pdf_registry.json --run-id ifind_pdf_run
```

如果系统 Python 缺 `pdfplumber`，使用 Codex 捆绑 Python：

```powershell
python -m src.pipeline --config config\ifind_pdf_registry.json --run-id ifind_pdf_run
```

也可以只跑 PDF 目录抽取，不执行完整 pipeline：

```powershell
python tools\extract_ifind_pdf_directory.py --run-id ifind_pdf_refresh --risk-db data\risk_data.sqlite
```

## 当前结构化能力

同花顺企业库 PDF 会被抽取为以下证据类型：

- 工商信息：企业主体、统一社会信用代码、法定代表人、注册资本、行业等。
- 股东信息：用于股权稀释程度、实控关系候选。
- 高管/主要人员：用于高管关联风险和高管稳定性。
- 融资事件：用于融资成本和融资风险线索。
- 客户/中标项目：用于工程化与商业转化率。
- 供应商信息：用于供应链进口依赖度。
- 新闻舆情：用于叙事热度和重大负面事件候选。
- 专利信息：用于技术先进性-专利产出效率。
- 司法/诉讼/执行：用于诉讼风险。
- 监管/处罚：用于监管处罚次数。

抽取结果会进入：

```text
data\evidence\<run_id>\evidence.jsonl
data\results\<run_id>\indicator_scores.json
data\review\<run_id>\review_queue.jsonl
data\risk_data.sqlite
```

完整 pipeline 还会写入：

- `entities`
- `entity_relations`
- `indicator_scores`
- `pipeline_runs`
- `review_feedback`

## 仍保留的 iFinD-struct 路径

如果需要使用外部 `iFinD-struct` 做更细表结构解析：

```powershell
$env:PYTHONPATH="<path-to-ifind-struct-src>"
python -m ifind_report_parser.cli --source "data\pdfs\ifind" --db "data\risk_data.sqlite"
python tools\ifind_adapter.py --ifind-db data\risk_data.sqlite --risk-db data\risk_data.sqlite
```

新接入的 `ifind_pdf_directory` 是系统内置保守抽取路径；`iFinD-struct` 是更细粒度的外部增强路径。
