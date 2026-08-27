"""Schema rules for reviewed, local structured risk-data imports."""

from __future__ import annotations

from typing import Any


COMMON_REQUIRED = ("company", "evidence_url", "original_location", "source_date")

DATASET_SCHEMAS: dict[str, dict[str, Any]] = {
    "bom_sbom": {
        "required": (*COMMON_REQUIRED, "component_name", "component_type", "criticality", "supplier_name", "country_or_region", "substitutability"),
        "allowed": {"yes", "no", "unknown", "partial"},
        "boolean_fields": ("controlled_list", "license_required"),
    },
    "license_data": {
        "required": (*COMMON_REQUIRED, "technology_or_component", "license_type", "licensor", "license_status", "expiry_date"),
        "allowed": {"active", "expired", "pending", "unknown", "not_applicable"},
        "boolean_fields": (),
    },
    "controlled_component": {
        "required": (*COMMON_REQUIRED, "component_name", "country_or_region", "controlled_list", "license_required"),
        "allowed": set(),
        "boolean_fields": ("controlled_list", "license_required"),
    },
    "third_party_test": {
        "required": (*COMMON_REQUIRED, "test_organization", "report_number", "product_name", "test_standard", "test_condition", "test_date"),
        "allowed": set(),
        "boolean_fields": (),
    },
    "test_result": {
        "required": (*COMMON_REQUIRED, "report_number", "product_name", "test_item", "result_status", "test_date"),
        "allowed": {"pass", "fail", "partial", "not_applicable"},
        "boolean_fields": (),
    },
    "equity_structure": {
        "required": (*COMMON_REQUIRED, "subject_name", "subject_role", "report_date", "shareholding_ratio", "ownership_type"),
        "allowed": {"direct", "indirect", "combined", "unknown"},
        "boolean_fields": (),
    },
    "regulatory_event": {
        "required": (*COMMON_REQUIRED, "subject_name", "event_type", "decision_number", "authority", "decision_date"),
        "allowed": {"administrative_penalty", "regulatory_measure", "disciplinary_action", "warning_letter", "unknown"},
        "boolean_fields": (),
    },
    "supplier_import_dependency": {
        "required": (*COMMON_REQUIRED, "report_period", "supplier_name", "supplier_country", "supplier_role", "purchase_amount_unit", "import_status", "supplier_scope"),
        "allowed": {"direct_import", "overseas_supplier", "domestic_agent", "domestic_supplier", "unknown", "confirmed_import", "not_imported"},
        "boolean_fields": ("is_top5_supplier", "single_source_flag"),
    },
    "peer_benchmark": {
        "required": (*COMMON_REQUIRED, "metric_name", "company_value", "peer_name", "peer_value", "percentile", "unit", "test_condition"),
        "allowed": set(),
        "boolean_fields": (),
    },
    "related_entity": {
        "required": (*COMMON_REQUIRED, "person_name", "related_entity_name", "relation_type", "relation_start_date"),
        "allowed": set(),
        "boolean_fields": (),
    },
}


def validate_structured_record(dataset_type: str, record: dict[str, Any]) -> list[str]:
    schema = DATASET_SCHEMAS.get(dataset_type)
    if not schema:
        return []
    errors = [f"missing:{field}" for field in schema["required"] if not str(record.get(field, "")).strip()]
    if dataset_type == "bom_sbom" and str(record.get("substitutability", "")).lower() not in schema["allowed"]:
        errors.append("invalid:substitutability")
    if dataset_type == "license_data" and str(record.get("license_status", "")).lower() not in schema["allowed"]:
        errors.append("invalid:license_status")
    if dataset_type == "test_result" and str(record.get("result_status", "")).lower() not in schema["allowed"]:
        errors.append("invalid:result_status")
    if dataset_type in {"equity_structure", "regulatory_event"} and str(record.get("ownership_type" if dataset_type == "equity_structure" else "event_type", "")).lower() not in schema["allowed"]:
        errors.append("invalid:enum")
    if dataset_type == "supplier_import_dependency":
        amount = record.get("purchase_amount")
        ratio = record.get("purchase_ratio")
        if str(amount).strip() in {"", "None", "null"} and str(ratio).strip() in {"", "None", "null"}:
            errors.append("missing:purchase_amount_or_purchase_ratio")
        if str(record.get("import_status", "")).lower() not in schema["allowed"]:
            errors.append("invalid:import_status")
        if str(record.get("supplier_role", "")).lower() not in {"supplier", "供应商", "供货方", "overseas_supplier", "domestic_agent"}:
            errors.append("invalid:supplier_role")
        if str(record.get("supplier_scope", "")).lower() not in {"top5", "top5_disclosed", "all", "all_suppliers", "全部供应商", "全量"}:
            errors.append("invalid:supplier_scope")
        try:
            if float(record.get("purchase_amount")) < 0:
                errors.append("invalid:purchase_amount")
        except (TypeError, ValueError):
            errors.append("invalid:purchase_amount")
    for field in schema["boolean_fields"]:
        allowed_boolean = {"true", "false", "yes", "no", "1", "0"}
        if dataset_type == "supplier_import_dependency" and field == "single_source_flag":
            allowed_boolean.add("unknown")
        if str(record.get(field, "")).lower() not in allowed_boolean:
            errors.append(f"invalid:boolean:{field}")
    try:
        percentile = record.get("percentile")
        if percentile not in (None, "") and not 0 <= float(percentile) <= 100:
            errors.append("invalid:percentile")
    except (TypeError, ValueError):
        errors.append("invalid:percentile")
    return errors


def template_headers(dataset_type: str) -> list[str]:
    schema = DATASET_SCHEMAS.get(dataset_type, {})
    return list(schema.get("required", ())) + ["notes"]
