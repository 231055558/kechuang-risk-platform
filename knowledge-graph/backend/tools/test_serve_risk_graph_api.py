import json
import sys
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path
from urllib.request import urlopen

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

from tools.serve_risk_graph_api import handler_factory


class FakeReader:
    def health(self):
        return {"ok": True, "neo4j": "connected", "active_nodes": 2, "snapshot_run_id": "test_run"}

    def companies(self):
        return [{"id": "enterprise:1", "label": "测试企业", "snapshot_run_id": "test_run"}]

    def graph(self, key, limit, *, view="overview", focus_key="", relation_type="", offset=0):
        if key != "enterprise:1":
            raise LookupError("未找到当前快照中的企业")
        return {
            "company_key": key,
            "view": view,
            "selected_relation_type": relation_type,
            "offset": offset,
            "nodes": [{"id": key, "label": "测试企业", "type": "company", "type_label": "企业实体"}],
            "edges": [],
            "truncated": False,
        }

    def fee_kbg(self, key, limit):
        if key != "enterprise:1":
            raise LookupError("当前企业尚无FEE-KBG试点快照")
        return {
            "company_key": key,
            "view": "fee_kbg",
            "snapshot_run_id": "test_fee_run",
            "nodes": [{"id": key, "label": "测试企业", "type": "company", "type_label": "企业实体"}],
            "edges": [],
            "event_count": 0,
            "evolution_count": 0,
            "truncated": False,
        }

    def fee_transmission(self, key, limit, min_weight):
        payload = self.fee_kbg(key, limit)
        payload.update({
            "view": "fee_transmission", "min_weight": min_weight,
            "subject_count": 0, "event_count": 0, "indicator_count": 0,
            "evolution_count": 0,
        })
        return payload

    def subject_panorama(self, key, limit, min_weight):
        payload = self.fee_kbg(key, limit)
        payload.update({
            "view": "subject_panorama", "min_weight": min_weight,
            "subject_count": 0, "risk_subject_count": 0,
            "neutral_subject_count": 0, "candidate_subject_count": 0,
            "event_count": 0, "indicator_count": 0, "evolution_count": 0,
        })
        return payload

    def event_transmission(self, key, limit):
        if key != "enterprise:1":
            raise LookupError("未找到当前快照中的企业")
        return {
            "company_key": key, "view": "event_transmission",
            "nodes": [{"id": key, "label": "测试企业", "type": "company", "type_label": "企业实体"}],
            "edges": [], "event_count": 0, "actor_count": 0,
            "indicator_count": 0, "missing": [], "truncated": False,
        }


class GraphApiTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        root = Path(self.temp_dir.name)
        (root / "risk-knowledge-graph.html").write_text("<h1>dynamic graph</h1>", encoding="utf-8")
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), handler_factory(FakeReader(), root))
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"

    def tearDown(self):
        self.server.shutdown()
        self.thread.join(timeout=2)
        self.server.server_close()
        self.temp_dir.cleanup()

    def get_json(self, path):
        with urlopen(self.base + path, timeout=3) as response:
            return response.status, json.loads(response.read().decode("utf-8"))

    def test_exposes_only_fixed_read_endpoints(self):
        status, payload = self.get_json("/api/health")
        self.assertEqual(status, 200)
        self.assertEqual(payload["snapshot_run_id"], "test_run")
        status, payload = self.get_json("/api/companies")
        self.assertEqual(status, 200)
        self.assertEqual(payload["companies"][0]["label"], "测试企业")
        status, payload = self.get_json("/api/graph?company_key=enterprise%3A1")
        self.assertEqual(status, 200)
        self.assertEqual(payload["company_key"], "enterprise:1")
        self.assertEqual(payload["view"], "overview")
        status, payload = self.get_json("/api/graph?company_key=enterprise%3A1&view=focus&focus_key=node%3A1&relation_type=owns&offset=10")
        self.assertEqual(status, 200)
        self.assertEqual(payload["view"], "focus")
        self.assertEqual(payload["selected_relation_type"], "owns")
        self.assertEqual(payload["offset"], 10)
        status, payload = self.get_json("/api/fee-kbg?company_key=enterprise%3A1")
        self.assertEqual(status, 200)
        self.assertEqual(payload["view"], "fee_kbg")
        self.assertEqual(payload["snapshot_run_id"], "test_fee_run")
        status, payload = self.get_json("/api/fee-transmission?company_key=enterprise%3A1&min_weight=0.5")
        self.assertEqual(status, 200)
        self.assertEqual(payload["view"], "fee_transmission")
        self.assertEqual(payload["min_weight"], 0.5)
        status, payload = self.get_json("/api/event-transmission?company_key=enterprise%3A1")
        self.assertEqual(status, 200)
        self.assertEqual(payload["view"], "event_transmission")
        status, payload = self.get_json("/api/subject-panorama?company_key=enterprise%3A1&min_weight=0.5")
        self.assertEqual(status, 200)
        self.assertEqual(payload["view"], "subject_panorama")


if __name__ == "__main__":
    unittest.main()
