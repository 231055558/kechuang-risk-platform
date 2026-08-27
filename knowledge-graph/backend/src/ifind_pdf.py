from __future__ import annotations

import re
from pathlib import Path
from typing import Any

try:
    import pdfplumber
except ImportError:  # pragma: no cover
    pdfplumber = None


SECTION_MAP = [
    ("company_profile", "公司公告", ["工商信息", "基本信息", "统一社会信用代码", "法定代表人"], ["company_profile", "company_announcement"]),
    ("shareholder", "股权稀释程度", ["股东信息", "股权结构", "持股比例", "实际控制人"], ["equity_structure"]),
    ("person", "高管关联风险暴露度", ["高管", "主要人员", "董事", "监事", "核心技术人员"], ["person_profile"]),
    ("financing", "累计融资金额", ["融资", "投资方", "融资金额", "估值"], ["financing_event"]),
    ("customer", "工程化与商业转化率", ["客户", "中标", "销售金额", "项目名称"], ["customer_acceptance", "commercialization_event"]),
    ("supplier", "供应链进口依赖度", ["供应商", "采购", "采购金额", "供应链"], ["supplier_data", "country_region"]),
    ("news", "叙事热度基本面背离度", ["新闻", "舆情", "负面", "报道"], ["text_news", "narrative"]),
    ("patent", "技术先进性-专利产出效率", ["专利", "发明", "授权", "申请号", "公开号"], ["patent_data", "patent_legal_status"]),
    ("litigation", "诉讼风险", ["司法", "诉讼", "开庭", "裁判", "执行", "仲裁"], ["litigation_event"]),
    ("regulatory", "监管处罚次数", ["行政处罚", "监管", "处罚决定", "违法违规"], ["regulatory_event"]),
]

PROFILE_FIELDS = {
    "统一社会信用代码": "credit_code",
    "法定代表人": "legal_representative",
    "注册资本": "registered_capital",
    "成立日期": "established_date",
    "经营状态": "operating_status",
    "注册地址": "registered_address",
    "所属行业": "industry",
}


def infer_company_from_ifind_filename(file_name: str) -> str:
    stem = Path(file_name).stem
    stem = re.sub(r"^\s*iFinD企业库[-_ ]*", "", stem, flags=re.I)
    stem = re.sub(r"\(\d+\)$", "", stem).strip()
    return stem


def inspect_pdf(pdf_path: Path) -> dict[str, Any]:
    if pdfplumber is None:
        return {"status": "missing_pdfplumber", "page_count": 0}
    try:
        with pdfplumber.open(pdf_path) as pdf:
            return {"status": "ok", "page_count": len(pdf.pages)}
    except Exception as exc:
        return {"status": "error", "error": str(exc), "page_count": 0}


def extract_ifind_pdf(pdf_path: Path, max_pages: int = 0) -> dict[str, Any]:
    if pdfplumber is None:
        raise RuntimeError("iFinD PDF extraction requires pdfplumber. Install project dependencies with: python -m pip install -r requirements.txt")
    company = infer_company_from_ifind_filename(pdf_path.name)
    pages = []
    tables = []
    sections = []
    with pdfplumber.open(pdf_path) as pdf:
        page_count = len(pdf.pages)
        page_limit = min(page_count, max_pages) if max_pages else page_count
        for page_no, page in enumerate(pdf.pages[:page_limit], 1):
            text = clean_text(page.extract_text() or "")
            page_tables = page.extract_tables() or []
            pages.append({"page_no": page_no, "text": text[:4000]})
            for table_index, table in enumerate(page_tables):
                normalized = normalize_table(table)
                if normalized:
                    tables.append({"page_no": page_no, "table_index": table_index, "rows": normalized[:80]})
            sections.extend(extract_sections(text, page_no, page_tables))
    return {
        "company": company,
        "file_name": pdf_path.name,
        "local_path": str(pdf_path),
        "page_count": page_count,
        "pages_read": len(pages),
        "pages": pages,
        "tables": tables,
        "sections": dedupe_sections(sections),
        "missing_fields": missing_fields(sections),
    }


