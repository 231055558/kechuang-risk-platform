"""Receive reviewed visible-table captures from the local Edge extension.

The receiver binds to loopback only, stores the raw payload unchanged, and
converts selected tables into the existing ``data/structured_exports`` input
contract. Paid-source payloads are retained as raw evidence but are never
promoted to structured imports without a separate approval workflow.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse


PROJECT_ROOT = Path(__file__).resolve().parents[1]
MAX_BODY_BYTES = 5 * 1024 * 1024
sys.path.insert(0, str(PROJECT_ROOT))

from src.structured_imports import validate_structured_record


def clean(value: object) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def normalized_key(value: object) -> str:
    return re.sub(r"[\s()（）/%：:、_-]+", "", clean(value)).lower()


def value_from(row: dict, *aliases: str) -> str:
    normalized = {normalized_key(key): value for key, value in row.items()}
    for alias in aliases:
        value = normalized.get(normalized_key(alias))
        if clean(value):
            return clean(value)
    return ""


def common_record(payload: dict, table: dict, row: dict) -> dict:
    captured_at = clean(payload.get("captured_at")) or datetime.now(timezone.utc).isoformat()
    return {
        "company": clean(payload.get("company")),
        "evidence_url": clean(payload.get("page_url")),
        "original_location": f"{clean(table.get('table_title'))} / 可见行 {row.get('_visible_row', '')}",
        "source_date": captured_at[:10],
        "page_title": clean(payload.get("page_title")),
        "capture_source": "edge_visible_table_extension",
        "review_required": True,
        "source_access": clean(payload.get("source_access")) or "public_visible",
        "raw_visible_row": row,
    }


def normalize_record(payload: dict, table: dict, row: dict) -> dict:
    dataset_type = clean(table.get("dataset_type")) or "visible_table"
    record = {"dataset_type": dataset_type, **common_record(payload, table, row)}
    date_value = value_from(row, "报告期/发布日期", "报告日期", "公告日期", "日期", "决定日期", "任职日期")
    if date_value:
        record["source_date"] = date_value
    if dataset_type == "supplier_customer":
        supplier = value_from(row, "供应商", "供应商名称", "供货方")
        customer = value_from(row, "客户", "客户名称", "采购单位", "招标/采购单位")
        role = "supplier" if supplier else "customer" if customer else value_from(row, "角色", "role")
        record.update({
            "role": role,
            "counterparty_name": supplier or customer or value_from(row, "交易对手", "主体名称"),
            "purchase_amount": value_from(row, "采购金额", "采购金额(万元)", "采购额"),
            "purchase_ratio": value_from(row, "采购占比", "采购比例"),
            "sales_amount": value_from(row, "销售金额", "销售金额(万元)", "中标金额(万元)"),
            "revenue_ratio": value_from(row, "销售占比", "收入占比"),
            "country_or_region": value_from(row, "国家/地区", "国家或地区", "注册地", "所在地"),
            "publish_date": date_value,
        })
    elif dataset_type == "equity_structure":
        record.update({
            "subject_name": value_from(row, "股东名称", "股东", "出资人", "实际控制人"),
            "subject_role": value_from(row, "股东性质", "主体角色", "股东类型") or "shareholder",
            "report_date": date_value,
            "shareholding_ratio": value_from(row, "持股比例", "持股比例(%)", "出资比例"),
            "holding_shares": value_from(row, "持股数额", "持股数量", "持股数"),
            "ownership_type": value_from(row, "持股类型", "所有权类型") or "unknown",
        })
    elif dataset_type == "executive_profile":
        record.update({
            "person_name": value_from(row, "姓名", "人员姓名", "高管姓名"),
            "position": value_from(row, "职务", "职位", "任职类型", "人物标签"),
            "start_date": value_from(row, "任职日期", "开始日期"),
            "end_date": value_from(row, "届满日期", "离任日期", "结束日期"),
            "technical_role": value_from(row, "技术角色", "核心技术人员"),
        })
    elif dataset_type == "related_entity":
        record.update({
            "person_name": value_from(row, "人员姓名", "姓名", "关联人员", "法定代表人"),
            "related_entity_name": value_from(row, "关联企业", "企业名称", "关联实体", "公司名称"),
            "relation_type": value_from(row, "关联关系", "关系类型", "职务", "角色"),
            "relation_start_date": value_from(row, "关系开始日期", "成立日期", "任职日期") or date_value,
            "registration_status": value_from(row, "经营状态", "登记状态"),
        })
    elif dataset_type == "litigation_event":
        record.update({
            "subject_name": value_from(row, "当事人", "被告", "原告", "主体名称"),
            "event_title": value_from(row, "案件名称", "标题", "案由"),
            "case_no": value_from(row, "案号"),
            "court": value_from(row, "法院", "执行法院"),
            "amount": value_from(row, "涉案金额", "标的金额"),
            "event_date": date_value,
        })
    elif dataset_type == "regulatory_event":
        record.update({
            "subject_name": value_from(row, "处罚对象", "监管对象", "当事人", "主体名称"),
            "event_type": "unknown",
            "event_title": value_from(row, "处罚事由", "标题", "监管事项"),
            "decision_number": value_from(row, "决定文书号", "文书号"),
            "authority": value_from(row, "处罚机关", "监管机构"),
            "decision_date": date_value,
        })
    else:
        record.update({"visible_fields": {clean(key): clean(value) for key, value in row.items()}})
    return record


def process_capture(project_root: Path, payload: dict) -> dict:
    company = clean(payload.get("company"))
    page_url = clean(payload.get("page_url"))
    if not company:
        raise ValueError("missing company")
    if urlparse(page_url).scheme not in {"http", "https"}:
        raise ValueError("page_url must be http or https")
    tables = payload.get("tables")
    if not isinstance(tables, list) or not tables:
        raise ValueError("no reviewed tables selected")
    now = datetime.now(timezone.utc)
    material = json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8")
    digest = hashlib.sha256(material).hexdigest()[:12]
    stem = f"edge_capture_{now:%Y%m%d_%H%M%S}_{digest}"
    raw_dir = project_root / "data" / "edge_captures"
    raw_dir.mkdir(parents=True, exist_ok=True)
    raw_path = raw_dir / f"{stem}.json"
    raw_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    records_by_type: dict[str, list[dict]] = {}
    for table in tables:
        if not isinstance(table, dict) or not isinstance(table.get("rows"), list):
            continue
        for row in table["rows"]:
            if isinstance(row, dict):
                record = normalize_record(payload, table, row)
                record["validation_errors"] = validate_structured_record(record["dataset_type"], record)
                records_by_type.setdefault(record["dataset_type"], []).append(record)

    structured_paths: list[str] = []
    paid_source = clean(payload.get("source_access")) == "paid_source"
    if not paid_source:
        for dataset_type, records in records_by_type.items():
            output_dir = project_root / "data" / "structured_exports" / dataset_type
            output_dir.mkdir(parents=True, exist_ok=True)
            path = output_dir / f"{stem}.json"
            path.write_text(json.dumps({"records": records}, ensure_ascii=False, indent=2), encoding="utf-8")
            structured_paths.append(str(path))
    return {
        "ok": True,
        "raw_path": str(raw_path),
        "structured_paths": structured_paths,
        "record_count": sum(len(records) for records in records_by_type.values()),
        "invalid_count": sum(
            bool(record.get("validation_errors"))
            for records in records_by_type.values() for record in records
        ),
        "paid_approval_required": paid_source,
    }


class CaptureHandler(BaseHTTPRequestHandler):
    project_root: Path

    def log_message(self, fmt: str, *args) -> None:
        print(f"[{self.log_date_time_string()}] {self.address_string()} {fmt % args}")

    def _headers(self, status: int, length: int) -> None:
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(length))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.end_headers()

    def _json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self._headers(status, len(body))
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:  # noqa: N802
        self._headers(HTTPStatus.NO_CONTENT, 0)

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/health":
            return self._json(HTTPStatus.OK, {"ok": True, "service": "edge-capture-receiver"})
        return self._json(HTTPStatus.NOT_FOUND, {"error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/capture":
            return self._json(HTTPStatus.NOT_FOUND, {"error": "not found"})
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > MAX_BODY_BYTES:
                raise ValueError("invalid body size")
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            if not isinstance(payload, dict):
                raise ValueError("payload must be an object")
            result = process_capture(self.project_root, payload)
            return self._json(HTTPStatus.OK, result)
        except Exception as exc:
            return self._json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})


def main() -> None:
    parser = argparse.ArgumentParser(description="Receive reviewed visible-table captures from Edge.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8770)
    args = parser.parse_args()
    handler = type("BoundCaptureHandler", (CaptureHandler,), {"project_root": PROJECT_ROOT})
    server = ThreadingHTTPServer((args.host, args.port), handler)
    print(f"Edge capture receiver: http://{args.host}:{args.port}/health", flush=True)
    try:
        server.serve_forever()
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
