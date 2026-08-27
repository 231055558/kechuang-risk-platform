from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

from tools.serve_edge_capture_receiver import normalize_record, process_capture


class EdgeCaptureReceiverTests(unittest.TestCase):
    def payload(self, source_access: str = "public_visible") -> dict:
        return {
            "company": "中科寒武纪科技股份有限公司",
            "page_url": "https://example.test/company",
            "page_title": "供应商信息",
            "captured_at": "2026-08-26T08:00:00Z",
            "source_access": source_access,
            "tables": [{
                "table_title": "前五大供应商",
                "dataset_type": "supplier_customer",
                "rows": [{"_visible_row": 1, "供应商": "测试供应商", "采购占比": "12.50%", "报告日期": "2025-12-31"}],
            }],
        }

    def test_normalizes_visible_supplier_row(self) -> None:
        payload = self.payload()
        record = normalize_record(payload, payload["tables"][0], payload["tables"][0]["rows"][0])
        self.assertEqual(record["dataset_type"], "supplier_customer")
        self.assertEqual(record["role"], "supplier")
        self.assertEqual(record["counterparty_name"], "测试供应商")
        self.assertEqual(record["purchase_ratio"], "12.50%")

    def test_public_capture_writes_raw_and_structured_records(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            result = process_capture(Path(directory), self.payload())
            self.assertEqual(result["record_count"], 1)
            self.assertFalse(result["paid_approval_required"])
            self.assertTrue(Path(result["raw_path"]).is_file())
            self.assertEqual(len(result["structured_paths"]), 1)
            data = json.loads(Path(result["structured_paths"][0]).read_text(encoding="utf-8"))
            self.assertEqual(data["records"][0]["counterparty_name"], "测试供应商")

    def test_paid_capture_is_quarantined_as_raw_only(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            result = process_capture(Path(directory), self.payload("paid_source"))
            self.assertTrue(result["paid_approval_required"])
            self.assertEqual(result["structured_paths"], [])
            self.assertTrue(Path(result["raw_path"]).is_file())


if __name__ == "__main__":
    unittest.main()
