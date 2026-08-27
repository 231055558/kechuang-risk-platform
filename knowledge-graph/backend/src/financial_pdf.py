from __future__ import annotations

import re
from pathlib import Path
from typing import Any

try:
    import pdfplumber
except ImportError:  # PDF extraction is an optional runtime capability.
    pdfplumber = None


PDFPLUMBER_INSTALL_HINT = "PDF extraction requires pdfplumber. Install project dependencies with: python -m pip install -r requirements.txt"


def require_pdfplumber() -> None:
    if pdfplumber is None:
        raise RuntimeError(PDFPLUMBER_INSTALL_HINT)


STANDARD_FIELD_PATTERNS = {
    "total_assets": {
        "statement": "balance_sheet",
        "labels": ["资产总计", "总资产"],
    },
    "total_liabilities": {
        "statement": "balance_sheet",
        "labels": ["负债合计", "负债总计", "总负债"],
    },
    "monetary_funds": {
        "statement": "balance_sheet",
        "labels": ["货币资金"],
    },
    "accounts_receivable": {
        "statement": "balance_sheet",
        "labels": ["应收账款"],
    },
    "inventory": {
        "statement": "balance_sheet",
        "labels": ["存货"],
    },
    "intangible_assets": {
        "statement": "balance_sheet",
        "labels": ["无形资产"],
    },
    "short_term_borrowing": {
        "statement": "balance_sheet",
        "labels": ["短期借款"],
    },
    "long_term_borrowing": {
        "statement": "balance_sheet",
        "labels": ["长期借款"],
    },
    "bonds_payable": {
        "statement": "balance_sheet",
        "labels": ["应付债券"],
    },
    "revenue": {
        "statement": "income_statement",
        "labels": ["营业收入", "营业总收入"],
    },
    "operating_cost": {
        "statement": "income_statement",
        "labels": ["营业成本", "营业总成本"],
    },
    "gross_profit": {
        "statement": "income_statement",
        "labels": ["毛利"],
    },
    "rd_expense": {
        "statement": "income_statement",
        "labels": ["研发费用", "研发投入", "研发投入合计", "研发支出"],
    },
    "interest_expense": {
        "statement": "income_statement",
        "labels": ["利息费用", "利息支出"],
    },
    "net_profit": {
        "statement": "income_statement",
        "labels": ["净利润", "归属于上市公司股东的净利润"],
    },
    "operating_cash_flow": {
        "statement": "cash_flow_statement",
        "labels": ["经营活动产生的现金流量净额"],
    },
    "cash_received_from_sales": {
        "statement": "cash_flow_statement",
        "labels": ["销售商品、提供劳务收到的现金", "销售商品、提供劳务收到的现金"],
    },
    "cash_paid_for_goods": {
        "statement": "cash_flow_statement",
        "labels": ["购买商品、接受劳务支付的现金"],
    },
    "cash_paid_to_employees": {
        "statement": "cash_flow_statement",
        "labels": ["支付给职工以及为职工支付的现金"],
    },
    "overseas_revenue": {
        "statement": "segment_information",
        "labels": ["境外收入", "海外收入", "国外收入", "外销收入"],
    },
    "domestic_revenue": {
        "statement": "segment_information",
        "labels": ["境内收入", "国内收入", "内销收入"],
    },
    "segment_revenue": {
        "statement": "segment_information",
        "labels": ["分部收入", "主营业务收入"],
    },
    "top_supplier_purchase_amount": {
        "statement": "supplier_customer",
        "labels": ["前五名供应商采购额", "前五大供应商采购额", "前五名供应商采购金额"],
    },
    "top_supplier_purchase_ratio": {
        "statement": "supplier_customer",
        "labels": ["前五名供应商采购额占年度采购总额比例", "前五大供应商采购额占比"],
    },
}

FIELD_ALIASES = {label: field for field, meta in STANDARD_FIELD_PATTERNS.items() for label in meta["labels"]}

STATEMENT_HINTS = [
    ("consolidated_balance_sheet", ["合并资产负债表"]),
    ("parent_balance_sheet", ["母公司资产负债表"]),
    ("balance_sheet", ["资产负债表"]),
    ("consolidated_income_statement", ["合并利润表"]),
    ("parent_income_statement", ["母公司利润表"]),
    ("income_statement", ["利润表"]),
    ("consolidated_cash_flow_statement", ["合并现金流量表"]),
    ("parent_cash_flow_statement", ["母公司现金流量表"]),
    ("cash_flow_statement", ["现金流量表"]),
    ("key_financial_data", ["主要会计数据", "主要财务指标"]),
    ("segment_information", ["主营业务分行业", "主营业务分产品", "主营业务分地区", "分部信息", "地区收入"]),
    ("supplier_customer", ["前五名供应商", "前五大供应商", "前五名客户", "前五大客户"]),
]