def extract_sections(text: str, page_no: int, page_tables: list) -> list[dict[str, Any]]:
    rows = []
    table_text = " ".join(" ".join(" ".join(clean_text(cell or "") for cell in row) for row in table or []) for table in page_tables)
    context = clean_text(f"{text} {table_text}")
    for section_type, indicator, labels, tags in SECTION_MAP:
        matched = [label for label in labels if label in context]
        if not matched:
            continue
        section_value = {"matched_labels": matched, "page_no": page_no, "section_type": section_type}
        if section_type == "company_profile":
            section_value.update(extract_profile_fields(context))
        if section_type in {"supplier", "customer", "patent", "person"}:
            section_value["items"] = extract_table_like_items(page_tables, labels)
        rows.append(
            {
                "section_type": section_type,
                "indicator": indicator,
                "tags": ["ifind_pdf", *tags],
                "page_no": page_no,
                "matched_labels": matched,
                "snippet": focused_snippet(context, matched),
                "value": section_value,
                "confidence": 0.82 if page_tables else 0.68,
                "needs_review": section_type not in {"company_profile"},
                "review_reason": review_reason(section_type),
            }
        )
    return rows


def extract_profile_fields(text: str) -> dict[str, str]:
    fields = {}
    for label, key in PROFILE_FIELDS.items():
        match = re.search(re.escape(label) + r"[:：]?\s*([^\s，。；;|]{2,80})", text)
        if match:
            fields[key] = match.group(1)
    credit = re.search(r"\b[0-9A-Z]{18}\b", text)
    if credit:
        fields.setdefault("credit_code", credit.group(0))
    return fields


def extract_table_like_items(page_tables: list, labels: list[str]) -> list[dict[str, Any]]:
    items = []
    for table in page_tables:
        normalized = normalize_table(table)
        if not normalized:
            continue
        headers = normalized[0]
        for row in normalized[1:30]:
            row_text = " ".join(row)
            if not row_text or not any(label in row_text or label in " ".join(headers) for label in labels):
                if len(row) < 2:
                    continue
            item = {headers[i] if i < len(headers) and headers[i] else f"col_{i}": value for i, value in enumerate(row) if value}
            if item:
                items.append(item)
    return items[:50]


def normalize_table(table) -> list[list[str]]:
    rows = []
    for row in table or []:
        cleaned = [clean_text(cell or "") for cell in row]
        if any(cleaned):
            rows.append(cleaned)
    return rows


def clean_text(value: str) -> str:
    return re.sub(r"\s+", " ", (value or "").replace("\u3000", " ")).strip()


def focused_snippet(text: str, labels: list[str], window: int = 320) -> str:
    first = min((text.find(label) for label in labels if text.find(label) >= 0), default=0)
    return text[max(0, first - 80) : first + window]


def review_reason(section_type: str) -> str:
    return {
        "shareholder": "股权结构需核验报告时点、股东性质和持股比例口径",
        "person": "高管和核心技术人员需核验任职关系、履历和关联企业",
        "financing": "融资事件需核验融资金额、轮次、时间和估值口径",
        "customer": "客户/中标项目需核验销售金额、合同状态和验收情况",
        "supplier": "供应商需核验境内外属性、采购金额和是否为前五大供应商",
        "news": "舆情新闻需去重并确认是否构成风险事件",
        "patent": "专利需补充法律状态、权利要求、引用和产品映射",
        "litigation": "司法风险需核验主体、案由、金额和当前状态",
        "regulatory": "监管处罚需核验处罚对象、日期和处罚决定书",
    }.get(section_type, "")


def dedupe_sections(sections: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen = set()
    out = []
    for section in sections:
        key = (section["section_type"], section["page_no"], section["snippet"][:100])
        if key in seen:
            continue
        seen.add(key)
        out.append(section)
    return out


def missing_fields(sections: list[dict[str, Any]]) -> list[dict[str, str]]:
    present = {section["section_type"] for section in sections}
    required = ["company_profile", "shareholder", "person", "supplier", "customer", "patent", "litigation"]
    return [{"module": module, "field_name": "section", "reason": "not_detected"} for module in required if module not in present]
