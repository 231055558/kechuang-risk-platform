from __future__ import annotations

import unittest
from pathlib import Path


from src.neo4j_sync import Neo4jRiskGraphSync


ROOT = Path(__file__).resolve().parents[1]


class _Result:
    def consume(self):
        return None


class _Session:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict]] = []

    def run(self, query: str, **params):
        self.calls.append((query, params))
        return _Result()


class Neo4jMultiSnapshotTests(unittest.TestCase):
    def setUp(self) -> None:
        self.sync = Neo4jRiskGraphSync(
            ROOT / "data" / "unused.sqlite", "bolt://localhost:7687", "neo4j", "unused"
        )

    def test_node_merge_preserves_existing_memberships(self) -> None:
        session = _Session()
        row = {
            "node_key": "node:test", "node_type": "company", "canonical_name": "测试企业",
            "attributes_json": "{}", "confidence": 0.9, "needs_review": 0,
            "review_reason": "", "first_seen_run_id": "run-a", "last_seen_run_id": "run-b",
            "created_at": "2026-01-01", "updated_at": "2026-01-02",
        }
        self.sync._merge_node(session, row, "run-b")
        query, params = session.calls[0]
        self.assertIn("snapshot_run_ids", query)
        self.assertIn("previous_memberships + $run_id", query)
        self.assertEqual(params["run_id"], "run-b")

    def test_prune_removes_only_selected_run_membership(self) -> None:
        session = _Session()
        self.sync._mark_not_in_snapshot(session, ["node:keep"], ["edge:keep"], "run-b")
        self.assertEqual(len(session.calls), 2)
        for query, params in session.calls:
            self.assertIn("value <> $run_id", query)
            self.assertIn("size(remaining) > 0", query)
            self.assertEqual(params["run_id"], "run-b")


if __name__ == "__main__":
    unittest.main()