SECTION_PATTERNS = [
    {
        "field": "business_segment",
        "labels": ["主营业务分行业", "主营业务分产品", "主营业务分地区", "分部信息", "境外收入", "海外收入"],
        "indicator": "海外业务收入占比",
        "tags": ["business_segment", "country_region", "financial_pdf"],
        "review_reason": "主营构成和海外收入需要核验地区/产品口径、金额单位和是否合并口径",
    },
    {
        "field": "supplier_customer",
        "labels": ["前五名供应商", "前五大供应商", "前五名客户", "前五大客户", "采购额", "销售额"],
        "indicator": "供应链进口依赖度",
        "tags": ["supplier_data", "customer_acceptance", "country_region", "financial_pdf"],
        "review_reason": "供应商客户章节需要核验是否披露名称、境内外属性、金额和集中度口径",
    },
    {
        "field": "rd_project",
        "labels": ["研发项目", "在研项目", "研发投入情况", "项目进展", "预计总投资规模"],
        "indicator": "工程化与商业转化率",
        "tags": ["rd_project", "technology_evidence", "financial_pdf"],
        "review_reason": "研发项目需要核验项目阶段、验收状态、商业化进展和终止项目披露完整性",
    },
    {
        "field": "core_technician",
        "labels": ["核心技术人员", "董事、监事和高级管理人员", "离任", "辞职", "聘任", "变动情况"],
        "indicator": "高管稳定性",
        "tags": ["person_profile", "personnel_change", "financial_pdf"],
        "review_reason": "核心技术人员和高管变动需要区分正常换届、异常离职和核心人员流失",
    },
    {
        "field": "patent",
        "labels": ["专利", "发明专利", "授权专利", "申请号", "公开号", "知识产权"],
        "indicator": "技术先进性-专利产出效率",
        "tags": ["patent_data", "patent_legal_status", "patent_claim_text", "financial_pdf"],
        "review_reason": "专利章节需要补充法律状态、权利要求、引用、专利族和产品映射后再硬计分",
    },
    {
        "field": "technology_evidence",
        "labels": ["核心技术", "客户验证", "客户验收", "中试", "量产", "认证", "测试报告"],
        "indicator": "工程化与商业转化率",
        "tags": ["technology_evidence", "trl_evidence", "financial_pdf"],
        "review_reason": "技术证据和TRL阶段需要人工确认外部验证强度和证据等级",
    },
]

SECTION_PATTERNS.extend([
    {
        "field": "shareholder",
        "labels": ["股东信息", "股权结构", "持股比例", "实际控制人", "主要股东"],
        "indicator": "股权稀释程度",
        "tags": ["equity_structure", "shareholder", "financial_pdf"],
        "review_reason": "股权稀释需要核验报告期、创始人/实际控制人身份、持股比例和股份变动口径",
    },
    {
        "field": "validation",
        "labels": ["第三方测试", "第三方检测", "客户验证", "客户验收", "可靠性测试", "测试报告", "认证"],
        "indicator": "工程化与商业转化率",
        "tags": ["third_party_test", "test_condition", "test_result", "financial_pdf"],
        "review_reason": "独立验证需要核验测试机构、报告编号、标准、工况、样本和结果；年报表述不能替代原始测试报告",
    },
])

UNIT_PATTERNS = [
    ("亿元", 100000000),
    ("人民币亿元", 100000000),
    ("万元", 10000),
    ("人民币万元", 10000),
    ("千元", 1000),
    ("人民币千元", 1000),
    ("元", 1),
    ("人民币元", 1),
]

PERIOD_HINTS = [
    ("current_period", ["本期", "本报告期", "报告期", "本年累计", "期末余额", "本期期末"]),
    ("previous_period", ["上期", "上年同期", "上年数", "上年度", "上期期末"]),
    ("period_end", ["期末", "本期期末", "报告期末"]),
    ("period_begin", ["期初", "上期期末", "上年年末"]),
]


