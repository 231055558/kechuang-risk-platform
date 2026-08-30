import unittest
from pathlib import Path

from tools.serve_fee_kbg_preview import SQLiteMultiSnapshotReader


DEMO_DB = Path(__file__).resolve().parents[2] / "demo" / "multi-company-fee-kbg.sqlite"
RUN_IDS = [
    "cambricon_fee_kbg_20260826_v1",
    "semidrive_fee_kbg_20260827_v1",
]


class MultiSnapshotPreviewTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.reader = SQLiteMultiSnapshotReader(DEMO_DB, RUN_IDS)

    @classmethod
    def tearDownClass(cls):
        cls.reader.close()

    def test_health_and_company_directory_cover_both_snapshots(self):
        health = self.reader.health()
        companies = self.reader.companies()

        self.assertEqual(health["neo4j"], "sqlite-preview")
        self.assertEqual(health["active_nodes"], 244)
        self.assertEqual(health["snapshot_run_ids"], RUN_IDS)
        self.assertEqual(
            {company["attributes"]["stock_code"] for company in companies},
            {"688256", "PRIVATE-SEMIDRIVE"},
        )

    def test_each_company_routes_to_its_own_snapshot(self):
        companies = self.reader.companies()
        by_code = {
            company["attributes"]["stock_code"]: company for company in companies
        }
        cambricon = self.reader.fee_transmission(by_code["688256"]["id"], 300, 0.5)
        semidrive = self.reader.fee_transmission(
            by_code["PRIVATE-SEMIDRIVE"]["id"], 300, 0.5
        )

        self.assertEqual(cambricon["snapshot_run_id"], RUN_IDS[0])
        self.assertEqual(semidrive["snapshot_run_id"], RUN_IDS[1])
        self.assertGreater(len(cambricon["nodes"]), 0)
        self.assertGreater(len(semidrive["nodes"]), 0)

        for graph in (cambricon, semidrive):
            self.assertNotIn("warning_score", {node["type"] for node in graph["nodes"]})
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


if __name__ == "__main__":
    unittest.main()
