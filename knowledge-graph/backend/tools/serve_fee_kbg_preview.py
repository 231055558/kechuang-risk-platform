"""Serve one completed FEE-KBG snapshot directly from SQLite for local QA."""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from http.server import ThreadingHTTPServer
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

from src.neo4j_sync import load_schema
from tools.serve_risk_graph_api import GraphReader, _evidence_display_label, handler_factory


DEFAULT_WEB_ROOT = PROJECT_ROOT.parent / "frontend"


class SQLiteFeeReader:
    def __init__(self, db_path: Path, run_id: str):
        self.db_path = Path(db_path)
        self.run_id = run_id
        schema = load_schema()
        self.display_type = {key: value["display_name"] for key, value in schema["node_labels"].items()}

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(f"file:{self.db_path.as_posix()}?mode=ro", uri=True)
        conn.row_factory = sqlite3.Row
        return conn

    def close(self) -> None:
        return None

    def health(self) -> dict:
        with self._connect() as conn:
            run = conn.execute(
                "SELECT status,node_count FROM knowledge_graph_runs WHERE run_id=?", (self.run_id,)
            ).fetchone()
            if not run or run["status"] != "completed":
                raise LookupError("SQLite FEE-KBG 快照不存在或尚未完成")
            return {
                "ok": True, "neo4j": "sqlite-preview", "active_nodes": run["node_count"],
                "snapshot_run_id": self.run_id,
            }

    def companies(self) -> list[dict]:
        with self._connect() as conn:
            rows = conn.execute(
                """SELECT n.* FROM knowledge_graph_snapshot_nodes s
                   JOIN knowledge_graph_nodes n ON n.node_key=s.node_key
                   WHERE s.run_id=? AND n.node_type='company' ORDER BY n.canonical_name""",
                (self.run_id,),
            ).fetchall()
            return [self._node(row) for row in rows]

    def fee_kbg(self, company_key: str, limit: int) -> dict:
        with self._connect() as conn:
            root = conn.execute(
                """SELECT n.node_key FROM knowledge_graph_snapshot_nodes s
                   JOIN knowledge_graph_nodes n ON n.node_key=s.node_key
                   WHERE s.run_id=? AND n.node_key=? AND n.node_type='company'""",
                (self.run_id, company_key),
            ).fetchone()
            if not root:
                raise LookupError("当前企业尚无FEE-KBG试点快照")
            node_rows = conn.execute(
                """SELECT n.* FROM knowledge_graph_snapshot_nodes s
                   JOIN knowledge_graph_nodes n ON n.node_key=s.node_key
                   WHERE s.run_id=? ORDER BY n.node_type,n.canonical_name LIMIT ?""",
                (self.run_id, limit),
            ).fetchall()
            nodes = [self._node(row) for row in node_rows]
            node_keys = {node["id"] for node in nodes}
            edge_rows = conn.execute(
                """SELECT e.* FROM knowledge_graph_snapshot_edges s
                   JOIN knowledge_graph_edges e ON e.edge_key=s.edge_key
                   WHERE s.run_id=? ORDER BY e.relation_type,e.edge_key""",
                (self.run_id,),
            ).fetchall()
            edges = [self._edge(row) for row in edge_rows if row["subject_key"] in node_keys and row["object_key"] in node_keys]
            warning = next((node for node in nodes if node["type"] == "warning_score"), None)
            attrs = warning["attributes"] if warning else {}
            return {
                "company_key": company_key, "view": "fee_kbg", "snapshot_run_id": self.run_id,
                "nodes": nodes, "edges": edges,
                "layer_counts": dict(__import__("collections").Counter(str(node["attributes"].get("fee_layer") or "other") for node in nodes)),
                "warning_scores": {
                    "W": attrs.get("indicator_score"), "E": attrs.get("E"), "H": attrs.get("H"),
                    "risk_level": attrs.get("risk_level"), "coverage_ratio": attrs.get("coverage_ratio"),
                    "limitations": attrs.get("limitations"),
                },
                "event_count": sum(node["type"] == "risk_event" for node in nodes),
                "actor_count": sum(node["attributes"].get("fee_layer") == "entity" and node["id"] != company_key for node in nodes),
                "indicator_count": sum(node["type"] == "risk_indicator" for node in nodes),
                "evolution_count": sum(edge["relation_code"] == "evolves_to" for edge in edges),
                "truncated": len(node_rows) >= limit, "missing": [],
            }

    def graph(self, *_args, **_kwargs):
        raise LookupError("SQLite 预览仅提供FEE-KBG完整视图")

    risk_chains = graph
    fee_transmission = GraphReader.fee_transmission
    subject_panorama = GraphReader.subject_panorama

    def event_transmission(self, company_key: str, limit: int) -> dict:
        graph = self.fee_kbg(company_key, max(limit * 8, 300))
        by_id = {node["id"]: node for node in graph["nodes"]}
        events = sorted(
            (node for node in graph["nodes"] if node["type"] == "risk_event"),
            key=lambda node: (str(node["attributes"].get("event_date") or ""), node["label"]),
        )[:limit]
        event_keys = {node["id"] for node in events}
        indicator_by_name = {
            str(node["attributes"].get("schema_indicator") or node["label"]): node
            for node in graph["nodes"] if node["type"] == "risk_indicator"
        }
        nodes = {company_key: by_id[company_key]}
        edges: dict[str, dict] = {}
        actor_count = indicator_count = 0
        for event in events:
            event["attributes"]["chain_role"] = "risk_event"
            nodes[event["id"]] = event
            company_edge = next((edge for edge in graph["edges"] if edge["source"] == event["id"] and edge["relation_code"] == "event_impacts_company"), None)
            edge_id = f"preview:event-company:{event['id']}"
            edges[edge_id] = {
                "id": edge_id, "source": event["id"], "target": company_key,
                "relation": "影响企业", "relation_code": "event_impacts_company",
                "confidence": event["confidence"], "needs_review": False,
                "attributes": (company_edge or {}).get("attributes", {"chain_projection": True}),
            }
            for impact in (
                edge for edge in graph["edges"]
                if edge["target"] == event["id"] and edge["relation_code"] == "subject_impacts_event"
            ):
                actor = by_id.get(impact["source"])
                if not actor:
                    continue
                actor["attributes"]["chain_role"] = "event_actor"
                nodes[actor["id"]] = actor
                edges[impact["id"]] = impact
                actor_count += 1
            for name in GraphReader._event_indicator_names(event):
                indicator = indicator_by_name.get(name)
                if not indicator:
                    continue
                indicator["attributes"]["chain_role"] = "secondary_indicator"
                nodes[indicator["id"]] = indicator
                mapping = "原始事件映射" if indicator["attributes"].get("indicator_id") in set(event["attributes"].get("original_indicator_ids") or []) else "事件机制推断"
                edge_id = f"preview:event-indicator:{event['id']}:{indicator['id']}"
                edges[edge_id] = {
                    "id": edge_id, "source": event["id"], "target": indicator["id"],
                    "relation": "影响指标（原始映射）" if mapping == "原始事件映射" else "影响指标（机制推断）",
                    "relation_code": "event_concludes_to_indicator", "confidence": event["confidence"],
                    "needs_review": False, "attributes": {"event_mapping": mapping, "chain_projection": True},
                }
                indicator_count += 1
            for support in (
                edge for edge in graph["edges"]
                if edge["target"] == event["id"] and edge["relation_code"] == "supports_event"
            ):
                source = by_id.get(support["source"])
                if source:
                    source["attributes"]["chain_role"] = "evidence_source"
                    nodes[source["id"]] = source
                    edges[support["id"]] = support
            evolution = GraphReader._event_evolution(event)
            if evolution:
                future_key = f"preview:future:{event['id']}"
                nodes[future_key] = {
                    "id": future_key, "label": evolution, "type": "future_evolution",
                    "type_label": "可能演化", "confidence": None, "needs_review": False,
                    "snapshot_run_id": self.run_id,
                    "attributes": {"chain_role": "future_evolution", "predictive": True, "based_on": event["label"]},
                }
                edge_id = f"preview:future-edge:{event['id']}"
                edges[edge_id] = {
                    "id": edge_id, "source": event["id"], "target": future_key,
                    "relation": "可能演化为", "relation_code": "may_evolve_to",
                    "confidence": None, "needs_review": False,
                    "attributes": {"chain_projection": True, "predictive": True},
                }
        actor_count = sum(node.get("attributes", {}).get("chain_role") == "event_actor" for node in nodes.values())
        indicator_count = sum(node.get("attributes", {}).get("chain_role") == "secondary_indicator" for node in nodes.values())
        return {
            "company_key": company_key, "view": "event_transmission",
            "nodes": list(nodes.values()), "edges": list(edges.values()),
            "event_count": len(events), "actor_count": actor_count,
            "indicator_count": indicator_count, "missing": [], "truncated": len(events) >= limit,
        }

    def _node(self, row: sqlite3.Row) -> dict:
        attributes = json.loads(row["attributes_json"] or "{}")
        if row["node_type"] == "risk_event" and attributes.get("event_date"):
            attributes["display_context"] = attributes["event_date"]
        label = row["canonical_name"]
        if row["node_type"] in {"evidence_source", "external_evidence_source"}:
            translated = _evidence_display_label(label)
            if translated != label:
                attributes["original_source_title"] = label
                label = translated
        return {
            "id": row["node_key"], "label": label, "type": row["node_type"],
            "type_label": self.display_type.get(row["node_type"], "补充实体"),
            "confidence": row["confidence"], "needs_review": bool(row["needs_review"]),
            "snapshot_run_id": self.run_id, "attributes": attributes,
        }

    @staticmethod
    def _edge(row: sqlite3.Row) -> dict:
        labels = {
            "procures_from": "向上游采购", "held_by": "持股", "employs": "任职",
            "belongs_to_industry": "属于行业", "associated_with_concept": "概念关联",
            "participates_in": "参与事件", "instance_of_topic": "归属主题",
            "maps_to_indicator": "映射指标", "belongs_to_risk_category": "属于风险",
            "supports_event": "提供证据", "regulates_event": "监管事件",
            "inquires_event": "问询事件", "adjudicates_event": "裁判事件",
            "involved_in_event": "涉及事件", "lists_entity_in_event": "列入清单事件",
            "evolves_to": "关联演化", "has_warning_score": "辅助预警",
            "subject_impacts_event": "影响事件", "event_impacts_company": "影响企业",
            "event_transmits_risk": "传导风险",
            "subject_influences_company": "影响企业主体",
            "has_external_risk_event": "发生外部风险事件",
            "supports_external_event": "提供外部事件证据",
            "external_event_impacts_subject": "影响关键主体",
            "activates_transmission_channel": "触发传导机制",
            "external_risk_transmits_to_company": "风险传导至企业",
            "external_risk_maps_to_indicator": "形成企业风险",
            "external_event_evolves_to": "外部事件演化",
            "may_evolve_to": "在条件成立时可能演化为",
            "scenario_maps_to_indicator": "可能导致风险指标上升",
            "serves_at_external_entity": "在关联企业任职",
        }
        return {
            "id": row["edge_key"], "source": row["subject_key"], "target": row["object_key"],
            "relation": labels.get(row["relation_type"], row["relation_type"]),
            "relation_code": row["relation_type"], "confidence": row["confidence"],
            "needs_review": bool(row["needs_review"]),
            "attributes": json.loads(row["attributes_json"] or "{}"),
        }


