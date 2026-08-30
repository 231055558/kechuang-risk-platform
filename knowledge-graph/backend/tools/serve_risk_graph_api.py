"""Serve the Neo4j risk graph and local web UI on a loopback-only address.

Neo4j credentials remain in this process (via environment variables) and are
never sent to the browser.  The API intentionally exposes only fixed read-only
Cypher queries; it is not a general Cypher endpoint.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

from src.neo4j_sync import load_schema  # noqa: E402

DEFAULT_WEB_ROOT = PROJECT_ROOT.parent / "frontend"
MAX_GRAPH_LIMIT = 600
CHAIN_PARTNER_RELATIONS = {
    "procures_from": "upstream",
    "depends_on": "upstream",
    "supplies_to": "downstream",
    "associated_risk": "related",
    "related_to": "related",
    "invests_in_entity": "related",
}
CHAIN_PARTNER_TYPES = {"company", "related_entity", "supplemental_entity"}
CHAIN_EVENT_TYPES = {
    "compliance_event", "major_technical_event", "financing_event",
    "sanctions_event", "asset_impairment_event", "personnel_risk_event",
    "personnel_mobility", "risk_event",
}

# ``relation_type`` is an internal schema code, while Neo4j relationship
# labels are implementation details.  The browser must never have to expose
# either of them as a user-facing relationship name.
RELATION_LABELS = {
    "related_to": "关联",
    "occurs": "发生",
    "penalized_by": "受到处罚",
    "inquired_by": "交易所问询",
    "litigates_in": "涉诉",
    "procures_from": "向上游采购",
    "depends_on": "依赖",
    "supplies_to": "向下游供货",
    "associated_risk": "风险关联",
    "invests_in_entity": "投资关联",
    "belongs_to_industry": "属于行业",
    "associated_with_concept": "概念关联",
    "participates_in": "参与事件",
    "instance_of_topic": "归属主题",
    "maps_to_indicator": "映射指标",
    "belongs_to_risk_category": "属于风险",
    "supports_event": "提供证据",
    "regulates_event": "监管事件",
    "inquires_event": "问询事件",
    "adjudicates_event": "裁判事件",
    "involved_in_event": "涉及事件",
    "lists_entity_in_event": "列入清单事件",
    "evolves_to": "关联演化",
    "has_warning_score": "辅助预警",
    "subject_impacts_event": "影响事件",
    "event_impacts_company": "影响企业",
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
    "employs": "任职",
    "held_by": "持股",
    "invests_in_entity": "参股",
    "restricted_by": "受限于",
    "financed_by": "融资关联",
    "serves_at_external_entity": "在关联企业任职",
    "sells_to": "销售或服务",
}
EVENT_DISPLAY_ALIASES = {
    "additions and revisions to the entity list and conforming removal from the unverified list": "美国实体清单调整事件",
    "additions and revisions to the entity list": "美国实体清单调整事件",
}
EVIDENCE_DISPLAY_ALIASES = {
    "additions and revisions to the entity list and conforming removal from the unverified list": "美国商务部实体清单调整公告",
    "additions of entities to the entity list": "美国商务部实体清单新增实体公告",
    "arm china majority shareholders announce the company’s corporate governance issue has been resolved": "安谋科技公司治理问题解决公告",
    "synopsys issues statement in connection to the lifting of recent u.s. export restrictions related to china": "新思科技关于美国对华出口限制撤销的声明",
}


def _evidence_display_label(value: object) -> str:
    label = str(value or "未命名证据").strip()
    alias = EVIDENCE_DISPLAY_ALIASES.get(label.lower())
    if alias:
        return alias
    prefix = "tyc_litigation_event:"
    if label.lower().startswith(prefix):
        return f"诉讼文书：{label[len(prefix):].strip()}"
    return label


def _relation_label(code: str, fallback: str, attributes: dict | None = None) -> str:
    """Return the audited Chinese display label for an edge."""
    attributes = attributes or {}
    mapping = attributes.get("event_mapping")
    if mapping == "原始事件映射":
        return "影响指标（原始映射）"
    if mapping:
        return "影响指标（机制推断）"
    return RELATION_LABELS.get(code, fallback or "关联")


def _json_response(handler: SimpleHTTPRequestHandler, status: int, payload: dict) -> None:
    body = json.dumps(payload, ensure_ascii=False, default=str).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Cache-Control", "no-store")
    handler.end_headers()
    handler.wfile.write(body)


def _bounded_int(value: str | None, default: int, low: int, high: int) -> int:
    try:
        return max(low, min(high, int(value or default)))
    except ValueError:
        return default


def _bounded_float(value: str | None, default: float, low: float, high: float) -> float:
    try:
        return max(low, min(high, float(value or default)))
    except ValueError:
        return default


class GraphReader:
    def __init__(self, uri: str, username: str, password: str, database: str):
        try:
            from neo4j import GraphDatabase
        except ImportError as exc:
            raise RuntimeError("缺少 Neo4j Python 驱动。请运行：python -m pip install -r requirements-neo4j.txt") from exc
        self._driver = GraphDatabase.driver(uri, auth=(username, password))
        self.database = database
        schema = load_schema()
        self.display_type = {key: value["display_name"] for key, value in schema["node_labels"].items()}

    def close(self) -> None:
        self._driver.close()

    def _run(self, query: str, **params):
        with self._driver.session(database=self.database) as session:
            return list(session.run(query, **params))

    def health(self) -> dict:
        row = self._run(
            "MATCH (n:RiskNode) WHERE n.in_snapshot = true RETURN count(n) AS nodes, max(n.snapshot_run_id) AS run_id"
        )[0]
        return {"ok": True, "neo4j": "connected", "active_nodes": row["nodes"], "snapshot_run_id": row["run_id"] or ""}

    def companies(self) -> list[dict]:
        rows = self._run(
            """
            MATCH (n:RiskNode:Enterprise)
            WHERE n.in_snapshot = true
            RETURN n
            ORDER BY coalesce(n.attributes_json, ''), n.canonical_name
            """
        )
        return [self._node(row["n"]) for row in rows]

    def graph(
        self,
        company_key: str,
        limit: int,
        *,
        view: str = "overview",
        focus_key: str = "",
        relation_type: str = "",
        offset: int = 0,
    ) -> dict:
        """Return a progressive-disclosure view of one company's graph.

        An all-neighbourhood Cypher query is technically correct but creates a
        hairball for companies with hundreds of patents or source facts.  The
        default view therefore contains only the audited schema/indicator
        anchors.  A caller may explicitly expand one anchor to retrieve its
        local two-hop evidence neighbourhood.
        """
        if view == "focus":
            if not focus_key:
                raise ValueError("展开视图缺少节点标识")
            return self._focus_graph(company_key, focus_key, limit, relation_type=relation_type, offset=offset)
        return self._overview_graph(company_key, limit)

    def fee_kbg(self, company_key: str, limit: int) -> dict:
        """Return one complete versioned FEE-KBG pilot snapshot.

        FEE nodes and edges are persisted by the offline builder. This endpoint
        never synthesizes an evolution or warning result at request time.
        """
        root_rows = self._run(
            """
            MATCH (n:RiskNode:Enterprise {node_key: $company_key})
            WHERE n.in_snapshot = true AND n.attributes_json CONTAINS '"fee_kbg": true'
            RETURN n
            ORDER BY n.snapshot_run_id DESC
            LIMIT 1
            """,
            company_key=company_key,
        )
        if not root_rows:
            raise LookupError("当前企业尚无FEE-KBG试点快照")
        root = self._node(root_rows[0]["n"])
        run_id = root["snapshot_run_id"]
        node_rows = self._run(
            """
            MATCH (n:RiskNode)
            WHERE n.in_snapshot = true AND n.snapshot_run_id = $run_id
              AND n.attributes_json CONTAINS '"fee_kbg": true'
            RETURN n
            ORDER BY n.node_type, n.canonical_name
            LIMIT $limit
            """,
            run_id=run_id,
            limit=limit,
        )
        nodes = [self._node(row["n"]) for row in node_rows]
        node_keys = [node["id"] for node in nodes]
        edge_rows = self._run(
            """
            MATCH (source:RiskNode)-[rel]->(target:RiskNode)
            WHERE rel.in_snapshot = true AND rel.snapshot_run_id = $run_id
              AND rel.attributes_json CONTAINS '"fee_kbg": true'
              AND source.node_key IN $node_keys AND target.node_key IN $node_keys
            RETURN source, rel, target
            ORDER BY rel.relation_type, rel.edge_key
            """,
            run_id=run_id,
            node_keys=node_keys,
        )
        edges = []
        for row in edge_rows:
            edge = self._edge(row["rel"])
            edge["source"] = row["source"]["node_key"]
            edge["target"] = row["target"]["node_key"]
            edges.append(edge)
        layer_counts: dict[str, int] = {}
        warning_scores: dict[str, object] = {}
        for node in nodes:
            layer = str(node["attributes"].get("fee_layer") or "other")
            layer_counts[layer] = layer_counts.get(layer, 0) + 1
            if node["type"] == "warning_score":
                warning_scores = {
                    "W": node["attributes"].get("indicator_score"),
                    "E": node["attributes"].get("E"),
                    "H": node["attributes"].get("H"),
                    "risk_level": node["attributes"].get("risk_level"),
                    "coverage_ratio": node["attributes"].get("coverage_ratio"),
                    "limitations": node["attributes"].get("limitations"),
                }
        return {
            "company_key": company_key,
            "view": "fee_kbg",
            "snapshot_run_id": run_id,
            "nodes": nodes,
            "edges": edges,
            "layer_counts": layer_counts,
            "warning_scores": warning_scores,
            "event_count": sum(node["type"] == "risk_event" for node in nodes),
            "actor_count": sum(node["attributes"].get("fee_layer") == "entity" and node["id"] != company_key for node in nodes),
            "indicator_count": sum(node["type"] == "risk_indicator" for node in nodes),
            "evolution_count": sum(edge["relation_code"] == "evolves_to" for edge in edges),
            "truncated": len(node_rows) >= limit,
            "missing": [],
        }

    def fee_transmission(self, company_key: str, limit: int, min_weight: float) -> dict:
        """Project the complete FEE snapshot into a weighted risk-transmission view."""
        graph = self.fee_kbg(company_key, limit)
        nodes_by_id = {node["id"]: node for node in graph["nodes"]}
        all_edges = graph["edges"]
        impact_edges = [
            edge for edge in all_edges
            if edge["relation_code"] == "subject_impacts_event"
            and not edge["needs_review"]
            and float(edge["attributes"].get("influence_weight") or 0) >= min_weight
        ]
        subject_weights: dict[str, float] = {}
        for edge in impact_edges:
            subject_weights[edge["source"]] = max(
                subject_weights.get(edge["source"], 0.0),
                float(edge["attributes"].get("influence_weight") or 0),
            )
        max_subjects = 12
        selected_subjects = {
            key for key, _weight in sorted(subject_weights.items(), key=lambda item: (-item[1], nodes_by_id.get(item[0], {}).get("label", "")))[:max_subjects]
        }
        impact_edges = [edge for edge in impact_edges if edge["source"] in selected_subjects]
        visible_events = {edge["target"] for edge in impact_edges}
        event_company_edges = [
            edge for edge in all_edges
            if edge["relation_code"] == "event_impacts_company"
            and float(edge["attributes"].get("impact_weight") or 0) >= min_weight
        ]
        visible_events.update(edge["source"] for edge in event_company_edges)
        event_company_edges = [edge for edge in event_company_edges if edge["source"] in visible_events]
        event_argument_relations = {
            "inquires_event", "involved_in_event", "lists_entity_in_event",
            "regulates_event", "adjudicates_event", "participates_in",
        }
        event_argument_edges = [
            edge for edge in all_edges
            if edge["relation_code"] in event_argument_relations
            and company_key not in {edge["source"], edge["target"]}
            and (
                (edge["target"] in visible_events and edge["source"] in selected_subjects | {company_key})
                or (edge["source"] in visible_events and edge["target"] in selected_subjects | {company_key})
            )
        ]
        entity_relation_edges = [
            edge for edge in all_edges
            if edge["relation_code"] in {"procures_from", "sells_to", "held_by", "employs"}
            and (
                (edge["source"] == company_key and edge["target"] in selected_subjects)
                or (edge["target"] == company_key and edge["source"] in selected_subjects)
            )
        ]

        historical_association_edges = [
            edge for edge in all_edges
            if edge["relation_code"] == "evolves_to"
            and edge["source"] in visible_events and edge["target"] in visible_events
        ]
        forward_evolution_edges = []
        forward_sources = set(visible_events)
        scenario_keys: set[str] = set()
        while forward_sources:
            batch = [
                edge for edge in all_edges
                if edge["relation_code"] == "may_evolve_to"
                and edge["source"] in forward_sources
                and edge["target"] not in scenario_keys
            ]
            if not batch:
                break
            forward_evolution_edges.extend(batch)
            forward_sources = {edge["target"] for edge in batch}
            scenario_keys.update(forward_sources)
        topic_edges = [
            edge for edge in all_edges
            if edge["relation_code"] == "instance_of_topic" and edge["source"] in visible_events
        ]
        topic_keys = {edge["target"] for edge in topic_edges}
        direct_risk_edges = [
            edge for edge in all_edges
            if edge["relation_code"] == "event_transmits_risk" and edge["source"] in visible_events
        ]
        scenario_indicator_edges = [
            edge for edge in all_edges
            if edge["relation_code"] == "scenario_maps_to_indicator"
            and edge["source"] in scenario_keys
        ]
        indicator_keys = {
            *[edge["target"] for edge in direct_risk_edges],
            *[edge["target"] for edge in scenario_indicator_edges],
        }
        topic_indicator_edges = [
            edge for edge in all_edges
            if edge["relation_code"] == "maps_to_indicator"
            and edge["source"] in topic_keys and edge["target"] in indicator_keys
        ]
        category_edges = [
            edge for edge in all_edges
            if edge["relation_code"] == "belongs_to_risk_category" and edge["source"] in indicator_keys
        ]
        category_keys = {edge["target"] for edge in category_edges}
        category_company_edges = []
        for category_key in sorted(category_keys):
            supporting_edges = [
                edge for edge in category_edges if edge["target"] == category_key
            ]
            confidences = [
                float(edge["confidence"])
                for edge in supporting_edges
                if edge.get("confidence") is not None
            ]
            edge_id = f"projection:risk-category-company:{category_key}:{company_key}"
            category_company_edges.append({
                "id": edge_id,
                "source": category_key,
                "target": company_key,
                "relation": "汇总至企业主体",
                "relation_code": "risk_category_impacts_company",
                "confidence": max(confidences) if confidences else None,
                "needs_review": False,
                "attributes": {
                    "chain_projection": True,
                    "projection_basis": "一级风险类别汇总已验证的二级风险指标",
                    "supporting_indicator_count": len(supporting_edges),
                },
            })
        evidence_edges = [
            edge for edge in all_edges
            if edge["relation_code"] == "supports_event" and edge["target"] in visible_events
        ]
        evidence_keys = {edge["source"] for edge in evidence_edges}

        selected_keys = {
            company_key, *selected_subjects, *visible_events, *topic_keys, *indicator_keys,
            *category_keys, *evidence_keys, *scenario_keys,
        }
        selected_edges = [
            *impact_edges, *event_argument_edges,
            *forward_evolution_edges, *topic_edges,
            *topic_indicator_edges, *scenario_indicator_edges, *category_edges,
            *category_company_edges, *evidence_edges,
        ]
        selected_nodes = [nodes_by_id[key] for key in selected_keys if key in nodes_by_id]
        for node in selected_nodes:
            if node["id"] in category_keys:
                node["attributes"]["supporting_indicator_count"] = sum(
                    edge["target"] == node["id"] for edge in category_edges
                )
            if node["id"] in subject_weights:
                node["attributes"]["transmission_weight"] = subject_weights[node["id"]]
            if node["id"] in visible_events:
                matching = next((edge for edge in event_company_edges if edge["source"] == node["id"]), None)
                if matching:
                    node["attributes"]["impact_weight"] = matching["attributes"].get("impact_weight")

        category_labels = sorted(
            {nodes_by_id[key]["label"] for key in category_keys if key in nodes_by_id},
            key=lambda value: value,
        )
        scenario_nodes = sorted(
            (nodes_by_id[key] for key in scenario_keys if key in nodes_by_id),
            key=lambda node: -float(node["attributes"].get("probability") or 0),
        )
        scenario_summary = "、".join(node["label"] for node in scenario_nodes[:3]) or "暂无满足条件的升级场景"
        analysis_text = (
            f"结论：当前阈值下识别出{len(visible_events)}个已发生风险事件和"
            f"{len(forward_evolution_edges)}条条件化前向演化关系，风险结果主要涉及"
            f"{'、'.join(category_labels) or '尚未形成明确类别聚集'}。"
            f"建议优先跟踪“{scenario_summary}”等高概率场景的触发条件；这些场景属于条件推演，不表示已经发生。"
        )
        return {
            "company_key": company_key,
            "view": "fee_transmission",
            "snapshot_run_id": graph["snapshot_run_id"],
            "nodes": selected_nodes,
            "edges": selected_edges,
            "warning_scores": graph["warning_scores"],
            "min_weight": min_weight,
            "subject_count": len(selected_subjects),
            "event_count": len(visible_events),
            "topic_count": len(topic_keys),
            "indicator_count": len(indicator_keys),
            "evolution_count": len(forward_evolution_edges),
            "future_scenario_count": len(scenario_keys),
            "historical_association_count": len(historical_association_edges),
            "analysis_text": analysis_text,
            "hidden_low_impact_count": max(0, len(subject_weights) - len(selected_subjects)),
            "truncated": graph["truncated"],
            "missing": [] if impact_edges else ["当前阈值下没有满足条件的外部风险主体"],
        }

    def subject_panorama(self, company_key: str, limit: int, min_weight: float) -> dict:
        """Return important subjects plus only their own verified event paths.

        Cambricon's own ``risk_event`` nodes and ``subject_impacts_event``
        relationships are intentionally excluded from this projection.
        """
        graph = self.fee_kbg(company_key, limit)
        nodes_by_id = {node["id"]: node for node in graph["nodes"]}
        all_edges = graph["edges"]
        influence_edges = [
            edge for edge in all_edges
            if edge["relation_code"] == "subject_influences_company"
            and float(edge["attributes"].get("influence_weight") or 0) >= min_weight
        ]
        selected_subjects = {edge["source"] for edge in influence_edges}
        influence_by_subject = {edge["source"]: edge for edge in influence_edges}
        structural_relations = {
            "procures_from", "sells_to", "held_by", "employs", "invests_in_entity",
            "restricted_by", "financed_by", "litigates_in", "inquired_by",
        }
        structural_edges = [
            edge for edge in all_edges
            if edge["relation_code"] in structural_relations
            and (
                (edge["source"] == company_key and edge["target"] in selected_subjects)
                or (edge["target"] == company_key and edge["source"] in selected_subjects)
            )
        ]
        terminal_edges = [
            edge for edge in all_edges
            if edge["relation_code"] == "external_risk_transmits_to_company"
            and edge["attributes"].get("via_subject_key") in selected_subjects
            and not edge["needs_review"]
            and float(edge["attributes"].get("path_weight") or 0) >= min_weight
        ]
        path_keys = {str(edge["attributes"].get("external_path_key") or "") for edge in terminal_edges}
        path_keys.discard("")
        path_edges = [
            edge for edge in all_edges
            if str(edge["attributes"].get("external_path_key") or "") in path_keys
            and edge["relation_code"] != "subject_influences_company"
        ]
        indicator_keys = {
            edge["target"] for edge in path_edges
            if edge["relation_code"] == "external_risk_maps_to_indicator"
        }
        category_edges = [
            edge for edge in all_edges
            if edge["relation_code"] == "belongs_to_risk_category" and edge["source"] in indicator_keys
        ]
        category_keys = {edge["target"] for edge in category_edges}
        path_node_keys = {
            key for edge in path_edges for key in (edge["source"], edge["target"])
        }
        selected_keys = {
            company_key, *selected_subjects, *path_node_keys, *category_keys,
        }
        selected_edges = [
            *structural_edges, *influence_edges, *path_edges, *category_edges,
        ]
        selected_nodes = [nodes_by_id[key] for key in selected_keys if key in nodes_by_id]
        for node in selected_nodes:
            influence = influence_by_subject.get(node["id"])
            if influence:
                attrs = influence["attributes"]
                node["attributes"]["panorama_weight"] = attrs.get("influence_weight")
                node["attributes"]["subject_category"] = attrs.get("subject_category")
                node["attributes"]["risk_status"] = attrs.get("risk_status")
                node["attributes"]["panorama_status"] = "待核验" if node["needs_review"] else "已确认"
        risk_subjects = {
            str(edge["attributes"].get("via_subject_key")) for edge in terminal_edges
            if edge["attributes"].get("via_subject_key")
        }
        visible_events = {
            node["id"] for node in selected_nodes if node["type"] == "external_risk_event"
        }
        evolution_edges = [edge for edge in path_edges if edge["relation_code"] == "external_event_evolves_to"]
        subject_category_counts: dict[str, int] = {}
        for edge in influence_edges:
            category = str(edge["attributes"].get("subject_category") or "其他主体")
            subject_category_counts[category] = subject_category_counts.get(category, 0) + 1
        category_summary = "、".join(
            f"{name}{count}个" for name, count in sorted(subject_category_counts.items())
        )
        risk_subject_labels = [
            nodes_by_id[key]["label"] for key in sorted(risk_subjects)
            if key in nodes_by_id
        ]
        analysis_text = (
            f"结论：当前阈值下共有{len(selected_subjects)}个重要外部主体（{category_summary}），"
            f"其中{len(risk_subjects)}个主体形成了{len(path_keys)}条已核验风险传导路径。"
            f"建议优先跟踪{'、'.join(risk_subject_labels) or '尚未出现已核验外部事件的主体'}，"
            "并结合采购、客户、持股和任职等基础关系持续核验风险是否沿关系链向寒武纪传导。"
        )
        return {
            "company_key": company_key,
            "view": "subject_panorama",
            "snapshot_run_id": graph["snapshot_run_id"],
            "nodes": selected_nodes,
            "edges": selected_edges,
            "min_weight": min_weight,
            "subject_count": len(selected_subjects),
            "risk_subject_count": len(risk_subjects),
            "neutral_subject_count": len(selected_subjects - risk_subjects),
            "candidate_subject_count": sum(nodes_by_id[key]["needs_review"] for key in selected_subjects if key in nodes_by_id),
            "event_count": len(visible_events),
            "transmission_path_count": len(path_keys),
            "indicator_count": len(indicator_keys),
            "evolution_count": len(evolution_edges),
            "internal_company_event_count": 0,
            "structural_relation_count": len(structural_edges),
            "analysis_text": analysis_text,
            "missing": [] if selected_subjects else ["当前阈值下没有重要外部主体"],
            "truncated": graph["truncated"],
        }

    def risk_chains(self, company_key: str, limit: int) -> dict:
        """Return only evidence-grounded enterprise-to-enterprise risk paths.

        A chain is emitted only when the database provides all four semantic
        parts: a supplier/customer/related enterprise, a structured risk event
        on that entity, an evidence-based association to the target enterprise,
        and a target-company second-level risk indicator.  The writer never
        fabricates a partner, event, or transmission edge merely to make the
        visual denser.
        """
        root_rows = self._run(
            "MATCH (n:RiskNode:Enterprise {node_key: $company_key}) WHERE n.in_snapshot = true RETURN n",
            company_key=company_key,
        )
        if not root_rows:
            raise LookupError("未找到当前快照中的企业")
        root = self._node(root_rows[0]["n"])

        anchor_rows = self._run(
            """
            MATCH (root:RiskNode:Enterprise {node_key: $company_key})-[rel]-(indicator:RiskNode)
            WHERE root.in_snapshot = true AND rel.in_snapshot = true AND indicator.in_snapshot = true
              AND indicator.attributes_json CONTAINS '"schema_indicator"'
            RETURN indicator
            """,
            company_key=company_key,
        )
        indicators: dict[str, dict] = {}
        for row in anchor_rows:
            item = self._node(row["indicator"])
            name = str(item["attributes"].get("schema_indicator") or item["label"])
            item["attributes"]["chain_role"] = "secondary_indicator"
            indicators[name] = item

        partner_rows = self._run(
            """
            MATCH (root:RiskNode:Enterprise {node_key: $company_key})-[rel]-(partner:RiskNode)
            WHERE root.in_snapshot = true AND rel.in_snapshot = true AND partner.in_snapshot = true
              AND partner.node_type IN $partner_types
              AND rel.relation_type IN $partner_relations
            RETURN partner, rel
            ORDER BY partner.canonical_name
            LIMIT $limit
            """,
            company_key=company_key,
            partner_types=sorted(CHAIN_PARTNER_TYPES),
            partner_relations=sorted(CHAIN_PARTNER_RELATIONS),
            limit=limit,
        )

        nodes: dict[str, dict] = {root["id"]: root}
        edges: dict[str, dict] = {}
        chain_count = 0
        event_count = 0
        partner_count = 0
        seen_event_ids: set[str] = set()
        for partner_row in partner_rows:
            partner = self._node(partner_row["partner"])
            partner_relation = self._edge(partner_row["rel"])
            role = CHAIN_PARTNER_RELATIONS.get(partner_relation["relation_code"], "related")
            partner["attributes"]["chain_role"] = role
            partner_events = self._run(
                """
                MATCH (partner:RiskNode {node_key: $partner_key})-[event_rel]-(event:RiskNode)
                WHERE partner.in_snapshot = true AND event.in_snapshot = true AND event_rel.in_snapshot = true
                  AND event.node_type IN $event_types
                  AND NOT event.attributes_json CONTAINS '"schema_indicator"'
                RETURN event, event_rel
                ORDER BY event.canonical_name
                LIMIT $limit
                """,
                partner_key=partner["id"],
                event_types=sorted(CHAIN_EVENT_TYPES),
                limit=limit,
            )
            for event_row in partner_events:
                event = self._node(event_row["event"])
                event_relation = self._edge(event_row["event_rel"])
                names = self._event_indicator_names(event)
                mapped = [indicators[name] for name in names if name in indicators]
                if not mapped:
                    continue
                if partner["id"] not in nodes:
                    nodes[partner["id"]] = partner
                    partner_count += 1
                event["attributes"]["chain_role"] = "risk_event"
                nodes[event["id"]] = event
                if event["id"] not in seen_event_ids:
                    event_count += 1
                    seen_event_ids.add(event["id"])
                partner_event_key = f"chain:partner-event:{partner['id']}:{event['id']}"
                edges[partner_event_key] = {
                    "id": partner_event_key,
                    "source": partner["id"],
                    "target": event["id"],
                    "relation": "发生风险",
                    "relation_code": "risk_event_at_entity",
                    "confidence": min(partner_relation["confidence"] or 1.0, event_relation["confidence"] or 1.0),
                    "needs_review": bool(partner_relation["needs_review"] or event_relation["needs_review"]),
                    "attributes": {
                        "chain_projection": True,
                        "partner_relation": partner_relation["relation"],
                        "event_relation": event_relation["relation"],
                    },
                }
                transmission_key = f"chain:transmission:{event['id']}:{partner['id']}:{root['id']}"
                edges[transmission_key] = {
                    "id": transmission_key,
                    "source": event["id"],
                    "target": root["id"],
                    "relation": "风险传导至",
                    "relation_code": "risk_transmission",
                    "confidence": min(partner_relation["confidence"] or 1.0, event_relation["confidence"] or 1.0),
                    "needs_review": bool(partner_relation["needs_review"] or event_relation["needs_review"]),
                    "attributes": {
                        "chain_projection": True,
                        "basis": f"{partner_relation['relation']} · {event_relation['relation']}",
                        "partner_key": partner["id"],
                    },
                }
                for indicator in mapped:
                    nodes[indicator["id"]] = indicator
                    conclusion_key = f"chain:conclusion:{root['id']}:{indicator['id']}"
                    edges[conclusion_key] = {
                        "id": conclusion_key,
                        "source": root["id"],
                        "target": indicator["id"],
                        "relation": "归结于",
                        "relation_code": "concludes_to_indicator",
                        "confidence": event["confidence"],
                        "needs_review": bool(event["needs_review"]),
                        "attributes": {"chain_projection": True, "event_key": event["id"]},
                    }
                    chain_count += 1

        missing: list[str] = []
        if not partner_rows:
            missing.append("尚未入图上游、下游或关联企业关系")
        elif not partner_count:
            missing.append("已发现企业关系，但关联企业尚未入图可归属的结构化风险事件")
        elif not chain_count:
            missing.append("已发现事件，但事件未携带可映射的二级风险指标")
        return {
            "company_key": company_key,
            "view": "risk_chain",
            "nodes": list(nodes.values()),
            "edges": list(edges.values()),
            "chain_count": chain_count,
            "partner_count": partner_count,
            "event_count": event_count,
            "missing": missing,
            "truncated": len(partner_rows) >= limit,
        }

    def event_transmission(self, company_key: str, limit: int) -> dict:
        """Return event-centred, evidence-grounded risk transmission paths.

        This view works when a real event is connected to the target enterprise
        through a regulator, court, person, supplier, list or other actor. It
        exposes the actor, event, target enterprise and the second-level risk
        indicator mapped by the event's original evidence. Enterprise-to-
        enterprise transmission is therefore optional, never fabricated.
        """
        root_rows = self._run(
            "MATCH (n:RiskNode:Enterprise {node_key: $company_key}) WHERE n.in_snapshot = true RETURN n",
            company_key=company_key,
        )
        if not root_rows:
            raise LookupError("未找到当前快照中的企业")
        root = self._node(root_rows[0]["n"])
        indicator_rows = self._run(
            """
            MATCH (root:RiskNode:Enterprise {node_key: $company_key})-[root_rel]-(event:RiskNode)
            WHERE root.in_snapshot = true AND root_rel.in_snapshot = true AND event.in_snapshot = true
              AND event.node_type IN $event_types
              AND root_rel.relation_type IN ['participates_in','occurs','inquired_by','litigates_in','penalized_by']
            MATCH (event)-[topic_rel]->(topic:RiskNode)-[map_rel]->(indicator:RiskNode)
            WHERE topic_rel.in_snapshot = true AND map_rel.in_snapshot = true AND indicator.in_snapshot = true
              AND topic_rel.relation_type = 'instance_of_topic'
              AND map_rel.relation_type = 'maps_to_indicator'
            RETURN DISTINCT indicator
            """,
            company_key=company_key,
            event_types=sorted(CHAIN_EVENT_TYPES),
        )
        indicators: dict[str, dict] = {}
        for row in indicator_rows:
            item = self._node(row["indicator"])
            indicators[str(item["attributes"].get("schema_indicator") or item["label"])] = item
        event_rows = self._run(
            """
            MATCH (root:RiskNode:Enterprise {node_key: $company_key})-[root_rel]-(event:RiskNode)
            WHERE root.in_snapshot = true AND root_rel.in_snapshot = true AND event.in_snapshot = true
              AND event.node_type IN $event_types
              AND root_rel.relation_type IN ['participates_in','occurs','inquired_by','litigates_in','penalized_by']
              AND NOT event.attributes_json CONTAINS '"schema_indicator"'
            RETURN root, root_rel, event
            ORDER BY coalesce(event.confidence, 0) DESC, event.canonical_name
            LIMIT $limit
            """,
            company_key=company_key,
            event_types=sorted(CHAIN_EVENT_TYPES),
            limit=limit,
        )
        nodes: dict[str, dict] = {root["id"]: root}
        edges: dict[str, dict] = {}
        event_count = actor_count = indicator_count = 0
        for row in event_rows:
            event = self._node(row["event"])
            root_relation = self._edge(row["root_rel"])
            event["attributes"]["chain_role"] = "risk_event"
            event["attributes"]["evidence_count"] = len(event["attributes"].get("evidence_titles", []))
            event["attributes"]["source_count"] = len(event["attributes"].get("source_names", []))
            nodes[event["id"]] = event
            event_count += 1

            # Document/source titles remain evidence nodes rather than being
            # mistaken for events. They make every displayed event traceable.
            evidence_names = list(dict.fromkeys([
                *event["attributes"].get("evidence_titles", []),
                *event["attributes"].get("source_names", []),
            ]))[:2]
            for evidence_name in evidence_names:
                source_key = f"event-chain:source:{event['id']}:{evidence_name}"
                nodes[source_key] = {
                    "id": source_key, "label": evidence_name,
                    "type": "evidence_source", "type_label": "证据开源",
                    "confidence": event["confidence"], "needs_review": False,
                    "attributes": {
                        "chain_role": "evidence_source", "synthetic": True,
                        "source_for": event["label"], "source_type": "事件证据来源",
                    },
                }
                source_edge = f"event-chain:source-edge:{event['id']}:{evidence_name}"
                edges[source_edge] = {
                    "id": source_edge, "source": source_key, "target": event["id"],
                    "relation": "提供证据", "relation_code": "evidence_supports_event",
                    "confidence": event["confidence"], "needs_review": False,
                    "attributes": {"chain_projection": True},
                }
            root_key = f"event-chain:to-company:{event['id']}"
            edges[root_key] = {
                "id": root_key, "source": event["id"], "target": root["id"],
                "relation": "影响企业", "relation_code": "event_impacts_company",
                "confidence": root_relation["confidence"], "needs_review": root_relation["needs_review"],
                "attributes": {"chain_projection": True, "basis": root_relation["relation"]},
            }
            actor_rows = self._run(
                """
                MATCH (event:RiskNode {node_key: $event_key})-[rel]-(actor:RiskNode)
                WHERE event.in_snapshot = true AND rel.in_snapshot = true AND actor.in_snapshot = true
                  AND actor.node_key <> $company_key
                  AND actor.node_type IN $actor_types
                RETURN actor, rel
                ORDER BY actor.node_type, actor.canonical_name
                LIMIT 8
                """,
                event_key=event["id"], company_key=company_key,
                actor_types=["regulator","regulatory_agency","court","person","supplier","person_group","internal_factor","associated_company","related_entity","financial_institution","country_region"],
            )
            for actor_row in actor_rows:
                actor = self._node(actor_row["actor"])
                relation = self._edge(actor_row["rel"])
                actor["attributes"]["chain_role"] = "event_actor"
                nodes[actor["id"]] = actor
                actor_count += 1
                actor_key = f"event-chain:actor:{actor['id']}:{event['id']}"
                edges[actor_key] = {
                    "id": actor_key, "source": actor["id"], "target": event["id"],
                    "relation": relation["relation"], "relation_code": "actor_linked_event",
                    "confidence": relation["confidence"], "needs_review": relation["needs_review"],
                    "attributes": {"chain_projection": True, "basis": relation["relation"], **relation["attributes"]},
                }
            for name in self._event_indicator_names(event):
                indicator = indicators.get(name)
                if not indicator:
                    continue
                indicator["attributes"]["chain_role"] = "secondary_indicator"
                nodes[indicator["id"]] = indicator
                indicator_count += 1
                indicator_key = f"event-chain:indicator:{root['id']}:{indicator['id']}:{event['id']}"
                indicator_id = str(indicator["attributes"].get("indicator_id") or "")
                mapping = (
                    "原始事件映射"
                    if indicator_id in set(event["attributes"].get("original_indicator_ids") or [])
                    else "事件机制推断"
                )
                edges[indicator_key] = {
                    # This is a projection of the explicit evidence-to-indicator
                    # mapping: the event, rather than the enterprise's generic
                    # taxonomy edge, is the cause that leads to the topic.  It
                    # keeps a risk-transmission view readable when a company has
                    # many events while preserving the original Neo4j edge as
                    # provenance in ``basis``.
                    "id": indicator_key, "source": event["id"], "target": indicator["id"],
                    "relation": "影响指标（原始映射）" if mapping == "原始事件映射" else "影响指标（机制推断）",
                    "relation_code": "event_concludes_to_indicator",
                    "confidence": event["confidence"], "needs_review": event["needs_review"],
                    "attributes": {
                        "chain_projection": True, "event_key": event["id"],
                        "basis": "事件证据映射至二级风险指标",
                        "event_mapping": mapping,
                    },
                }
            evolution = self._event_evolution(event)
            if evolution:
                evolution_key = f"event-chain:evolution:{event['id']}"
                nodes[evolution_key] = {
                    "id": evolution_key, "label": evolution,
                    "type": "future_evolution", "type_label": "可能演化",
                    "confidence": None, "needs_review": False,
                    "attributes": {
                        "chain_role": "future_evolution", "synthetic": True,
                        "predictive": True, "based_on": event["label"],
                    },
                }
                evolution_edge = f"event-chain:evolution-edge:{event['id']}"
                edges[evolution_edge] = {
                    "id": evolution_edge, "source": event["id"], "target": evolution_key,
                    "relation": "可能演化为", "relation_code": "may_evolve_to",
                    "confidence": None, "needs_review": False,
                    "attributes": {"chain_projection": True, "predictive": True},
                }
        missing: list[str] = []
        actor_count = sum(
            node.get("attributes", {}).get("chain_role") == "event_actor"
            for node in nodes.values()
        )
        indicator_count = sum(
            node.get("attributes", {}).get("chain_role") == "secondary_indicator"
            for node in nodes.values()
        )
        if not event_count:
            missing.append("当前企业尚未物化可直接关联的结构化风险事件")
        elif not actor_count:
            missing.append("事件已入图，但尚缺监管机构、法院、供应商、关联主体等外部关联节点")
        elif not indicator_count:
            missing.append("事件已入图，但尚未能映射至当前二级风险指标主题")
        return {
            "company_key": company_key, "view": "event_transmission",
            "nodes": list(nodes.values()), "edges": list(edges.values()),
            "event_count": event_count, "actor_count": actor_count,
            "indicator_count": indicator_count, "missing": missing,
            "truncated": len(event_rows) >= limit,
        }

    @staticmethod
    def _event_indicator_names(event: dict) -> set[str]:
        """Normalize source indicator links stored on a structured fact node."""
        attrs = event.get("attributes") or {}
        values = attrs.get("indicators") or attrs.get("indicator") or []
        if isinstance(values, str):
            values = [values]
        if not isinstance(values, list):
            return set()
        return {str(value).strip() for value in values if str(value).strip()}

    @staticmethod
    def _event_evolution(event: dict) -> str:
        node_type = event.get("type", "")
        legacy = {
            "compliance_event": "后续监管处置或声誉压力扩大",
            "major_technical_event": "技术质量影响向客户与交付扩散",
            "financing_event": "融资条件收紧并传导至现金流",
            "sanctions_event": "供应与合规限制进一步扩大",
            "asset_impairment_event": "减值压力向业绩与融资能力传导",
            "personnel_risk_event": "关联人员风险向治理与经营传导",
            "personnel_mobility": "关键人员流失影响研发与项目交付",
        }.get(node_type, "")
        if legacy:
            return legacy
        attrs = event.get("attributes") or {}
        if attrs.get("risk_direction") == "mitigating":
            return ""
        return {
            "诉讼与仲裁": "司法处置、成本与声誉影响可能延续",
            "关键人员变动": "研发连续性和项目交付可能承压",
            "政策与供应限制": "供应链稳定与合规限制可能扩大",
            "供应链稳定压力": "采购成本和交付风险可能继续传导",
            "融资审核问询": "融资进度、现金流与控制权安排可能受影响",
            "监管问询": "后续监管关注与信息披露压力可能上升",
            "监管处罚与处置": "后续整改和声誉压力可能扩大",
            "资产负面与减值": "利润、现金流与融资能力可能继续承压",
            "研发与募投里程碑受阻": "研发计划与项目交付可能继续延期",
        }.get(str(attrs.get("event_topic") or ""), "")

    def _overview_graph(self, company_key: str, limit: int) -> dict:
        """Get a compact two-hop enterprise risk-transmission neighbourhood.

        The centre is always the enterprise.  First-hop nodes retain the
        audited indicator themes and structured risk events; second-hop nodes
        expose the real institutions, counterparties, suppliers, regions and
        other entities that make a transmission path explainable.  This keeps
        the default view useful for risk analysis without loading the whole
        enterprise neighbourhood into a hairball.
        """
        rows = self._run(
            """
            MATCH (root:RiskNode:Enterprise {node_key: $company_key})
            WHERE root.in_snapshot = true
            CALL {
              WITH root
              MATCH (root)-[rel]-(node:RiskNode)
              WHERE rel.in_snapshot = true AND node.in_snapshot = true
              RETURN rel, node
              ORDER BY
                CASE
                  WHEN node.attributes_json CONTAINS '"schema_indicator"' THEN 0
                  WHEN node.node_type IN ['compliance_event','financing_event','sanctions_event','asset_impairment_event','personnel_risk_event','personnel_mobility','major_technical_event'] THEN 1
                  WHEN node.node_type IN ['regulatory_agency','court','related_entity','financial_institution','country_region','controlled_component','person'] THEN 2
                  ELSE 3
                END,
                node.canonical_name
              LIMIT $limit
            }
            OPTIONAL MATCH (node)-[rel2]-(leaf:RiskNode)
            WHERE leaf.in_snapshot = true
              AND leaf.node_key <> root.node_key
              AND rel2.in_snapshot = true
            RETURN root, rel, node, collect({leaf: leaf, rel2: rel2}) AS second_hop
            """,
            company_key=company_key,
            limit=limit,
        )
        node_map: dict[str, dict] = {}
        edge_map: dict[str, dict] = {}
        for row in rows:
            for node in (row["root"], row["node"]):
                item = self._node(node)
                node_map[item["id"]] = item
            item = self._edge(row["rel"])
            edge_map[item["id"]] = item
            for hop in row["second_hop"] or []:
                leaf = hop.get("leaf")
                rel2 = hop.get("rel2")
                if leaf is None or rel2 is None:
                    continue
                item = self._node(leaf)
                node_map[item["id"]] = item
                item = self._edge(rel2)
                edge_map[item["id"]] = item
        if not node_map:
            # A company with no current anchors still needs to render as an
            # honest isolated node instead of appearing to be absent.
            root_rows = self._run(
                "MATCH (n:RiskNode:Enterprise {node_key: $company_key}) WHERE n.in_snapshot = true RETURN n",
                company_key=company_key,
            )
            if not root_rows:
                raise LookupError("未找到当前快照中的企业")
            item = self._node(root_rows[0]["n"])
            node_map[item["id"]] = item
        return {
            "company_key": company_key,
            "view": "overview",
            "nodes": list(node_map.values()),
            "edges": list(edge_map.values()),
            "analysis_mode": "risk_transmission",
            "truncated": len(rows) >= limit,
        }

    def _focus_graph(self, company_key: str, focus_key: str, limit: int, *, relation_type: str, offset: int) -> dict:
        """Get a complete, paged local 4.1/4.2 neighbourhood.

        The SQL/Neo4j graph remains complete.  ``offset`` and optional
        relationship grouping are only presentation controls: the UI can walk
        each group page by page without losing any underlying entity or edge.
        """
        anchor_rows = self._run(
            """
            MATCH (root:RiskNode:Enterprise {node_key: $company_key})-[root_rel]-(focus:RiskNode {node_key: $focus_key})
            WHERE root.in_snapshot = true AND focus.in_snapshot = true AND root_rel.in_snapshot = true
            RETURN root, focus, root_rel
            """,
            company_key=company_key,
            focus_key=focus_key,
        )
        if not anchor_rows:
            raise LookupError("所选节点不属于当前企业的可用图谱")
        anchor = anchor_rows[0]
        group_rows = self._run(
            """
            MATCH (focus:RiskNode {node_key: $focus_key})-[rel]-(node:RiskNode)
            WHERE focus.in_snapshot = true AND node.in_snapshot = true AND rel.in_snapshot = true
              AND node.node_key <> $company_key
            RETURN rel.relation_type AS code, type(rel) AS fallback, rel.attributes_json AS attributes_json, count(rel) AS count
            ORDER BY count DESC, fallback
            """,
            company_key=company_key,
            focus_key=focus_key,
        )
        grouped: dict[tuple[str, str], dict] = {}
        for row in group_rows:
            try:
                attributes = json.loads(row["attributes_json"] or "{}")
            except json.JSONDecodeError:
                attributes = {}
            code = row["code"] or ""
            label = _relation_label(code, row["fallback"], attributes)
            key = (code, label)
            grouped.setdefault(key, {"code": code, "label": label, "count": 0})["count"] += int(row["count"])
        relation_groups = sorted(grouped.values(), key=lambda group: (-group["count"], group["label"]))
        selected_count = sum(
            group["count"] for group in relation_groups
            if not relation_type or group["code"] == relation_type
        )
        rows = self._run(
            """
            MATCH (focus:RiskNode {node_key: $focus_key})
            CALL {
              WITH focus
              MATCH (focus)-[rel]-(node:RiskNode)
              WHERE node.in_snapshot = true AND rel.in_snapshot = true
                AND node.node_key <> $company_key
                AND ($relation_type = '' OR rel.relation_type = $relation_type)
              RETURN node, rel
              ORDER BY node.node_type, node.canonical_name
              SKIP $offset LIMIT $limit
            }
            OPTIONAL MATCH p=(node)-[rels*1..1]-(leaf:RiskNode)
            WHERE leaf.in_snapshot = true
              AND leaf.node_key <> focus.node_key
              AND ALL(item IN nodes(p) WHERE item.node_key <> $company_key)
              AND ALL(item_rel IN rels WHERE item_rel.in_snapshot = true)
            RETURN node, rel, nodes(p) AS nodes, relationships(p) AS relationships
            """,
            company_key=company_key,
            focus_key=focus_key,
            relation_type=relation_type,
            offset=offset,
            limit=limit,
        )
        node_map: dict[str, dict] = {}
        edge_map: dict[str, dict] = {}
        for node in (anchor["root"], anchor["focus"]):
            item = self._node(node)
            node_map[item["id"]] = item
        root_edge = self._edge(anchor["root_rel"])
        edge_map[root_edge["id"]] = root_edge
        for row in rows:
            for node in (row["node"],):
                item = self._node(node)
                node_map[item["id"]] = item
            # ``rel`` is the direct focus-to-neighbour relationship.  It was
            # previously omitted while collecting only the optional second
            # hop, which left the neighbour visible but visually detached.
            # This is especially damaging for event -> secondary-indicator
            # many-to-many mappings in the focused event view.
            item = self._edge(row["rel"])
            edge_map[item["id"]] = item
            for node in row["nodes"] or []:
                item = self._node(node)
                node_map[item["id"]] = item
            for relation in row["relationships"] or []:
                item = self._edge(relation)
                edge_map[item["id"]] = item
        return {
            "company_key": company_key,
            "focus_key": focus_key,
            "view": "focus",
            "nodes": list(node_map.values()),
            "edges": list(edge_map.values()),
            "relation_groups": relation_groups,
            "selected_relation_type": relation_type,
            "offset": offset,
            "limit": limit,
            "has_more": offset + limit < selected_count,
            "truncated": False,
        }

    def _node(self, node) -> dict:
        props = dict(node)
        try:
            attributes = json.loads(props.get("attributes_json") or "{}")
        except json.JSONDecodeError:
            attributes = {}
        node_type = props.get("node_type", "supplemental_entity")
        label = props.get("canonical_name", "未命名节点")
        if node_type in {"evidence_source", "external_evidence_source"}:
            translated = _evidence_display_label(label)
            if translated != label:
                attributes["original_source_title"] = label
                label = translated
        if node_type in CHAIN_EVENT_TYPES:
            label = EVENT_DISPLAY_ALIASES.get(str(label).lower(), label)
        if props.get("canonical_name") and node_type in CHAIN_EVENT_TYPES:
            event_date = str(attributes.get("event_date") or "").strip()
            if event_date:
                attributes["display_context"] = event_date
            elif attributes.get("event_ids"):
                attributes["display_context"] = f"事件记录 {attributes['event_ids'][0]}"
        return {
            "id": props["node_key"],
            "label": label,
            "type": node_type,
            "type_label": self.display_type.get(node_type, "补充实体"),
            "confidence": props.get("confidence"),
            "needs_review": bool(props.get("needs_review")),
            "snapshot_run_id": props.get("snapshot_run_id", ""),
            "attributes": attributes,
        }

    @staticmethod
    def _edge(relation) -> dict:
        props = dict(relation)
        try:
            attributes = json.loads(props.get("attributes_json") or "{}")
        except json.JSONDecodeError:
            attributes = {}
        return {
            "id": props["edge_key"],
            "source": relation.start_node["node_key"],
            "target": relation.end_node["node_key"],
            "relation": _relation_label(props.get("relation_type", ""), relation.type, attributes),
            "relation_code": props.get("relation_type", ""),
            "confidence": props.get("confidence"),
            "needs_review": bool(props.get("needs_review")),
            "attributes": attributes,
        }


def handler_factory(reader: GraphReader, web_root: Path):
    class RiskGraphHandler(SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(web_root), **kwargs)

        def end_headers(self) -> None:
            # The graph UI is edited independently from the React shell. Prevent
            # embedded frames from keeping an outdated HTML document after a
            # local rebuild or service restart.
            self.send_header("Cache-Control", "no-store, max-age=0")
            self.send_header("Pragma", "no-cache")
            self.send_header("Expires", "0")
            super().end_headers()

        def log_message(self, fmt: str, *args) -> None:
            print(f"[{self.log_date_time_string()}] {self.address_string()} {fmt % args}")

        def do_GET(self) -> None:  # noqa: N802
            parsed = urlparse(self.path)
            if not parsed.path.startswith("/api/"):
                if parsed.path == "/":
                    self.path = "/risk-knowledge-graph.html"
                return super().do_GET()
            query = parse_qs(parsed.query)
            try:
                if parsed.path == "/api/health":
                    return _json_response(self, HTTPStatus.OK, reader.health())
                if parsed.path == "/api/companies":
                    return _json_response(self, HTTPStatus.OK, {"companies": reader.companies()})
                if parsed.path == "/api/graph":
                    key = (query.get("company_key") or [""])[0]
                    if not key:
                        return _json_response(self, HTTPStatus.BAD_REQUEST, {"error": "缺少 company_key"})
                    view = (query.get("view") or ["overview"])[0]
                    if view not in {"overview", "focus"}:
                        return _json_response(self, HTTPStatus.BAD_REQUEST, {"error": "不支持的图谱视图"})
                    focus_key = (query.get("focus_key") or [""])[0]
                    relation_type = (query.get("relation_type") or [""])[0]
                    offset = _bounded_int((query.get("offset") or [""])[0], 0, 0, 100000)
                    default_limit = 48 if view == "overview" else 60
                    limit = _bounded_int((query.get("limit") or [""])[0], default_limit, 1, MAX_GRAPH_LIMIT)
                    return _json_response(
                        self,
                        HTTPStatus.OK,
                        reader.graph(key, limit, view=view, focus_key=focus_key, relation_type=relation_type, offset=offset),
                    )
                if parsed.path == "/api/fee-kbg":
                    key = (query.get("company_key") or [""])[0]
                    if not key:
                        return _json_response(self, HTTPStatus.BAD_REQUEST, {"error": "缺少 company_key"})
                    limit = _bounded_int((query.get("limit") or [""])[0], 300, 1, MAX_GRAPH_LIMIT)
                    return _json_response(self, HTTPStatus.OK, reader.fee_kbg(key, limit))
                if parsed.path == "/api/fee-transmission":
                    key = (query.get("company_key") or [""])[0]
                    if not key:
                        return _json_response(self, HTTPStatus.BAD_REQUEST, {"error": "缺少 company_key"})
                    limit = _bounded_int((query.get("limit") or [""])[0], 300, 1, MAX_GRAPH_LIMIT)
                    min_weight = _bounded_float((query.get("min_weight") or [""])[0], 0.5, 0.35, 0.95)
                    return _json_response(self, HTTPStatus.OK, reader.fee_transmission(key, limit, min_weight))
                if parsed.path == "/api/subject-panorama":
                    key = (query.get("company_key") or [""])[0]
                    if not key:
                        return _json_response(self, HTTPStatus.BAD_REQUEST, {"error": "缺少 company_key"})
                    limit = _bounded_int((query.get("limit") or [""])[0], 500, 1, MAX_GRAPH_LIMIT)
                    min_weight = _bounded_float((query.get("min_weight") or [""])[0], 0.5, 0.35, 0.95)
                    return _json_response(self, HTTPStatus.OK, reader.subject_panorama(key, limit, min_weight))
                if parsed.path == "/api/risk-chains":
                    key = (query.get("company_key") or [""])[0]
                    if not key:
                        return _json_response(self, HTTPStatus.BAD_REQUEST, {"error": "缺少 company_key"})
                    limit = _bounded_int((query.get("limit") or [""])[0], 36, 1, MAX_GRAPH_LIMIT)
                    return _json_response(self, HTTPStatus.OK, reader.risk_chains(key, limit))
                if parsed.path == "/api/event-transmission":
                    key = (query.get("company_key") or [""])[0]
                    if not key:
                        return _json_response(self, HTTPStatus.BAD_REQUEST, {"error": "缺少 company_key"})
                    limit = _bounded_int((query.get("limit") or [""])[0], 24, 1, MAX_GRAPH_LIMIT)
                    return _json_response(self, HTTPStatus.OK, reader.event_transmission(key, limit))
                return _json_response(self, HTTPStatus.NOT_FOUND, {"error": "不存在的 API 路径"})
            except LookupError as exc:
                return _json_response(self, HTTPStatus.NOT_FOUND, {"error": str(exc)})
            except Exception as exc:  # Do not leak credentials or tracebacks to the browser.
                print(f"API error: {exc}")
                return _json_response(self, HTTPStatus.SERVICE_UNAVAILABLE, {"error": "Neo4j 查询失败，请确认服务已启动、密码正确且已完成图谱同步。"})

    return RiskGraphHandler


def main() -> None:
    parser = argparse.ArgumentParser(description="Serve the local Neo4j risk graph API and dynamic UI.")
    parser.add_argument("--host", default="127.0.0.1", help="Loopback-only by default; do not expose Neo4j data on a LAN.")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--web-root", default=str(DEFAULT_WEB_ROOT))
    parser.add_argument("--uri", default=os.getenv("NEO4J_URI", "bolt://localhost:7687"))
    parser.add_argument("--username", default=os.getenv("NEO4J_USERNAME", "neo4j"))
    parser.add_argument("--password", default=os.getenv("NEO4J_PASSWORD", ""))
    parser.add_argument("--database", default=os.getenv("NEO4J_DATABASE", "neo4j"))
    args = parser.parse_args()
    if not args.password:
        raise SystemExit("缺少 Neo4j 密码。请先设置 $env:NEO4J_PASSWORD。")
    web_root = Path(args.web_root)
    if not (web_root / "risk-knowledge-graph.html").is_file():
        raise SystemExit(f"前端文件不存在：{web_root / 'risk-knowledge-graph.html'}")
    reader = GraphReader(args.uri, args.username, args.password, args.database)
    try:
        reader.health()
        server = ThreadingHTTPServer((args.host, args.port), handler_factory(reader, web_root))
        print(f"风险知识图谱已启动：http://{args.host}:{args.port}/")
        print("按 Ctrl+C 停止服务。")
        server.serve_forever()
    finally:
        reader.close()


if __name__ == "__main__":
    main()
