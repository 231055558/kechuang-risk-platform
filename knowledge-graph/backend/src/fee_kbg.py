"""Financial event evolutionary-knowledge big graph pilot.

This module builds a non-destructive, versioned FEE-KBG projection for the
Cambricon pilot. The R01-R22 master database remains the source of truth. Every
derived entity, event, evolution edge and warning score keeps its provenance,
model version and review state in dedicated SQLite tables before it is
projected into the generic knowledge-graph snapshot tables.
"""

from __future__ import annotations

import hashlib
import json
import math
import re
import sqlite3
import unicodedata
from collections import Counter, defaultdict, deque
from dataclasses import dataclass
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Iterable

from .r01r22_knowledge_graph import (
    DOCUMENT_TITLE_PATTERN,
    GENERIC_LIST_PATTERN,
    JSON_LIKE_TITLE_PATTERN,
    NEGATED_EVENT_PATTERN,
    NON_EVENT_TITLE_PATTERN,
    PLACEHOLDER_EVENT_PATTERN,
    SEARCH_RESULT_TITLE_PATTERN,
    _company_key,
    _event_identity,
    _normalize_event_name,
    ensure_master_graph_schema,
)


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CONFIG_PATH = PROJECT_ROOT / "config" / "fee_kbg_cambricon_pilot_20260826.json"
AGENT_VERSION = "fee-kbg-cambricon-1.3.0"


FEE_SCHEMA = """
CREATE TABLE IF NOT EXISTS fee_kbg_runs (
    run_id TEXT PRIMARY KEY,
    company_id INTEGER NOT NULL,
    stock_code TEXT NOT NULL,
    status TEXT NOT NULL,
    model_version TEXT NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT NOT NULL DEFAULT '',
    entity_count INTEGER NOT NULL DEFAULT 0,
    entity_relationship_count INTEGER NOT NULL DEFAULT 0,
    event_count INTEGER NOT NULL DEFAULT 0,
    event_argument_count INTEGER NOT NULL DEFAULT 0,
    evolution_edge_count INTEGER NOT NULL DEFAULT 0,
    risk_score_count INTEGER NOT NULL DEFAULT 0,
    validation_issue_count INTEGER NOT NULL DEFAULT 0,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS fee_entities (
    run_id TEXT NOT NULL,
    entity_key TEXT NOT NULL,
    company_id INTEGER NOT NULL,
    entity_type TEXT NOT NULL,
    canonical_name TEXT NOT NULL,
    attributes_json TEXT NOT NULL DEFAULT '{}',
    confidence REAL NOT NULL,
    needs_review INTEGER NOT NULL DEFAULT 0,
    review_reason TEXT NOT NULL DEFAULT '',
    source_ref TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (run_id, entity_key),
    FOREIGN KEY (run_id) REFERENCES fee_kbg_runs(run_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_fee_entities_company_type
    ON fee_entities(run_id, company_id, entity_type);
CREATE TABLE IF NOT EXISTS fee_entity_relationships (
    run_id TEXT NOT NULL,
    relationship_key TEXT NOT NULL,
    company_id INTEGER NOT NULL,
    subject_key TEXT NOT NULL,
    relation_type TEXT NOT NULL,
    object_key TEXT NOT NULL,
    relation_layer TEXT NOT NULL,
    attributes_json TEXT NOT NULL DEFAULT '{}',
    confidence REAL NOT NULL,
    needs_review INTEGER NOT NULL DEFAULT 0,
    review_reason TEXT NOT NULL DEFAULT '',
    source_ref TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (run_id, relationship_key),
    FOREIGN KEY (run_id) REFERENCES fee_kbg_runs(run_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_fee_relationships_layer
    ON fee_entity_relationships(run_id, relation_layer);
CREATE TABLE IF NOT EXISTS fee_event_instances (
    run_id TEXT NOT NULL,
    event_key TEXT NOT NULL,
    company_id INTEGER NOT NULL,
    stable_event_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    event_topic TEXT NOT NULL,
    event_date TEXT NOT NULL,
    title TEXT NOT NULL,
    risk_polarity REAL NOT NULL,
    risk_direction TEXT NOT NULL,
    source_url TEXT NOT NULL DEFAULT '',
    source_name TEXT NOT NULL DEFAULT '',
    evidence_json TEXT NOT NULL DEFAULT '{}',
    attributes_json TEXT NOT NULL DEFAULT '{}',
    confidence REAL NOT NULL,
    needs_review INTEGER NOT NULL DEFAULT 0,
    review_reason TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (run_id, event_key),
    FOREIGN KEY (run_id) REFERENCES fee_kbg_runs(run_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_fee_events_company_date
    ON fee_event_instances(run_id, company_id, event_date);
CREATE TABLE IF NOT EXISTS fee_event_arguments (
    run_id TEXT NOT NULL,
    argument_key TEXT NOT NULL,
    event_key TEXT NOT NULL,
    entity_key TEXT NOT NULL,
    role TEXT NOT NULL,
    attributes_json TEXT NOT NULL DEFAULT '{}',
    confidence REAL NOT NULL,
    needs_review INTEGER NOT NULL DEFAULT 0,
    source_ref TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (run_id, argument_key),
    FOREIGN KEY (run_id) REFERENCES fee_kbg_runs(run_id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS fee_event_topic_mappings (
    run_id TEXT NOT NULL,
    mapping_key TEXT NOT NULL,
    event_key TEXT NOT NULL,
    event_topic TEXT NOT NULL,
    indicator_id TEXT NOT NULL,
    mapping_type TEXT NOT NULL,
    confidence REAL NOT NULL,
    attributes_json TEXT NOT NULL DEFAULT '{}',
    PRIMARY KEY (run_id, mapping_key),
    FOREIGN KEY (run_id) REFERENCES fee_kbg_runs(run_id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS fee_event_evolution_edges (
    run_id TEXT NOT NULL,
    evolution_key TEXT NOT NULL,
    source_event_key TEXT NOT NULL,
    target_event_key TEXT NOT NULL,
    evolution_score REAL NOT NULL,
    time_decay_score REAL NOT NULL,
    topic_score REAL NOT NULL,
    semantic_score REAL NOT NULL,
    subject_score REAL NOT NULL,
    polarity_score REAL NOT NULL,
    model_version TEXT NOT NULL,
    attributes_json TEXT NOT NULL DEFAULT '{}',
    PRIMARY KEY (run_id, evolution_key),
    FOREIGN KEY (run_id) REFERENCES fee_kbg_runs(run_id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS fee_subject_impacts (
    run_id TEXT NOT NULL,
    impact_key TEXT NOT NULL,
    company_id INTEGER NOT NULL,
    subject_key TEXT NOT NULL,
    event_key TEXT NOT NULL,
    company_key TEXT NOT NULL,
    subject_type TEXT NOT NULL,
    influence_weight REAL NOT NULL,
    impact_level TEXT NOT NULL,
    impact_kind TEXT NOT NULL,
    components_json TEXT NOT NULL DEFAULT '{}',
    evidence_json TEXT NOT NULL DEFAULT '{}',
    confidence REAL NOT NULL,
    needs_review INTEGER NOT NULL DEFAULT 0,
    model_version TEXT NOT NULL,
    PRIMARY KEY (run_id, impact_key),
    FOREIGN KEY (run_id) REFERENCES fee_kbg_runs(run_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_fee_subject_impacts_weight
    ON fee_subject_impacts(run_id, influence_weight DESC);
CREATE TABLE IF NOT EXISTS fee_subject_influences (
    run_id TEXT NOT NULL,
    influence_key TEXT NOT NULL,
    company_id INTEGER NOT NULL,
    subject_key TEXT NOT NULL,
    company_key TEXT NOT NULL,
    subject_type TEXT NOT NULL,
    subject_category TEXT NOT NULL,
    influence_weight REAL NOT NULL,
    influence_level TEXT NOT NULL,
    risk_status TEXT NOT NULL,
    components_json TEXT NOT NULL DEFAULT '{}',
    evidence_json TEXT NOT NULL DEFAULT '{}',
    confidence REAL NOT NULL,
    needs_review INTEGER NOT NULL DEFAULT 0,
    model_version TEXT NOT NULL,
    PRIMARY KEY (run_id, influence_key),
    FOREIGN KEY (run_id) REFERENCES fee_kbg_runs(run_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_fee_subject_influences_weight
    ON fee_subject_influences(run_id, influence_weight DESC);
CREATE TABLE IF NOT EXISTS fee_external_subject_events (
    run_id TEXT NOT NULL,
    event_key TEXT NOT NULL,
    company_id INTEGER NOT NULL,
    event_owner_key TEXT NOT NULL,
    via_subject_key TEXT NOT NULL,
    event_type TEXT NOT NULL,
    event_topic TEXT NOT NULL,
    event_date TEXT NOT NULL,
    title TEXT NOT NULL,
    severity REAL NOT NULL,
    event_status TEXT NOT NULL,
    source_url TEXT NOT NULL DEFAULT '',
    source_title TEXT NOT NULL DEFAULT '',
    evidence_json TEXT NOT NULL DEFAULT '{}',
    confidence REAL NOT NULL,
    needs_review INTEGER NOT NULL DEFAULT 0,
    model_version TEXT NOT NULL,
    PRIMARY KEY (run_id, event_key),
    FOREIGN KEY (run_id) REFERENCES fee_kbg_runs(run_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_fee_external_events_subject
    ON fee_external_subject_events(run_id, via_subject_key, event_date);
CREATE TABLE IF NOT EXISTS fee_external_transmission_paths (
    run_id TEXT NOT NULL,
    path_key TEXT NOT NULL,
    company_id INTEGER NOT NULL,
    event_key TEXT NOT NULL,
    event_owner_key TEXT NOT NULL,
    via_subject_key TEXT NOT NULL,
    company_key TEXT NOT NULL,
    channel_key TEXT NOT NULL,
    path_weight REAL NOT NULL,
    impact_level TEXT NOT NULL,
    components_json TEXT NOT NULL DEFAULT '{}',
    indicator_ids_json TEXT NOT NULL DEFAULT '[]',
    mechanism TEXT NOT NULL DEFAULT '',
    confidence REAL NOT NULL,
    needs_review INTEGER NOT NULL DEFAULT 0,
    model_version TEXT NOT NULL,
    PRIMARY KEY (run_id, path_key),
    FOREIGN KEY (run_id) REFERENCES fee_kbg_runs(run_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_fee_external_paths_weight
    ON fee_external_transmission_paths(run_id, path_weight DESC);
CREATE TABLE IF NOT EXISTS fee_risk_scores (
    run_id TEXT NOT NULL,
    company_id INTEGER NOT NULL,
    score_type TEXT NOT NULL,
    score_value REAL NOT NULL,
    coverage_ratio REAL NOT NULL,
    risk_level TEXT NOT NULL,
    model_version TEXT NOT NULL,
    components_json TEXT NOT NULL DEFAULT '{}',
    limitations TEXT NOT NULL DEFAULT '',
    calculated_at TEXT NOT NULL,
    PRIMARY KEY (run_id, company_id, score_type),
    FOREIGN KEY (run_id) REFERENCES fee_kbg_runs(run_id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS fee_validation_issues (
    issue_id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL,
    severity TEXT NOT NULL,
    code TEXT NOT NULL,
    subject_key TEXT NOT NULL DEFAULT '',
    message TEXT NOT NULL,
    payload_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    FOREIGN KEY (run_id) REFERENCES fee_kbg_runs(run_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_fee_validation_run
    ON fee_validation_issues(run_id, severity, code);
"""


@dataclass
class GraphNode:
    key: str
    node_type: str
    name: str
    attributes: dict[str, Any]
    confidence: float
    needs_review: bool = False
    review_reason: str = ""


@dataclass
class GraphEdge:
    key: str
    subject_key: str
    relation_type: str
    object_key: str
    attributes: dict[str, Any]
    confidence: float
    needs_review: bool = False
    review_reason: str = ""
    source_id: int = 0
    source_evidence_id: int = 0


@dataclass
class EntityFact:
    key: str
    entity_type: str
    name: str
    attributes: dict[str, Any]
    confidence: float
    needs_review: bool
    review_reason: str
    source_ref: str


@dataclass
class EntityRelationship:
    key: str
    subject_key: str
    relation_type: str
    object_key: str
    layer: str
    attributes: dict[str, Any]
    confidence: float
    needs_review: bool
    review_reason: str
    source_ref: str


@dataclass
class EventFact:
    key: str
    stable_id: str
    event_type: str
    topic: str
    event_date: str
    title: str
    indicators: list[str]
    risk_categories: list[str]
    polarity: float
    direction: str
    source_url: str
    source_name: str
    evidence: dict[str, Any]
    attributes: dict[str, Any]
    confidence: float
    needs_review: bool = False
    review_reason: str = ""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _json(value: Any) -> str:
    return json.dumps(value if value is not None else {}, ensure_ascii=False, sort_keys=True, default=str)


def _stable_key(prefix: str, *parts: Any) -> str:
    material = "|".join(str(part) for part in parts)
    digest = hashlib.sha256(material.encode("utf-8")).hexdigest()[:24]
    return f"{prefix}:{digest}"


def _edge_key(subject_key: str, relation_type: str, object_key: str) -> str:
    return _stable_key("fee-edge", subject_key, relation_type, object_key)


def _clamp(value: Any, default: float = 0.6) -> float:
    try:
        return max(0.0, min(1.0, float(value)))
    except (TypeError, ValueError):
        return default


def _normalize_name(value: Any) -> str:
    name = unicodedata.normalize("NFKC", str(value or "")).strip()
    name = re.sub(r"(?<=[\u4e00-\u9fff])\s+(?=[\u4e00-\u9fff])", "", name)
    return re.sub(r"\s+", " ", name).strip()


