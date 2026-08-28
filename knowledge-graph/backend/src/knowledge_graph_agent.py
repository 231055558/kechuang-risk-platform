"""Controlled knowledge-graph agent built on the crawler's existing SQLite data.

The agent deliberately does not fetch sources or invent facts.  Collection,
parsing, normalisation and confidence assignment remain owned by the existing
pipeline.  This module projects those audited records into the risk graph,
validates the graph and stores an immutable membership snapshot per run.
"""

from __future__ import annotations

import hashlib
import json
import re
import sqlite3
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .database import connect, init_db


AGENT_VERSION = "0.3.0"
LOW_CONFIDENCE = 0.60

# A document is evidence, not a business entity.  In particular, annual-report
# titles occur many times for the same company and must never be materialised
# as event / asset nodes merely because they contain structured observations.
DOCUMENT_TITLE_PATTERN = re.compile(
    r"(?:年度|半年度|季度)?报告|年报|招股说明书|公告|审计报告|问询函|回复函|说明书",
    re.IGNORECASE,
)

# The 18 types in the approved risk-graph schema.  Current crawler types are
# mapped into these labels; unmapped records are retained as supplemental
# entities so no source fact is silently discarded.
NODE_TYPE_MAP = {
    "company": "company",
    "patent": "technical_asset",
    "technology_route": "technical_asset",
    "product": "technical_asset",
    "person": "personnel_structure",
    "supplier": "supply_chain",
    "customer": "supply_chain",
    "country": "market_exposure",
    "region": "market_exposure",
    "sanction_entity": "sanctions_event",
    "controlled_component": "sanctions_event",
    "related_entity": "personnel_risk_event",
    "regulator": "compliance_event",
    "paper_reference": "narrative_event",
    "credit_code": "identity_fact",
    "stock_code": "identity_fact",
    "business_segment": "market_exposure",
    "benchmark_metric": "financial_indicator",
    "business_segment": "market_exposure",
    "equity_structure": "equity_structure",
    "rd_project": "rd_project",
    "personnel_change": "personnel_mobility",
    "litigation_event": "compliance_event",
    "regulatory_event": "compliance_event",
    "exchange_inquiry_event": "compliance_event",
    "financing_event": "financing_event",
    "cash_debt": "cash_debt",
    "asset_impairment_event": "asset_impairment_event",
    "major_technical_event": "major_technical_event",
}

RELATION_TYPE_MAP = {
    "has_patent": "owns",
    "mentions_patent": "owns",
    "has_person": "employs",
    "has_supplier": "procures_from",
    "mentions_supplier": "procures_from",
    "has_customer": "supplies_to",
    "has_business_segment": "operates_in",
    "has_credit_code": "has_identity_fact",
    "has_stock_code": "has_identity_fact",
    "related_to": "associated_risk",
    "screening_match": "restricted_by",
    "depends_on_controlled_component": "depends_on",
    "maps_to_product": "supports_product",
    "supports_technology_route": "supports_technology",
    "benchmarked_by": "benchmarked_by",
    "mentions_product": "supports_product",
    "mentions_customer": "supplies_to",
    "mentions_customer": "supplies_to",
}

# The canonical 22 indicators are the stable bridge between the workbook,
# indicator Agent and PDF §4.1/4.2 graph schema.  Values are (node label,
# directional relation from Enterprise to that node).
INDICATOR_GRAPH_MAP = {
    "叙事热度基本面背离度": ("narrative_event", "narrative_heat"),
    "第三方与自身表述偏差": ("narrative_event", "statement_gap"),
    "自身评价一致性/稳定性": ("narrative_event", "self_statement_consistency"),
    "概念股标签关联度": ("concept_tag", "concept_association"),
    "技术先进性—专利质量": ("technical_asset", "owns"),
    "核心技术人员占比": ("personnel_structure", "employs"),
    "研发投入强度与趋势": ("rd_investment", "invests_in"),
    "研发/募投里程碑兑现度": ("rd_project", "commits_to"),
    "重大技术与知识产权事件": ("major_technical_event", "occurs"),
    "监管处罚次数": ("compliance_event", "penalized_by"),
    "交易所问询次数": ("compliance_event", "inquired_by"),
    "诉讼风险": ("compliance_event", "litigates_in"),
    "营业收入增长率": ("financial_indicator", "has_financial_indicator"),
    "无形资产减值风险": ("asset_impairment_event", "holds"),
    "融资成本": ("financing_event", "financed_by"),
    "经营现金流与短期偿债压力": ("cash_debt", "generates"),
    "关键供应链进口依赖度": ("supply_chain", "procures_from"),
    "海外业务收入占比": ("market_exposure", "operates_in"),
    "出口管制与制裁暴露度": ("sanctions_event", "restricted_by"),
    "控制权稀释与稳定性": ("equity_structure", "held_by"),
    "高管关联风险暴露度": ("personnel_risk_event", "associated_risk"),
    "关键管理与技术人员稳定性": ("personnel_mobility", "leaves"),
}


@dataclass(frozen=True)
class GraphNode:
    key: str
    node_type: str
    canonical_name: str
    attributes: dict[str, Any] = field(default_factory=dict)
    confidence: float = 1.0
    needs_review: bool = False
    review_reason: str = ""


@dataclass(frozen=True)
class GraphEdge:
    key: str
    subject_key: str
    relation_type: str
    object_key: str
    attributes: dict[str, Any] = field(default_factory=dict)
    confidence: float = 1.0
    needs_review: bool = False
    review_reason: str = ""
    source_id: int = 0
    source_evidence_id: int = 0


@dataclass(frozen=True)
class ValidationIssue:
    severity: str
    code: str
    message: str
    node_key: str = ""
    edge_key: str = ""
    payload: dict[str, Any] = field(default_factory=dict)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _json(value: Any) -> str:
    return json.dumps(value or {}, ensure_ascii=False, sort_keys=True, default=str)


