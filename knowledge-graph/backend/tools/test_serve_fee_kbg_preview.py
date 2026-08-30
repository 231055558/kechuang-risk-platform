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

    def test_fee_transmission_ends_at_company_through_risk_categories(self):
        companies = self.reader.companies()
        for company in companies:
            graph = self.reader.fee_transmission(company["id"], 500, 0.5)
            self.assertNotIn(
                "warning_score", {node["type"] for node in graph["nodes"]}
            )
            company_edges = [
                edge
                for edge in graph["edges"]
                if edge["source"] == graph["company_key"]
                or edge["target"] == graph["company_key"]
            ]
            self.assertGreater(len(company_edges), 0)
            self.assertEqual(
                {edge["relation_code"] for edge in company_edges},
                {"risk_category_impacts_company"},
            )
            self.assertTrue(
                all(edge["target"] == graph["company_key"] for edge in company_edges)
            )

    def test_unknown_company_never_falls_back_to_another_snapshot(self):
        with self.assertRaisesRegex(LookupError, "尚无FEE-KBG试点快照"):
            self.reader.fee_kbg("node:missing", 500)

    def test_default_web_root_is_the_tracked_frontend(self):
        self.assertEqual(DEFAULT_WEB_ROOT, PROJECT_ROOT / "frontend")
        self.assertTrue((DEFAULT_WEB_ROOT / "risk-knowledge-graph.html").is_file())


if __name__ == "__main__":
    unittest.main()