def _parse_json(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    try:
        parsed = json.loads(value or "{}")
        return parsed if isinstance(parsed, dict) else {}
    except (json.JSONDecodeError, TypeError):
        return {}


def _valid_date(value: Any, as_of: date) -> str:
    raw = str(value or "").strip()
    try:
        parsed = date.fromisoformat(raw)
    except ValueError:
        return ""
    if parsed.year < 1990 or parsed > as_of:
        return ""
    return parsed.isoformat()


def ensure_fee_schema(conn: sqlite3.Connection) -> None:
    ensure_master_graph_schema(conn)
    conn.executescript(FEE_SCHEMA)
    conn.commit()


def load_fee_config(path: Path = DEFAULT_CONFIG_PATH) -> dict[str, Any]:
    return json.loads(Path(path).read_text(encoding="utf-8-sig"))


class CambriconFEEKBGBuilder:
    """Build one evidence-grounded company FEE-KBG pilot from a versioned config."""

    def __init__(self, db_path: Path, config_path: Path = DEFAULT_CONFIG_PATH):
        self.db_path = Path(db_path)
        self.config_path = Path(config_path)
        self.config = load_fee_config(self.config_path)
        self.quality = self.config["quality"]
        self.as_of = date.fromisoformat(self.config["pilot_company"]["as_of_date"])
        self.nodes: dict[str, GraphNode] = {}
        self.edges: dict[str, GraphEdge] = {}
        self.entities: dict[str, EntityFact] = {}
        self.entity_relationships: dict[str, EntityRelationship] = {}
        self.events: dict[str, EventFact] = {}
        self.event_arguments: list[dict[str, Any]] = []
        self.topic_mappings: list[dict[str, Any]] = []
        self.evolution_edges: list[dict[str, Any]] = []
        self.subject_impacts: list[dict[str, Any]] = []
        self.subject_influences: list[dict[str, Any]] = []
        self.external_subject_events: list[dict[str, Any]] = []
        self.external_transmission_paths: list[dict[str, Any]] = []
        self.forward_risk_scenarios: list[dict[str, Any]] = []
        self.risk_scores: list[dict[str, Any]] = []
        self.validation_issues: list[dict[str, Any]] = []

    def run(self, run_id: str, stock_code: str = "688256") -> dict[str, Any]:
        expected = str(self.config["pilot_company"]["stock_code"])
        if stock_code != expected:
            raise ValueError(f"当前试点只允许股票代码 {expected}，收到 {stock_code}")
        conn = sqlite3.connect(self.db_path, timeout=120)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute("PRAGMA busy_timeout = 120000")
        ensure_fee_schema(conn)
        company = conn.execute("SELECT * FROM companies WHERE stock_code=?", (stock_code,)).fetchone()
        if not company:
            conn.close()
            raise ValueError(f"主库中未找到股票代码：{stock_code}")
        if company["full_name"] != self.config["pilot_company"]["name"]:
            conn.close()
            raise ValueError("试点企业身份与配置不一致")
        started_at = _now()
        try:
            self._start_run(conn, run_id, company, started_at)
            company_key = self._build_entity_layer(conn, company)
            indicator_catalog = self._indicator_catalog(conn)
            self._build_event_and_risk_layers(conn, company, company_key, indicator_catalog)
            self._build_event_evolution()
            self._build_forward_risk_evolution(company_key, indicator_catalog)
            self._build_subject_impacts(company_key, indicator_catalog)
            self._build_subject_influences(company_key)
            self._build_external_subject_transmissions(company_key, indicator_catalog)
            self._calculate_risk_indexes(conn, company, company_key, indicator_catalog)
            self._add_warning_node(company_key)
            self._validate(company_key)
            self._persist(conn, run_id, company)
            conn.commit()
            return {
                "run_id": run_id,
                "agent_version": AGENT_VERSION,
                "company": company["full_name"],
                "stock_code": company["stock_code"],
                "node_count": len(self.nodes),
                "edge_count": len(self.edges),
                "entity_count": len(self.entities),
                "entity_relationship_count": len(self.entity_relationships),
                "event_count": len(self.events),
                "event_argument_count": len(self.event_arguments),
                "evolution_edge_count": len(self.evolution_edges),
                "subject_impact_count": len(self.subject_impacts),
                "subject_influence_count": len(self.subject_influences),
                "external_subject_event_count": len(self.external_subject_events),
                "external_transmission_path_count": len(self.external_transmission_paths),
                "forward_risk_scenario_count": len(self.forward_risk_scenarios),
                "risk_scores": {row["score_type"]: row["score_value"] for row in self.risk_scores},
                "validation_issue_count": len(self.validation_issues),
                "validation_issues": self.validation_issues,
            }
        except Exception as exc:
            now = _now()
            conn.execute(
                """UPDATE fee_kbg_runs SET status='failed', finished_at=?,
                   metadata_json=?, updated_at=? WHERE run_id=?""",
                (now, _json({"error": str(exc), "agent_version": AGENT_VERSION}), now, run_id),
            )
            conn.commit()
            raise
        finally:
            conn.close()

    def _start_run(self, conn: sqlite3.Connection, run_id: str, company: sqlite3.Row, started_at: str) -> None:
        for table in (
            "fee_validation_issues", "fee_risk_scores", "fee_external_transmission_paths",
            "fee_external_subject_events", "fee_subject_influences", "fee_subject_impacts", "fee_event_evolution_edges",
            "fee_event_topic_mappings", "fee_event_arguments", "fee_event_instances",
            "fee_entity_relationships", "fee_entities",
        ):
            conn.execute(f"DELETE FROM {table} WHERE run_id=?", (run_id,))
        conn.execute("DELETE FROM knowledge_graph_snapshot_edges WHERE run_id=?", (run_id,))
        conn.execute("DELETE FROM knowledge_graph_snapshot_nodes WHERE run_id=?", (run_id,))
        conn.execute("DELETE FROM knowledge_graph_validation_issues WHERE run_id=?", (run_id,))
        now = _now()
        metadata = {
            "agent_version": AGENT_VERSION,
            "config_version": self.config["version"],
            "company": company["full_name"],
            "stock_code": company["stock_code"],
            "data_contract": "R01-R22 + FEE-KBG",
            "scope": self.config.get("scope", "company-fee-kbg-pilot"),
            "as_of_date": self.as_of.isoformat(),
        }
        conn.execute(
            """INSERT INTO fee_kbg_runs(
                   run_id,company_id,stock_code,status,model_version,started_at,
                   metadata_json,created_at,updated_at
               ) VALUES (?,?,?,'running',?,?,?,?,?)
               ON CONFLICT(run_id) DO UPDATE SET
                   company_id=excluded.company_id,stock_code=excluded.stock_code,
                   status='running',model_version=excluded.model_version,
                   started_at=excluded.started_at,finished_at='',entity_count=0,
                   entity_relationship_count=0,event_count=0,event_argument_count=0,
                   evolution_edge_count=0,risk_score_count=0,validation_issue_count=0,
                   metadata_json=excluded.metadata_json,updated_at=excluded.updated_at""",
            (
                run_id, company["company_id"], company["stock_code"], AGENT_VERSION,
                started_at, _json(metadata), now, now,
            ),
        )
        conn.execute(
            """INSERT INTO knowledge_graph_runs(
                   run_id,company_id,status,started_at,metadata_json,created_at,updated_at
               ) VALUES (?,?,'running',?,?,?,?)
               ON CONFLICT(run_id) DO UPDATE SET
                   company_id=excluded.company_id,status='running',started_at=excluded.started_at,
                   finished_at='',node_count=0,edge_count=0,validation_issue_count=0,
                   review_count=0,metadata_json=excluded.metadata_json,updated_at=excluded.updated_at""",
            (run_id, company["company_id"], started_at, _json(metadata), now, now),
        )

    def _add_node(self, node: GraphNode) -> None:
        node.attributes.setdefault("fee_kbg", True)
        self.nodes[node.key] = node

    def _add_edge(self, edge: GraphEdge) -> None:
        edge.attributes.setdefault("fee_kbg", True)
        self.edges[edge.key] = edge

    def _add_entity(self, fact: EntityFact) -> None:
        existing = self.entities.get(fact.key)
        if existing and existing.confidence > fact.confidence:
            return
        fact.attributes.setdefault("fee_layer", "entity")
        fact.attributes.setdefault("chain_role", "entity")
        self.entities[fact.key] = fact
        self._add_node(GraphNode(
            fact.key, fact.entity_type, fact.name, dict(fact.attributes), fact.confidence,
            fact.needs_review, fact.review_reason,
        ))

    def _add_entity_relationship(self, relation: EntityRelationship) -> None:
        self.entity_relationships[relation.key] = relation
        attrs = dict(relation.attributes)
        attrs.update({"fee_layer": "entity", "relation_layer": relation.layer})
        self._add_edge(GraphEdge(
            relation.key, relation.subject_key, relation.relation_type, relation.object_key,
            attrs, relation.confidence, relation.needs_review, relation.review_reason,
        ))

    def _build_entity_layer(self, conn: sqlite3.Connection, company: sqlite3.Row) -> str:
        company_key = _company_key(company)
        company_attrs = {
            "fee_layer": "entity", "chain_role": "focal_company", "company_id": company["company_id"],
            "stock_code": company["stock_code"], "short_name": company["short_name"],
            "aliases": company["aliases"], "chain_segment": company["chain_segment"],
            "sse_industry": company["sse_industry"], "exchange": company["exchange"],
            "as_of_date": self.as_of.isoformat(), "schema_source": "FEE-KBG entity layer",
        }
        self._add_entity(EntityFact(
            company_key, "company", company["full_name"], company_attrs,
            _clamp(company["confidence_score"], 0.98), False, "", "companies",
        ))

        for industry_kind, value in (("产业链环节", company["chain_segment"]), ("交易所行业", company["sse_industry"])):
            name = _normalize_name(value)
            if not name:
                continue
            key = _stable_key("fee-entity", "industry", name)
            self._add_entity(EntityFact(
                key, "industry", name, {"industry_kind": industry_kind}, 0.98, False, "", "companies",
            ))
            rel_key = _edge_key(company_key, "belongs_to_industry", key)
            self._add_entity_relationship(EntityRelationship(
                rel_key, company_key, "belongs_to_industry", key, "industry",
                {"industry_kind": industry_kind}, 0.98, False, "", "companies",
            ))

        supplier_rows = conn.execute(
            "SELECT * FROM tyc_supplier_profiles WHERE company_id=? ORDER BY profile_id",
            (company["company_id"],),
        ).fetchall()
        for row in supplier_rows:
            name = _normalize_name(row["supplier_name"])
            if not name:
                continue
            key = _stable_key("fee-entity", "supplier", name)
            attrs = {
                "purchase_ratio": row["purchase_ratio"], "purchase_amount": row["purchase_amount"],
                "relationship": row["relationship"], "domestic_flag": row["domestic_flag"],
                "publish_date": row["announcement_date"],
                "registered_location": row["profile_reg_location"], "city": row["profile_city"],
                "source_table": "tyc_supplier_profiles",
            }
            confidence = 0.92 if not row["profile_error_code"] else 0.7
            review = bool(row["profile_error_code"])
            self._add_entity(EntityFact(
                key, "supplier", name, attrs, confidence, review,
                "供应商画像接口返回异常" if review else "", f"tyc_supplier_profiles:{row['profile_id']}",
            ))
            rel_key = _edge_key(company_key, "procures_from", key)
            self._add_entity_relationship(EntityRelationship(
                rel_key, company_key, "procures_from", key, "supply_chain", attrs,
                confidence, review, "供应商关系待复核" if review else "",
                f"tyc_supplier_profiles:{row['profile_id']}",
            ))

        concept_counter: Counter[str] = Counter()
        for row in conn.execute(
            """SELECT concept_keywords FROM narrative_news_evidence
               WHERE company_id=? AND concept_flag=1 AND COALESCE(concept_keywords,'')<>''""",
            (company["company_id"],),
        ):
            for value in re.split(r"[;,；、]", str(row["concept_keywords"] or "")):
                concept = _normalize_name(value)
                if len(concept) >= 2:
                    concept_counter[concept] += 1
        for concept, count in concept_counter.most_common(int(self.quality["maximum_concepts"])):
            key = _stable_key("fee-entity", "concept", concept)
            attrs = {"evidence_count": count, "source_table": "narrative_news_evidence"}
            confidence = min(0.95, 0.72 + math.log1p(count) / 20)
            self._add_entity(EntityFact(key, "concept_tag", concept, attrs, confidence, False, "", "narrative_news_evidence"))
            rel_key = _edge_key(company_key, "associated_with_concept", key)
            self._add_entity_relationship(EntityRelationship(
                rel_key, company_key, "associated_with_concept", key, "concept", attrs,
                confidence, False, "", "narrative_news_evidence",
            ))

        self._load_approved_legacy_counterparties(conn, company, company_key)
        self._load_repaired_legacy_people_and_shareholders(conn, company, company_key)
        self._load_external_entities(conn, company)
        return company_key

    def _load_approved_legacy_counterparties(
        self, conn: sqlite3.Connection, company: sqlite3.Row, company_key: str,
    ) -> None:
        grouped: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
        rows = conn.execute(
            "SELECT source_row_key,row_json FROM source_auxiliary_rows WHERE table_name='entity_relations'"
        ).fetchall()
        for row in rows:
            item = _parse_json(row["row_json"])
            if item.get("subject_name") != company["full_name"] or item.get("needs_review"):
                continue
            relation_type = str(item.get("relation_type") or "")
            if relation_type not in {"has_supplier", "has_customer"}:
                continue
            attrs = _parse_json(item.get("attributes_json"))
            role = "supplier" if relation_type == "has_supplier" else "customer"
            name = _normalize_name(attrs.get("counterparty_name") or item.get("object_name"))
            if not name or name == "--" or len(name) > 80 or re.search(r"公告$|报告$|采购$", name):
                continue
            grouped[(role, name)].append({
                "item": item, "attrs": attrs,
                "source_ref": f"legacy-entity-relation:{item.get('id', row['source_row_key'])}",
            })
        for (role, name), items in grouped.items():
            def numeric(item: dict[str, Any], *fields: str) -> float:
                for field in fields:
                    try:
                        value = item["attrs"].get(field)
                        if value not in (None, ""):
                            return float(value)
                    except (TypeError, ValueError):
                        continue
                return 0.0
            best = max(items, key=lambda item: (
                numeric(item, "amount", "purchase_amount"),
                str(item["attrs"].get("publish_date") or ""),
            ))
            attrs = {
                "role": role,
                "amount": numeric(best, "amount", "purchase_amount"),
                "purchase_ratio": best["attrs"].get("purchase_ratio"),
                "revenue_ratio": best["attrs"].get("revenue_ratio"),
                "publish_date": best["attrs"].get("publish_date"),
                "history_count": len(items),
                "source_table": "source_auxiliary_rows/entity_relations",
                "source_name": best["item"].get("source_name"),
            }
            entity_type = role
            key = _stable_key("fee-entity", entity_type, name)
            self._add_entity(EntityFact(
                key, entity_type, name, attrs, 0.82, False, "", best["source_ref"],
            ))
            relation_type = "procures_from" if role == "supplier" else "sells_to"
            relation_key = _edge_key(company_key, relation_type, key)
            if relation_key in self.entity_relationships:
                existing = self.entity_relationships[relation_key]
                existing.attributes.setdefault("historical_records", len(items))
                existing.attributes.setdefault("legacy_amount", attrs["amount"])
                continue
            self._add_entity_relationship(EntityRelationship(
                relation_key, company_key, relation_type, key,
                "supply_chain" if role == "supplier" else "customer",
                attrs, 0.82, False, "", best["source_ref"],
            ))

    def _load_repaired_legacy_people_and_shareholders(
        self, conn: sqlite3.Connection, company: sqlite3.Row, company_key: str,
    ) -> None:
        rows = conn.execute(
            "SELECT source_row_key,row_json FROM source_auxiliary_rows WHERE table_name='entity_relations'"
        ).fetchall()
        for row in rows:
            item = _parse_json(row["row_json"])
            if item.get("subject_name") != company["full_name"]:
                continue
            attrs = _parse_json(item.get("attributes_json"))
            source_ref = f"legacy-entity-relation:{item.get('id', row['source_row_key'])}"
            review = bool(item.get("needs_review", True))
            confidence = _clamp(item.get("confidence"), 0.82)
            if attrs.get("股东名称"):
                name = _normalize_name(attrs.get("股东名称"))
                if not name or name in {"股东名称", company["full_name"]}:
                    continue
                key = _stable_key("fee-entity", "shareholder", name)
                entity_type = "person" if attrs.get("股东性质") == "境内自然人" else "shareholder"
                repaired = {
                    "holding_shares": attrs.get("持股数额"), "holding_ratio_pct": attrs.get("持股比例(%)"),
                    "shareholder_nature": attrs.get("股东性质"), "capital_nature": attrs.get("股本性质"),
                    "source_table": "source_auxiliary_rows/entity_relations", "repaired_from": "has_person",
                }
                self._add_entity(EntityFact(
                    key, entity_type, name, repaired, confidence, review,
                    "股权关系待人工确认" if review else "", source_ref,
                ))
                rel_key = _edge_key(company_key, "held_by", key)
                self._add_entity_relationship(EntityRelationship(
                    rel_key, company_key, "held_by", key, "equity", repaired, confidence, review,
                    "股权关系待人工确认" if review else "", source_ref,
                ))
                continue
            person_name = attrs.get("姓名") or attrs.get("受益所有人名称")
            has_person_fact = attrs.get("人物介绍") or attrs.get("任职类型") or attrs.get("职务")
            if not person_name or not has_person_fact:
                continue
            name = _normalize_name(person_name)
            if not name or len(name) > 12 or re.search(r"地址|期限|范围|序号", name):
                continue
            key = _stable_key("fee-entity", "person", name)
            repaired = {
                "positions": attrs.get("人物标签") or attrs.get("任职类型") or attrs.get("职务"),
                "profile": attrs.get("人物介绍") or attrs.get("个人介绍"),
                "source_table": "source_auxiliary_rows/entity_relations", "repaired_from": "has_person",
            }
            self._add_entity(EntityFact(
                key, "person", name, repaired, confidence, review,
                "人员任职关系待人工确认" if review else "", source_ref,
            ))
            rel_key = _edge_key(company_key, "employs", key)
            self._add_entity_relationship(EntityRelationship(
                rel_key, company_key, "employs", key, "personnel", repaired, confidence, review,
                "人员任职关系待人工确认" if review else "", source_ref,
            ))

    def _load_external_entities(self, conn: sqlite3.Connection, company: sqlite3.Row) -> None:
        type_map = {
            "监管机构": "regulator", "法院": "court", "仲裁机构": "court",
            "人员": "person", "人员群体": "person_group", "企业": "associated_company",
            "内部因素": "internal_factor",
        }
        rows = conn.execute(
            "SELECT * FROM external_subject_evidence WHERE company_id=? ORDER BY evidence_id",
            (company["company_id"],),
        ).fetchall()
        for row in rows:
            name = _normalize_name(row["subject_name"])
            entity_type = type_map.get(str(row["subject_type"]), "external_subject")
            key = _stable_key("fee-entity", entity_type, name)
            review = str(row["review_status"] or "") not in {"已确认", "approved", "通过"}
            attrs = {
                "subject_type": row["subject_type"], "source_title": row["source_title"],
                "source_url": row["source_url"], "source_institution": row["source_institution"],
                "evidence_quote": row["evidence_quote"], "event_date": row["event_date"],
                "external_subject_evidence_ids": [row["evidence_id"]],
            }
            self._add_entity(EntityFact(
                key, entity_type, name, attrs, _clamp(row["confidence_score"]), review,
                "外部主体证据待人工复核" if review else "", f"external_subject_evidence:{row['evidence_id']}",
            ))

    @staticmethod
    def _indicator_catalog(conn: sqlite3.Connection) -> dict[str, dict[str, Any]]:
        return {str(row["indicator_id"]): dict(row) for row in conn.execute("SELECT * FROM indicator_catalog")}

    def _classify_event(self, row: sqlite3.Row) -> tuple[dict[str, Any] | None, str]:
        text = f"{row['title'] or ''} {row['notes'] or ''}"
        for rule in self.config["title_rules"]:
            if re.search(rule["pattern"], text, re.IGNORECASE):
                return dict(rule), "title_rule"
        fallback = self.config["event_type_topics"].get(str(row["event_type"] or ""))
        return (dict(fallback), "event_type") if fallback else (None, "")

    def _event_is_usable(self, row: sqlite3.Row, normalized_title: str, classification: dict[str, Any] | None) -> bool:
        if not classification or _clamp(row["confidence_score"], 0) < float(self.quality["minimum_event_confidence"]):
            return False
        if not normalized_title or PLACEHOLDER_EVENT_PATTERN.match(normalized_title):
            return False
        if SEARCH_RESULT_TITLE_PATTERN.search(normalized_title) or JSON_LIKE_TITLE_PATTERN.match(normalized_title):
            return False
        if DOCUMENT_TITLE_PATTERN.search(normalized_title) or NON_EVENT_TITLE_PATTERN.search(normalized_title):
            return False
        if NEGATED_EVENT_PATTERN.search(normalized_title) or "公告标题关键词" in normalized_title:
            return False
        url = str(row["url"] or "").lower()
        if "ecfr.gov/current" in url or "consolidated.csv" in url:
            return False
        official_entity_list = (
            str(row["related_indicator_id"] or "") == "R19"
            and "federalregister.gov" in url
            and bool(re.search(r"Additions and Revisions.*Entity List", normalized_title, re.IGNORECASE))
        )
        if GENERIC_LIST_PATTERN.search(normalized_title) and not official_entity_list:
            return False
        if str(row["related_indicator_id"] or "") == "R21" and not re.search(
            r"风险|处罚|失信|限高|诉讼|立案|调查|破产|整改", normalized_title
        ):
            return False
        return True

    def _build_event_and_risk_layers(
        self,
        conn: sqlite3.Connection,
        company: sqlite3.Row,
        company_key: str,
        catalog: dict[str, dict[str, Any]],
    ) -> None:
        grouped: dict[str, list[tuple[sqlite3.Row, dict[str, Any], str, str]]] = defaultdict(list)
        invalid_dates = 0
        rows = conn.execute(
            "SELECT * FROM deep_search_events WHERE company_id=? ORDER BY event_date,event_id",
            (company["company_id"],),
        ).fetchall()
        for row in rows:
            event_date = _valid_date(row["event_date"], self.as_of)
            if not event_date:
                if row["event_date"]:
                    invalid_dates += 1
                continue
            classification, mapping_type = self._classify_event(row)
            normalized_title = _normalize_event_name(row["title"])
            if not self._event_is_usable(row, normalized_title, classification):
                continue
            if str(row["related_indicator_id"] or "") == "R11":
                identity = _event_identity(row, normalized_title)
            else:
                identity = "|".join((
                    str(row["url"] or "").strip(), classification["topic"], normalized_title, event_date,
                ))
            grouped[identity].append((row, classification, mapping_type, normalized_title))
        if invalid_dates:
            self.validation_issues.append({
                "severity": "warning", "code": "invalid_source_event_date", "subject_key": "",
                "message": f"{invalid_dates} 条源事件日期非法，已隔离且未入图", "payload": {"count": invalid_dates},
            })

        indicator_names = {indicator_id: item["secondary_indicator"] for indicator_id, item in catalog.items()}
        category_by_indicator = {indicator_id: item["primary_category"] for indicator_id, item in catalog.items()}
        raw_event_to_key: dict[int, str] = {}
        topic_indicator_pairs: set[tuple[str, str]] = set()
        category_nodes: set[str] = set()

        for identity, candidates in grouped.items():
            exemplar, primary_classification, mapping_type, normalized_title = max(
                candidates, key=lambda item: _clamp(item[0]["confidence_score"], 0)
            )
            event_ids = sorted({int(item[0]["event_id"]) for item in candidates})
            original_indicators = {
                str(item[0]["related_indicator_id"] or "")
                for item in candidates
                if str(item[0]["related_indicator_id"] or "") in catalog
            }
            indicators: set[str] = set(primary_classification["indicators"])
            for row, classification, _kind, _title in candidates:
                indicators.update(classification["indicators"])
                original = str(row["related_indicator_id"] or "")
                if original in catalog:
                    indicators.add(original)
            indicators = {indicator_id for indicator_id in indicators if indicator_id in catalog}
            risk_categories = sorted({category_by_indicator[indicator_id] for indicator_id in indicators})
            event_date = min(str(item[0]["event_date"]) for item in candidates)
            source_urls = list(dict.fromkeys(str(item[0]["url"] or "") for item in candidates if item[0]["url"]))
            source_names = list(dict.fromkeys(str(item[0]["source_channel"] or "") for item in candidates if item[0]["source_channel"]))
            raw_titles = list(dict.fromkeys(str(item[0]["title"] or "") for item in candidates))
            notes = list(dict.fromkeys(str(item[0]["notes"] or "") for item in candidates if item[0]["notes"]))
            stable_id = _stable_key("fee-event-id", identity)
            event_key = _stable_key("fee-event", stable_id)
            confidence = max(_clamp(item[0]["confidence_score"], 0) for item in candidates)
            event = EventFact(
                event_key, stable_id, str(exemplar["event_type"]), primary_classification["topic"],
                event_date, normalized_title, sorted(indicators), risk_categories,
                _clamp(primary_classification["risk_polarity"]), primary_classification["direction"],
                source_urls[0] if source_urls else "", source_names[0] if source_names else "",
                {"event_ids": event_ids, "raw_titles": raw_titles, "source_urls": source_urls, "notes": notes},
                {
                    "fee_layer": "event", "chain_role": "risk_event", "event_ids": event_ids,
                    "event_date": event_date, "event_type": exemplar["event_type"],
                    "event_topic": primary_classification["topic"], "indicator_ids": sorted(indicators),
                    "original_indicator_ids": sorted(original_indicators),
                    "inferred_indicator_ids": sorted(indicators - original_indicators),
                    "indicators": [indicator_names[item] for item in sorted(indicators)],
                    "risk_categories": risk_categories, "risk_polarity": primary_classification["risk_polarity"],
                    "risk_direction": primary_classification["direction"], "mapping_type": mapping_type,
                    "evidence_titles": raw_titles, "evidence_urls": source_urls,
                    "source_names": source_names, "source_database": "R01-R22/deep_search_events",
                },
                confidence,
            )
            self.events[event_key] = event
            self._add_node(GraphNode(event_key, "risk_event", event.title, dict(event.attributes), confidence))
            for event_id in event_ids:
                raw_event_to_key[event_id] = event_key

            participant_key = _edge_key(company_key, "participates_in", event_key)
            participant_attrs = {"fee_layer": "event", "role": "affected_entity", "event_date": event_date}
            self._add_edge(GraphEdge(participant_key, company_key, "participates_in", event_key, participant_attrs, confidence))
            self.event_arguments.append({
                "argument_key": _stable_key("fee-arg", event_key, company_key, "affected_entity"),
                "event_key": event_key, "entity_key": company_key, "role": "affected_entity",
                "attributes": participant_attrs, "confidence": confidence, "needs_review": False,
                "source_ref": "deep_search_events",
            })

            topic_key = _stable_key("fee-topic", event.topic)
            self._add_node(GraphNode(
                topic_key, "event_topic", event.topic,
                {"fee_layer": "risk", "chain_role": "event_topic", "topic": event.topic},
                confidence,
            ))
            topic_edge_key = _edge_key(event_key, "instance_of_topic", topic_key)
            self._add_edge(GraphEdge(
                topic_edge_key, event_key, "instance_of_topic", topic_key,
                {"fee_layer": "risk", "mapping_type": mapping_type}, confidence,
            ))

            for indicator_id in sorted(indicators):
                indicator = catalog[indicator_id]
                indicator_key = _stable_key("fee-indicator", company["company_id"], indicator_id)
                self._add_node(GraphNode(
                    indicator_key, "risk_indicator", indicator["secondary_indicator"],
                    {
                        "fee_layer": "risk", "chain_role": "secondary_indicator",
                        "schema_indicator": indicator["secondary_indicator"], "indicator_id": indicator_id,
                        "primary_category": indicator["primary_category"], "definition": indicator["definition"],
                        "calculation_rule": indicator["calculation_rule"],
                    },
                    confidence,
                ))
                if (event.topic, indicator_id) not in topic_indicator_pairs:
                    mapping_key = _edge_key(topic_key, "maps_to_indicator", indicator_key)
                    self._add_edge(GraphEdge(
                        mapping_key, topic_key, "maps_to_indicator", indicator_key,
                        {"fee_layer": "risk", "indicator_id": indicator_id, "mapping_type": mapping_type},
                        confidence,
                    ))
                    topic_indicator_pairs.add((event.topic, indicator_id))
                self.topic_mappings.append({
                    "mapping_key": _stable_key("fee-map", event_key, event.topic, indicator_id),
                    "event_key": event_key, "event_topic": event.topic, "indicator_id": indicator_id,
                    "mapping_type": "source_indicator" if indicator_id in original_indicators else mapping_type,
                    "confidence": confidence,
                    "attributes": {"event_ids": event_ids, "indicator_name": indicator["secondary_indicator"]},
                })
                category = indicator["primary_category"]
                category_key = _stable_key("fee-risk-category", category)
                if category not in category_nodes:
                    self._add_node(GraphNode(
                        category_key, "risk_category", category,
                        {"fee_layer": "risk", "chain_role": "risk_category"}, 1.0,
                    ))
                    category_nodes.add(category)
                category_edge_key = _edge_key(indicator_key, "belongs_to_risk_category", category_key)
                self._add_edge(GraphEdge(
                    category_edge_key, indicator_key, "belongs_to_risk_category", category_key,
                    {"fee_layer": "risk", "indicator_id": indicator_id}, 1.0,
                ))

            source_items = list(zip(raw_titles, source_urls or [""] * len(raw_titles)))
            if not source_items:
                source_items = [(event.source_name or "结构化事件来源", "")]
            for index, (source_title, source_url) in enumerate(source_items[:3]):
                source_key = _stable_key("fee-source", source_url or event.source_name, source_title)
                self._add_node(GraphNode(
                    source_key, "evidence_source", source_title,
                    {
                        "fee_layer": "evidence", "chain_role": "evidence_source", "source_url": source_url,
                        "source_name": event.source_name, "source_for": event.title, "event_date": event.event_date,
                    },
                    confidence,
                ))
                support_key = _edge_key(source_key, "supports_event", event_key)
                self._add_edge(GraphEdge(
                    support_key, source_key, "supports_event", event_key,
                    {"fee_layer": "evidence", "source_url": source_url, "source_order": index}, confidence,
                ))

        external_rows = conn.execute(
            "SELECT * FROM external_subject_evidence WHERE company_id=? ORDER BY evidence_id",
            (company["company_id"],),
        ).fetchall()
        external_type_map = {
            "监管机构": "regulator", "法院": "court", "仲裁机构": "court",
            "人员": "person", "人员群体": "person_group", "企业": "associated_company",
            "内部因素": "internal_factor",
        }
        role_map = {"监管": "regulator", "问询": "inquirer", "处罚": "regulator", "裁判": "adjudicator", "涉及": "participant", "列入实体清单": "listing_authority"}
        relation_map = {"regulator": "regulates_event", "inquirer": "inquires_event", "adjudicator": "adjudicates_event", "participant": "involved_in_event", "listing_authority": "lists_entity_in_event"}
        for row in external_rows:
            event_key = raw_event_to_key.get(int(row["event_id"] or 0))
            if not event_key:
                continue
            name = _normalize_name(row["subject_name"])
            entity_type = external_type_map.get(str(row["subject_type"]), "external_subject")
            entity_key = _stable_key("fee-entity", entity_type, name)
            role = role_map.get(str(row["relation_type"]), "participant")
            review = str(row["review_status"] or "") not in {"已确认", "approved", "通过"}
            confidence = _clamp(row["confidence_score"])
            attrs = {
                "fee_layer": "event", "role": role, "evidence_quote": row["evidence_quote"],
                "source_url": row["source_url"], "external_subject_evidence_id": row["evidence_id"],
            }
            argument_key = _stable_key("fee-arg", event_key, entity_key, role)
            self.event_arguments.append({
                "argument_key": argument_key, "event_key": event_key, "entity_key": entity_key, "role": role,
                "attributes": attrs, "confidence": confidence, "needs_review": review,
                "source_ref": f"external_subject_evidence:{row['evidence_id']}",
            })
            relation_type = relation_map[role]
            graph_edge_key = _edge_key(entity_key, relation_type, event_key)
            self._add_edge(GraphEdge(
                graph_edge_key, entity_key, relation_type, event_key, attrs, confidence, review,
                "外部主体事件论元待复核" if review else "", 0, int(row["evidence_id"]),
            ))

    def _impact_level(self, weight: float) -> str:
        levels = self.config["risk_transmission"]["impact_levels"]
        if weight >= float(levels["high"]):
            return "高"
        if weight >= float(levels["medium"]):
            return "中"
        return "低"

    def _register_subject_impact(
        self,
        *,
        company_key: str,
        subject_key: str,
        event_key: str,
        subject_type: str,
        weight: float,
        impact_kind: str,
        components: dict[str, Any],
        evidence: dict[str, Any],
        confidence: float,
        needs_review: bool = False,
    ) -> None:
        model_version = self.config["risk_transmission"]["model_version"]
        weight = round(_clamp(weight, 0.0), 6)
        impact_key = _stable_key("fee-impact", subject_key, event_key, model_version)
        item = {
            "impact_key": impact_key, "subject_key": subject_key, "event_key": event_key,
            "company_key": company_key, "subject_type": subject_type,
            "influence_weight": weight, "impact_level": self._impact_level(weight),
            "impact_kind": impact_kind, "components": components, "evidence": evidence,
            "confidence": confidence, "needs_review": needs_review, "model_version": model_version,
        }
        self.subject_impacts.append(item)
        attributes = {
            "fee_layer": "transmission", "chain_role": "risk_source_impact",
            "influence_weight": weight, "impact_level": item["impact_level"],
            "impact_kind": impact_kind, "weight_components": components,
            "weight_basis": evidence.get("weight_basis", ""),
            "evidence": evidence, "model_version": model_version,
            "causal_claim": False,
        }
        self._add_edge(GraphEdge(
            impact_key, subject_key, "subject_impacts_event", event_key, attributes,
            confidence, needs_review, "影响权重包含暴露度推演" if impact_kind == "exposure_projection" else "",
        ))
        subject = self.nodes.get(subject_key)
        if subject:
            subject.attributes["transmission_weight"] = max(
                float(subject.attributes.get("transmission_weight") or 0), weight
            )
            subject.attributes["impact_level"] = self._impact_level(subject.attributes["transmission_weight"])

    @staticmethod
    def _percentage(value: Any) -> float | None:
        match = re.search(r"-?\d+(?:\.\d+)?", str(value or ""))
        return float(match.group()) if match else None

    def _build_subject_impacts(
        self, company_key: str, catalog: dict[str, dict[str, Any]],
    ) -> None:
        """Materialize weighted risk-source -> event -> enterprise paths.

        Direct event arguments are factual relationships. Supplier paths are
        explicitly marked as exposure projections: the supplier relationship
        and the company's supply-chain risk disclosure are both evidenced,
        but this does not assert that the supplier itself suffered an incident.
        """
        config = self.config["risk_transmission"]
        weights = config["weights"]
        directness = config["role_directness"]

        for argument in self.event_arguments:
            role = str(argument["role"])
            if role == "affected_entity" or argument["event_key"] not in self.events:
                continue
            subject = self.entities.get(argument["entity_key"])
            event = self.events[argument["event_key"]]
            if not subject:
                continue
            relation_score = float(directness.get(role, 0.6))
            confidence = min(subject.confidence, event.confidence, float(argument["confidence"]))
            weight = (
                float(weights["event_severity"]) * event.polarity
                + float(weights["evidence_confidence"]) * confidence
                + float(weights["relation_directness"]) * relation_score
            )
            self._register_subject_impact(
                company_key=company_key, subject_key=subject.key, event_key=event.key,
                subject_type=subject.entity_type, weight=weight, impact_kind="direct_evidence",
                components={
                    "event_severity": event.polarity, "evidence_confidence": confidence,
                    "relation_directness": relation_score, "formula_weights": weights,
                },
                evidence={
                    "weight_basis": f"{subject.name}以{role}角色直接关联该事件",
                    "source_ref": argument["source_ref"],
                    "source_url": argument["attributes"].get("source_url", ""),
                    "evidence_quote": argument["attributes"].get("evidence_quote", ""),
                },
                confidence=confidence, needs_review=bool(argument["needs_review"]),
            )

        supply_events = sorted(
            (
                event for event in self.events.values()
                if re.search(r"供应|原材料", event.title)
                and event.direction != "mitigating"
            ),
            key=lambda event: (event.event_date, event.key),
        )
        supplier_relations = [
            relation for relation in self.entity_relationships.values()
            if relation.layer == "supply_chain" and relation.object_key in self.entities
            and str(relation.attributes.get("purchase_ratio") or "").strip()
        ]
        purchase_shares = {
            relation.object_key: self._percentage(relation.attributes.get("purchase_ratio"))
            for relation in supplier_relations
        }
        max_share = max((value for value in purchase_shares.values() if value is not None), default=0.0)
        if supply_events:
            first_supply_event = supply_events[0]
            supplier_weights = config["supplier_weights"]
            for relation in supplier_relations:
                subject = self.entities[relation.object_key]
                share = purchase_shares.get(subject.key)
                normalized_share = share / max_share if share is not None and max_share else 0.0
                confidence = min(subject.confidence, first_supply_event.confidence, relation.confidence)
                weight = (
                    float(supplier_weights["purchase_share"]) * normalized_share
                    + float(supplier_weights["event_severity"]) * first_supply_event.polarity
                    + float(supplier_weights["evidence_confidence"]) * confidence
                )
                self._register_subject_impact(
                    company_key=company_key, subject_key=subject.key, event_key=first_supply_event.key,
                    subject_type=subject.entity_type, weight=weight,
                    impact_kind="exposure_projection",
                    components={
                        "purchase_share_pct": share, "purchase_share_normalized": normalized_share,
                        "event_severity": first_supply_event.polarity,
                        "evidence_confidence": confidence, "formula_weights": supplier_weights,
                    },
                    evidence={
                        "weight_basis": "供应商采购依赖与企业已披露的供应链稳定风险联合测度",
                        "supplier_source": relation.source_ref,
                        "event_source_url": first_supply_event.source_url,
                        "disclaimer": "不表示该供应商已经发生风险事件",
                    },
                    confidence=confidence, needs_review=relation.needs_review,
                )

        key_person_events = sorted(
            (event for event in self.events.values() if event.topic == "关键人员变动"),
            key=lambda event: (event.event_date, event.key),
        )
        if key_person_events:
            event = key_person_events[0]
            group_key = _stable_key("fee-entity", "person_group", "核心技术人员群体")
            group = EntityFact(
                group_key, "person_group", "核心技术人员群体",
                {
                    "entity_scope": "由核心技术人员离职/调整事件识别的群体主体",
                    "source_event": event.title, "source_url": event.source_url,
                },
                event.confidence, False, "", "deep_search_events/core_personnel",
            )
            self._add_entity(group)
            role_score = float(directness["key_person_group"])
            confidence = event.confidence
            weight = (
                float(weights["event_severity"]) * event.polarity
                + float(weights["evidence_confidence"]) * confidence
                + float(weights["relation_directness"]) * role_score
            )
            self._register_subject_impact(
                company_key=company_key, subject_key=group.key, event_key=event.key,
                subject_type=group.entity_type, weight=weight, impact_kind="direct_evidence",
                components={
                    "event_severity": event.polarity, "evidence_confidence": confidence,
                    "relation_directness": role_score, "formula_weights": weights,
                },
                evidence={
                    "weight_basis": "核心技术人员离职/调整事件直接影响企业技术与治理稳定性",
                    "source_url": event.source_url,
                },
                confidence=confidence,
            )

        existing_argument_events = {
            argument["event_key"] for argument in self.event_arguments
            if argument["role"] != "affected_entity"
        }
        for event in sorted(self.events.values(), key=lambda item: (item.event_date, item.key)):
            if event.key in existing_argument_events or event.topic != "诉讼与仲裁":
                continue
            raw = " ".join(event.evidence.get("raw_titles") or [event.title])
            match = re.search(r"([\u4e00-\u9fff]{2,4})与中科寒武纪", raw)
            if not match:
                continue
            name = match.group(1)
            person_key = _stable_key("fee-entity", "person", name)
            person = EntityFact(
                person_key, "person", name,
                {"extracted_from_event_title": raw, "source_url": event.source_url},
                min(0.9, event.confidence), False, "", "deep_search_events/litigation-title",
            )
            self._add_entity(person)
            relation_score = float(directness["participant"])
            confidence = min(person.confidence, event.confidence)
            weight = (
                float(weights["event_severity"]) * event.polarity
                + float(weights["evidence_confidence"]) * confidence
                + float(weights["relation_directness"]) * relation_score
            )
            self._register_subject_impact(
                company_key=company_key, subject_key=person.key, event_key=event.key,
                subject_type=person.entity_type, weight=weight, impact_kind="direct_evidence",
                components={
                    "event_severity": event.polarity, "evidence_confidence": confidence,
                    "relation_directness": relation_score, "formula_weights": weights,
                },
                evidence={"weight_basis": "诉讼文书标题明确记载的案件当事人", "raw_title": raw},
                confidence=confidence,
            )

        impairment_events = [event for event in self.events.values() if event.topic == "资产负面与减值"]
        for event in impairment_events:
            factor_key = _stable_key("fee-entity", "internal_factor", "存货与战略备货")
            factor = EntityFact(
                factor_key, "internal_factor", "存货与战略备货",
                {"source_event": event.title, "source_url": event.source_url},
                event.confidence, False, "", "deep_search_events/asset-impairment",
            )
            self._add_entity(factor)
            relation_score = float(directness["internal_factor"])
            confidence = event.confidence
            weight = (
                float(weights["event_severity"]) * event.polarity
                + float(weights["evidence_confidence"]) * confidence
                + float(weights["relation_directness"]) * relation_score
            )
            self._register_subject_impact(
                company_key=company_key, subject_key=factor.key, event_key=event.key,
                subject_type=factor.entity_type, weight=weight, impact_kind="internal_evidence",
                components={
                    "event_severity": event.polarity, "evidence_confidence": confidence,
                    "relation_directness": relation_score, "formula_weights": weights,
                },
                evidence={"weight_basis": "资产减值公告明确披露战略备货和存货跌价损失", "source_url": event.source_url},
                confidence=confidence,
            )

        event_weights: dict[str, float] = defaultdict(float)
        event_sources: dict[str, list[str]] = defaultdict(list)
        for impact in self.subject_impacts:
            event_weights[impact["event_key"]] = max(event_weights[impact["event_key"]], impact["influence_weight"])
            event_sources[impact["event_key"]].append(impact["subject_key"])
        propagated_from: dict[str, dict[str, Any]] = {}
        for evolution in sorted(
            self.evolution_edges,
            key=lambda item: (self.events[item["target_event_key"]].event_date, -item["evolution_score"]),
        ):
            source_weight = event_weights.get(evolution["source_event_key"], 0.0)
            propagated = source_weight * float(evolution["evolution_score"]) * 0.9
            if propagated > event_weights.get(evolution["target_event_key"], 0.0):
                event_weights[evolution["target_event_key"]] = propagated
                propagated_from[evolution["target_event_key"]] = {
                    "source_event_key": evolution["source_event_key"],
                    "evolution_score": evolution["evolution_score"],
                    "upstream_weight": source_weight,
                }

        company_id = int(self.entities[company_key].attributes["company_id"])
        for event_key, weight in sorted(event_weights.items(), key=lambda item: -item[1]):
            event = self.events[event_key]
            event.attributes["impact_weight"] = round(weight, 6)
            event.attributes["impact_level"] = self._impact_level(weight)
            event.attributes["transmission_subject_count"] = len(set(event_sources.get(event_key, [])))
            if event_key in propagated_from:
                event.attributes["propagated_from"] = propagated_from[event_key]
            impact_edge_key = _edge_key(event_key, "event_impacts_company", company_key)
            self._add_edge(GraphEdge(
                impact_edge_key, event_key, "event_impacts_company", company_key,
                {
                    "fee_layer": "transmission", "chain_role": "event_company_impact",
                    "impact_weight": round(weight, 6), "impact_level": self._impact_level(weight),
                    "subject_count": len(set(event_sources.get(event_key, []))),
                    "propagated_from": propagated_from.get(event_key),
                    "causal_claim": False,
                },
                min(event.confidence, max(weight, 0.35)),
            ))
            original_indicators = event.attributes.get("original_indicator_ids") or []
            for indicator_id in original_indicators:
                if indicator_id not in catalog:
                    continue
                indicator_key = _stable_key("fee-indicator", company_id, indicator_id)
                if indicator_key not in self.nodes:
                    continue
                risk_edge_key = _edge_key(event_key, "event_transmits_risk", indicator_key)
                self._add_edge(GraphEdge(
                    risk_edge_key, event_key, "event_transmits_risk", indicator_key,
                    {
                        "fee_layer": "transmission", "chain_role": "event_risk_result",
                        "impact_weight": round(weight, 6), "indicator_id": indicator_id,
                        "mapping_type": "source_indicator",
                    },
                    event.confidence,
                ))

    def _build_subject_influences(self, company_key: str) -> None:
        """Build the external-subject panorama independently of risk events."""
        config = self.config["subject_panorama"]
        model_version = config["model_version"]

        relevant_relations = [
            relation for relation in self.entity_relationships.values()
            if relation.subject_key == company_key
            and relation.layer in {"supply_chain", "customer", "equity", "personnel"}
            and relation.object_key in self.entities
        ]
        max_ratio: dict[str, float] = defaultdict(float)
        max_amount: dict[str, float] = defaultdict(float)
        for relation in relevant_relations:
            ratio = self._percentage(
                relation.attributes.get("purchase_ratio")
                or relation.attributes.get("revenue_ratio")
                or relation.attributes.get("holding_ratio_pct")
            ) or 0.0
            try:
                amount = float(
                    relation.attributes.get("purchase_amount")
                    or relation.attributes.get("amount")
                    or relation.attributes.get("legacy_amount")
                    or 0
                )
            except (TypeError, ValueError):
                amount = 0.0
            max_ratio[relation.layer] = max(max_ratio[relation.layer], ratio)
            max_amount[relation.layer] = max(max_amount[relation.layer], amount)

        def recency(value: Any) -> float:
            match = re.search(r"(20\d{2})", str(value or ""))
            if not match:
                return 0.45
            age = max(0, self.as_of.year - int(match.group(1)))
            return math.exp(-age / 5)

        def role_criticality(value: Any) -> tuple[float, float]:
            role = str(value or "")
            if re.search(r"董事长|总经理|首席执行官|实际控制人", role):
                score = 1.0
            elif re.search(r"副总经理|财务负责人|董事会秘书|首席运营官|核心技术", role):
                score = 0.85
            elif re.search(r"董事|监事", role):
                score = 0.68
            elif re.search(r"独立董事", role):
                score = 0.42
            else:
                score = 0.5
            technical = 1.0 if re.search(r"核心技术|研发|技术", role) else 0.0
            return score, technical

        candidates: dict[str, dict[str, Any]] = {}
        for relation in relevant_relations:
            subject = self.entities[relation.object_key]
            confidence = min(subject.confidence, relation.confidence)
            if relation.layer in {"supply_chain", "customer"}:
                weights = config["counterparty_weights"]
                ratio = self._percentage(
                    relation.attributes.get("purchase_ratio") or relation.attributes.get("revenue_ratio")
                ) or 0.0
                try:
                    amount = float(
                        relation.attributes.get("purchase_amount")
                        or relation.attributes.get("amount")
                        or relation.attributes.get("legacy_amount")
                        or 0
                    )
                except (TypeError, ValueError):
                    amount = 0.0
                scale = ratio / max_ratio[relation.layer] if ratio and max_ratio[relation.layer] else (
                    amount / max_amount[relation.layer] if amount and max_amount[relation.layer] else 0.15
                )
                overrides = {
                    _normalize_name(name): value
                    for name, value in (config.get("counterparty_overrides") or {}).items()
                }
                override = overrides.get(_normalize_name(subject.name))
                scale_basis = "披露比例或金额归一化"
                if override is not None:
                    scale = _clamp(override, scale)
                    scale_basis = "配置化关键依赖分级；不代表采购占比"
                recency_score = recency(relation.attributes.get("publish_date"))
                influence = (
                    float(weights["relationship_scale"]) * scale
                    + float(weights["recency"]) * recency_score
                    + float(weights["evidence_confidence"]) * confidence
                )
                category = "供应商" if relation.layer == "supply_chain" else "客户"
                components = {
                    "relationship_scale": scale, "purchase_or_revenue_ratio": ratio,
                    "amount": amount, "recency": recency_score,
                    "relationship_scale_basis": scale_basis,
                    "evidence_confidence": confidence, "formula_weights": weights,
                }
            elif relation.layer == "equity":
                weights = config["equity_weights"]
                ratio = self._percentage(relation.attributes.get("holding_ratio_pct")) or 0.0
                ratio_score = ratio / max_ratio["equity"] if ratio and max_ratio["equity"] else 0.15
                directness = 0.9
                influence = (
                    float(weights["holding_ratio"]) * ratio_score
                    + float(weights["relationship_directness"]) * directness
                    + float(weights["evidence_confidence"]) * confidence
                )
                category = "股东"
                components = {
                    "holding_ratio_pct": ratio, "holding_ratio_normalized": ratio_score,
                    "relationship_directness": directness,
                    "evidence_confidence": confidence, "formula_weights": weights,
                }
            else:
                weights = config["personnel_weights"]
                role = relation.attributes.get("positions")
                role_score, technical_score = role_criticality(role)
                influence = (
                    float(weights["role_criticality"]) * role_score
                    + float(weights["technical_criticality"]) * technical_score
                    + float(weights["evidence_confidence"]) * confidence
                )
                category = "高管/核心人员"
                components = {
                    "position": role, "role_criticality": role_score,
                    "technical_criticality": technical_score,
                    "evidence_confidence": confidence, "formula_weights": weights,
                }
            item = {
                "subject_key": subject.key, "subject_type": subject.entity_type,
                "subject_category": category, "influence_weight": _clamp(influence),
                "components": components,
                "evidence": {"source_ref": relation.source_ref, "relationship_type": relation.relation_type},
                "confidence": confidence, "needs_review": subject.needs_review or relation.needs_review,
            }
            existing = candidates.get(subject.key)
            if not existing or item["influence_weight"] > existing["influence_weight"]:
                candidates[subject.key] = item

        company_id = int(self.entities[company_key].attributes["company_id"])
        for subject_key, item in sorted(candidates.items(), key=lambda pair: -pair[1]["influence_weight"]):
            subject = self.entities[subject_key]
            # Risk status is deliberately neutral here.  It is promoted only by
            # _build_external_subject_transmissions when an event belonging to
            # this external subject (or its associated entity) is verified.
            risk_status = "no_verified_external_risk_event"
            influence = round(float(item["influence_weight"]), 6)
            influence_key = _stable_key("fee-subject-influence", subject_key, company_key, model_version)
            record = {
                "influence_key": influence_key, "subject_key": subject_key,
                "company_key": company_key, "subject_type": item["subject_type"],
                "subject_category": item["subject_category"], "influence_weight": influence,
                "influence_level": self._impact_level(influence), "risk_status": risk_status,
                "components": item["components"], "evidence": item["evidence"],
                "confidence": item["confidence"], "needs_review": item["needs_review"],
                "model_version": model_version,
            }
            self.subject_influences.append(record)
            subject.attributes.update({
                "panorama_weight": influence, "panorama_level": record["influence_level"],
                "subject_category": record["subject_category"], "risk_status": risk_status,
                "panorama_components": item["components"],
            })
            self._add_edge(GraphEdge(
                influence_key, subject_key, "subject_influences_company", company_key,
                {
                    "fee_layer": "subject_panorama", "chain_role": "subject_influence",
                    "influence_weight": influence, "influence_level": record["influence_level"],
                    "subject_category": record["subject_category"], "risk_status": risk_status,
                    "weight_components": item["components"], "evidence": item["evidence"],
                    "model_version": model_version,
                },
                item["confidence"], item["needs_review"],
                "主体关系待浏览器可见表格复核" if item["needs_review"] else "",
            ))

    def _build_external_subject_transmissions(
        self, company_key: str, catalog: dict[str, dict[str, Any]],
    ) -> None:
        """Build verified external-event -> subject -> enterprise risk paths.

        This layer is intentionally separate from ``self.events``.  Those are
        the target company's own events and belong only to the enterprise-event graph.
        An external panorama path is admitted only when the configured evidence
        names an external event owner and an already-important related subject.
        """
        config = self.config.get("external_subject_transmission") or {}
        model_version = str(config.get("model_version") or "fee-external-transmission-1.0.0")
        formula_weights = config.get("weights") or {
            "subject_importance": 0.45, "event_severity": 0.35, "evidence_confidence": 0.2,
        }
        path_specs = config.get("paths") or []
        if not path_specs:
            return

        influence_by_subject = {item["subject_key"]: item for item in self.subject_influences}
        entity_by_name = {_normalize_name(item.name): item for item in self.entities.values()}
        company_id = int(self.entities[company_key].attributes["company_id"])
        event_key_by_id: dict[str, str] = {}
        pending_evolution: list[tuple[str, str]] = []

        for spec in path_specs:
            path_id = str(spec.get("path_id") or "").strip()
            via_name = _normalize_name((spec.get("via_subject") or {}).get("name"))
            via_subject = entity_by_name.get(via_name)
            influence = influence_by_subject.get(via_subject.key) if via_subject else None
            if not path_id or not via_subject or not influence:
                self.validation_issues.append({
                    "severity": "warning", "code": "external_path_subject_missing",
                    "subject_key": via_name or path_id,
                    "message": "外部风险路径未找到已纳入全景的重要主体",
                    "payload": {"path_id": path_id, "via_subject": via_name},
                })
                continue

            owner_spec = spec.get("event_owner") or {}
            owner_name = _normalize_name(owner_spec.get("name"))
            owner = entity_by_name.get(owner_name)
            if not owner:
                owner_type = str(owner_spec.get("entity_type") or "associated_company")
                owner_key = _stable_key("fee-entity", owner_type, owner_name)
                owner = EntityFact(
                    owner_key, owner_type, owner_name,
                    {
                        "fee_layer": "external_entity", "chain_role": "external_event_owner",
                        "association_to_subject": owner_spec.get("association_to_subject", ""),
                        "association_source_url": owner_spec.get("association_source_url", ""),
                    },
                    _clamp(owner_spec.get("confidence"), 0.9),
                    bool(owner_spec.get("needs_review", False)),
                    str(owner_spec.get("review_reason") or ""),
                    str(owner_spec.get("source_ref") or "external_subject_transmission_config"),
                )
                self._add_entity(owner)
                entity_by_name[owner_name] = owner
            elif owner.key == company_key:
                self.validation_issues.append({
                    "severity": "error", "code": "external_event_owned_by_target",
                    "subject_key": path_id, "message": "外部主体图禁止使用目标企业自身事件",
                    "payload": {"event_owner": owner_name},
                })
                continue

            if spec.get("via_subject_verified"):
                via_subject.needs_review = False
                via_subject.review_reason = ""
                graph_subject = self.nodes.get(via_subject.key)
                if graph_subject:
                    graph_subject.needs_review = False
                    graph_subject.review_reason = ""
                influence["needs_review"] = False
                influence_edge = self.edges.get(influence["influence_key"])
                if influence_edge:
                    influence_edge.needs_review = False
                    influence_edge.review_reason = ""

            event_spec = spec.get("external_event") or {}
            event_date = _valid_date(event_spec.get("event_date"), self.as_of)
            if not event_date:
                self.validation_issues.append({
                    "severity": "warning", "code": "invalid_external_event_date",
                    "subject_key": path_id, "message": "外部主体事件日期无效，已隔离",
                    "payload": {"event_date": event_spec.get("event_date")},
                })
                continue
            title = _normalize_name(event_spec.get("title"))
            event_key = _stable_key("fee-external-event", owner.key, event_date, title)
            severity = _clamp(event_spec.get("severity"), 0.7)
            evidence_confidence = min(
                _clamp(event_spec.get("confidence"), 0.9), owner.confidence,
                float(influence["confidence"]),
            )
            needs_review = bool(spec.get("needs_review", False) or owner.needs_review)
            path_key = _stable_key("fee-external-path", path_id, company_key, model_version)
            source_url = str(event_spec.get("source_url") or "")
            source_title = str(event_spec.get("source_title") or "")
            event_attributes = {
                "fee_layer": "external_event", "chain_role": "external_risk_event",
                "external_event_id": path_id, "event_owner_key": owner.key,
                "event_owner_name": owner.name, "via_subject_key": via_subject.key,
                "via_subject_name": via_subject.name, "event_date": event_date,
                "event_type": event_spec.get("event_type", "external_risk_event"),
                "event_topic": event_spec.get("topic", "外部主体风险事件"),
                "severity": severity, "event_status": event_spec.get("status", "active"),
                "source_url": source_url, "source_title": source_title,
                "evidence_quote": event_spec.get("evidence_quote", ""),
                "external_path_key": path_key, "target_company_event": False,
            }
            self._add_node(GraphNode(
                event_key, "external_risk_event", title, event_attributes,
                evidence_confidence, needs_review,
                "外部事件证据待复核" if needs_review else "",
            ))
            event_record = {
                "event_key": event_key, "event_owner_key": owner.key,
                "via_subject_key": via_subject.key,
                "event_type": event_attributes["event_type"],
                "event_topic": event_attributes["event_topic"], "event_date": event_date,
                "title": title, "severity": severity,
                "event_status": event_attributes["event_status"],
                "source_url": source_url, "source_title": source_title,
                "evidence": {
                    "evidence_quote": event_spec.get("evidence_quote", ""),
                    "source_institution": event_spec.get("source_institution", ""),
                    "browser_verified": bool(event_spec.get("browser_verified", False)),
                },
                "confidence": evidence_confidence, "needs_review": needs_review,
                "model_version": model_version,
            }
            self.external_subject_events.append(event_record)
            event_key_by_id[path_id] = event_key
            if spec.get("evolves_from_event_id"):
                pending_evolution.append((str(spec["evolves_from_event_id"]), path_id))

            common = {
                "fee_layer": "external_transmission", "external_path_key": path_key,
                "path_id": path_id, "via_subject_key": via_subject.key,
                "via_subject_name": via_subject.name, "event_owner_key": owner.key,
                "event_owner_name": owner.name, "model_version": model_version,
            }
            self._add_edge(GraphEdge(
                _stable_key("fee-ext-edge", path_key, "owner-event"),
                owner.key, "has_external_risk_event", event_key,
                {**common, "chain_role": "external_event_origin"},
                evidence_confidence, needs_review,
            ))

            source_key = _stable_key("fee-external-source", source_url or source_title, path_id)
            self._add_node(GraphNode(
                source_key, "external_evidence_source", source_title or "外部事件公开来源",
                {
                    "fee_layer": "external_evidence", "chain_role": "external_evidence_source",
                    "source_url": source_url, "source_institution": event_spec.get("source_institution", ""),
                    "source_for": title, "external_path_key": path_key,
                },
                evidence_confidence, needs_review,
            ))
            self._add_edge(GraphEdge(
                _stable_key("fee-ext-edge", path_key, "source-event"),
                source_key, "supports_external_event", event_key,
                {**common, "chain_role": "external_event_evidence", "source_url": source_url},
                evidence_confidence, needs_review,
            ))

            channel_source_key = event_key
            if owner.key != via_subject.key:
                self._add_edge(GraphEdge(
                    _stable_key("fee-ext-edge", path_key, "subject-associated-entity"),
                    via_subject.key, "serves_at_external_entity", owner.key,
                    {
                        **common, "fee_layer": "external_entity_relation",
                        "chain_role": "structural_association",
                        "association_type": owner_spec.get("association_to_subject", "关联任职"),
                        "association_source_url": owner_spec.get("association_source_url", ""),
                    },
                    evidence_confidence, needs_review,
                ))
                self._add_edge(GraphEdge(
                    _stable_key("fee-ext-edge", path_key, "event-via-subject"),
                    event_key, "external_event_impacts_subject", via_subject.key,
                    {
                        **common, "chain_role": "associated_entity_to_subject",
                        "association_type": owner_spec.get("association_to_subject", "关联任职"),
                        "association_source_url": owner_spec.get("association_source_url", ""),
                    },
                    evidence_confidence, needs_review,
                ))
                channel_source_key = via_subject.key

            channel_name = _normalize_name(spec.get("transmission_channel") or "外部主体风险暴露")
            channel_key = _stable_key("fee-external-channel", path_key, channel_name)
            self._add_node(GraphNode(
                channel_key, "risk_transmission_channel", channel_name,
                {
                    "fee_layer": "external_transmission", "chain_role": "transmission_channel",
                    "external_path_key": path_key, "via_subject_key": via_subject.key,
                    "mechanism": spec.get("mechanism", ""),
                },
                evidence_confidence, needs_review,
            ))
            self._add_edge(GraphEdge(
                _stable_key("fee-ext-edge", path_key, "activate-channel"),
                channel_source_key, "activates_transmission_channel", channel_key,
                {**common, "chain_role": "external_event_mechanism"},
                evidence_confidence, needs_review,
            ))

            attenuation = _clamp(spec.get("path_attenuation"), 0.88)
            components = {
                "subject_importance": float(influence["influence_weight"]),
                "event_severity": severity, "evidence_confidence": evidence_confidence,
                "path_attenuation": attenuation, "formula_weights": formula_weights,
            }
            raw_weight = (
                float(formula_weights["subject_importance"]) * components["subject_importance"]
                + float(formula_weights["event_severity"]) * severity
                + float(formula_weights["evidence_confidence"]) * evidence_confidence
            )
            path_weight = round(_clamp(raw_weight * attenuation), 6)
            path_attributes = {
                **common, "chain_role": "external_risk_to_target_company",
                "path_weight": path_weight, "impact_level": self._impact_level(path_weight),
                "weight_components": components, "mechanism": spec.get("mechanism", ""),
                "causal_claim": False,
                "disclaimer": "表示证据支持的风险暴露传导路径，不表示已证实直接因果关系",
            }
            self._add_edge(GraphEdge(
                _stable_key("fee-ext-edge", path_key, "channel-company"),
                channel_key, "external_risk_transmits_to_company", company_key,
                path_attributes, evidence_confidence, needs_review,
            ))

            indicator_ids = [str(value) for value in spec.get("indicator_ids") or [] if str(value) in catalog]
            for indicator_id in indicator_ids:
                indicator = catalog[indicator_id]
                indicator_key = _stable_key("fee-indicator", company_id, indicator_id)
                if indicator_key not in self.nodes:
                    self._add_node(GraphNode(
                        indicator_key, "risk_indicator", indicator["secondary_indicator"],
                        {
                            "fee_layer": "risk", "chain_role": "secondary_indicator",
                            "schema_indicator": indicator["secondary_indicator"], "indicator_id": indicator_id,
                            "primary_category": indicator["primary_category"],
                            "definition": indicator["definition"],
                            "calculation_rule": indicator["calculation_rule"],
                        },
                        evidence_confidence,
                    ))
                self._add_edge(GraphEdge(
                    _stable_key("fee-ext-edge", path_key, "company-indicator", indicator_id),
                    company_key, "external_risk_maps_to_indicator", indicator_key,
                    {
                        **common, "chain_role": "external_risk_result", "path_weight": path_weight,
                        "indicator_id": indicator_id, "mechanism": spec.get("mechanism", ""),
                    },
                    evidence_confidence, needs_review,
                ))
                category = indicator["primary_category"]
                category_key = _stable_key("fee-risk-category", category)
                if category_key not in self.nodes:
                    self._add_node(GraphNode(
                        category_key, "risk_category", category,
                        {"fee_layer": "risk", "chain_role": "risk_category"}, 1.0,
                    ))
                category_edge_key = _edge_key(indicator_key, "belongs_to_risk_category", category_key)
                if category_edge_key not in self.edges:
                    self._add_edge(GraphEdge(
                        category_edge_key, indicator_key, "belongs_to_risk_category", category_key,
                        {"fee_layer": "risk", "indicator_id": indicator_id}, 1.0,
                    ))

            path_record = {
                "path_key": path_key, "event_key": event_key, "event_owner_key": owner.key,
                "via_subject_key": via_subject.key, "company_key": company_key,
                "channel_key": channel_key, "path_weight": path_weight,
                "impact_level": self._impact_level(path_weight), "components": components,
                "indicator_ids": indicator_ids, "mechanism": spec.get("mechanism", ""),
                "confidence": evidence_confidence, "needs_review": needs_review,
                "model_version": model_version,
            }
            self.external_transmission_paths.append(path_record)
            if not needs_review:
                influence["risk_status"] = "verified_external_risk_event"
                influence.setdefault("evidence", {}).setdefault("external_path_keys", []).append(path_key)
                via_subject.attributes["risk_status"] = "verified_external_risk_event"
                via_subject.attributes.setdefault("external_path_keys", []).append(path_key)
                graph_subject = self.nodes.get(via_subject.key)
                if graph_subject:
                    graph_subject.attributes["risk_status"] = "verified_external_risk_event"
                    graph_subject.attributes.setdefault("external_path_keys", []).append(path_key)
                influence_edge = self.edges.get(influence["influence_key"])
                if influence_edge:
                    influence_edge.attributes["risk_status"] = "verified_external_risk_event"
                    influence_edge.attributes.setdefault("external_path_keys", []).append(path_key)

        for source_id, target_id in pending_evolution:
            source_key = event_key_by_id.get(source_id)
            target_key = event_key_by_id.get(target_id)
            if not source_key or not target_key:
                continue
            target_path = next(
                (item for item in self.external_transmission_paths if item["event_key"] == target_key), None
            )
            self._add_edge(GraphEdge(
                _stable_key("fee-ext-evolution", source_key, target_key),
                source_key, "external_event_evolves_to", target_key,
                {
                    "fee_layer": "external_transmission", "chain_role": "external_event_evolution",
                    "external_path_key": target_path["path_key"] if target_path else "",
                    "model_version": model_version,
                },
                min(self.nodes[source_key].confidence, self.nodes[target_key].confidence),
            ))

    def _event_argument_sets(self) -> dict[str, set[str]]:
        result: dict[str, set[str]] = defaultdict(set)
        for argument in self.event_arguments:
            if argument["role"] != "affected_entity":
                result[argument["event_key"]].add(argument["entity_key"])
        return result

    @staticmethod
    def _fallback_text_similarity(texts: list[str]) -> list[list[float]]:
        grams: list[Counter[str]] = []
        for text in texts:
            normalized = re.sub(r"\s+", "", text.lower())
            grams.append(Counter(normalized[index:index + 2] for index in range(max(0, len(normalized) - 1))))
        matrix = [[0.0 for _ in texts] for _ in texts]
        for i, left in enumerate(grams):
            for j, right in enumerate(grams):
                if i == j:
                    matrix[i][j] = 1.0
                    continue
                dot = sum(value * right.get(key, 0) for key, value in left.items())
                norm = math.sqrt(sum(value * value for value in left.values()) * sum(value * value for value in right.values()))
                matrix[i][j] = dot / norm if norm else 0.0
        return matrix

    def _semantic_similarity(self, events: list[EventFact]) -> list[list[float]]:
        texts = [" ".join((event.title, event.topic, " ".join(event.indicators))) for event in events]
        try:
            from sklearn.feature_extraction.text import TfidfVectorizer
            from sklearn.metrics.pairwise import cosine_similarity

            vectors = TfidfVectorizer(analyzer="char", ngram_range=(2, 4), min_df=1).fit_transform(texts)
            return cosine_similarity(vectors).tolist()
        except (ImportError, ValueError):
            return self._fallback_text_similarity(texts)

    def _build_event_evolution(self) -> None:
        events = sorted(self.events.values(), key=lambda event: (event.event_date, event.key))
        if len(events) < 2:
            return
        similarities = self._semantic_similarity(events)
        args = self._event_argument_sets()
        config = self.config["event_evolution"]
        weights = config["weights"]
        max_gap = int(self.quality["maximum_evolution_gap_days"])
        decay_days = float(config["time_decay_days"])
        threshold = float(config["threshold"])
        top_k = int(config["top_k_forward"])
        outgoing: dict[str, list[dict[str, Any]]] = defaultdict(list)

        for source_index, source in enumerate(events):
            source_date = date.fromisoformat(source.event_date)
            for target_index in range(source_index + 1, len(events)):
                target = events[target_index]
                gap = (date.fromisoformat(target.event_date) - source_date).days
                if gap <= 0 or gap > max_gap:
                    continue
                source_original = set(source.attributes.get("original_indicator_ids") or source.indicators)
                target_original = set(target.attributes.get("original_indicator_ids") or target.indicators)
                shared_indicators = source_original & target_original
                union_indicators = source_original | target_original
                indicator_jaccard = len(shared_indicators) / len(union_indicators) if union_indicators else 0.0
                shared_categories = set(source.risk_categories) & set(target.risk_categories)
                topic_score = max(
                    1.0 if source.topic == target.topic else 0.0,
                    indicator_jaccard,
                    0.35 if shared_categories else 0.0,
                )
                semantic_score = float(similarities[source_index][target_index])
                if source.topic != target.topic and not shared_indicators and semantic_score < 0.2:
                    continue
                shared_arguments = args.get(source.key, set()) & args.get(target.key, set())
                subject_score = 1.0 if shared_arguments else 0.6
                time_decay = math.exp(-gap / decay_days)
                polarity_score = 1.0 - abs(source.polarity - target.polarity)
                score = (
                    weights["time_decay"] * time_decay
                    + weights["topic"] * topic_score
                    + weights["semantic"] * semantic_score
                    + weights["subject"] * subject_score
                    + weights["polarity"] * polarity_score
                )
                if score < threshold:
                    continue
                outgoing[source.key].append({
                    "source_event_key": source.key, "target_event_key": target.key,
                    "evolution_score": score, "time_decay_score": time_decay,
                    "topic_score": topic_score, "semantic_score": semantic_score,
                    "subject_score": subject_score, "polarity_score": polarity_score,
                    "gap_days": gap, "shared_indicators": sorted(shared_indicators),
                    "shared_categories": sorted(shared_categories),
                })

        for candidates in outgoing.values():
            for item in sorted(candidates, key=lambda value: (-value["evolution_score"], value["gap_days"]))[:top_k]:
                item["evolution_key"] = _stable_key(
                    "fee-evolution", item["source_event_key"], item["target_event_key"], config["model_version"]
                )
                self.evolution_edges.append(item)
                attrs = {
                    "fee_layer": "event", "historical_association": True, "causal_claim": False,
                    "evolution_score": round(item["evolution_score"], 6), "gap_days": item["gap_days"],
                    "shared_indicators": item["shared_indicators"], "shared_categories": item["shared_categories"],
                    "model_version": config["model_version"],
                    "score_components": {
                        "time_decay": item["time_decay_score"], "topic": item["topic_score"],
                        "semantic": item["semantic_score"], "subject": item["subject_score"],
                        "polarity": item["polarity_score"],
                    },
                }
                self._add_edge(GraphEdge(
                    item["evolution_key"], item["source_event_key"], "evolves_to",
                    item["target_event_key"], attrs, item["evolution_score"],
                ))

    def _build_forward_risk_evolution(
        self, company_key: str, catalog: dict[str, dict[str, Any]],
    ) -> None:
        """Materialize conditional, severity-increasing future risk scenarios.

        Unlike ``evolves_to`` (a historical association between two occurred
        events), ``may_evolve_to`` always starts from an occurred adverse event
        and ends at a predictive scenario.  Every edge records conditions,
        probability, time horizon and an explicit severity increase.
        """
        config = self.config.get("forward_risk_evolution") or {}
        rules = config.get("rules") or []
        if not rules:
            return
        model_version = str(config.get("model_version") or "conditional-risk-evolution-1.0.0")
        max_rules = max(1, int(config.get("max_rules_per_event") or 1))
        company_id = int(self.entities[company_key].attributes["company_id"])
        scenario_records: dict[str, dict[str, Any]] = {}

        for event in sorted(self.events.values(), key=lambda item: (item.event_date, item.key)):
            if event.direction == "mitigating":
                continue
            text = " ".join((event.title, event.topic, event.event_type))
            matched = 0
            for rule in rules:
                if not re.search(str(rule.get("event_pattern") or r"$^"), text, flags=re.I):
                    continue
                previous_key = event.key
                previous_severity = float(event.polarity)
                for index, step in enumerate(rule.get("steps") or []):
                    scenario_id = str(step.get("scenario_id") or "").strip()
                    label = _normalize_name(step.get("label"))
                    severity = _clamp(step.get("severity"), min(0.99, previous_severity + 0.08))
                    if not scenario_id or not label or severity <= previous_severity:
                        self.validation_issues.append({
                            "severity": "warning", "code": "non_escalating_future_scenario",
                            "subject_key": scenario_id or event.key,
                            "message": "条件演化场景严重度未高于前序事件，已隔离",
                            "payload": {
                                "source_severity": previous_severity,
                                "target_severity": severity,
                                "rule_id": rule.get("rule_id"),
                            },
                        })
                        break
                    scenario_key = _stable_key("fee-future-risk-scenario", scenario_id)
                    probability = round(_clamp(step.get("probability"), 0.5), 6)
                    attributes = {
                        "fee_layer": "event", "chain_role": "future_evolution",
                        "predictive": True, "scenario_id": scenario_id,
                        "severity": severity, "probability": probability,
                        "horizon": step.get("horizon", ""),
                        "conditions": step.get("conditions", ""),
                        "indicator_ids": step.get("indicator_ids") or [],
                        "model_version": model_version,
                        "causal_claim": False,
                        "disclaimer": "条件化风险推演，不表示该事件已经发生",
                    }
                    if scenario_key not in self.nodes:
                        self._add_node(GraphNode(
                            scenario_key, "future_risk_scenario", label,
                            attributes, probability,
                        ))
                        record = {
                            "scenario_key": scenario_key, "scenario_id": scenario_id,
                            "label": label, "severity": severity,
                            "probability": probability, "horizon": step.get("horizon", ""),
                            "conditions": step.get("conditions", ""),
                            "indicator_ids": list(step.get("indicator_ids") or []),
                            "based_on_event_keys": [], "model_version": model_version,
                        }
                        scenario_records[scenario_key] = record
                        self.forward_risk_scenarios.append(record)
                    record = scenario_records.get(scenario_key)
                    if record is not None and event.key not in record["based_on_event_keys"]:
                        record["based_on_event_keys"].append(event.key)
                        self.nodes[scenario_key].attributes["based_on_event_keys"] = list(record["based_on_event_keys"])

                    edge_key = _stable_key(
                        "fee-forward-evolution", previous_key, scenario_key,
                        rule.get("rule_id"), model_version,
                    )
                    self._add_edge(GraphEdge(
                        edge_key, previous_key, "may_evolve_to", scenario_key,
                        {
                            "fee_layer": "event", "chain_role": "conditional_forward_evolution",
                            "predictive": True, "conditional": True,
                            "probability": probability,
                            "conditions": step.get("conditions", ""),
                            "horizon": step.get("horizon", ""),
                            "source_severity": round(previous_severity, 6),
                            "target_severity": round(severity, 6),
                            "severity_increase": round(severity - previous_severity, 6),
                            "rule_id": rule.get("rule_id", ""),
                            "model_version": model_version,
                            "causal_claim": False,
                            "disclaimer": "仅在条件成立时可能演化，不表示必然发生",
                        },
                        probability,
                    ))

                    for indicator_id in step.get("indicator_ids") or []:
                        indicator_id = str(indicator_id)
                        indicator = catalog.get(indicator_id)
                        if not indicator:
                            continue
                        indicator_key = _stable_key("fee-indicator", company_id, indicator_id)
                        if indicator_key not in self.nodes:
                            self._add_node(GraphNode(
                                indicator_key, "risk_indicator", indicator["secondary_indicator"],
                                {
                                    "fee_layer": "risk", "chain_role": "secondary_indicator",
                                    "schema_indicator": indicator["secondary_indicator"],
                                    "indicator_id": indicator_id,
                                    "primary_category": indicator["primary_category"],
                                    "definition": indicator["definition"],
                                    "calculation_rule": indicator["calculation_rule"],
                                },
                                probability,
                            ))
                        mapping_key = _stable_key(
                            "fee-scenario-indicator", scenario_key, indicator_key, model_version,
                        )
                        self._add_edge(GraphEdge(
                            mapping_key, scenario_key, "scenario_maps_to_indicator", indicator_key,
                            {
                                "fee_layer": "risk", "chain_role": "future_risk_result",
                                "predictive": True, "indicator_id": indicator_id,
                                "probability": probability, "model_version": model_version,
                            },
                            probability,
                        ))
                        category = indicator["primary_category"]
                        category_key = _stable_key("fee-risk-category", category)
                        if category_key not in self.nodes:
                            self._add_node(GraphNode(
                                category_key, "risk_category", category,
                                {"fee_layer": "risk", "chain_role": "risk_category"}, 1.0,
                            ))
                        category_edge_key = _edge_key(indicator_key, "belongs_to_risk_category", category_key)
                        if category_edge_key not in self.edges:
                            self._add_edge(GraphEdge(
                                category_edge_key, indicator_key, "belongs_to_risk_category", category_key,
                                {"fee_layer": "risk", "indicator_id": indicator_id}, 1.0,
                            ))
                    previous_key = scenario_key
                    previous_severity = severity
                matched += 1
                if matched >= max_rules:
                    break

    @staticmethod
    def _graph_centralities(edges: Iterable[tuple[str, str]], root_key: str) -> dict[str, float]:
        adjacency: dict[str, set[str]] = defaultdict(set)
        for left, right in edges:
            adjacency[left].add(right)
            adjacency[right].add(left)
        nodes = sorted(adjacency)
        if root_key not in adjacency or len(nodes) < 2:
            return {"closeness": 0.0, "betweenness": 0.0, "pagerank": 0.0, "composite": 0.0, "node_count": len(nodes)}

        closeness: dict[str, float] = {}
        for source in nodes:
            distances = {source: 0}
            queue: deque[str] = deque([source])
            while queue:
                current = queue.popleft()
                for neighbour in adjacency[current]:
                    if neighbour not in distances:
                        distances[neighbour] = distances[current] + 1
                        queue.append(neighbour)
            total = sum(distances.values())
            reachable = len(distances)
            value = (reachable - 1) / total if total else 0.0
            if len(nodes) > 1:
                value *= (reachable - 1) / (len(nodes) - 1)
            closeness[source] = value

        betweenness = {node: 0.0 for node in nodes}
        for source in nodes:
            stack: list[str] = []
            predecessors = {node: [] for node in nodes}
            paths = dict.fromkeys(nodes, 0.0)
            paths[source] = 1.0
            distance = dict.fromkeys(nodes, -1)
            distance[source] = 0
            queue = deque([source])
            while queue:
                current = queue.popleft()
                stack.append(current)
                for neighbour in adjacency[current]:
                    if distance[neighbour] < 0:
                        queue.append(neighbour)
                        distance[neighbour] = distance[current] + 1
                    if distance[neighbour] == distance[current] + 1:
                        paths[neighbour] += paths[current]
                        predecessors[neighbour].append(current)
            dependency = dict.fromkeys(nodes, 0.0)
            while stack:
                target = stack.pop()
                for predecessor in predecessors[target]:
                    if paths[target]:
                        dependency[predecessor] += paths[predecessor] / paths[target] * (1 + dependency[target])
                if target != source:
                    betweenness[target] += dependency[target]
        for node in betweenness:
            betweenness[node] /= 2.0
        if len(nodes) > 2:
            scale = 2.0 / ((len(nodes) - 1) * (len(nodes) - 2))
            betweenness = {node: value * scale for node, value in betweenness.items()}

        pagerank = {node: 1.0 / len(nodes) for node in nodes}
        damping = 0.85
        for _ in range(100):
            next_rank = {node: (1 - damping) / len(nodes) for node in nodes}
            for node in nodes:
                share = pagerank[node] / len(adjacency[node])
                for neighbour in adjacency[node]:
                    next_rank[neighbour] += damping * share
            if max(abs(next_rank[node] - pagerank[node]) for node in nodes) < 1e-10:
                pagerank = next_rank
                break
            pagerank = next_rank

        def normalized(values: dict[str, float]) -> float:
            maximum = max(values.values(), default=0.0)
            return values.get(root_key, 0.0) / maximum if maximum else 0.0

        result = {
            "closeness": normalized(closeness),
            "betweenness": normalized(betweenness),
            "pagerank": normalized(pagerank),
            "node_count": len(nodes),
        }
        result["composite"] = (result["closeness"] + result["betweenness"] + result["pagerank"]) / 3
        return result

    @staticmethod
    def _risk_level(score: float) -> str:
        if score >= 0.75:
            return "高"
        if score >= 0.55:
            return "中高"
        if score >= 0.35:
            return "中"
        if score >= 0.2:
            return "中低"
        return "低"

    def _calculate_risk_indexes(
        self,
        conn: sqlite3.Connection,
        company: sqlite3.Row,
        company_key: str,
        catalog: dict[str, dict[str, Any]],
    ) -> None:
        index_config = self.config["risk_indexes"]
        relation_weights = index_config["relation_weights"]
        layer_components: dict[str, dict[str, float]] = {}
        available_weight = 0.0
        conservative_e = 0.0
        for layer, weight in relation_weights.items():
            approved_edges = [
                (relation.subject_key, relation.object_key)
                for relation in self.entity_relationships.values()
                if relation.layer == layer and not relation.needs_review
            ]
            metrics = self._graph_centralities(approved_edges, company_key)
            metrics["edge_count"] = len(approved_edges)
            layer_components[layer] = metrics
            if approved_edges:
                available_weight += float(weight)
                conservative_e += float(weight) * metrics["composite"]
        adjusted_e = conservative_e / available_weight if available_weight else 0.0
        e_coverage = available_weight / sum(float(value) for value in relation_weights.values())
        limitations = []
        missing_layers = [layer for layer in relation_weights if not layer_components[layer]["edge_count"]]
        if missing_layers:
            limitations.append(f"论文关系层缺失：{', '.join(missing_layers)}")
        self.risk_scores.extend((
            {
                "score_type": "E_conservative", "score_value": conservative_e, "coverage_ratio": e_coverage,
                "risk_level": self._risk_level(conservative_e), "components": layer_components,
                "limitations": "；".join(limitations),
            },
            {
                "score_type": "E_observed_adjusted", "score_value": adjusted_e, "coverage_ratio": e_coverage,
                "risk_level": self._risk_level(adjusted_e), "components": layer_components,
                "limitations": "仅在已有关系层内归一；不可解释为全市场风险概率",
            },
        ))

        supply_edges = [
            (relation.subject_key, relation.object_key)
            for relation in self.entity_relationships.values()
            if relation.layer == "supply_chain" and not relation.needs_review
        ]
        supply_metrics = self._graph_centralities(supply_edges, company_key)
        self.risk_scores.append({
            "score_type": "E_supply_chain_experimental", "score_value": supply_metrics["composite"],
            "coverage_ratio": 1.0 if supply_edges else 0.0,
            "risk_level": self._risk_level(supply_metrics["composite"]), "components": supply_metrics,
            "limitations": "供应链层为科创企业试点扩展，不属于论文原始四层权重",
        })

        objective_categories = list(index_config["historical_risk_categories"])
        category_totals = Counter(
            item["primary_category"] for item in catalog.values()
            if item["primary_category"] in objective_categories
        )
        triggered_indicators = {
            indicator
            for event in self.events.values()
            for indicator in (event.attributes.get("original_indicator_ids") or [])
        }
        category_triggered: dict[str, list[str]] = {}
        h_components: dict[str, Any] = {}
        for category in objective_categories:
            items = sorted(
                indicator for indicator in triggered_indicators
                if catalog[indicator]["primary_category"] == category
            )
            category_triggered[category] = items
            total = category_totals.get(category, 0)
            h_components[category] = {
                "triggered_indicators": items, "triggered_count": len(items), "catalog_count": total,
                "ratio": len(items) / total if total else 0.0,
            }
        historical_h = sum(item["ratio"] for item in h_components.values()) / len(objective_categories)

        coverage_rows = conn.execute(
            "SELECT indicator_id,coverage_status,usable_for_scoring FROM indicator_coverage WHERE company_id=?",
            (company["company_id"],),
        ).fetchall()
        objective_indicator_ids = {
            indicator_id for indicator_id, item in catalog.items()
            if item["primary_category"] in objective_categories
        }
        covered = {
            str(row["indicator_id"]) for row in coverage_rows
            if str(row["indicator_id"]) in objective_indicator_ids
            and str(row["coverage_status"] or "").lower() not in {"missing", "缺失", ""}
        }
        h_coverage = len(covered) / len(objective_indicator_ids) if objective_indicator_ids else 0.0
        self.risk_scores.append({
            "score_type": "H_historical", "score_value": historical_h, "coverage_ratio": h_coverage,
            "risk_level": self._risk_level(historical_h), "components": h_components,
            "limitations": "按历史事件主题覆盖计算，新闻或公告曝光差异仍可能影响结果",
        })

        warning_weights = index_config["warning_weights"]
        warning = (
            warning_weights["entity_association_conservative"] * conservative_e
            + warning_weights["historical_risk"] * historical_h
        )
        warning_coverage = (
            warning_weights["entity_association_conservative"] * e_coverage
            + warning_weights["historical_risk"] * h_coverage
        )
        self.risk_scores.append({
            "score_type": "W_auxiliary_warning", "score_value": warning,
            "coverage_ratio": warning_coverage, "risk_level": self._risk_level(warning),
            "components": {
                "E_conservative": conservative_e, "H_historical": historical_h,
                "weights": warning_weights, "triggered_indicators": sorted(triggered_indicators),
            },
            "limitations": "寒武纪单企业试点分值；缺少全市场股权与人员网络，不是违约概率或投资建议",
        })

    def _add_warning_node(self, company_key: str) -> None:
        warning = next(row for row in self.risk_scores if row["score_type"] == "W_auxiliary_warning")
        e_score = next(row for row in self.risk_scores if row["score_type"] == "E_conservative")
        h_score = next(row for row in self.risk_scores if row["score_type"] == "H_historical")
        key = _stable_key("fee-warning", company_key, self.config["risk_indexes"]["model_version"])
        attrs = {
            "fee_layer": "risk", "chain_role": "warning_score", "schema_indicator": "辅助预警",
            "indicator_score": warning["score_value"], "risk_level": warning["risk_level"],
            "coverage_ratio": warning["coverage_ratio"], "E": e_score["score_value"],
            "E_coverage": e_score["coverage_ratio"], "H": h_score["score_value"],
            "H_coverage": h_score["coverage_ratio"], "as_of_date": self.as_of.isoformat(),
            "model_version": self.config["risk_indexes"]["model_version"],
            "limitations": warning["limitations"],
        }
        self._add_node(GraphNode(key, "warning_score", "寒武纪辅助预警", attrs, warning["coverage_ratio"]))
        edge_key = _edge_key(company_key, "has_warning_score", key)
        self._add_edge(GraphEdge(
            edge_key, company_key, "has_warning_score", key,
            {"fee_layer": "risk", "score_type": "W_auxiliary_warning"}, warning["coverage_ratio"],
        ))

    def _validate(self, company_key: str) -> None:
        node_keys = set(self.nodes)
        for edge in self.edges.values():
            if edge.subject_key not in node_keys or edge.object_key not in node_keys:
                self.validation_issues.append({
                    "severity": "error", "code": "dangling_edge", "subject_key": edge.key,
                    "message": "图谱边存在缺失端点", "payload": {"edge": edge.key},
                })
        if company_key not in self.nodes:
            self.validation_issues.append({
                "severity": "error", "code": "missing_company", "subject_key": company_key,
                "message": "试点企业节点缺失", "payload": {},
            })
        event_topic_sources = {edge.subject_key for edge in self.edges.values() if edge.relation_type == "instance_of_topic"}
        event_sources = {edge.object_key for edge in self.edges.values() if edge.relation_type == "supports_event"}
        participants = {edge.object_key for edge in self.edges.values() if edge.relation_type == "participates_in"}
        for event in self.events.values():
            missing = []
            if event.key not in event_topic_sources:
                missing.append("topic")
            if event.key not in event_sources:
                missing.append("evidence")
            if event.key not in participants:
                missing.append("company")
            if missing:
                self.validation_issues.append({
                    "severity": "error", "code": "incomplete_event", "subject_key": event.key,
                    "message": "事件缺少必要闭环", "payload": {"missing": missing},
                })
        for evolution in self.evolution_edges:
            source = self.events[evolution["source_event_key"]]
            target = self.events[evolution["target_event_key"]]
            if source.event_date >= target.event_date:
                self.validation_issues.append({
                    "severity": "error", "code": "non_forward_evolution", "subject_key": evolution["evolution_key"],
                    "message": "事件演化边没有严格按时间正向", "payload": {},
                })
        path_event_keys = {item["event_key"] for item in self.external_transmission_paths}
        for event in self.external_subject_events:
            if event["event_owner_key"] == company_key:
                self.validation_issues.append({
                    "severity": "error", "code": "target_event_in_external_panorama",
                    "subject_key": event["event_key"],
                    "message": "外部主体影响全景图混入了寒武纪自身事件", "payload": {},
                })
            if event["event_key"] not in path_event_keys:
                self.validation_issues.append({
                    "severity": "error", "code": "external_event_without_path",
                    "subject_key": event["event_key"],
                    "message": "外部主体事件没有形成完整风险传导路径", "payload": {},
                })
        for edge in self.edges.values():
            if edge.relation_type != "may_evolve_to":
                continue
            source_severity = float(edge.attributes.get("source_severity") or 0)
            target_severity = float(edge.attributes.get("target_severity") or 0)
            target = self.nodes.get(edge.object_key)
            if (
                target_severity <= source_severity
                or not target
                or target.node_type != "future_risk_scenario"
                or not target.attributes.get("predictive")
            ):
                self.validation_issues.append({
                    "severity": "error", "code": "invalid_forward_risk_evolution",
                    "subject_key": edge.key,
                    "message": "前向事件演化必须指向严重度更高的预测场景",
                    "payload": {
                        "source_severity": source_severity,
                        "target_severity": target_severity,
                    },
                })

    def _persist(self, conn: sqlite3.Connection, run_id: str, company: sqlite3.Row) -> None:
        now = _now()
        for fact in self.entities.values():
            conn.execute(
                """INSERT INTO fee_entities VALUES (?,?,?,?,?,?,?,?,?,?)""",
                (
                    run_id, fact.key, company["company_id"], fact.entity_type, fact.name,
                    _json(fact.attributes), fact.confidence, int(fact.needs_review),
                    fact.review_reason, fact.source_ref,
                ),
            )
        for influence in self.subject_influences:
            conn.execute(
                """INSERT INTO fee_subject_influences VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    run_id, influence["influence_key"], company["company_id"],
                    influence["subject_key"], influence["company_key"], influence["subject_type"],
                    influence["subject_category"], influence["influence_weight"],
                    influence["influence_level"], influence["risk_status"],
                    _json(influence["components"]), _json(influence["evidence"]),
                    influence["confidence"], int(influence["needs_review"]),
                    influence["model_version"],
                ),
            )
        for event in self.external_subject_events:
            conn.execute(
                """INSERT INTO fee_external_subject_events VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    run_id, event["event_key"], company["company_id"], event["event_owner_key"],
                    event["via_subject_key"], event["event_type"], event["event_topic"],
                    event["event_date"], event["title"], event["severity"], event["event_status"],
                    event["source_url"], event["source_title"], _json(event["evidence"]),
                    event["confidence"], int(event["needs_review"]), event["model_version"],
                ),
            )
        for path in self.external_transmission_paths:
            conn.execute(
                """INSERT INTO fee_external_transmission_paths VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    run_id, path["path_key"], company["company_id"], path["event_key"],
                    path["event_owner_key"], path["via_subject_key"], path["company_key"],
                    path["channel_key"], path["path_weight"], path["impact_level"],
                    _json(path["components"]), _json(path["indicator_ids"]), path["mechanism"],
                    path["confidence"], int(path["needs_review"]), path["model_version"],
                ),
            )
        for relation in self.entity_relationships.values():
            conn.execute(
                """INSERT INTO fee_entity_relationships VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    run_id, relation.key, company["company_id"], relation.subject_key,
                    relation.relation_type, relation.object_key, relation.layer,
                    _json(relation.attributes), relation.confidence, int(relation.needs_review),
                    relation.review_reason, relation.source_ref,
                ),
            )
        for event in self.events.values():
            conn.execute(
                """INSERT INTO fee_event_instances VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    run_id, event.key, company["company_id"], event.stable_id, event.event_type,
                    event.topic, event.event_date, event.title, event.polarity, event.direction,
                    event.source_url, event.source_name, _json(event.evidence), _json(event.attributes),
                    event.confidence, int(event.needs_review), event.review_reason,
                ),
            )
        for argument in self.event_arguments:
            conn.execute(
                """INSERT INTO fee_event_arguments VALUES (?,?,?,?,?,?,?,?,?)""",
                (
                    run_id, argument["argument_key"], argument["event_key"], argument["entity_key"],
                    argument["role"], _json(argument["attributes"]), argument["confidence"],
                    int(argument["needs_review"]), argument["source_ref"],
                ),
            )
        for mapping in self.topic_mappings:
            conn.execute(
                """INSERT INTO fee_event_topic_mappings VALUES (?,?,?,?,?,?,?,?)""",
                (
                    run_id, mapping["mapping_key"], mapping["event_key"], mapping["event_topic"],
                    mapping["indicator_id"], mapping["mapping_type"], mapping["confidence"],
                    _json(mapping["attributes"]),
                ),
            )
        for evolution in self.evolution_edges:
            conn.execute(
                """INSERT INTO fee_event_evolution_edges VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    run_id, evolution["evolution_key"], evolution["source_event_key"],
                    evolution["target_event_key"], evolution["evolution_score"],
                    evolution["time_decay_score"], evolution["topic_score"], evolution["semantic_score"],
                    evolution["subject_score"], evolution["polarity_score"],
                    self.config["event_evolution"]["model_version"],
                    _json({"gap_days": evolution["gap_days"], "shared_indicators": evolution["shared_indicators"], "shared_categories": evolution["shared_categories"]}),
                ),
            )
        for impact in self.subject_impacts:
            conn.execute(
                """INSERT INTO fee_subject_impacts VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    run_id, impact["impact_key"], company["company_id"], impact["subject_key"],
                    impact["event_key"], impact["company_key"], impact["subject_type"],
                    impact["influence_weight"], impact["impact_level"], impact["impact_kind"],
                    _json(impact["components"]), _json(impact["evidence"]), impact["confidence"],
                    int(impact["needs_review"]), impact["model_version"],
                ),
            )
        for score in self.risk_scores:
            conn.execute(
                """INSERT INTO fee_risk_scores VALUES (?,?,?,?,?,?,?,?,?,?)""",
                (
                    run_id, company["company_id"], score["score_type"], score["score_value"],
                    score["coverage_ratio"], score["risk_level"],
                    self.config["risk_indexes"]["model_version"], _json(score["components"]),
                    score["limitations"], now,
                ),
            )
        for issue in self.validation_issues:
            conn.execute(
                """INSERT INTO fee_validation_issues(
                       run_id,severity,code,subject_key,message,payload_json,created_at
                   ) VALUES (?,?,?,?,?,?,?)""",
                (
                    run_id, issue["severity"], issue["code"], issue.get("subject_key", ""),
                    issue["message"], _json(issue.get("payload", {})), now,
                ),
            )

        for node in self.nodes.values():
            conn.execute(
                """INSERT INTO knowledge_graph_nodes(
                       node_key,node_type,canonical_name,attributes_json,confidence,needs_review,
                       review_reason,first_seen_run_id,last_seen_run_id,created_at,updated_at
                   ) VALUES (?,?,?,?,?,?,?,?,?,?,?)
                   ON CONFLICT(node_key) DO UPDATE SET
                       node_type=excluded.node_type,canonical_name=excluded.canonical_name,
                       attributes_json=excluded.attributes_json,confidence=excluded.confidence,
                       needs_review=excluded.needs_review,review_reason=excluded.review_reason,
                       last_seen_run_id=excluded.last_seen_run_id,updated_at=excluded.updated_at""",
                (
                    node.key, node.node_type, node.name, _json(node.attributes), node.confidence,
                    int(node.needs_review), node.review_reason, run_id, run_id, now, now,
                ),
            )
            conn.execute(
                """INSERT INTO knowledge_graph_snapshot_nodes(
                       run_id,node_key,node_type,canonical_name,attributes_json,confidence,
                       needs_review,review_reason,created_at,updated_at
                   ) VALUES (?,?,?,?,?,?,?,?,?,?)""",
                (
                    run_id, node.key, node.node_type, node.name, _json(node.attributes),
                    node.confidence, int(node.needs_review), node.review_reason, now, now,
                ),
            )
        for edge in self.edges.values():
            conn.execute(
                """INSERT INTO knowledge_graph_edges(
                       edge_key,subject_key,relation_type,object_key,attributes_json,confidence,
                       needs_review,review_reason,source_id,source_evidence_id,first_seen_run_id,
                       last_seen_run_id,created_at,updated_at
                   ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                   ON CONFLICT(edge_key) DO UPDATE SET
                       attributes_json=excluded.attributes_json,confidence=excluded.confidence,
                       needs_review=excluded.needs_review,review_reason=excluded.review_reason,
                       source_id=excluded.source_id,source_evidence_id=excluded.source_evidence_id,
                       last_seen_run_id=excluded.last_seen_run_id,updated_at=excluded.updated_at""",
                (
                    edge.key, edge.subject_key, edge.relation_type, edge.object_key, _json(edge.attributes),
                    edge.confidence, int(edge.needs_review), edge.review_reason, edge.source_id,
                    edge.source_evidence_id, run_id, run_id, now, now,
                ),
            )
            conn.execute(
                """INSERT INTO knowledge_graph_snapshot_edges(
                       run_id,edge_key,subject_key,relation_type,object_key,attributes_json,
                       confidence,needs_review,review_reason,source_id,source_evidence_id,
                       created_at,updated_at
                   ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    run_id, edge.key, edge.subject_key, edge.relation_type, edge.object_key,
                    _json(edge.attributes), edge.confidence, int(edge.needs_review), edge.review_reason,
                    edge.source_id, edge.source_evidence_id, now, now,
                ),
            )
        for issue in self.validation_issues:
            conn.execute(
                """INSERT INTO knowledge_graph_validation_issues(
                       run_id,severity,code,node_key,message,payload_json,created_at
                   ) VALUES (?,?,?,?,?,?,?)""",
                (
                    run_id, issue["severity"], issue["code"], issue.get("subject_key", ""),
                    issue["message"], _json(issue.get("payload", {})), now,
                ),
            )

        review_count = sum(node.needs_review for node in self.nodes.values()) + sum(edge.needs_review for edge in self.edges.values())
        metadata = {
            "agent_version": AGENT_VERSION, "config_version": self.config["version"],
            "company": company["full_name"], "stock_code": company["stock_code"],
            "as_of_date": self.as_of.isoformat(), "scope": "cambricon-pilot-only",
            "warning_scores": {row["score_type"]: row["score_value"] for row in self.risk_scores},
            "subject_impact_count": len(self.subject_impacts),
            "transmission_model_version": self.config["risk_transmission"]["model_version"],
            "subject_influence_count": len(self.subject_influences),
            "subject_panorama_model_version": self.config["subject_panorama"]["model_version"],
            "external_subject_event_count": len(self.external_subject_events),
            "external_transmission_path_count": len(self.external_transmission_paths),
            "forward_risk_scenario_count": len(self.forward_risk_scenarios),
            "forward_risk_evolution_model_version": self.config.get("forward_risk_evolution", {}).get("model_version", ""),
            "external_transmission_model_version": self.config.get("external_subject_transmission", {}).get("model_version", ""),
        }
        conn.execute(
            """UPDATE fee_kbg_runs SET status='completed',finished_at=?,entity_count=?,
                   entity_relationship_count=?,event_count=?,event_argument_count=?,
                   evolution_edge_count=?,risk_score_count=?,validation_issue_count=?,
                   metadata_json=?,updated_at=? WHERE run_id=?""",
            (
                now, len(self.entities), len(self.entity_relationships), len(self.events),
                len(self.event_arguments), len(self.evolution_edges), len(self.risk_scores),
                len(self.validation_issues), _json(metadata), now, run_id,
            ),
        )
        conn.execute(
            """UPDATE knowledge_graph_runs SET status='completed',finished_at=?,node_count=?,
                   edge_count=?,validation_issue_count=?,review_count=?,metadata_json=?,updated_at=?
                   WHERE run_id=?""",
            (
                now, len(self.nodes), len(self.edges), len(self.validation_issues), review_count,
                _json(metadata), now, run_id,
            ),
        )


def run_cambricon_fee_kbg(
    db_path: Path,
    run_id: str,
    *,
    stock_code: str = "688256",
    config_path: Path = DEFAULT_CONFIG_PATH,
) -> dict[str, Any]:
    return CambriconFEEKBGBuilder(db_path, config_path).run(run_id, stock_code)