def clean_text(value: str) -> str:
    return re.sub(r"\s+", " ", (value or "").replace("\u3000", " ")).strip()


def compact_text(value: str) -> str:
    return re.sub(r"[\s:：()（）]", "", value or "")


def parse_number(value: str):
    if value is None:
        return None
    text = str(value).replace(",", "").replace("，", "").strip()
    text = text.replace("(", "-").replace(")", "").replace("（", "-").replace("）", "")
    if text in {"", "-", "--", "不适用"}:
        return None
    match = re.search(r"-?\d+(?:\.\d+)?(?![-/]\d)", text)
    return float(match.group(0)) if match else None


def ensure_pdf_file(pdf_path: Path) -> None:
    if not pdf_path.exists():
        raise FileNotFoundError(pdf_path)
    if not pdf_path.read_bytes()[:8].startswith(b"%PDF"):
        raise ValueError(f"Not a valid PDF file: {pdf_path}")


def infer_unit(text: str) -> dict:
    normalized = clean_text(text)
    unit_match = re.search(r"单位[:：\s]*([^，。；;\s]{1,20})", normalized)
    if unit_match:
        normalized = unit_match.group(1)
    for unit, multiplier in UNIT_PATTERNS:
        if unit in normalized:
            return {"unit": unit, "multiplier": multiplier}
    return {"unit": "", "multiplier": 1}


def infer_statement_type(text: str) -> str:
    normalized = clean_text(text)
    for statement_type, hints in STATEMENT_HINTS:
        if any(hint in normalized for hint in hints):
            return statement_type
    return ""


def infer_scope(statement_type: str, text: str) -> str:
    if statement_type.startswith("parent"):
        return "parent_company"
    if statement_type.startswith("consolidated"):
        return "consolidated"
    if "母公司" in text:
        return "parent_company"
    if "合并" in text:
        return "consolidated"
    return ""


def infer_period_from_headers(headers: list[str], value_index: int) -> str:
    if value_index < len(headers):
        header = headers[value_index]
        for period, hints in PERIOD_HINTS:
            if any(hint in header for hint in hints):
                return period
        match = re.search(r"\d{4}年\d{1,2}月\d{1,2}日|\d{4}年度|\d{4}年", header)
        if match:
            return match.group(0)
    return ""


def extract_financial_fields(pdf_path: Path, include_text_fallback: bool = False) -> list[dict]:
    rows = []
    ensure_pdf_file(pdf_path)
    require_pdfplumber()
    with pdfplumber.open(pdf_path) as pdf:
        for page_no, page in enumerate(pdf.pages, 1):
            text = clean_text(page.extract_text() or "")
            tables = extract_page_tables(page, page_no, text)
            if include_text_fallback:
                rows.extend(extract_from_text_line(text, page_no, page.bbox))
            for table in tables:
                rows.extend(extract_from_table(table, page_no, text))
    return dedupe_fields(rows)


def extract_annual_report_sections(pdf_path: Path) -> list[dict]:
    rows = []
    ensure_pdf_file(pdf_path)
    require_pdfplumber()
    with pdfplumber.open(pdf_path) as pdf:
        for page_no, page in enumerate(pdf.pages, 1):
            text = clean_text(page.extract_text() or "")
            tables = extract_page_tables(page, page_no, text)
            rows.extend(extract_sections_from_text(text, page_no, page.bbox))
            for table in tables:
                rows.extend(extract_sections_from_table(table, page_no, text))
    rows.extend(build_extraction_issues(rows, "annual_report_sections"))
    return dedupe_sections(rows)


def extract_pdf_with_trace(pdf_path: Path, include_text_fallback: bool = False) -> dict[str, Any]:
    ensure_pdf_file(pdf_path)
    fields = extract_financial_fields(pdf_path, include_text_fallback=include_text_fallback)
    sections = extract_annual_report_sections(pdf_path)
    issues = build_financial_extraction_issues(fields)
    return {
        "pdf_path": str(pdf_path),
        "fields": fields,
        "sections": sections,
        "issues": issues,
        "summary": {
            "field_count": len(fields),
            "section_count": len([item for item in sections if item.get("field") != "extraction_issue"]),
            "issue_count": len(issues) + len([item for item in sections if item.get("field") == "extraction_issue"]),
        },
    }


