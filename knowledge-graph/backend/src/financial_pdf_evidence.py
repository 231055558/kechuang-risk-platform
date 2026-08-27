from __future__ import annotations

from pathlib import Path

from .financial_pdf import build_financial_extraction_issues
from .models import Evidence, utc_now_iso


FIELD_TO_INDICATORS = {
    "revenue": ["营业收入增长率", "研发投入强度", "海外业务收入占比"],
    "rd_expense": ["研发投入强度"],
    "total_assets": ["无形资产减值风险"],
    "intangible_assets": ["无形资产减值风险"],
    "total_liabilities": ["融资成本"],
    "interest_expense": ["融资成本"],
    "short_term_borrowing": ["融资成本"],
    "long_term_borrowing": ["融资成本"],
    "bonds_payable": ["融资成本"],
    "net_profit": ["融资成本"],
    "operating_cash_flow": ["融资成本"],
    "overseas_revenue": ["海外业务收入占比"],
    "domestic_revenue": ["海外业务收入占比"],
    "segment_revenue": ["概念股标签关联度", "海外业务收入占比"],
    "top_supplier_purchase_amount": ["供应链进口依赖度"],
    "top_supplier_purchase_ratio": ["供应链进口依赖度"],
}


def evidence_from_fields(company: str, pdf_path: Path, fields: list[dict], source_name: str, publish_date: str = "", fetched_at: str = "") -> list[Evidence]:
    grouped = {}
    for field in fields:
        for indicator in FIELD_TO_INDICATORS.get(field["field"], []):
            grouped.setdefault(indicator, []).append(field)
    evidence = []
    for indicator, values in grouped.items():
        evidence.append(
            Evidence(
                company=company,
                indicator=indicator,
                source_id=f"financial_pdf_{pdf_path.stem}",
                source_name=source_name,
                publish_date=publish_date,
                fetched_at=fetched_at or utc_now_iso(),
                url=str(pdf_path),
                title=f"{pdf_path.name} 财务字段标准化抽取",
                snippet="；".join(
                    f"{v['label']}={v['raw_value']}({v.get('unit') or '未识别单位'}, {v.get('period') or '未识别期间'}, {v.get('scope') or '未识别口径'})@p{v['page_no']}"
                    for v in values[:10]
                ),
                value=values,
                confidence=0.82 if all(v.get("unit") and v.get("source_location") for v in values[:3]) else 0.68,
                tags=["financial_pdf", "financial_numeric", "pdf_traceable", "text_company_disclosure"],
                needs_review=True,
                review_reason="PDF财务字段抽取需要核验单位、期间、合并/母公司口径、表格坐标和跨页表格完整性",
                source_type="financial_pdf",
            )
        )
    return evidence


def evidence_from_sections(company: str, pdf_path: Path, sections: list[dict], source_name: str, publish_date: str = "", fetched_at: str = "") -> list[Evidence]:
    evidence = []
    for section in sections:
        page_ref = "unknown_page" if section.get("page_no") is None else f"p{section['page_no']}"
        if section.get("table_index") is not None:
            page_ref += f"/table{section['table_index']}"
        evidence.append(
            Evidence(
                company=company,
                indicator=section["indicator"],
                source_id=f"annual_report_pdf_{pdf_path.stem}",
                source_name=source_name,
                publish_date=publish_date,
                fetched_at=fetched_at or utc_now_iso(),
                url=str(pdf_path),
                title=f"{pdf_path.name} 年报章节/表格抽取 {section['field']}",
                snippet=f"{page_ref} {section['snippet']}",
                value=section["value"],
                confidence=section["confidence"],
                tags=[*section["tags"], "pdf_traceable", "text_company_disclosure"],
                needs_review=section["needs_review"],
                review_reason=section["review_reason"],
                source_type="annual_report_pdf",
            )
        )
    return evidence


def evidence_from_financial_issues(company: str, pdf_path: Path, fields: list[dict], source_name: str, publish_date: str = "", fetched_at: str = "") -> list[Evidence]:
    evidence = []
    for issue in build_financial_extraction_issues(fields):
        evidence.append(
            Evidence(
                company=company,
                indicator=issue["indicator"],
                source_id=f"financial_pdf_{pdf_path.stem}",
                source_name=source_name,
                publish_date=publish_date,
                fetched_at=fetched_at or utc_now_iso(),
                url=str(pdf_path),
                title=f"{pdf_path.name} PDF抽取缺失 {issue.get('missing_field', '')}",
                snippet=issue["snippet"],
                value=issue["value"],
                confidence=0.0,
                tags=[*issue["tags"], "pdf_traceable"],
                needs_review=True,
                review_reason=issue["review_reason"],
                source_type="financial_pdf",
            )
        )
    return evidence


def evidence_from_exception(company: str, pdf_path: Path, exc: Exception, source_name: str, publish_date: str = "", fetched_at: str = "") -> list[Evidence]:
    return [
        Evidence(
            company=company,
            indicator="公司公告",
            source_id=f"financial_pdf_{pdf_path.stem}",
            source_name=source_name,
            publish_date=publish_date,
            fetched_at=fetched_at or utc_now_iso(),
            url=str(pdf_path),
            title=f"{pdf_path.name} PDF结构化抽取失败",
            snippet=str(exc)[:300],
            value={"error": str(exc), "evidence_type": "pdf_extraction_failure"},
            confidence=0.0,
            tags=["financial_pdf", "pdf_extract_error", "needs_manual_review"],
            needs_review=True,
            review_reason="PDF无法打开、不是有效PDF、加密、扫描件或表格解析失败，需要人工复核并补录结构化数据",
            source_type="financial_pdf",
        )
    ]