class MultiSQLiteFeeReader:
    """Expose multiple independent SQLite snapshots through one read-only API."""

    def __init__(self, readers: list[SQLiteFeeReader]):
        if not readers:
            raise ValueError("至少需要一个图谱快照")
        self.readers = readers
        self.company_readers: dict[str, SQLiteFeeReader] = {}
        for reader in readers:
            reader.health()
            for company in reader.companies():
                company_key = company["id"]
                if company_key in self.company_readers:
                    raise ValueError(f"企业节点重复出现在多个快照中：{company_key}")
                self.company_readers[company_key] = reader

    def close(self) -> None:
        for reader in self.readers:
            reader.close()

    def health(self) -> dict:
        health = [reader.health() for reader in self.readers]
        run_ids = [str(item["snapshot_run_id"]) for item in health]
        return {
            "ok": True,
            "neo4j": "sqlite-preview-multi-snapshot",
            "active_nodes": sum(int(item["active_nodes"]) for item in health),
            "snapshot_run_id": run_ids[0],
            "snapshot_run_ids": run_ids,
            "snapshot_count": len(run_ids),
        }

    def companies(self) -> list[dict]:
        return sorted(
            (
                company
                for reader in self.readers
                for company in reader.companies()
            ),
            key=lambda company: company["label"],
        )

    def _reader_for(self, company_key: str) -> SQLiteFeeReader:
        reader = self.company_readers.get(company_key)
        if reader is None:
            raise LookupError("当前企业尚无FEE-KBG试点快照")
        return reader

    def fee_kbg(self, company_key: str, limit: int) -> dict:
        return self._reader_for(company_key).fee_kbg(company_key, limit)

    def fee_transmission(
        self, company_key: str, limit: int, min_weight: float
    ) -> dict:
        return self._reader_for(company_key).fee_transmission(
            company_key, limit, min_weight
        )

    def subject_panorama(
        self, company_key: str, limit: int, min_weight: float
    ) -> dict:
        return self._reader_for(company_key).subject_panorama(
            company_key, limit, min_weight
        )

    def event_transmission(self, company_key: str, limit: int) -> dict:
        return self._reader_for(company_key).event_transmission(company_key, limit)

    def graph(self, company_key: str, *args, **kwargs):
        return self._reader_for(company_key).graph(company_key, *args, **kwargs)

    risk_chains = graph