def extract_page_tables(page, page_no: int, page_text: str) -> list[dict]:
    tables = []
    settings_candidates = [
        {"vertical_strategy": "lines", "horizontal_strategy": "lines", "snap_tolerance": 3, "join_tolerance": 3},
        {"vertical_strategy": "text", "horizontal_strategy": "text", "snap_tolerance": 3, "join_tolerance": 3},
    ]
    seen = set()
    for settings_index, settings in enumerate(settings_candidates):
        try:
            found = page.find_tables(table_settings=settings)
        except Exception:
            found = []
        for table_index, table_obj in enumerate(found):
            rows = normalize_table(table_obj.extract() or [])
            if not rows:
                continue
            key = (round(table_obj.bbox[0], 1), round(table_obj.bbox[1], 1), round(table_obj.bbox[2], 1), round(table_obj.bbox[3], 1), len(rows))
            if key in seen:
                continue
            seen.add(key)
            tables.append(
                {
                    "page_no": page_no,
                    "table_index": len(tables),
                    "strategy_index": settings_index,
                    "bbox": list(table_obj.bbox),
                    "rows": rows,
                    "page_text": page_text,
                }
            )
    if not tables:
        try:
            for table_index, table in enumerate(page.extract_tables() or []):
                rows = normalize_table(table)
                if rows:
                    tables.append({"page_no": page_no, "table_index": table_index, "strategy_index": -1, "bbox": None, "rows": rows, "page_text": page_text})
        except Exception:
            pass
    return tables


def normalize_table(table) -> list[list[str]]:
    rows = []
    for row in table or []:
        cleaned = [clean_text(cell or "") for cell in row]
        if any(cleaned):
            rows.append(cleaned)
    return rows


def extract_from_table(table: dict, page_no: int, page_text: str = "") -> list[dict]:
    rows = []
    normalized = table["rows"]
    headers = normalized[0] if normalized else []
    table_text = clean_text(" ".join(" ".join(row) for row in normalized[:8]))
    context_text = clean_text(f"{page_text[:900]} {table_text}")
    unit_info = infer_unit(table_text) or {"unit": "", "multiplier": 1}
    if not unit_info["unit"]:
        unit_info = infer_unit(context_text)
    statement_type = infer_statement_type(context_text)
    scope = infer_scope(statement_type, context_text)
    for row_index, row in enumerate(normalized):
        row_text = " ".join(row)
        matched_field, matched_label = match_standard_field(row)
        if not matched_field:
            continue
        if not should_accept_financial_row(matched_field, row, context_text):
            continue
        for value_index, raw_value, value in first_amount_cells(row, headers):
            rows.append(
                {
                    "field": matched_field,
                    "standard_field": matched_field,
                    "statement_family": STANDARD_FIELD_PATTERNS[matched_field]["statement"],
                    "statement_type": statement_type,
                    "scope": scope,
                    "label": matched_label,
                    "value": value,
                    "normalized_value": value * unit_info["multiplier"] if value is not None else None,
                    "raw_value": raw_value,
                    "unit": unit_info["unit"],
                    "unit_multiplier": unit_info["multiplier"],
                    "period": infer_period_from_headers(headers, value_index),
                    "page_no": page_no,
                    "table_index": table.get("table_index"),
                    "row_index": row_index,
                    "column_index": value_index,
                    "bbox": table.get("bbox"),
                    "source_location": source_location(page_no, table.get("bbox"), table.get("table_index"), row_index, value_index),
                    "source": "table",
                    "snippet": row_text[:500],
                }
            )
            break
    return rows


def extract_from_text_line(text: str, page_no: int, page_bbox=None) -> list[dict]:
    rows = []
    if not text:
        return rows
    unit_info = infer_unit(text)
    statement_type = infer_statement_type(text)
    scope = infer_scope(statement_type, text)
    for field, meta in STANDARD_FIELD_PATTERNS.items():
        for label in meta["labels"]:
            pattern = re.compile(re.escape(label) + r"\s*[:：]?\s*(?P<number>-?\d[\d,，]*(?:\.\d+)?)")
            for match in pattern.finditer(text):
                value = parse_number(match.group("number"))
                if value is None:
                    continue
                rows.append(
                    {
                        "field": field,
                        "standard_field": field,
                        "statement_family": meta["statement"],
                        "statement_type": statement_type,
                        "scope": scope,
                        "label": label,
                        "value": value,
                        "normalized_value": value * unit_info["multiplier"],
                        "raw_value": match.group("number"),
                        "unit": unit_info["unit"],
                        "unit_multiplier": unit_info["multiplier"],
                        "period": "",
                        "page_no": page_no,
                        "table_index": None,
                        "row_index": None,
                        "column_index": None,
                        "bbox": page_bbox,
                        "source_location": source_location(page_no, page_bbox, None, None, None),
                        "source": "text",
                        "snippet": text[max(0, match.start() - 100) : match.end() + 120],
                    }
                )
    return rows


