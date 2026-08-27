"""Canonical evidence-observation contract aligned with the 37-company workbook.

The crawler database keeps the original payload untouched.  This module gives
every stored evidence record a lossless *projection* to the workbook's
``观测数据`` columns, so sources with different native schemas can be audited,
exported and re-imported through one stable data-chain format.
"""

from __future__ import annotations

import json
from typing import Any


# Exact column order of ``观测数据`` in
# 科创板数字芯片设计企业风险指标数据库_37家_核对版_20260819.xlsx.
OBSERVATION_COLUMNS = (
    "stock_code", "short_name", "primary_category", "secondary_indicator",
    "metric_name", "period_start", "period_end", "as_of_date",
    "numeric_value", "text_value", "unit", "status", "is_derived",
    "formula", "institution", "title", "publication_date", "url",
    "source_page", "evidence_excerpt", "confidence", "confidence_score",
    "confidence_reason", "limitations",
)

MISSING = {None, "", "--", "-", "不适用", "未知", "nan", "None"}


def is_present(value: Any) -> bool:
    if isinstance(value, str):
        return value.strip() not in MISSING
    if isinstance(value, (dict, list, tuple, set)):
        return bool(value)
    return value not in MISSING


def json_value(value_json: str | None) -> Any:
    try:
        return json.loads(value_json) if value_json else None
    except (TypeError, json.JSONDecodeError):
        return None


def payload_fields(value: Any) -> dict[str, Any]:
    """Flatten the known record wrappers while retaining the original value."""
    if not isinstance(value, dict):
        return {}
    result = dict(value)
    for key in ("record", "workbook_record"):
        nested = result.get(key)
        if isinstance(nested, dict):
            result.update(nested)
    return result


def first(fields: dict[str, Any], *names: str) -> Any:
    for name in names:
        value = fields.get(name)
        if is_present(value):
            return value
    return ""


def source_location(fields: dict[str, Any]) -> str:
    location = first(fields, "source_location", "original_location")
    if isinstance(location, dict):
        for name in ("page_no", "page", "row", "sheet"):
            if is_present(location.get(name)):
                return str(location[name])
        return json.dumps(location, ensure_ascii=False, sort_keys=True)
    return str(location or first(fields, "source_page", "page", "page_no"))


def to_observation(row: Any) -> dict[str, Any]:
    """Project a joined SQLite evidence row to the workbook observation contract."""
    value = json_value(row["value_json"])
    fields = payload_fields(value)
    tags = json_value(row["tags_json"]) or []
    tags = tags if isinstance(tags, list) else []
    numeric = first(fields, "numeric_value", "direct_value", "normalized_value", "value")
    if isinstance(numeric, (dict, list, tuple)):
        numeric = ""
    text = first(fields, "text_value", "text", "description") or row["snippet"]
    confidence_reason = first(fields, "confidence_reason") or row["review_reason"]
    metric = first(fields, "metric_name", "metric", "standard_field")
    if not metric:
        metric = "evidence_observation"
    return {
        "stock_code": row["stock_code"] or "",
        "short_name": first(fields, "short_name") or "",
        "primary_category": row["risk_category"] or "未分类",
        "secondary_indicator": row["indicator"] or "",
        "metric_name": metric,
        "period_start": first(fields, "period_start", "start_date", "report_period_start"),
        "period_end": first(fields, "period_end", "end_date", "report_period_end"),
        "as_of_date": first(fields, "as_of_date", "report_date", "event_date"),
        "numeric_value": numeric,
        "text_value": text,
        "unit": first(fields, "unit", "currency_unit"),
        "status": "待复核" if int(row["needs_review"] or 0) else "已放行",
        "is_derived": "true" if row["source_type"] == "text_derived" else "false",
        "formula": first(fields, "formula", "calculation_formula"),
        "institution": row["source_name"] or "",
        "title": row["title"] or "",
        "publication_date": row["publish_date"] or "",
        "url": row["url"] or "",
        "source_page": source_location(fields),
        "evidence_excerpt": row["snippet"] or "",
        "confidence": row["confidence"],
        "confidence_score": row["confidence"],
        "confidence_reason": confidence_reason,
        "limitations": row["review_reason"] or "",
    }


def contract_issues(row: Any) -> list[str]:
    """Check traceability essentials; incomplete does not imply deletion."""
    observation = to_observation(row)
    issues: list[str] = []
    if not is_present(row["company"]):
        issues.append("missing:company")
    if not is_present(observation["secondary_indicator"]):
        issues.append("missing:secondary_indicator")
    if not is_present(observation["title"]) and not is_present(observation["evidence_excerpt"]):
        issues.append("missing:title_and_excerpt")
    if not is_present(observation["url"]) and not is_present(observation["source_page"]):
        issues.append("missing:source_trace")
    if not is_present(observation["text_value"]) and not is_present(observation["numeric_value"]):
        issues.append("missing:observation_value")
    return issues


def hard_delete_reason(row: Any) -> str:
    """Return a reason only for records that contain no business fact at all.

    A failed extraction is removed because it is an error marker, not evidence.
    Pending manual review, a low confidence score, or a free-text source never
    makes a record deletable by this conservative rule.
    """
    value = json_value(row["value_json"])
    tags = json_value(row["tags_json"]) or []
    tags = set(tags) if isinstance(tags, list) else set()
    fields = payload_fields(value)
    error_text = str(first(fields, "error", "exception", "failure_reason")).strip()
    if "pdf_extract_error" in tags or "missing_section" in tags:
        return "pdf_extraction_failure_or_missing_section"
    if error_text and float(row["confidence"] or 0) <= 0.05 and not str(row["snippet"] or "").strip():
        return "parser_error_without_evidence_content"
    if value is None and not str(row["title"] or "").strip() and not str(row["snippet"] or "").strip():
        return "empty_evidence_shell"
    return ""