def _key(prefix: str, *parts: str) -> str:
    material = "|".join(str(part).strip() for part in parts)
    digest = hashlib.sha256(material.encode("utf-8")).hexdigest()[:20]
    return f"{prefix}:{digest}"


def _node_key(node_type: str, name: str, identifier_type: str = "", identifier_value: str = "") -> str:
    stable_identifier = identifier_value if identifier_value else name
    return _key("node", node_type, identifier_type, stable_identifier)


def _edge_key(subject_key: str, relation_type: str, object_key: str) -> str:
    return _key("edge", subject_key, relation_type, object_key)


def _graph_type(source_type: str) -> str:
    return NODE_TYPE_MAP.get(source_type, "supplemental_entity")


def _relation_type(source_type: str) -> str:
    return RELATION_TYPE_MAP.get(source_type, "related_to")


class KnowledgeGraphAgent:
    """Materialises an explainable graph snapshot from the existing SQLite store."""

    def __init__(self, db_path: Path):
        self.db_path = Path(db_path)

    def run(
        self,
        *,
        run_id: str,
        company: str = "",
        include_unreviewed: bool = False,
    ) -> dict[str, Any]:
        conn = connect(self.db_path)
        try:
            init_db(conn)
            company_row = self._resolve_company(conn, company)
            target_companies = [company_row] if company_row else self._all_companies(conn)
            if not target_companies:
                raise ValueError("no companies are registered in the database")
            self._start_run(conn, run_id, company_row["id"] if company_row else None, company, include_unreviewed)
            nodes: dict[str, GraphNode] = {}
            edges: dict[str, GraphEdge] = {}
            issues: list[ValidationIssue] = []
            for target in target_companies:
                company_nodes, entity_keys = self._build_entity_nodes(conn, target, include_unreviewed)
                score_nodes, score_edges = self._build_score_nodes(conn, target, entity_keys, include_unreviewed)
                relation_edges = self._build_relation_edges(conn, entity_keys, include_unreviewed)
                schema_nodes, schema_edges = self._build_schema_projection(conn, target, entity_keys, include_unreviewed)
                fact_nodes, fact_edges = self._build_fact_network(conn, target, include_unreviewed)
                nodes.update(company_nodes)
                nodes.update(score_nodes)
                nodes.update(schema_nodes)
                nodes.update(fact_nodes)
                edges.update(relation_edges)
                edges.update(score_edges)
                edges.update(schema_edges)
                edges.update(fact_edges)
                issues.extend(self._validate(company_nodes | score_nodes | schema_nodes | fact_nodes, relation_edges | score_edges | schema_edges | fact_edges, target))
            self._persist(conn, run_id, nodes, edges, issues)
            conn.commit()
            return {
                "run_id": run_id,
                "agent_version": AGENT_VERSION,
                "company": company_row["name"] if company_row else "全部企业",
                "company_count": len(target_companies),
                "companies": [row["name"] for row in target_companies],
                "node_count": len(nodes),
                "edge_count": len(edges),
                "validation_issue_count": len(issues),
                "review_count": sum(1 for node in nodes.values() if node.needs_review)
                + sum(1 for edge in edges.values() if edge.needs_review),
                "validation_issues": [issue.__dict__ for issue in issues],
            }
        except Exception as exc:
            self._fail_run(conn, run_id, str(exc))
            conn.commit()
            raise
        finally:
            conn.close()

    def _resolve_company(self, conn: sqlite3.Connection, company: str):
        if not company:
            return None
        row = conn.execute("SELECT * FROM companies WHERE name = ?", (company,)).fetchone()
        if row:
            return row
        matches = conn.execute(
            "SELECT * FROM companies WHERE name LIKE '%' || ? || '%' ORDER BY LENGTH(name) LIMIT 2", (company,)
        ).fetchall()
        if len(matches) == 1:
            return matches[0]
        if not matches:
            raise ValueError(f"company not found: {company}")
        raise ValueError(f"company is ambiguous: {company}; use the full registered name")

    def _all_companies(self, conn: sqlite3.Connection):
        """Return every registered company for a whole-library graph run.

        An omitted ``--company`` is a documented all-company run, not a null
        company.  Keeping this selection explicit prevents a later graph
        stage from dereferencing a missing company row.
        """
        return conn.execute("SELECT * FROM companies ORDER BY CASE WHEN stock_code = '' THEN 1 ELSE 0 END, stock_code, name").fetchall()

    def _start_run(self, conn, run_id, company_id, company, include_unreviewed):
        now = _now()
        conn.execute(
            """
            INSERT INTO knowledge_graph_runs(
                run_id, company_id, status, started_at, metadata_json, created_at, updated_at
            ) VALUES (?, ?, 'running', ?, ?, ?, ?)
            ON CONFLICT(run_id) DO UPDATE SET
                company_id=excluded.company_id, status='running', started_at=excluded.started_at,
                finished_at='', node_count=0, edge_count=0, validation_issue_count=0,
                review_count=0, metadata_json=excluded.metadata_json, updated_at=excluded.updated_at
            """,
            (run_id, company_id, now, _json({"company": company, "include_unreviewed": include_unreviewed, "agent_version": AGENT_VERSION}), now, now),
        )
        conn.execute("DELETE FROM knowledge_graph_snapshot_nodes WHERE run_id = ?", (run_id,))
        conn.execute("DELETE FROM knowledge_graph_snapshot_edges WHERE run_id = ?", (run_id,))
        conn.execute("DELETE FROM knowledge_graph_validation_issues WHERE run_id = ?", (run_id,))

    def _build_entity_nodes(self, conn, company_row, include_unreviewed):
        sql = "SELECT * FROM entities"
        params: list[Any] = []
        if not include_unreviewed:
            sql += " WHERE needs_review = 0"
        rows = conn.execute(sql, params).fetchall()
        scoped_pairs: set[tuple[str, str]] | None = None
        if company_row:
            relation_sql = "SELECT subject_type, subject_name, object_type, object_name FROM entity_relations WHERE (subject_type = 'company' AND subject_name = ?) OR (object_type = 'company' AND object_name = ?)"
            relation_params: list[Any] = [company_row["name"], company_row["name"]]
            if not include_unreviewed:
                relation_sql += " AND needs_review = 0"
            scoped_pairs = {("company", company_row["name"])}
            for relation in conn.execute(relation_sql, relation_params):
                scoped_pairs.add((relation["subject_type"], relation["subject_name"]))
                scoped_pairs.add((relation["object_type"], relation["object_name"]))
        nodes: dict[str, GraphNode] = {}
        entity_keys: dict[tuple[str, str], str] = {}
        for row in rows:
            source_type = row["entity_type"]
            if scoped_pairs is not None and (source_type, row["canonical_name"]) not in scoped_pairs:
                continue
            if company_row and source_type == "company" and row["canonical_name"] == company_row["name"]:
                continue
            graph_type = _graph_type(source_type)
            key = _node_key(graph_type, row["canonical_name"], row["identifier_type"], row["identifier_value"])
            attributes = json.loads(row["attributes_json"] or "{}")
            attributes.update({"source_entity_type": source_type, "entity_id": row["id"]})
            nodes[key] = GraphNode(
                key=key, node_type=graph_type, canonical_name=row["canonical_name"], attributes=attributes,
                confidence=float(row["confidence"]), needs_review=bool(row["needs_review"]), review_reason=row["review_reason"],
            )
            entity_keys[(source_type, row["canonical_name"])] = key
        if company_row:
            company_key = _node_key("company", company_row["name"], "credit_code", company_row["credit_code"])
            nodes[company_key] = GraphNode(
                key=company_key, node_type="company", canonical_name=company_row["name"],
                attributes={"company_id": company_row["id"], "stock_code": company_row["stock_code"], "credit_code": company_row["credit_code"], "aliases": json.loads(company_row["aliases_json"] or "[]")},
                confidence=1.0,
            )
            entity_keys[("company", company_row["name"])] = company_key
        return nodes, entity_keys

    def _build_relation_edges(self, conn, entity_keys, include_unreviewed):
        sql = "SELECT * FROM entity_relations"
        if not include_unreviewed:
            sql += " WHERE needs_review = 0"
        edges: dict[str, GraphEdge] = {}
        for row in conn.execute(sql):
            subject_key = entity_keys.get((row["subject_type"], row["subject_name"]))
            object_key = entity_keys.get((row["object_type"], row["object_name"]))
            if not subject_key or not object_key:
                continue
            relation_type = _relation_type(row["relation_type"])
            key = _edge_key(subject_key, relation_type, object_key)
            attributes = json.loads(row["attributes_json"] or "{}")
            attributes.update({"source_relation_type": row["relation_type"], "relation_id": row["id"]})
            candidate = GraphEdge(
                key=key, subject_key=subject_key, relation_type=relation_type, object_key=object_key,
                attributes=attributes, confidence=float(row["confidence"]), needs_review=bool(row["needs_review"]),
                review_reason=row["review_reason"], source_id=int(row["source_id"]), source_evidence_id=int(row["source_evidence_id"]),
            )
            previous = edges.get(key)
            if previous is None or candidate.confidence > previous.confidence:
                edges[key] = candidate
        return edges

    def _build_score_nodes(self, conn, company_row, entity_keys, include_unreviewed):
        if not company_row:
            return {}, {}
        company_key = entity_keys.get(("company", company_row["name"]))
        if not company_key:
            return {}, {}
        sql = """
            SELECT s.*, i.name AS indicator_name, i.risk_category
            FROM indicator_scores s
            JOIN indicators i ON i.id = s.indicator_id
            WHERE s.company_id = ?
        """
        params: list[Any] = [company_row["id"]]
        if not include_unreviewed:
            sql += " AND s.needs_review = 0"
        latest: dict[int, sqlite3.Row] = {}
        for row in conn.execute(sql, params):
            existing = latest.get(row["indicator_id"])
            if existing is None or row["calculated_at"] > existing["calculated_at"]:
                latest[row["indicator_id"]] = row
        nodes: dict[str, GraphNode] = {}
        edges: dict[str, GraphEdge] = {}
        for row in latest.values():
            name = row["indicator_name"]
            key = _node_key("financial_indicator", name, "company_indicator", f"{company_row['id']}:{row['indicator_id']}")
            calculation = json.loads(row["calculation_json"] or "{}")
            attributes = {
                "indicator_id": row["indicator_id"], "risk_category": row["risk_category"],
                "value": json.loads(row["value_json"]) if row["value_json"] else None,
                "risk_score": row["score"], "risk_level": row["level"], "evidence_count": row["evidence_count"],
                "calculation": calculation, "calculated_at": row["calculated_at"],
            }
            nodes[key] = GraphNode(key, "financial_indicator", name, attributes, 1.0, bool(row["needs_review"]), row["reason"] if row["needs_review"] else "")
            edge_key = _edge_key(company_key, "has_risk_indicator", key)
            edges[edge_key] = GraphEdge(edge_key, company_key, "has_risk_indicator", key, {"indicator_id": row["indicator_id"]}, 1.0, bool(row["needs_review"]), row["reason"] if row["needs_review"] else "")
        return nodes, edges

    def _build_fact_network(self, conn, company_row, include_unreviewed):
        """Materialise structured evidence as auditable 4.2 multi-hop facts."""
        nodes: dict[str, GraphNode] = {}
        edges: dict[str, GraphEdge] = {}
        if not company_row:
            return nodes, edges
        company_key = _node_key("company", company_row["name"], "credit_code", company_row["credit_code"])
        rows = conn.execute(
            """SELECT e.*, i.name AS indicator_name, s.source_key, s.name AS source_name, s.source_type
               FROM evidence e JOIN indicators i ON i.id=e.indicator_id JOIN sources s ON s.id=e.source_id
               WHERE e.company_id=? ORDER BY e.id""", (company_row["id"],)
        ).fetchall()
        for row in rows:
            if not include_unreviewed and (row["needs_review"] or float(row["confidence"]) < LOW_CONFIDENCE):
                continue
            payload = self._payload_dict(row["value_json"])
            tags = set(json.loads(row["tags_json"] or "[]"))
            if not self._is_structured_fact(row["indicator_name"], tags, payload):
                continue
            identity = self._fact_identity(row, payload, tags)
            if identity:
                fact_type, fact_name, identifier_type, identifier_value = identity
                fact_key = _node_key(fact_type, fact_name, identifier_type, identifier_value)
                self._upsert_fact_node(nodes, fact_key, fact_type, fact_name, row, payload, tags)
                company_relation = self._fact_company_relation(row["indicator_name"], fact_type)
                self._upsert_evidence_edge(
                    edges, company_key, company_relation, fact_key, row,
                    {"indicator": row["indicator_name"], "fact_identifier": identifier_value},
                )
                self._add_external_fact_edges(nodes, edges, fact_key, row, payload, tags)
            else:
                # When an observation names an actual counterparty but does
                # not name a distinct event (for example a report stating a
                # supplier country), retain the valid direct 4.2 relation.
                # Do not insert the report title as a fabricated middle node.
                self._add_external_fact_edges(nodes, edges, "", row, payload, tags, company_key=company_key)
        return nodes, edges

    def _payload_dict(self, value_json):
        try:
            value = json.loads(value_json) if value_json else {}
        except json.JSONDecodeError:
            return {}
        if isinstance(value, dict):
            record = value.get("record")
            if isinstance(record, dict):
                merged = dict(value)
                merged.update(record)
                return merged
            return value
        return {"value": value}

    def _is_structured_fact(self, indicator, tags, payload):
        structured_tags = {"litigation_event", "regulatory_event", "exchange_inquiry_event", "financing_event", "equity_structure", "supplier_data", "country_region", "sanction_list", "controlled_component", "patent_data", "person_profile", "personnel_change", "rd_project", "milestone_event", "business_segment"}
        return bool(tags.intersection(structured_tags) or payload.get("dataset_type") in structured_tags or indicator in {"诉讼风险", "监管处罚次数", "交易所问询次数", "融资成本", "股权稀释程度", "供应链进口依赖度", "高管关联风险暴露度", "高管稳定性", "出口管制与制裁暴露度"})

    def _fact_type(self, indicator, tags, payload):
        if indicator == "诉讼风险" or "litigation_event" in tags: return "compliance_event"
        if indicator in {"监管处罚次数", "交易所问询次数"} or "regulatory_event" in tags or "exchange_inquiry_event" in tags: return "compliance_event"
        if indicator == "融资成本" or "financing_event" in tags: return "financing_event"
        if indicator in {"股权稀释程度", "控制权稀释与稳定性"} or "equity_structure" in tags: return "equity_structure"
        if indicator in {"供应链进口依赖度", "关键供应链进口依赖度"} or "supplier_data" in tags: return "supply_chain"
        if indicator in {"高管稳定性", "关键管理与技术人员稳定性"} or "personnel_change" in tags: return "personnel_mobility"
        if "person_profile" in tags: return "personnel_structure"
        if indicator == "出口管制与制裁暴露度" or "sanction_list" in tags or "controlled_component" in tags: return "sanctions_event"
        if "patent_data" in tags: return "technical_asset"
        if "rd_project" in tags or "milestone_event" in tags: return "rd_project"
        if "business_segment" in tags or "country_region" in tags: return "market_exposure"
        return "supplemental_entity"

    def _fact_company_relation(self, indicator, fact_type):
        return {"compliance_event": "occurs", "financing_event": "financed_by", "equity_structure": "held_by", "supply_chain": "procures_from", "personnel_mobility": "leaves", "personnel_structure": "employs", "sanctions_event": "restricted_by", "technical_asset": "owns", "rd_project": "commits_to", "market_exposure": "operates_in"}.get(fact_type, "related_to")

    def _fact_identity(self, row, payload, tags):
        """Return a canonical, auditable identity for a real fact entity.

        Source titles deliberately do not participate in identity selection.
        A title such as ``某公司2025年年度报告`` identifies a document, while
        §4.1/4.2 require a patent, case, project, penalty decision or other
        business object as the graph node.  The title remains in evidence
        attributes through :meth:`_upsert_fact_node`.
        """
        fact_type = self._fact_type(row["indicator_name"], tags, payload)
        patent_no = self._scalar(payload, ["patent_number", "publication_number", "application_number", "专利号", "公开号", "申请号"])
        patent_name = self._scalar(payload, ["patent_name", "专利名称", "发明名称"])
        if patent_no:
            return "technical_asset", patent_name or patent_no, "patent_number", patent_no

        # Structured patent extractors sometimes provide only the invention
        # name.  It remains a valid node only when it is an explicit field,
        # never when it is the source document title.
        if patent_name and "patent_data" in tags:
            return "technical_asset", patent_name, "patent_name", patent_name

        case_no = self._scalar(payload, ["case_number", "case_no", "案号", "案件编号"])
        cause = self._scalar(payload, ["cause", "case_cause", "案由", "纠纷类型"])
        if case_no:
            return "compliance_event", cause or case_no, "case_number", case_no

        decision_no = self._scalar(payload, ["decision_number", "decision_no", "penalty_number", "处罚决定书文号", "决定书文号", "监管文号", "问询函编号"])
        if decision_no:
            return "compliance_event", decision_no, "decision_number", decision_no

        project_name = self._scalar(payload, ["project_name", "milestone_name", "项目名称", "募投项目", "研发项目", "里程碑"])
        if project_name:
            return "rd_project", project_name, "project_name", project_name

        event_id = self._scalar(payload, ["event_id", "event_number", "事件编号", "公告编号"])
        event_name = self._scalar(payload, ["event_name", "event_title", "事件名称", "处罚事项", "事项名称"])
        if event_id and event_name:
            return fact_type, event_name, "event_id", event_id

        # A title is permitted only when an upstream extractor explicitly
        # classified it as an event and it is not a document heading.
        explicit_title = self._scalar(payload, ["event_title", "事件标题"])
        if explicit_title and not DOCUMENT_TITLE_PATTERN.search(explicit_title):
            return fact_type, explicit_title, "event_title", explicit_title
        return None

    def _upsert_fact_node(self, nodes, fact_key, fact_type, fact_name, row, payload, tags):
        """Merge cross-source evidence onto one disambiguated entity node."""
        attrs = {
            "evidence_ids": [int(row["id"])],
            "source_ids": [int(row["source_id"])],
            "evidence_titles": [row["title"]] if row["title"] else [],
            "publish_dates": [row["publish_date"]] if row["publish_date"] else [],
            "urls": [row["url"]] if row["url"] else [],
            "source_names": [row["source_name"]] if row["source_name"] else [],
            "indicators": [row["indicator_name"]],
            "tags": sorted(tags),
            "payload_json": json.dumps(payload, ensure_ascii=False, sort_keys=True, default=str),
        }
        existing = nodes.get(fact_key)
        if existing:
            merged = dict(existing.attributes)
            for field in ("evidence_ids", "source_ids", "evidence_titles", "publish_dates", "urls", "source_names", "indicators", "tags"):
                merged[field] = list(dict.fromkeys([*merged.get(field, []), *attrs[field]]))
            if float(row["confidence"]) >= existing.confidence:
                merged["payload_json"] = attrs["payload_json"]
            nodes[fact_key] = GraphNode(
                fact_key, fact_type, fact_name, merged,
                max(existing.confidence, float(row["confidence"])),
                existing.needs_review or bool(row["needs_review"]),
                existing.review_reason or row["review_reason"],
            )
            return
        nodes[fact_key] = GraphNode(
            fact_key, fact_type, fact_name, attrs, float(row["confidence"]),
            bool(row["needs_review"]), row["review_reason"],
        )

    def _upsert_evidence_edge(self, edges, subject_key, relation_type, object_key, row, attributes=None):
        edge_key = _edge_key(subject_key, relation_type, object_key)
        attrs = dict(attributes or {})
        attrs.update({"evidence_ids": [int(row["id"])], "source_ids": [int(row["source_id"])]})
        existing = edges.get(edge_key)
        if existing:
            merged = dict(existing.attributes)
            merged["evidence_ids"] = list(dict.fromkeys([*merged.get("evidence_ids", []), *attrs["evidence_ids"]]))
            merged["source_ids"] = list(dict.fromkeys([*merged.get("source_ids", []), *attrs["source_ids"]]))
            merged.update({key: value for key, value in attrs.items() if key not in {"evidence_ids", "source_ids"}})
            edges[edge_key] = GraphEdge(
                edge_key, subject_key, relation_type, object_key, merged,
                max(existing.confidence, float(row["confidence"])),
                existing.needs_review or bool(row["needs_review"]),
                existing.review_reason or row["review_reason"], int(row["source_id"]), int(row["id"]),
            )
            return
        edges[edge_key] = GraphEdge(
            edge_key, subject_key, relation_type, object_key, attrs,
            float(row["confidence"]), bool(row["needs_review"]), row["review_reason"],
            int(row["source_id"]), int(row["id"]),
        )

    def _scalar(self, payload, keys):
        for key in keys:
            value = payload.get(key)
            if isinstance(value, str):
                value = value.strip()
            if value not in (None, "", "--", "-", "不适用", "未知"):
                return str(value)
        return ""

    def _add_external_fact_edges(self, nodes, edges, fact_key, row, payload, tags, *, company_key=""):
        relation_specs = [
            ("监管机构", ["authority", "处罚机关", "agency", "监管机构"], "regulated_by", "regulatory_agency"),
            ("法院", ["执行法院", "court", "court_name", "审理法院"], "adjudicated_by", "court"),
            ("对手方", ["related_entity_name", "counterparty", "party", "对手方"], "litigates_against", "related_entity"),
            ("金融机构", ["bank", "financial_institution", "金融机构"], "financed_by", "financial_institution"),
            ("国家地区", ["country_or_region", "country", "region", "国家地区"], "operates_in", "country_region"),
            ("受限零部件", ["controlled_component", "component", "受管制零部件"], "depends_on", "controlled_component"),
            ("关联企业", ["related_company", "related_entity", "关联企业"], "associated_risk", "related_entity"),
        ]
        # iFinD person/profile rows store names in raw_row rather than a field.
        person = self._scalar(payload, ["person_name", "姓名", "name"])
        raw_row = payload.get("raw_row")
        if not person and isinstance(raw_row, list) and len(raw_row) > 1:
            candidate = str(raw_row[1]).strip()
            if candidate and not re.fullmatch(r"\d+(?:\.\d+)?", candidate):
                person = candidate
        if person and ("person_profile" in tags or "personnel_change" in tags):
            relation_specs.append(("人员", ["__person__"], "involves_person", "person"))
            payload = dict(payload); payload["__person__"] = person
        for name_hint, keys, relation, node_type in relation_specs:
            name = self._scalar(payload, keys)
            if not name or len(name) > 300:
                continue
            # Split court party strings into individual named parties where
            # available, while retaining the original event as one fact node.
            candidates = [x.strip() for x in re.split(r"[;；\n,，]", name) if x.strip()] if relation == "litigates_against" else [name]
            for candidate in candidates[:10]:
                ext_key = _node_key(node_type, candidate, "canonical_name", candidate)
                nodes.setdefault(ext_key, GraphNode(ext_key, node_type, candidate, {"external_role": name_hint, "extracted_from_evidence_id": int(row["id"]), "source_name": row["source_name"]}, float(row["confidence"]), bool(row["needs_review"]), row["review_reason"]))
                if fact_key:
                    self._upsert_evidence_edge(edges, fact_key, relation, ext_key, row, {"field": keys[0]})
                elif company_key:
                    # A real counterparty may be known even if the source does
                    # not identify a distinct event.  Use the direct 4.2
                    # enterprise relation, with the same traceable evidence.
                    direct_relation = {
                        "regulated_by": "inquired_by" if row["indicator_name"] == "交易所问询次数" else "penalized_by",
                        "adjudicated_by": "litigates_in",
                        "litigates_against": "litigates_against",
                        "financed_by": "financed_by",
                        "operates_in": "operates_in",
                        "depends_on": "depends_on",
                        "associated_risk": "associated_risk",
                        "involves_person": "employs",
                    }.get(relation, "related_to")
                    self._upsert_evidence_edge(edges, company_key, direct_relation, ext_key, row, {"field": keys[0], "direct_from_evidence": True})

    def _build_schema_projection(self, conn, company_row, entity_keys, include_unreviewed):
        """Project evidence and latest indicator outputs to every PDF §4.1 type.

        This makes the required schema explicit without manufacturing external
        parties: every generated node and edge has either an indicator-score or
        evidence record behind it.  A candidate is retained as review-required
        when its source still requires human confirmation.
        """
        if not company_row:
            return {}, {}
        company_key = entity_keys.get(("company", company_row["name"]))
        if not company_key:
            return {}, {}
        nodes: dict[str, GraphNode] = {}
        edges: dict[str, GraphEdge] = {}
        latest_scores = self._latest_scores(conn, company_row["id"])
        for indicator, (node_type, relation_type) in INDICATOR_GRAPH_MAP.items():
            score = latest_scores.get(indicator)
            # Keep the production graph based on approved evidence, but carry
            # a complete provenance/coverage summary for every raw source
            # record.  §4.3 requires confidence and human-review status; raw
            # data must be visible as pending rather than silently discarded
            # or, worse, treated as an approved risk fact.
            all_evidence = self._indicator_evidence(conn, company_row["id"], indicator, True)
            evidence = all_evidence if include_unreviewed else [
                row for row in all_evidence
                if not row["needs_review"] and float(row["confidence"]) >= LOW_CONFIDENCE
            ]
            if not score and not all_evidence:
                continue
            score_attrs = self._score_attributes(score) if score else {}
            evidence_attrs = self._evidence_summary(evidence, all_evidence)
            key = _node_key(node_type, indicator, "company_indicator", f"{company_row['id']}:{indicator}")
            needs_review = bool((score and score["needs_review"]) or any(item["needs_review"] or float(item["confidence"]) < LOW_CONFIDENCE for item in evidence))
            reason = (score["reason"] if score and score["needs_review"] else "")
            attrs = {"schema_indicator": indicator, "schema_source": "修改意见.pdf §4.1/4.2", **score_attrs, **evidence_attrs}
            nodes[key] = GraphNode(key, node_type, indicator, attrs, self._confidence(score, evidence), needs_review, reason)
            edge_key = _edge_key(company_key, relation_type, key)
            edges[edge_key] = GraphEdge(
                edge_key, company_key, relation_type, key,
                {"schema_indicator": indicator, "schema_source": "修改意见.pdf §4.2", **evidence_attrs},
                self._confidence(score, evidence), needs_review, reason,
                source_id=int(evidence[0]["source_id"]) if evidence else 0,
                source_evidence_id=int(evidence[0]["id"]) if evidence else 0,
            )
            self._add_schema_detail_edges(nodes, edges, company_key, key, node_type, relation_type, evidence, indicator)
        return nodes, edges

    def _latest_scores(self, conn, company_id):
        rows = conn.execute(
            """SELECT s.*, i.name AS indicator_name, i.risk_category FROM indicator_scores s
               JOIN indicators i ON i.id=s.indicator_id WHERE s.company_id=? ORDER BY s.calculated_at DESC""",
            (company_id,),
        ).fetchall()
        latest = {}
        for row in rows:
            latest.setdefault(row["indicator_name"], row)
        return latest

    def _indicator_evidence(self, conn, company_id, indicator, include_unreviewed):
        aliases = {indicator}
        # Existing records use some pre-contract names. The score table is
        # canonical, while these aliases keep raw evidence traceable.
        alias_groups = {
            "技术先进性—专利质量": {"核心专利质量与技术壁垒"},
            "研发投入强度与趋势": {"研发投入强度", "持续创新能力"},
            "研发/募投里程碑兑现度": {"工程化与商业转化率", "技术成熟与阶段兑现度(TRL等级)"},
            "重大技术与知识产权事件": {"重大技术质量事件指数"},
            "关键供应链进口依赖度": {"供应链进口依赖度"},
            "控制权稀释与稳定性": {"股权稀释程度"},
            "关键管理与技术人员稳定性": {"高管稳定性"},
        }
        aliases.update(alias_groups.get(indicator, set()))
        placeholders = ",".join("?" for _ in aliases)
        sql = f"""SELECT e.*, s.source_key, s.name AS source_name, s.source_type, i.name AS indicator_name
                  FROM evidence e JOIN indicators i ON i.id=e.indicator_id JOIN sources s ON s.id=e.source_id
                  WHERE e.company_id=? AND i.name IN ({placeholders})"""
        params = [company_id, *sorted(aliases)]
        if not include_unreviewed:
            sql += " AND e.needs_review=0 AND e.confidence >= ?"
            params.append(LOW_CONFIDENCE)
        return conn.execute(sql, params).fetchall()

    def _score_attributes(self, row):
        return {
            "indicator_score": row["score"], "indicator_value": json.loads(row["value_json"]) if row["value_json"] else None,
            "risk_level": row["level"], "calculation": json.loads(row["calculation_json"] or "{}"),
            "calculated_at": row["calculated_at"], "score_evidence_count": row["evidence_count"],
        }

    def _evidence_summary(self, rows, all_rows=None):
        """Summarise approved evidence and the whole data-chain coverage.

        ``rows`` contains evidence eligible for the current graph view;
        ``all_rows`` contains the same indicator's full audited intake.  The
        latter is metadata only, not a shortcut around the confidence/review
        gate used by the risk-score and official graph.
        """
        all_rows = list(all_rows if all_rows is not None else rows)
        dated = [row["publish_date"] for row in rows if row["publish_date"]]
        by_source: dict[tuple[str, str], dict[str, Any]] = {}
        for row in all_rows:
            key = (row["source_type"] or "未标注来源类型", row["source_name"] or "未命名来源")
            bucket = by_source.setdefault(key, {
                "source_type": key[0], "source_name": key[1], "total": 0, "approved": 0, "review_pending": 0,
            })
            bucket["total"] += 1
            approved = not row["needs_review"] and float(row["confidence"]) >= LOW_CONFIDENCE
            if approved:
                bucket["approved"] += 1
            else:
                bucket["review_pending"] += 1
        provenance = sorted(by_source.values(), key=lambda item: (-item["total"], item["source_name"]))
        return {
            "evidence_count": len(rows), "evidence_ids": [int(row["id"]) for row in rows[:50]],
            "source_ids": sorted({int(row["source_id"]) for row in rows}),
            "latest_evidence_date": max(dated) if dated else "",
            "data_chain_evidence_count": len(all_rows),
            "approved_evidence_count": len(rows),
            "review_pending_evidence_count": len(all_rows) - len(rows),
            "source_coverage": provenance,
            # Keep document provenance queryable on the indicator / edge,
            # rather than turning a document heading into a graph node.
            "evidence_titles": list(dict.fromkeys(row["title"] for row in rows[:50] if row["title"])),
            "evidence_urls": list(dict.fromkeys(row["url"] for row in rows[:50] if row["url"])),
            "evidence_source_names": list(dict.fromkeys(row["source_name"] for row in rows[:50] if row["source_name"])),
        }

    def _confidence(self, score, evidence):
        values = ([1.0] if score else []) + [float(row["confidence"]) for row in evidence]
        return max(LOW_CONFIDENCE, min(values)) if values else LOW_CONFIDENCE

    def _add_schema_detail_edges(self, nodes, edges, company_key, indicator_key, node_type, relation_type, evidence, indicator):
        """Attach schema indicators only to identified 4.2 business facts.

        A report can substantiate an indicator without being the object of a
        graph relationship.  This method therefore attaches a second-hop node
        only if the evidence has a stable real-world identity; it never falls
        back to ``evidence.title``.
        """
        detail_map = {
            "技术先进性—专利质量": ("technical_asset", "owns", "same_family_as"),
            "核心技术人员占比": ("personnel_structure", "employs", "contributes_to"),
            "研发投入强度与趋势": ("rd_investment", "invests_in", "occurs_in_period"),
            "研发/募投里程碑兑现度": ("rd_project", "commits_to", "delayed"),
            "重大技术与知识产权事件": ("major_technical_event", "occurs", "related_to"),
            "监管处罚次数": ("compliance_event", "penalized_by", "related_to"),
            "交易所问询次数": ("compliance_event", "inquired_by", "related_to"),
            # `adjudicated_by` is reserved for an event → Court edge.  The
            # indicator → evidence trace is deliberately generic so it never
            # points the semantic "裁判" relation at a compliance event.
            "诉讼风险": ("compliance_event", "litigates_in", "related_to"),
            "无形资产减值风险": ("asset_impairment_event", "holds", "related_to"),
            "融资成本": ("financing_event", "financed_by", "related_to"),
            "经营现金流与短期偿债压力": ("cash_debt", "generates", "covers"),
            "关键供应链进口依赖度": ("supply_chain", "procures_from", "operates_in"),
            "海外业务收入占比": ("market_exposure", "operates_in", "related_to"),
            "出口管制与制裁暴露度": ("sanctions_event", "restricted_by", "related_to"),
            "控制权稀释与稳定性": ("equity_structure", "held_by", "related_to"),
            "高管关联风险暴露度": ("personnel_risk_event", "associated_risk", "related_to"),
            "关键管理与技术人员稳定性": ("personnel_mobility", "leaves", "related_to"),
        }
        if not evidence or indicator not in detail_map:
            return
        _, _, detail_relation = detail_map[indicator]
        for source in evidence:
            payload = self._payload_dict(source["value_json"])
            tags = set(json.loads(source["tags_json"] or "[]"))
            identity = self._fact_identity(source, payload, tags)
            if not identity:
                continue
            detail_type, name, identifier_type, identifier_value = identity
            detail_key = _node_key(detail_type, name, identifier_type, identifier_value)
            self._upsert_fact_node(nodes, detail_key, detail_type, name, source, payload, tags)
            self._upsert_evidence_edge(
                edges, indicator_key, detail_relation, detail_key, source,
                {"indicator": indicator, "schema_indicator": indicator},
            )

    def _validate(self, nodes, edges, company_row):
        issues: list[ValidationIssue] = []
        referenced = {edge.subject_key for edge in edges.values()} | {edge.object_key for edge in edges.values()}
        for node in nodes.values():
            # §4.2 documents are provenance or (only where separately
            # modelled) relation-end facts; a source document heading cannot
            # masquerade as an asset, compliance event, person or project.
            # Treat this as an error so a new importer cannot silently bring
            # the former annual-report-title defect back into production.
            if node.node_type not in {"company", "financial_indicator"} and DOCUMENT_TITLE_PATTERN.search(node.canonical_name):
                issues.append(ValidationIssue(
                    "error", "document_title_as_entity",
                    "source document title was materialised as a business entity",
                    node_key=node.key,
                    payload={"name": node.canonical_name, "type": node.node_type},
                ))
            if node.key not in referenced and node.node_type != "company":
                issues.append(ValidationIssue("warning", "isolated_node", "node has no graph relation", node_key=node.key, payload={"name": node.canonical_name, "type": node.node_type}))
            if node.confidence < LOW_CONFIDENCE:
                issues.append(ValidationIssue("warning", "low_confidence_node", "node confidence is below auto-publish threshold", node_key=node.key, payload={"confidence": node.confidence}))
        for edge in edges.values():
            if edge.subject_key not in nodes or edge.object_key not in nodes:
                issues.append(ValidationIssue("error", "dangling_edge", "edge endpoint is missing", edge_key=edge.key))
            if edge.confidence < LOW_CONFIDENCE:
                issues.append(ValidationIssue("warning", "low_confidence_edge", "edge confidence is below auto-publish threshold", edge_key=edge.key, payload={"confidence": edge.confidence}))
            target = nodes.get(edge.object_key)
            if edge.relation_type == "regulated_by" and target and target.node_type != "regulatory_agency":
                issues.append(ValidationIssue("error", "invalid_regulatory_target", "regulated_by must terminate at regulatory_agency", edge_key=edge.key, payload={"actual_type": target.node_type}))
            if edge.relation_type == "adjudicated_by" and target and target.node_type != "court":
                issues.append(ValidationIssue("error", "invalid_court_target", "adjudicated_by must terminate at court", edge_key=edge.key, payload={"actual_type": target.node_type}))
            if edge.relation_type == "operates_in" and target and target.node_type not in {"market_exposure", "country_region"}:
                issues.append(ValidationIssue("error", "invalid_region_target", "operates_in must terminate at market_exposure or country_region", edge_key=edge.key, payload={"actual_type": target.node_type}))
        if company_row:
            company_nodes = [node for node in nodes.values() if node.node_type == "company" and node.canonical_name == company_row["name"]]
            if not company_nodes:
                issues.append(ValidationIssue("error", "missing_company_node", "requested company has no graph node"))
            elif not any(edge.subject_key == company_nodes[0].key or edge.object_key == company_nodes[0].key for edge in edges.values()):
                issues.append(ValidationIssue("warning", "isolated_company", "requested company has no approved graph relation", node_key=company_nodes[0].key))
        return issues

    def _persist(self, conn, run_id, nodes, edges, issues):
        now = _now()
        for node in nodes.values():
            conn.execute(
                """
                INSERT INTO knowledge_graph_nodes(node_key, node_type, canonical_name, attributes_json, confidence, needs_review, review_reason, first_seen_run_id, last_seen_run_id, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(node_key) DO UPDATE SET node_type=excluded.node_type, canonical_name=excluded.canonical_name, attributes_json=excluded.attributes_json, confidence=excluded.confidence, needs_review=excluded.needs_review, review_reason=excluded.review_reason, last_seen_run_id=excluded.last_seen_run_id, updated_at=excluded.updated_at
                """,
                (node.key, node.node_type, node.canonical_name, _json(node.attributes), node.confidence, int(node.needs_review), node.review_reason, run_id, run_id, now, now),
            )
            conn.execute(
                """INSERT OR REPLACE INTO knowledge_graph_snapshot_nodes(
                       run_id,node_key,node_type,canonical_name,attributes_json,confidence,
                       needs_review,review_reason,created_at,updated_at
                   ) VALUES (?,?,?,?,?,?,?,?,?,?)""",
                (
                    run_id, node.key, node.node_type, node.canonical_name, _json(node.attributes),
                    node.confidence, int(node.needs_review), node.review_reason, now, now,
                ),
            )
        for edge in edges.values():
            conn.execute(
                """
                INSERT INTO knowledge_graph_edges(edge_key, subject_key, relation_type, object_key, attributes_json, confidence, needs_review, review_reason, source_id, source_evidence_id, first_seen_run_id, last_seen_run_id, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(edge_key) DO UPDATE SET attributes_json=excluded.attributes_json, confidence=excluded.confidence, needs_review=excluded.needs_review, review_reason=excluded.review_reason, source_id=excluded.source_id, source_evidence_id=excluded.source_evidence_id, last_seen_run_id=excluded.last_seen_run_id, updated_at=excluded.updated_at
                """,
                (edge.key, edge.subject_key, edge.relation_type, edge.object_key, _json(edge.attributes), edge.confidence, int(edge.needs_review), edge.review_reason, edge.source_id, edge.source_evidence_id, run_id, run_id, now, now),
            )
            conn.execute(
                """INSERT OR REPLACE INTO knowledge_graph_snapshot_edges(
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
        for issue in issues:
            conn.execute(
                "INSERT INTO knowledge_graph_validation_issues(run_id, severity, code, node_key, edge_key, message, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (run_id, issue.severity, issue.code, issue.node_key, issue.edge_key, issue.message, _json(issue.payload), now),
            )
        review_count = sum(1 for node in nodes.values() if node.needs_review) + sum(1 for edge in edges.values() if edge.needs_review)
        conn.execute(
            "UPDATE knowledge_graph_runs SET status='completed', finished_at=?, node_count=?, edge_count=?, validation_issue_count=?, review_count=?, updated_at=? WHERE run_id=?",
            (now, len(nodes), len(edges), len(issues), review_count, now, run_id),
        )

    def _fail_run(self, conn, run_id, error):
        conn.execute("UPDATE knowledge_graph_runs SET status='failed', finished_at=?, metadata_json=?, updated_at=? WHERE run_id=?", (_now(), _json({"error": error, "agent_version": AGENT_VERSION}), _now(), run_id))


def run_knowledge_graph_agent(db_path: Path, run_id: str, company: str = "", include_unreviewed: bool = False) -> dict[str, Any]:
    return KnowledgeGraphAgent(db_path).run(run_id=run_id, company=company, include_unreviewed=include_unreviewed)