def _resolve_db_path(value: str) -> Path:
    db_path = Path(value)
    return db_path if db_path.is_absolute() else PROJECT_ROOT / db_path


def _snapshot_reader(specification: str) -> SQLiteFeeReader:
    run_id, separator, db_value = specification.partition("=")
    if not separator or not run_id or not db_value:
        raise ValueError("--snapshot 必须使用 RUN_ID=SQLITE_PATH 格式")
    return SQLiteFeeReader(_resolve_db_path(db_value), run_id)


def main() -> None:
    parser = argparse.ArgumentParser(description="Serve a read-only SQLite FEE-KBG preview.")
    parser.add_argument("--run-id", default="cambricon_fee_kbg_20260826_v1")
    parser.add_argument("--db", default="data/risk_data.sqlite")
    parser.add_argument(
        "--snapshot",
        action="append",
        default=[],
        metavar="RUN_ID=SQLITE_PATH",
        help="加载一个独立快照；可重复传入以提供多企业预览。",
    )
    parser.add_argument("--web-root", default=str(DEFAULT_WEB_ROOT))
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8766)
    args = parser.parse_args()
    reader = (
        MultiSQLiteFeeReader([_snapshot_reader(item) for item in args.snapshot])
        if args.snapshot
        else SQLiteFeeReader(_resolve_db_path(args.db), args.run_id)
    )
    reader.health()
    server = ThreadingHTTPServer((args.host, args.port), handler_factory(reader, Path(args.web_root)))
    print(f"FEE-KBG SQLite 预览已启动：http://{args.host}:{args.port}/", flush=True)
    try:
        server.serve_forever()
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