def match_standard_field(row: list[str]) -> tuple[str, str]:
    row_text = compact_text(" ".join(row[:2]))
    first_cell = compact_text(row[0] if row else "")
    for label, field in FIELD_ALIASES.items():
        compact_label = compact_text(label)
        if compact_label == first_cell or first_cell.startswith(compact_label):
            return field, label
    for label, field in FIELD_ALIASES.items():
        compact_label = compact_text(label)
        if compact_label and compact_label in row_text:
            return field, label
    return "", ""


def should_accept_financial_row(field: str, row: list[str], context_text: str) -> bool:
    family = STANDARD_FIELD_PATTERNS[field]["statement"]
    if family in {"segment_information", "supplier_customer"}:
        return True
    statement_type = infer_statement_type(context_text)
    if not statement_type:
        return len(first_amount_cells(row, [])) > 0
    if family == "balance_sheet":
        return "资产负债表" in context_text or "主要会计数据" in context_text
    if family == "income_statement":
        return "利润表" in context_text or "主要会计数据" in context_text or "主要财务指标" in context_text
    if family == "cash_flow_statement":
        return "现金流量表" in context_text or "主要会计数据" in context_text
    return True


def first_amount_cells(row: list[str], headers: list[str]) -> list[tuple[int, str, float]]:
    cells = []
    for index, cell in enumerate(row[1:], 1):
        value = parse_number(cell)
        if value is None:
            continue
        if is_percent_cell(cell) or is_percent_column(headers, index):
            continue
        cells.append((index, cell, value))
    return cells


def is_percent_cell(cell: str) -> bool:
    return "%" in (cell or "") or "百分点" in (cell or "")


def is_percent_column(headers: list[str], value_index: int) -> bool:
    if value_index < len(headers):
        return any(term in headers[value_index] for term in ["比例", "比率", "占比", "变动", "%"])
    return False


def extract_sections_from_text(text: str, page_no: int, page_bbox=None) -> list[dict]:
    rows = []
    for pattern in SECTION_PATTERNS:
        matched = [label for label in pattern["labels"] if label in text]
        if not matched:
            continue
        rows.append(
            build_section_row(
                pattern=pattern,
                matched=matched,
                page_no=page_no,
                table_index=None,
                bbox=page_bbox,
                source="text_section",
                snippet=focused_snippet(text, matched),
                records=[],
                confidence=0.64,
            )
        )
    return rows


def extract_sections_from_table(table: dict, page_no: int, page_text: str = "") -> list[dict]:
    rows = []
    normalized = table["rows"]
    table_text = clean_text(" ".join(" ".join(row) for row in normalized))
    context = clean_text(f"{page_text[:900]} {table_text}")
    for pattern in SECTION_PATTERNS:
        matched = [label for label in pattern["labels"] if label in context]
        if not matched:
            continue
        rows.append(
            build_section_row(
                pattern=pattern,
                matched=matched,
                page_no=page_no,
                table_index=table.get("table_index"),
                bbox=table.get("bbox"),
                source="table_section",
                snippet=focused_snippet(context, matched),
                records=table_records(normalized),
                confidence=0.76,
            )
        )
    return rows


def build_section_row(pattern: dict, matched: list[str], page_no: int, table_index, bbox, source: str, snippet: str, records: list[dict], confidence: float) -> dict:
    return {
        "field": pattern["field"],
        "matched_labels": matched,
        "indicator": pattern["indicator"],
        "tags": pattern["tags"],
        "page_no": page_no,
        "table_index": table_index,
        "bbox": bbox,
        "source_location": source_location(page_no, bbox, table_index, None, None),
        "source": source,
        "snippet": snippet,
        "value": {
            "matched_labels": matched,
            "page_no": page_no,
            "table_index": table_index,
            "bbox": bbox,
            "source_location": source_location(page_no, bbox, table_index, None, None),
            "evidence_type": "annual_report_table" if table_index is not None else "annual_report_section",
            "records": records[:40],
        },
        "confidence": confidence,
        "needs_review": True,
        "review_reason": pattern["review_reason"],
    }


