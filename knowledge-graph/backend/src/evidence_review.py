"""Deterministic quality gate for structured risk evidence.

The gate is intentionally conservative: provenance alone never approves a
record.  A source must be authoritative enough *and* the extracted record
must contain the identifiers, subject, temporal context and/or source
location appropriate to its business type.  This makes the §4.3 confidence
and review workflow repeatable for both new imports and legacy SQLite data.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any

from .models import Evidence


AUTO_REVIEW_VERSION = "2026-08-19.1"
APPROVAL_THRESHOLD = 0.82
MISSING = {None, "", "--", "-", "不适用", "未知", "nan", "None"}
AUTHORITATIVE_SOURCES = {
    "cninfo_announcements", "sse_static_stock", "sse_regulatory_measures",
    "证券监管处罚核查公告", "美国联邦公报原始规则", "正式招股说明书",
    "官方定期报告", "官方清单CSV",
}
STRUCTURED_SOURCES = {
    "ifind_categorized_xlsx", "ifind_financial_workbook", "financial_pdf",
    "tianyancha_openapi", "tianyancha_person_fanout", "qichacha_openapi",
}
MANAGED_SOURCE_TYPES = AUTHORITATIVE_SOURCES | STRUCTURED_SOURCES


@dataclass(frozen=True)
class ReviewDecision:
    approved: bool
    confidence: float
    reason: str
    score: float
    source_tier: str
    completeness: float
    structured: bool


def _present(value: Any) -> bool:
    if isinstance(value, str):
        return value.strip() not in MISSING
    return value not in MISSING


def _payload(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        result = dict(value)
        record = result.get("record")
        if isinstance(record, dict):
            result.update(record)
        return result
    return {}


def _value(payload: dict[str, Any], keys: list[str]) -> Any:
    for key in keys:
        value = payload.get(key)
        if _present(value):
            return value
    return None


def _is_date(value: Any) -> bool:
    return bool(value and re.search(r"\d{4}[-/]?\d{0,2}[-/]?\d{0,2}", str(value)))


def _source_tier(source_type: str) -> tuple[str, float]:
    if source_type in AUTHORITATIVE_SOURCES:
        return "authoritative", 0.42
    if source_type in STRUCTURED_SOURCES:
        return "licensed_structured", 0.34
    if source_type in {"ifind_pdf_directory", "annual_report_pdf", "text_derived", "mcp_streamable_http"}:
        return "extracted_or_derived", 0.20
    return "other", 0.12


def _completeness(evidence: Evidence, payload: dict[str, Any]) -> tuple[float, str]:
    """Return type-specific extraction completeness and audit explanation."""
    dataset = str(payload.get("dataset_type") or "")
    tags = set(evidence.tags or [])
    location = payload.get("source_location") or payload.get("original_location")
    located = isinstance(location, dict) and _present(location.get("row") or location.get("page_no") or location.get("sheet"))
    dated = _is_date(evidence.publish_date) or _is_date(_value(payload, ["event_date", "report_date", "publication_date", "裁判日期", "开庭时间", "报告期/发布日期"]))
    subject = _present(evidence.company) and (
        _present(_value(payload, ["company", "企业名称", "company_name", "applicant", "当事人"]))
        or bool(evidence.company)
    )

    if "pdf_extract_error" in tags or "missing_section" in tags:
        return 0.0, "PDF解析异常或缺失章节"
    if dataset == "patent_structured" or "patent_data" in tags:
        patent = _value(payload, ["patent_number", "publication_number", "application_number", "专利号", "申请公布号"])
        name = _value(payload, ["patent_name", "专利名称", "发明名称"])
        status = _value(payload, ["legal_status", "法律状态"])
        score = 0.45 * bool(patent) + 0.25 * bool(name) + 0.15 * bool(status) + 0.15 * located
        return score, "专利号、名称、法律状态和原始行定位"
    if dataset == "litigation_event" or "litigation_event" in tags:
        case = _value(payload, ["case_number", "case_no", "案号", "案件编号"])
        cause = _value(payload, ["cause", "案由"])
        court = _value(payload, ["court", "court_name", "执行法院", "审理法院"])
        score = 0.45 * bool(case) + 0.2 * bool(cause) + 0.15 * bool(court) + 0.1 * dated + 0.1 * located
        return score, "案号、案由、法院、日期和原始行定位"
    if dataset in {"supplier_customer", "supply_chain"} or "supplier_data" in tags:
        counterparty = _value(payload, ["counterparty_name", "supplier_name", "customer_name", "供应商", "客户"])
        amount = _value(payload, ["purchase_amount", "transaction_amount", "采购金额(万元)", "销售金额"])
        score = 0.45 * bool(counterparty) + 0.2 * bool(amount) + 0.2 * dated + 0.15 * located
        return score, "交易对手、金额、报告期和原始行定位"
    if dataset in {"financial_statement", "financial_numeric"} or "financial_numeric" in tags:
        metrics = payload.get("metrics") if isinstance(payload.get("metrics"), dict) else payload
        has_numeric = any(isinstance(value, (int, float)) for value in metrics.values()) if isinstance(metrics, dict) else False
        paired = _present(payload.get("comparison_date")) and _present(payload.get("previous_revenue_10k_cny"))
        # A generic balance-sheet/cash-flow row is valuable lineage, but it
        # cannot on its own establish financing cost.  Only a paired
        # comparable-period metric can be auto-released for calculation.
        if payload.get("metric") != "revenue_yoy_growth" and not paired:
            return 0.60 * has_numeric + 0.25 * dated + 0.15 * located, "数值字段、报告期和来源定位（缺少可计算配对）"
        score = 0.45 * has_numeric + 0.25 * dated + 0.15 * located + 0.15 * paired
        return score, "数值字段、报告期、来源定位和可比同期"
    if dataset in {"regulatory_event", "exchange_inquiry_event"} or {"regulatory_event", "exchange_inquiry_event"}.intersection(tags):
        number = _value(payload, ["decision_number", "decision_no", "处罚决定书文号", "决定书文号", "问询函编号", "event_id"])
        agency = _value(payload, ["authority", "agency", "处罚机关", "监管机构", "交易所"])
        score = 0.45 * bool(number) + 0.2 * bool(agency) + 0.2 * dated + 0.15 * bool(evidence.url or located)
        return score, "文号、监管机构、日期和可追溯来源"
    if dataset.startswith("tyc_") or "tianyancha" in tags:
        external_id = _value(payload, ["id", "hcgid", "creditCode", "credit_code"])
        name = _value(payload, ["name", "company", "企业名称"])
        score = 0.45 * bool(external_id) + 0.3 * bool(name) + 0.15 * subject + 0.1 * bool(evidence.title)
        return score, "外部唯一标识、名称、企业主体和标题"
    # Free text and broad PDF sections need a human decision, even when they
    # have a high parser confidence.  They can be used as traceable context,
    # not automatically promoted to a formal risk fact.
    score = 0.4 * bool(evidence.snippet) + 0.2 * dated + 0.2 * bool(evidence.url or located) + 0.2 * subject
    return score, "文本、日期、来源定位和主体匹配"


def _supports_auto_release(evidence: Evidence, payload: dict[str, Any]) -> bool:
    """Limit release to records with a known, verifiable business contract."""
    dataset = str(payload.get("dataset_type") or "")
    tags = set(evidence.tags or [])
    if dataset in {"patent_structured", "litigation_event", "supplier_customer", "supply_chain"}:
        return True
    if dataset in {"regulatory_event", "exchange_inquiry_event"}:
        return True
    if dataset in {"tyc_enterprise_profile", "executive_related"}:
        return True
    if payload.get("metric") == "revenue_yoy_growth":
        return True
    if "patent_data" in tags or "litigation_event" in tags or "supplier_data" in tags:
        return True
    return False


def assess_evidence(evidence: Evidence) -> ReviewDecision:
    payload = _payload(evidence.value)
    tier, tier_score = _source_tier(evidence.source_type)
    completeness, criteria = _completeness(evidence, payload)
    structured = evidence.source_type in STRUCTURED_SOURCES or bool(payload.get("dataset_type"))
    parser_score = max(0.0, min(1.0, float(evidence.confidence or 0.0)))
    score = min(0.99, tier_score + 0.43 * completeness + 0.15 * parser_score)
    safe_dataset = str(payload.get("dataset_type") or "")
    auto_eligible = (
        tier in {"authoritative", "licensed_structured"}
        and structured
        and _supports_auto_release(evidence, payload)
        and completeness >= 0.80
        and parser_score >= 0.75
        and "pdf_extract_error" not in set(evidence.tags or [])
    )
    approved = auto_eligible and score >= APPROVAL_THRESHOLD
    if approved:
        reason = f"自动复核通过[{AUTO_REVIEW_VERSION}]：{tier}；{criteria}完整度={completeness:.2f}；综合={score:.2f}"
    else:
        reason = f"待人工复核[{AUTO_REVIEW_VERSION}]：{tier}；{criteria}完整度={completeness:.2f}；综合={score:.2f}" + (f"；数据集={safe_dataset}" if safe_dataset else "")
    return ReviewDecision(approved, round(max(parser_score, score if approved else parser_score), 4), reason, round(score, 4), tier, round(completeness, 4), structured)


def apply_auto_review(evidence: Evidence) -> Evidence:
    """Mutate an evidence object with its deterministic quality decision."""
    decision = assess_evidence(evidence)
    evidence.needs_review = not decision.approved
    evidence.review_reason = decision.reason
    evidence.confidence = max(float(evidence.confidence or 0.0), decision.confidence)
    return evidence


def should_apply_auto_review(source_type: str) -> bool:
    """Whether this source has a deterministic, schema-aware policy."""
    return source_type in MANAGED_SOURCE_TYPES


def evidence_from_row(row: Any) -> Evidence:
    try:
        value = json.loads(row["value_json"] or "null")
    except (TypeError, json.JSONDecodeError):
        value = None
    try:
        tags = json.loads(row["tags_json"] or "[]")
    except (TypeError, json.JSONDecodeError):
        tags = []
    return Evidence(
        company=row["company_name"], indicator=row["indicator_name"], source_id=row["source_key"],
        source_name=row["source_name"], source_type=row["source_type"], publish_date=row["publish_date"],
        fetched_at=row["fetched_at"], url=row["url"], title=row["title"], snippet=row["snippet"],
        value=value, confidence=float(row["confidence"]), tags=tags,
        needs_review=bool(row["needs_review"]), review_reason=row["review_reason"],
    )
