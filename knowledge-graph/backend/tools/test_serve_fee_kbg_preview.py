import unittest
from pathlib import Path

from tools.serve_fee_kbg_preview import (
    DEFAULT_WEB_ROOT,
    MultiSQLiteFeeReader,
    SQLiteFeeReader,
)


PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEMO_ROOT = PROJECT_ROOT / "demo"


class MultiSnapshotPreviewTests(unittest.TestCase):
    def setUp(self):
        self.reader = MultiSQLiteFeeReader(
            [
                SQLiteFeeReader(
                    DEMO_ROOT / "cambricon_fee_kbg_demo.sqlite",
                    "cambricon_fee_kbg_20260826_v1",
                ),
                SQLiteFeeReader(
                    DEMO_ROOT / "semidrive_fee_kbg_demo.sqlite",
                    "semidrive_fee_kbg_20260827_v1",
                ),
            ]
        )

    def tearDown(self):
        self.reader.close()

    def test_exposes_two_independent_company_snapshots(self):
        companies = self.reader.companies()
        self.assertEqual(len(companies), 2)
        by_stock_code = {
            company["attributes"]["stock_code"]: company for company in companies
        }
        self.assertEqual(
            set(by_stock_code), {"688256", "PRIVATE-SEMIDRIVE"}
        )

        cambricon = self.reader.fee_kbg(by_stock_code["688256"]["id"], 500)
        semidrive = self.reader.fee_kbg(
            by_stock_code["PRIVATE-SEMIDRIVE"]["id"], 500
        )
        self.assertEqual(
            cambricon["snapshot_run_id"], "cambricon_fee_kbg_20260826_v1"
        )
        self.assertEqual(
            semidrive["snapshot_run_id"], "semidrive_fee_kbg_20260827_v1"
        )
        self.assertEqual(len(cambricon["nodes"]), 150)
        self.assertEqual(len(semidrive["nodes"]), 104)

    def test_health_aggregates_snapshot_nodes(self):
        health = self.reader.health()
        self.assertEqual(health["active_nodes"], 254)
        self.assertEqual(health["snapshot_count"], 2)
        self.assertEqual(
            health["snapshot_run_ids"],
            [
                "cambricon_fee_kbg_20260826_v1",
                "semidrive_fee_kbg_20260827_v1",
            ],
        )

    def test_unknown_company_never_falls_back_to_another_snapshot(self):
        with self.assertRaisesRegex(LookupError, "尚无FEE-KBG试点快照"):
            self.reader.fee_kbg("node:missing", 500)

    def test_default_web_root_is_the_tracked_frontend(self):
        self.assertEqual(DEFAULT_WEB_ROOT, PROJECT_ROOT / "frontend")
        self.assertTrue((DEFAULT_WEB_ROOT / "risk-knowledge-graph.html").is_file())


if __name__ == "__main__":
    unittest.main()
