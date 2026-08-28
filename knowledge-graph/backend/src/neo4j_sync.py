"""Synchronise audited SQLite risk-graph snapshots to Neo4j.

Neo4j is an operational projection, not a new source of truth.  The crawler
continues to write evidence, entities, relations and versioned graph snapshots
to SQLite first.  This module writes only a selected completed snapshot to
Neo4j, with stable MERGE keys and evidence/review metadata preserved.
"""

from __future__ import annotations

import json
import re
import sqlite3
from pathlib import Path
from typing import Any

from .database import connect, init_db
from .r01r22_knowledge_graph import ensure_master_graph_schema


SCHEMA_PATH = Path(__file__).resolve().parents[1] / "config" / "neo4j_fee_kbg_schema_20260826.json"
SAFE_TOKEN = re.compile(r"^[A-Za-z_\u4e00-\u9fff][A-Za-z0-9_\u4e00-\u9fff]*$")


def _safe_token(value: str) -> str:
    if not SAFE_TOKEN.fullmatch(value):
        raise ValueError(f"unsafe Cypher label or relationship token: {value!r}")
    return value


def load_schema(path: Path = SCHEMA_PATH) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8-sig"))


class Neo4jRiskGraphSync:
    def __init__(self, db_path: Path, uri: str, username: str, password: str, database: str = "neo4j", schema_path: Path = SCHEMA_PATH):
        self.db_path = Path(db_path)
        self.uri = uri
        self.username = username
        self.password = password
        self.database = database
        self.schema = load_schema(schema_path)

    def _driver(self):
        try:
            from neo4j import GraphDatabase
        except ImportError as exc:
            raise RuntimeError("未安装 Neo4j Python 驱动。请运行：python -m pip install -r requirements-neo4j.txt") from exc
        return GraphDatabase.driver(self.uri, auth=(self.username, self.password))

    def initialize_schema(self) -> dict[str, int]:
        """Create a stable identity constraint and lookup indexes for the graph."""
        driver = self._driver()
        try:
            with driver.session(database=self.database) as session:
                session.run("CREATE CONSTRAINT risk_graph_node_key IF NOT EXISTS FOR (n:RiskNode) REQUIRE n.node_key IS UNIQUE").consume()
                session.run("CREATE INDEX risk_graph_canonical_name IF NOT EXISTS FOR (n:RiskNode) ON (n.canonical_name)").consume()
                session.run("CREATE INDEX risk_graph_node_type IF NOT EXISTS FOR (n:RiskNode) ON (n.node_type)").consume()
                session.run("CREATE INDEX risk_graph_last_seen_run IF NOT EXISTS FOR (n:RiskNode) ON (n.last_seen_run_id)").consume()
            return {"constraints": 1, "indexes": 3}
        finally:
            driver.close()

    def sync_snapshot(self, run_id: str, *, prune_snapshot_members: bool = False, replace_relation_types: bool = False) -> dict[str, int | str]:
        """Write one completed SQLite snapshot.  Never deletes historical graph data by default."""
        conn = connect(self.db_path)
        try:
            is_r01r22_master = bool(conn.execute(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name='indicator_catalog'"
            ).fetchone())
            if is_r01r22_master:
                ensure_master_graph_schema(conn)
            else:
                init_db(conn)
            run = conn.execute("SELECT * FROM knowledge_graph_runs WHERE run_id=?", (run_id,)).fetchone()
            if not run:
                raise ValueError(f"SQLite graph run not found: {run_id}")
            if run["status"] != "completed":
                raise ValueError(f"SQLite graph run is not completed: {run_id} ({run['status']})")
            node_snapshot_columns = {
                str(row[1]) for row in conn.execute("PRAGMA table_info(knowledge_graph_snapshot_nodes)")
            }
            edge_snapshot_columns = {
                str(row[1]) for row in conn.execute("PRAGMA table_info(knowledge_graph_snapshot_edges)")
            }
            if "attributes_json" in node_snapshot_columns:
                nodes = conn.execute(
                    """SELECT s.node_key,s.node_type,s.canonical_name,s.attributes_json,
                              s.confidence,s.needs_review,s.review_reason,
                              n.first_seen_run_id,n.last_seen_run_id,
                              COALESCE(NULLIF(s.created_at,''),n.created_at) AS created_at,
                              COALESCE(NULLIF(s.updated_at,''),n.updated_at) AS updated_at
                       FROM knowledge_graph_snapshot_nodes s
                       JOIN knowledge_graph_nodes n ON n.node_key=s.node_key
                       WHERE s.run_id=? ORDER BY s.node_key""",
                    (run_id,),
                ).fetchall()
            else:
                nodes = conn.execute(
                    """SELECT n.* FROM knowledge_graph_nodes n
                       JOIN knowledge_graph_snapshot_nodes s ON s.node_key=n.node_key
                       WHERE s.run_id=? ORDER BY n.node_key""", (run_id,)
                ).fetchall()
            if "attributes_json" in edge_snapshot_columns:
                edges = conn.execute(
                    """SELECT s.edge_key,s.subject_key,s.relation_type,s.object_key,s.attributes_json,
                              s.confidence,s.needs_review,s.review_reason,s.source_id,s.source_evidence_id,
                              e.first_seen_run_id,e.last_seen_run_id,
                              COALESCE(NULLIF(s.created_at,''),e.created_at) AS created_at,
                              COALESCE(NULLIF(s.updated_at,''),e.updated_at) AS updated_at
                       FROM knowledge_graph_snapshot_edges s
                       JOIN knowledge_graph_edges e ON e.edge_key=s.edge_key
                       WHERE s.run_id=? ORDER BY s.edge_key""",
                    (run_id,),
                ).fetchall()
            else:
                edges = conn.execute(
                    """SELECT e.* FROM knowledge_graph_edges e
                       JOIN knowledge_graph_snapshot_edges s ON s.edge_key=e.edge_key
                       WHERE s.run_id=? ORDER BY e.edge_key""", (run_id,)
                ).fetchall()
        finally:
            conn.close()

        driver = self._driver()
        try:
            with driver.session(database=self.database) as session:
                for row in nodes:
                    self._merge_node(session, row, run_id)
                for row in edges:
                    self._merge_edge(session, row, run_id)
                if replace_relation_types:
                    self._remove_legacy_relation_types(session)
                if prune_snapshot_members:
                    self._mark_not_in_snapshot(
                        session,
                        [str(row["node_key"]) for row in nodes],
                        [str(row["edge_key"]) for row in edges],
                        run_id,
                    )
            return {"run_id": run_id, "nodes_synced": len(nodes), "edges_synced": len(edges), "prune_snapshot_members": int(prune_snapshot_members), "legacy_relation_types_removed": int(replace_relation_types)}
        finally:
            driver.close()

    def _merge_node(self, session, row: sqlite3.Row, run_id: str) -> None:
        label_info = self.schema["node_labels"].get(row["node_type"], self.schema["node_labels"]["supplemental_entity"])
        label = _safe_token(label_info["label"])
        attributes = json.loads(row["attributes_json"] or "{}")
        # Arbitrary JSON remains namespaced to avoid invalid Neo4j property
        # values (maps/lists of maps) and preserve full provenance.
        props = {
            "node_key": row["node_key"], "node_type": row["node_type"], "canonical_name": row["canonical_name"],
            "attributes_json": json.dumps(attributes, ensure_ascii=False, sort_keys=True, default=str),
            "confidence": float(row["confidence"]), "needs_review": bool(row["needs_review"]), "review_reason": row["review_reason"],
            "first_seen_run_id": row["first_seen_run_id"], "last_seen_run_id": row["last_seen_run_id"],
            "snapshot_run_id": run_id, "in_snapshot": True, "created_at": row["created_at"], "updated_at": row["updated_at"],
        }
        snapshot_payload = json.dumps(
            {"run_id": run_id, **props}, ensure_ascii=False, separators=(",", ":"), default=str,
        )
        run_marker = json.dumps({"run_id": run_id}, ensure_ascii=False, separators=(",", ":"))[:-1]
        query = f"""
            MERGE (n:RiskNode {{node_key: $node_key}})
            WITH n,
                 CASE
                     WHEN n.snapshot_run_ids IS NOT NULL THEN n.snapshot_run_ids
                     WHEN n.snapshot_run_id IS NOT NULL THEN [n.snapshot_run_id]
                     ELSE []
                 END AS previous_memberships,
                 [payload IN coalesce(n.snapshot_payloads, [])
                  WHERE NOT (payload STARTS WITH $run_marker)] AS other_payloads
            SET n += $props
            SET n.snapshot_run_ids = CASE
                WHEN $run_id IN previous_memberships THEN previous_memberships
                ELSE previous_memberships + [$run_id]
            END,
            n.snapshot_payloads = other_payloads + [$snapshot_payload],
            n.in_snapshot = true
            SET n:{label}
        """
        session.run(
            query, node_key=row["node_key"], props=props, run_id=run_id,
            run_marker=run_marker, snapshot_payload=snapshot_payload,
        ).consume()

    def _merge_edge(self, session, row: sqlite3.Row, run_id: str) -> None:
        relation = self.schema["relationship_types"].get(row["relation_type"], "RELATED_TO")
        relation = _safe_token(relation)
        attributes = json.loads(row["attributes_json"] or "{}")
        props = {
            "edge_key": row["edge_key"], "relation_type": row["relation_type"],
            "attributes_json": json.dumps(attributes, ensure_ascii=False, sort_keys=True, default=str),
            "confidence": float(row["confidence"]), "needs_review": bool(row["needs_review"]), "review_reason": row["review_reason"],
            "source_id": int(row["source_id"]), "source_evidence_id": int(row["source_evidence_id"]),
            "first_seen_run_id": row["first_seen_run_id"], "last_seen_run_id": row["last_seen_run_id"],
            "snapshot_run_id": run_id, "in_snapshot": True, "created_at": row["created_at"], "updated_at": row["updated_at"],
        }
        snapshot_payload = json.dumps(
            {"run_id": run_id, **props}, ensure_ascii=False, separators=(",", ":"), default=str,
        )
        run_marker = json.dumps({"run_id": run_id}, ensure_ascii=False, separators=(",", ":"))[:-1]
        query = f"""
            MATCH (s:RiskNode {{node_key: $subject_key}}), (o:RiskNode {{node_key: $object_key}})
            MERGE (s)-[r:{relation} {{edge_key: $edge_key}}]->(o)
            WITH r,
                 CASE
                     WHEN r.snapshot_run_ids IS NOT NULL THEN r.snapshot_run_ids
                     WHEN r.snapshot_run_id IS NOT NULL THEN [r.snapshot_run_id]
                     ELSE []
                 END AS previous_memberships,
                 [payload IN coalesce(r.snapshot_payloads, [])
                  WHERE NOT (payload STARTS WITH $run_marker)] AS other_payloads
            SET r += $props
            SET r.snapshot_run_ids = CASE
                WHEN $run_id IN previous_memberships THEN previous_memberships
                ELSE previous_memberships + [$run_id]
            END,
            r.snapshot_payloads = other_payloads + [$snapshot_payload],
            r.in_snapshot = true
        """
        session.run(
            query, subject_key=row["subject_key"], object_key=row["object_key"],
            edge_key=row["edge_key"], props=props, run_id=run_id,
            run_marker=run_marker, snapshot_payload=snapshot_payload,
        ).consume()

    def _mark_not_in_snapshot(self, session, node_keys: list[str], edge_keys: list[str], run_id: str) -> None:
        """Remove one run membership from members absent from its rebuilt snapshot.

        A run id may be rebuilt in place during curation.  Comparing only the
        previous ``snapshot_run_id`` leaves nodes that were removed from the
        rebuilt run incorrectly active.  Snapshot membership is the actual
        contract, so use the stable node/edge keys loaded from SQLite instead.
        Other companies' active snapshot memberships are preserved.
        """
        session.run(
            """
            MATCH (n:RiskNode)
            WITH n, CASE
                WHEN n.snapshot_run_ids IS NOT NULL THEN n.snapshot_run_ids
                WHEN n.snapshot_run_id IS NOT NULL THEN [n.snapshot_run_id]
                ELSE []
            END AS memberships
            WHERE $run_id IN memberships AND NOT (n.node_key IN $node_keys)
            WITH n, [value IN memberships WHERE value <> $run_id] AS remaining,
                 [payload IN coalesce(n.snapshot_payloads, [])
                  WHERE NOT (payload STARTS WITH $run_marker)] AS remaining_payloads
            SET n.snapshot_run_ids = remaining,
                n.snapshot_payloads = remaining_payloads,
                n.in_snapshot = size(remaining) > 0
            """,
            node_keys=node_keys, run_id=run_id,
            run_marker=json.dumps({"run_id": run_id}, separators=(",", ":"))[:-1],
        ).consume()
        session.run(
            """
            MATCH ()-[r]->()
            WHERE r.edge_key IS NOT NULL
            WITH r, CASE
                WHEN r.snapshot_run_ids IS NOT NULL THEN r.snapshot_run_ids
                WHEN r.snapshot_run_id IS NOT NULL THEN [r.snapshot_run_id]
                ELSE []
            END AS memberships
            WHERE $run_id IN memberships AND NOT (r.edge_key IN $edge_keys)
            WITH r, [value IN memberships WHERE value <> $run_id] AS remaining,
                 [payload IN coalesce(r.snapshot_payloads, [])
                  WHERE NOT (payload STARTS WITH $run_marker)] AS remaining_payloads
            SET r.snapshot_run_ids = remaining,
                r.snapshot_payloads = remaining_payloads,
                r.in_snapshot = size(remaining) > 0
            """,
            edge_keys=edge_keys, run_id=run_id,
            run_marker=json.dumps({"run_id": run_id}, separators=(",", ":"))[:-1],
        ).consume()

    def _remove_legacy_relation_types(self, session) -> None:
        """Remove only historical English copies with the same stable edge key.

        `edge_key` is unique per logical relation, so the newly MERGEd Chinese
        relationship remains authoritative. Nodes and unrelated user data stay
        untouched.
        """
        chinese_types = set(self.schema["relationship_types"].values())
        for internal, chinese in self.schema["relationship_types"].items():
            legacy = internal.upper()
            if legacy == chinese or legacy in chinese_types:
                continue
            legacy = _safe_token(legacy)
            session.run(f"MATCH ()-[r:{legacy}]->() WHERE r.edge_key IS NOT NULL DELETE r").consume()