def table_records(rows: list[list[str]]) -> list[dict]:
    if not rows:
        return []
    headers = [header or f"col_{index}" for index, header in enumerate(rows[0])]
    records = []
    for row_index, row in enumerate(rows[1:80], 1):
        item = {headers[index] if index < len(headers) else f"col_{index}": value for index, value in enumerate(row) if value}
        if item:
            item["_row_index"] = row_index
            records.append(item)
    return records


def focused_snippet(text: str, matched: list[str], window: int = 320) -> str:
    first = min((text.find(label) for label in matched if text.find(label) >= 0), default=0)
    return text[max(0, first - 100) : first + window]


def source_location(page_no: int, bbox, table_index, row_index, column_index) -> dict:
    return {
        "page_no": page_no,
        "bbox": list(bbox) if bbox else None,
        "table_index": table_index,
        "row_index": row_index,
        "column_index": column_index,
    }


def build_financial_extraction_issues(fields: list[dict]) -> list[dict]:
    present = {item["field"] for item in fields}
    required = ["total_assets", "total_liabilities", "revenue", "net_profit", "operating_cash_flow", "rd_expense"]
    issues = []
    for field in required:
        if field not in present:
            issues.append(
                {
                    "field": "extraction_issue",
                    "missing_field": field,
                    "indicator": indicator_for_missing_field(field),
                    "tags": ["financial_pdf", "pdf_extract_error", "missing_field"],
                    "page_no": None,
                    "table_index": None,
                    "bbox": None,
                    "source_location": source_location(None, None, None, None, None),
                    "source": "quality_check",
                    "snippet": f"PDF未稳定抽取到标准字段: {field}",
                    "value": {"missing_field": field, "evidence_type": "pdf_extraction_issue"},
                    "confidence": 0.0,
                    "needs_review": True,
                    "review_reason": "PDF表格字段抽取缺失，需要人工定位原文表格并确认是否未披露或抽取失败",
                }
            )
    return issues


def build_extraction_issues(sections: list[dict], scope: str) -> list[dict]:
    present = {item["field"] for item in sections}
    expected = ["business_segment", "supplier_customer", "rd_project", "core_technician", "patent"]
    issues = []
    for field in expected:
        if field in present:
            continue
        issues.append(
            {
                "field": "extraction_issue",
                "missing_field": field,
                "indicator": indicator_for_missing_section(field),
                "tags": ["financial_pdf", "pdf_extract_error", "missing_section"],
                "page_no": None,
                "table_index": None,
                "bbox": None,
                "source_location": source_location(None, None, None, None, None),
                "source": scope,
                "snippet": f"PDF未定位到章节: {field}",
                "value": {"missing_section": field, "evidence_type": "pdf_extraction_issue"},
                "confidence": 0.0,
                "needs_review": True,
                "review_reason": "PDF章节抽取缺失，需要人工确认年报是否披露该章节、目录标题是否变体或表格是否跨页",
            }
        )
    return issues


def indicator_for_missing_field(field: str) -> str:
    return {
        "rd_expense": "研发投入强度",
        "revenue": "营业收入增长率",
        "net_profit": "融资成本",
        "operating_cash_flow": "融资成本",
        "total_assets": "无形资产减值风险",
        "total_liabilities": "融资成本",
    }.get(field, "公司公告")


def indicator_for_missing_section(field: str) -> str:
    return {
        "business_segment": "海外业务收入占比",
        "supplier_customer": "供应链进口依赖度",
        "rd_project": "工程化与商业转化率",
        "core_technician": "高管稳定性",
        "patent": "技术先进性-专利产出效率",
    }.get(field, "公司公告")


def dedupe_fields(rows: list[dict]) -> list[dict]:
    seen = set()
    out = []
    for row in rows:
        key = (
            row.get("field"),
            row.get("raw_value"),
            row.get("page_no"),
            row.get("table_index"),
            row.get("row_index"),
            row.get("column_index"),
        )
        if key in seen:
            continue
        seen.add(key)
        out.append(row)
    return out


def dedupe_sections(rows: list[dict]) -> list[dict]:
    seen = set()
    out = []
    for row in rows:
        key = (row.get("field"), row.get("missing_field"), row.get("page_no"), row.get("table_index"), row.get("snippet", "")[:100])
        if key in seen:
            continue
        seen.add(key)
        out.append(row)
    return out
