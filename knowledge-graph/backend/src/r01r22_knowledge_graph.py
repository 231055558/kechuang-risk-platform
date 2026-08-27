"""Knowledge-graph projection for the R01--R22 master data contract.

The master SQLite database is the source of truth.  This adapter deliberately
uses only its documented data chain:

``companies -> observations -> sources`` and
``companies -> deep_search_events -> indicator_catalog``.

It never interprets a source document title as a risk event.  Event nodes are
therefore created only from ``deep_search_events``; every event keeps its
indicator id, source URL/channel and confidence in its provenance attributes.
"""

from __future__ import annotations

import json
import re
import sqlite3
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


AGENT_VERSION = "r01r22-1.3.0"
LOW_CONFIDENCE = 0.60
DOCUMENT_TITLE_PATTERN = re.compile(r"(?:年度|半年度|季度)?报告|年报|招股说明书|审计报告", re.IGNORECASE)
NON_EVENT_TITLE_PATTERN = re.compile(
    r"(?:\.pdf\b|\.xlsx\b|\bstructured row\b|第\s*\d+\s*(?:个)?工作表第\s*\d+\s*行|"
    r"财务字段标准化抽取|年报章节/表格抽取|公告标题关键词|\bget_[a-z_]+\b|\bsearch_notice\b|"
    r"Consolidated Screening List|CSV Download|iFinD企业库)",
    re.IGNORECASE,
)
NEGATED_EVENT_PATTERN = re.compile(r"未被.*(?:处罚|监管措施)|不存在.*(?:处罚|诉讼|风险)|无(?:行政)?处罚|未发生", re.IGNORECASE)
GENERIC_LIST_PATTERN = re.compile(r"^(?:Additions and Revisions|Consolidated Screening List)", re.IGNORECASE)
TECHNICAL_EVENT_PREFIX_PATTERN = re.compile(
    r"^(?:judgment_document|tyc_litigation_event|tyc_[a-z_]+|event|notice)\s*:\s*",
    re.IGNORECASE,
)
JSON_LIKE_TITLE_PATTERN = re.compile(r"^\s*\{[\s\S]*\}\s*$")
PLACEHOLDER_EVENT_PATTERN = re.compile(r"^(?:sample|test|demo|unknown|n/?a|未知|未命名|-+)$", re.IGNORECASE)
SEARCH_RESULT_TITLE_PATTERN = re.compile(r"(?:\s*[-—]\s*搜索|搜索结果|检索结果)\s*$", re.IGNORECASE)
WHITESPACE_PATTERN = re.compile(r"\s+")

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

EVENT_NODE_TYPES = {
    "R09": "major_technical_event", "R10": "compliance_event", "R11": "compliance_event",
    "R12": "compliance_event", "R14": "asset_impairment_event", "R15": "financing_event",
    "R19": "sanctions_event", "R21": "personnel_risk_event", "R22": "personnel_mobility",
}

# These are conservative *impact* rules, used only when the event title itself
# explicitly names the underlying mechanism.  The original event mapping is
# always retained as the primary mapping.  This supports the real many-to-many
# relationship: one event can affect several R01--R22 indicators and every
# indicator can be affected by many events.
TITLE_INDICATOR_RULES = (
    (re.compile(r"核心技术人员|核心人员|高级管理人员.*(?:离职|变动)|离职.*(?:核心技术|高管)"), {"R22", "R06", "R08"}),
    (re.compile(r"监管工作函|监管措施|行政处罚|处罚决定|市场禁入"), {"R10", "R11", "R21"}),
    (re.compile(r"问询函|审核问询"), {"R11", "R15"}),
    (re.compile(r"(?:劳动|专利|知识产权|合同|侵权).*(?:诉讼|判决|裁定)|(?:诉讼|判决|裁定)"), {"R12", "R21"}),
    (re.compile(r"出口管制|实体清单|制裁|BIS|OFAC|受管制" , re.IGNORECASE), {"R19", "R17", "R18"}),
    (re.compile(r"募投.*(?:延期|终止|结项)|项目.*(?:延期|终止)|研发.*(?:延期|终止)"), {"R08", "R07", "R16"}),
    (re.compile(r"减值|减记"), {"R14", "R13", "R16"}),
    (re.compile(r"融资|定向增发|发行股票|债券"), {"R15", "R16", "R20"}),
)

MASTER_GRAPH_SCHEMA = """
CREATE TABLE IF NOT EXISTS knowledge_graph_runs (
    run_id TEXT PRIMARY KEY, company_id INTEGER, status TEXT NOT NULL,
    started_at TEXT NOT NULL, finished_at TEXT NOT NULL DEFAULT '',
    node_count INTEGER NOT NULL DEFAULT 0, edge_count INTEGER NOT NULL DEFAULT 0,
    validation_issue_count INTEGER NOT NULL DEFAULT 0, review_count INTEGER NOT NULL DEFAULT 0,
    metadata_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS knowledge_graph_nodes (
    node_key TEXT PRIMARY KEY, node_type TEXT NOT NULL, canonical_name TEXT NOT NULL,
    attributes_json TEXT NOT NULL DEFAULT '{}', confidence REAL NOT NULL DEFAULT 0,
    needs_review INTEGER NOT NULL DEFAULT 0, review_reason TEXT NOT NULL DEFAULT '',
    first_seen_run_id TEXT NOT NULL DEFAULT '', last_seen_run_id TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_knowledge_graph_nodes_type_name ON knowledge_graph_nodes(node_type, canonical_name);
CREATE TABLE IF NOT EXISTS knowledge_graph_edges (
    edge_key TEXT PRIMARY KEY, subject_key TEXT NOT NULL, relation_type TEXT NOT NULL,
    object_key TEXT NOT NULL, attributes_json TEXT NOT NULL DEFAULT '{}',
    confidence REAL NOT NULL DEFAULT 0, needs_review INTEGER NOT NULL DEFAULT 0,
    review_reason TEXT NOT NULL DEFAULT '', source_id INTEGER NOT NULL DEFAULT 0,
    source_evidence_id INTEGER NOT NULL DEFAULT 0, first_seen_run_id TEXT NOT NULL DEFAULT '',
    last_seen_run_id TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    FOREIGN KEY (subject_key) REFERENCES knowledge_graph_nodes(node_key) ON DELETE CASCADE,
    FOREIGN KEY (object_key) REFERENCES knowledge_graph_nodes(node_key) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_knowledge_graph_edges_subject ON knowledge_graph_edges(subject_key);
CREATE INDEX IF NOT EXISTS idx_knowledge_graph_edges_object ON knowledge_graph_edges(object_key);
CREATE TABLE IF NOT EXISTS knowledge_graph_snapshot_nodes (
    run_id TEXT NOT NULL, node_key TEXT NOT NULL, PRIMARY KEY (run_id, node_key),
    FOREIGN KEY (run_id) REFERENCES knowledge_graph_runs(run_id) ON DELETE CASCADE,
    FOREIGN KEY (node_key) REFERENCES knowledge_graph_nodes(node_key) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS knowledge_graph_snapshot_edges (
    run_id TEXT NOT NULL, edge_key TEXT NOT NULL, PRIMARY KEY (run_id, edge_key),
    FOREIGN KEY (run_id) REFERENCES knowledge_graph_runs(run_id) ON DELETE CASCADE,
    FOREIGN KEY (edge_key) REFERENCES knowledge_graph_edges(edge_key) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS knowledge_graph_validation_issues (
    id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, severity TEXT NOT NULL,
    code TEXT NOT NULL, node_key TEXT NOT NULL DEFAULT '', edge_key TEXT NOT NULL DEFAULT '',
    message TEXT NOT NULL, payload_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL,
    FOREIGN KEY (run_id) REFERENCES knowledge_graph_runs(run_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_knowledge_graph_validation_run ON knowledge_graph_validation_issues(run_id, severity);
CREATE INDEX IF NOT EXISTS idx_r01r22_observations_company_indicator ON observations(company_id, indicator_id);
CREATE INDEX IF NOT EXISTS idx_r01r22_events_company_indicator ON deep_search_events(company_id, related_indicator_id);
CREATE TABLE IF NOT EXISTS external_subject_evidence (
    evidence_id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL, event_id INTEGER, event_stable_id TEXT NOT NULL DEFAULT '', source_id INTEGER,
    subject_name TEXT NOT NULL, subject_type TEXT NOT NULL, relation_type TEXT NOT NULL,
    object_name TEXT NOT NULL, event_date TEXT, source_title TEXT NOT NULL,
    source_url TEXT NOT NULL, source_institution TEXT NOT NULL, source_type TEXT NOT NULL,
    publish_date TEXT, evidence_quote TEXT NOT NULL, retrieval_time TEXT NOT NULL,
    confidence_score REAL NOT NULL DEFAULT 0, review_status TEXT NOT NULL DEFAULT '待人工复核',
    duplicate_key TEXT NOT NULL UNIQUE
);
CREATE INDEX IF NOT EXISTS idx_external_subject_company ON external_subject_evidence(company_id, event_id);
"""


@dataclass(frozen=True)
class GraphNode:
    key: str
    node_type: str
    canonical_name: str
    attributes: dict[str, Any]
    confidence: float
    needs_review: bool = False
    review_reason: str = ""


@dataclass(frozen=True)
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


@dataclass(frozen=True)
class ValidationIssue:
    severity: str
    code: str
    message: str
    node_key: str = ""
    edge_key: str = ""
    payload: dict[str, Any] | None = None


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _json(value: Any) -> str:
    return json.dumps(value or {}, ensure_ascii=False, sort_keys=True, default=str)


def _key(prefix: str, *parts: str) -> str:
    return f"{prefix}:{__import__('hashlib').sha256('|'.join(map(str, parts)).encode('utf-8')).hexdigest()[:20]}"


def _node_key(node_type: str, name: str, identifier_type: str = "", identifier_value: str = "") -> str:
    return _key("node", node_type, identifier_type, identifier_value or name)


def _edge_key(subject_key: str, relation_type: str, object_key: str) -> str:
    return _key("edge", subject_key, relation_type, object_key)


def _clamp_confidence(value: Any) -> float:
    try:
        return max(0.0, min(1.0, float(value)))
    except (TypeError, ValueError):
        return LOW_CONFIDENCE


def _company_key(row: sqlite3.Row) -> str:
    return _node_key("company", row["full_name"], "stock_code", row["stock_code"] or str(row["company_id"]))


def _normalize_event_name(title: Any) -> str:
    """Produce a readable, source-neutral event name for graph nodes.

    ``deep_search_events.title`` is also used by the collection pipeline as a
    source-field.  Some historic rows consequently start with crawler labels
    such as ``tyc_litigation_event:``.  Those labels describe the extraction
    method, rather than the risk event, and must not be exposed as an entity
    name.  The unmodified title is retained in event provenance attributes.
    """
    name = WHITESPACE_PATTERN.sub(" ", str(title or "").replace("\u3000", " ")).strip(" \t\r\n-—:：")
    name = TECHNICAL_EVENT_PREFIX_PATTERN.sub("", name).strip()
    english_aliases = {
        "addition of entities to the entity list and revision of an entry on the entity list": "美国实体清单新增或修订事件",
        "additions and revisions to the entity list and conforming removal from the unverified list": "美国实体清单调整事件",
        "additions and revisions to the entity list": "美国实体清单调整事件",
        "entity list additions": "美国实体清单新增事件",
    }
    name = english_aliases.get(name.lower(), name)
    name = re.sub(r"^名单命中\s*[:：]\s*", "受管制/制裁名单命中：", name)
    name = re.sub(r"^美国官方清单(?:精确)?命中\s*[:：]\s*", "美国官方限制清单命中：", name)
    name = re.sub(r"^美国官方清单关联主体候选\s*[:：]\s*", "美国官方限制清单关联主体：", name)
    # Public-disclosure titles often repeat the full issuer name.  The graph
    # already has the issuer as a separate node, so use the actual risk fact
    # as the display name while retaining the original title in provenance.
    if "核心技术人员" in name and re.search(r"离职|离任|辞任|调整|变动|新增认定", name):
        verbs = []
        if re.search(r"离职|离任", name):
            verbs.append("离职/离任")
        if "辞任" in name:
            verbs.append("辞任")
        if re.search(r"调整|变动", name):
            verbs.append("调整/变动")
        if "新增认定" in name:
            verbs.append("新增认定")
        return f"核心技术人员{'、'.join(verbs)}事件"
    if "监管工作函" in name:
        if re.search(r"核心技术人员.*(?:离职|离任|辞任)", name):
            return "监管工作函：核心技术人员离职事项"
        if "关联交易" in name:
            return "监管工作函：关联交易事项"
        if "股东" in name and re.search(r"冻结|质押", name):
            return "监管工作函：股东股份冻结/质押事项"
        return "监管工作函"
    if re.search(r"向特定对象发行.*(?:第二轮)?审核问询函", name):
        return "交易所审核问询：向特定对象发行股票申请"
    if "股票交易异常波动问询函" in name:
        return "股票异常波动问询函回复"
    if re.search(r"行政处罚.*(?:决定书|告知书)|监管警示|通报批评", name):
        return "监管处分/行政处罚事项"
    if "劳动争议" in name:
        return "劳动争议诉讼/仲裁事项"
    if "合同纠纷" in name:
        return "合同纠纷诉讼/仲裁事项"
    if re.search(r"专利|知识产权", name) and re.search(r"纠纷|无效|诉讼|裁定", name):
        return "知识产权争议/法律程序事项"
    if re.search(r"诉讼|仲裁", name) and re.search(r"进展|结果|裁定|判决", name):
        return "诉讼/仲裁进展事项"
    return name


def _event_identity(row: sqlite3.Row, normalized_title: str) -> str:
    """Return a semantic identity when one event has multiple disclosure files.

    An exchange inquiry is normally published twice: the exchange's inquiry
    letter and the issuer's notice that it received the letter.  They are two
    sources for one round of supervision, not two independent risk events.
    Keep the date and explicit round number so successive rounds remain
    distinct.  Other event kinds retain the source URL as their stable ID.
    """
    raw_title = str(row["title"] or "")
    indicator_id = str(row["related_indicator_id"] or "")
    if indicator_id == "R11" and "问询函" in raw_title and "向特定对象发行" in raw_title:
        round_match = re.search(r"第\s*([一二三四五六七八九十0-9]+)\s*轮", raw_title)
        round_label = round_match.group(1) if round_match else "一"
        date = str(row["event_date"] or "")
        return f"inquiry:{normalized_title}:round:{round_label}:date:{date}"
    return str(row["url"] or "").strip() or "|".join(
        (normalized_title, str(row["event_date"] or ""), str(row["event_type"] or ""))
    )


def _display_source_name(value: Any) -> str:
    """Hide local technical storage names from business-facing graph labels."""
    source = WHITESPACE_PATTERN.sub(" ", str(value or "")).strip()
    aliases = {
        "risk_data.sqlite": "历史结构化风险数据链",
        "上交所公司公告/Ego": "上交所公司公告",
        "上海证券交易所": "上海证券交易所公告",
        "国家知识产权局专利检索及分析系统": "国家知识产权局专利检索系统",
    }
    return aliases.get(source, source or "结构化事件数据")


def ensure_master_graph_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(MASTER_GRAPH_SCHEMA)
    conn.commit()


class R01R22KnowledgeGraphAgent:
    def __init__(self, db_path: Path):
        self.db_path = Path(db_path)

    def run(self, *, run_id: str, company: str = "", include_unreviewed: bool = False) -> dict[str, Any]:
        conn = sqlite3.connect(self.db_path, timeout=60)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute("PRAGMA busy_timeout = 60000")
        try:
            ensure_master_graph_schema(conn)
            targets = self._companies(conn, company)
            if not targets:
                raise ValueError("主库中没有企业实体")
            self._start_run(conn, run_id, targets[0]["company_id"] if company else None, company, include_unreviewed)
            nodes: dict[str, GraphNode] = {}
            edges: dict[str, GraphEdge] = {}
            for target in targets:
                company_nodes, company_edges = self._build_company(conn, target, include_unreviewed)
                nodes.update(company_nodes)
                edges.update(company_edges)
            issues = self._validate(nodes, edges)
            self._persist(conn, run_id, nodes, edges, issues)
            conn.commit()
            return {"run_id": run_id, "agent_version": AGENT_VERSION, "company": targets[0]["full_name"] if company else "全部企业", "company_count": len(targets), "companies": [r["full_name"] for r in targets], "node_count": len(nodes), "edge_count": len(edges), "validation_issue_count": len(issues), "review_count": sum(n.needs_review for n in nodes.values()) + sum(e.needs_review for e in edges.values()), "validation_issues": [issue.__dict__ for issue in issues]}
        except Exception as exc:
            self._fail_run(conn, run_id, str(exc))
            conn.commit()
            raise
        finally:
            conn.close()

    def _companies(self, conn: sqlite3.Connection, query: str) -> list[sqlite3.Row]:
        if not query:
            return conn.execute("SELECT * FROM companies ORDER BY stock_code, full_name").fetchall()
        exact = conn.execute("SELECT * FROM companies WHERE full_name=? OR short_name=?", (query, query)).fetchall()
        if exact:
            return exact[:1]
        matches = conn.execute("SELECT * FROM companies WHERE full_name LIKE '%' || ? || '%' OR short_name LIKE '%' || ? || '%' ORDER BY LENGTH(full_name)", (query, query)).fetchall()
        if len(matches) != 1:
            raise ValueError(f"企业未找到或不唯一：{query}")
        return matches

    def _build_company(self, conn: sqlite3.Connection, company: sqlite3.Row, include_unreviewed: bool) -> tuple[dict[str, GraphNode], dict[str, GraphEdge]]:
        nodes: dict[str, GraphNode] = {}
        edges: dict[str, GraphEdge] = {}
        company_key = _company_key(company)
        exchange = _display_source_name(company["exchange"])
        source_database = _display_source_name(company["source_database_id"])
        nodes[company_key] = GraphNode(company_key, "company", company["full_name"], {"company_id": company["company_id"], "stock_code": company["stock_code"], "short_name": company["short_name"], "aliases": company["aliases"], "board": company["board"], "exchange": exchange, "chain_segment": company["chain_segment"], "data_chain_source": source_database, "schema_source": "R01-R22 主库"}, _clamp_confidence(company["confidence_score"]))
        catalog = conn.execute("SELECT * FROM indicator_catalog ORDER BY indicator_id").fetchall()
        summaries = self._observation_summaries(conn, int(company["company_id"]))
        event_counts = {str(r["related_indicator_id"]): int(r["n"]) for r in conn.execute("SELECT related_indicator_id, COUNT(*) n FROM deep_search_events WHERE company_id=? GROUP BY related_indicator_id", (company["company_id"],)) if r["related_indicator_id"]}
        indicator_keys: dict[str, str] = {}
        for item in catalog:
            indicator_id, name = item["indicator_id"], item["secondary_indicator"]
            summary = summaries.get(indicator_id, {})
            if not summary and not event_counts.get(indicator_id):
                continue
            node_type, relation = INDICATOR_GRAPH_MAP.get(name, ("supplemental_entity", "related_to"))
            confidence, needs_review = summary.get("confidence", LOW_CONFIDENCE), bool(summary.get("needs_review", False))
            key = _node_key(node_type, name, "company_indicator", f"{company['company_id']}:{indicator_id}")
            attrs = {"schema_indicator": name, "indicator_id": indicator_id, "primary_category": item["primary_category"], "definition": item["definition"], "calculation_rule": item["calculation_rule"], "update_frequency": item["update_frequency"], "entity_type": item["entity_type"], "schema_source": "R01-R22 主库 / 修改意见.pdf §4.1/4.2", **summary, "event_count": event_counts.get(indicator_id, 0)}
            nodes[key] = GraphNode(key, node_type, name, attrs, confidence, needs_review, "存在低置信度或待复核观测" if needs_review else "")
            edge_key = _edge_key(company_key, relation, key)
            edges[edge_key] = GraphEdge(edge_key, company_key, relation, key, {"schema_indicator": name, "indicator_id": indicator_id, **summary}, confidence, needs_review, "存在低置信度或待复核观测" if needs_review else "")
            indicator_keys[indicator_id] = key
        self._event_nodes(conn, company, company_key, indicator_keys, nodes, edges, include_unreviewed)
        self._external_subject_nodes(conn, company, company_key, nodes, edges, include_unreviewed)
        return nodes, edges

    def _external_subject_nodes(self, conn: sqlite3.Connection, company: sqlite3.Row, company_key: str,
                                nodes: dict[str, GraphNode], edges: dict[str, GraphEdge], include_unreviewed: bool) -> None:
        """Project explicitly evidenced regulators, courts and people.

        Facts are loaded only from the auditable external_subject_evidence table;
        no subject is inferred from a company name or a document filename.
        """
        rows = conn.execute("SELECT * FROM external_subject_evidence WHERE company_id=? ORDER BY evidence_id", (company["company_id"],)).fetchall()
        event_by_id: dict[int, str] = {}
        for key, node in nodes.items():
            for eid in node.attributes.get("event_ids", []):
                event_by_id[int(eid)] = key
        for row in rows:
            conf = _clamp_confidence(row["confidence_score"])
            review = str(row["review_status"] or "") not in {"已确认", "approved", "通过"} or conf < LOW_CONFIDENCE
            if review and not include_unreviewed:
                continue
            subject_type = str(row["subject_type"])
            node_type = {"监管机构": "regulator", "法院": "court", "仲裁机构": "arbitration_body", "人员": "person", "企业": "associated_company"}.get(subject_type, "external_subject")
            subject_key = _node_key(node_type, row["subject_name"], "external_subject", row["subject_name"])
            attrs = {"subject_type": subject_type, "source_title": row["source_title"], "source_url": row["source_url"], "source_institution": row["source_institution"], "source_type": row["source_type"], "publish_date": row["publish_date"], "event_date": row["event_date"], "evidence_quote": row["evidence_quote"], "external_subject_evidence_id": row["evidence_id"]}
            nodes[subject_key] = GraphNode(subject_key, node_type, row["subject_name"], attrs, conf, review, "外部主体证据待人工复核" if review else "")
            event_key = event_by_id.get(int(row["event_id"])) if row["event_id"] else None
            object_key = event_key or company_key
            rel = str(row["relation_type"])
            edge_key = _edge_key(subject_key, rel, object_key)
            edges[edge_key] = GraphEdge(edge_key, subject_key, rel, object_key, attrs, conf, review, "外部主体证据待人工复核" if review else "", int(row["source_id"] or 0) if "source_id" in row.keys() else 0, int(row["evidence_id"]))
            if event_key and object_key != company_key:
                back_rel = {"监管": "监管事件", "问询": "问询事件", "处罚": "处罚事件", "裁判": "裁判", "涉及": "涉及"}.get(rel, "关联事件")
                back_key = _edge_key(company_key, back_rel, event_key)
                edges[back_key] = GraphEdge(back_key, company_key, back_rel, event_key, {"external_subject_evidence_id": row["evidence_id"]}, conf, review, "外部主体证据待人工复核" if review else "", int(row["source_id"] or 0) if "source_id" in row.keys() else 0, int(row["evidence_id"]))

    def _observation_summaries(self, conn: sqlite3.Connection, company_id: int) -> dict[str, dict[str, Any]]:
        rows = conn.execute("SELECT o.*, s.title source_title, s.url source_url, s.institution source_name, s.source_type FROM observations o LEFT JOIN sources s ON s.source_id=o.source_id WHERE o.company_id=? ORDER BY o.indicator_id,o.as_of_date DESC,o.observation_id DESC", (company_id,)).fetchall()
        grouped: dict[str, list[sqlite3.Row]] = defaultdict(list)
        for row in rows: grouped[str(row["indicator_id"])].append(row)
        summaries: dict[str, dict[str, Any]] = {}
        for indicator_id, items in grouped.items():
            approved = [r for r in items if _clamp_confidence(r["confidence_score"]) >= LOW_CONFIDENCE and r["status"] != "legacy_review_pending"]
            usable = approved or items
            coverage: dict[tuple[str,str],dict[str,Any]] = {}
            for row in items:
                k=(str(row["source_type"] or "未标注来源类型"),str(row["source_name"] or row["source_title"] or "未命名来源")); b=coverage.setdefault(k,{"source_type":k[0],"source_name":k[1],"total":0,"approved":0,"review_pending":0}); b["total"]+=1; b["approved" if row in approved else "review_pending"]+=1
            summaries[indicator_id] = {"data_chain_evidence_count":len(items),"approved_evidence_count":len(approved),"review_pending_evidence_count":len(items)-len(approved),"evidence_count":len(usable),"latest_evidence_date":max((str(r["as_of_date"] or "") for r in items),default=""),"evidence_titles":list(dict.fromkeys(str(r["source_title"] or "") for r in usable if r["source_title"]))[:30],"evidence_urls":list(dict.fromkeys(str(r["source_url"] or "") for r in usable if r["source_url"]))[:30],"source_coverage":sorted(coverage.values(),key=lambda x:(-x["total"],x["source_name"])),"confidence":max((_clamp_confidence(r["confidence_score"]) for r in usable),default=LOW_CONFIDENCE),"needs_review":len(approved)<len(items),"observation_metrics":list(dict.fromkeys(str(r["metric_name"]) for r in usable if r["metric_name"]))[:30]}
        return summaries

    def _event_nodes(self, conn: sqlite3.Connection, company: sqlite3.Row, company_key: str, indicator_keys: dict[str,str], nodes: dict[str,GraphNode], edges: dict[str,GraphEdge], include_unreviewed: bool) -> None:
        rows=conn.execute("SELECT * FROM deep_search_events WHERE company_id=? ORDER BY event_date DESC,event_id DESC",(company["company_id"],)).fetchall()
        grouped: dict[tuple[str, str], list[sqlite3.Row]] = defaultdict(list)
        for row in rows:
            indicator_id,raw_title=str(row["related_indicator_id"] or ""),str(row["title"] or "").strip(); node_type=EVENT_NODE_TYPES.get(indicator_id)
            title = _normalize_event_name(raw_title)
            # A source file, query term, raw table row or screening-list name
            # is evidence provenance, not the risk event itself.  Keep those
            # rows in the master data chain but block them from the graph.
            # A Federal Register/BIS notice titled "Additions and Revisions to
            # the Entity List" is itself the dated regulatory action, not a
            # crawler result.  Keep this narrow exception while continuing to
            # suppress generic CSV/list-page provenance rows.
            is_official_entity_list_action = (
                indicator_id == "R19"
                and bool(row["url"])
                and "federalregister.gov" in str(row["url"]).lower()
                and re.search(r"Additions and Revisions.*Entity List", title, re.IGNORECASE)
            )
            if (not node_type or not title or PLACEHOLDER_EVENT_PATTERN.match(title) or SEARCH_RESULT_TITLE_PATTERN.search(title) or JSON_LIKE_TITLE_PATTERN.match(title) or DOCUMENT_TITLE_PATTERN.search(title)
                    or NON_EVENT_TITLE_PATTERN.search(title) or NEGATED_EVENT_PATTERN.search(title)
                    or (GENERIC_LIST_PATTERN.search(title) and not is_official_entity_list_action)):
                continue
            # R21 records are often the *name of an associated entity* rather
            # than an event.  They need an independently identified adverse
            # event before being allowed into the transmission graph.
            if indicator_id == "R21" and not re.search(r"风险|处罚|失信|限高|诉讼|立案|调查|破产|整改", title):
                continue
            confidence=_clamp_confidence(row["confidence_score"]); review=confidence<LOW_CONFIDENCE or str(row["confidence"] or "") in {"低","未知"}
            if review and not include_unreviewed: continue
            # URL is the stable event identifier where available; title plus
            # date/type is the fallback for official events without a URL.
            # Group duplicate extracts by a stable URL when available.  For
            # URL-less records the normalized title is used, so source-system
            # prefixes cannot create duplicate graph events.
            identity = _event_identity(row, title)
            grouped[(node_type, identity)].append(row)
        for (node_type, identity), event_rows in grouped.items():
            exemplar = max(event_rows, key=lambda row: _clamp_confidence(row["confidence_score"]))
            raw_title = str(exemplar["title"] or "").strip()
            title = _normalize_event_name(raw_title)
            event_ids = sorted({int(row["event_id"]) for row in event_rows})
            original_ids = {str(row["related_indicator_id"]) for row in event_rows if row["related_indicator_id"]}
            inferred_ids = set().union(*(indicator_ids for pattern, indicator_ids in TITLE_INDICATOR_RULES if pattern.search(title)))
            indicator_ids = {indicator_id for indicator_id in original_ids | inferred_ids if indicator_id in indicator_keys}
            confidence = max(_clamp_confidence(row["confidence_score"]) for row in event_rows)
            review = any(_clamp_confidence(row["confidence_score"]) < LOW_CONFIDENCE or str(row["confidence"] or "") in {"低", "未知"} for row in event_rows)
            event_key = _node_key(node_type, title, "master_event", identity)
            attrs = {
                "event_ids": event_ids, "event_id": event_ids[0], "event_type": exemplar["event_type"],
                "event_date": exemplar["event_date"], "indicator_ids": sorted(indicator_ids),
                "original_indicator_ids": sorted(original_ids), "inferred_indicator_ids": sorted(inferred_ids - original_ids),
                "indicators": [], "raw_event_titles": list(dict.fromkeys(str(row["title"]) for row in event_rows)),
                "evidence_titles": list(dict.fromkeys(title for _row in event_rows)),
                "evidence_urls": list(dict.fromkeys(str(row["url"]) for row in event_rows if row["url"])),
                "source_names": list(dict.fromkeys(_display_source_name(row["source_channel"]) for row in event_rows if row["source_channel"])),
                "notes": list(dict.fromkeys(str(row["notes"]) for row in event_rows if row["notes"]))[:5],
                "source_database": "R01-R22 主库 / deep_search_events", "event_identity": identity,
            }
            nodes[event_key] = GraphNode(event_key, node_type, title, attrs, confidence, review, "事件含待复核来源" if review else "")
            primary_id = str(exemplar["related_indicator_id"] or "")
            relation = {"R10":"penalized_by", "R11":"inquired_by", "R12":"litigates_in"}.get(primary_id, "occurs")
            key = _edge_key(company_key, relation, event_key)
            edges[key] = GraphEdge(key, company_key, relation, event_key, {"event_ids": event_ids, "indicator_ids": sorted(indicator_ids)}, confidence, review, "", 0, event_ids[0])
            for indicator_id in sorted(indicator_ids):
                indicator_key = indicator_keys[indicator_id]
                mapping_basis = "原始事件映射" if indicator_id in original_ids else "事件标题影响规则"
                key = _edge_key(event_key, "related_to", indicator_key)
                edges[key] = GraphEdge(key, event_key, "related_to", indicator_key, {"indicator_id": indicator_id, "event_ids": event_ids, "event_mapping": mapping_basis}, confidence, review, "", 0, event_ids[0])
                nodes[event_key].attributes["indicators"].append(nodes[indicator_key].canonical_name)

    def _start_run(self,conn:sqlite3.Connection,run_id:str,company_id:int|None,company:str,include_unreviewed:bool)->None:
        now=_now();conn.execute("INSERT INTO knowledge_graph_runs(run_id,company_id,status,started_at,metadata_json,created_at,updated_at) VALUES (?,?,'running',?,?,?,?) ON CONFLICT(run_id) DO UPDATE SET company_id=excluded.company_id,status='running',started_at=excluded.started_at,finished_at='',node_count=0,edge_count=0,validation_issue_count=0,review_count=0,metadata_json=excluded.metadata_json,updated_at=excluded.updated_at",(run_id,company_id,now,_json({"company":company,"include_unreviewed":include_unreviewed,"agent_version":AGENT_VERSION,"data_contract":"R01-R22"}),now,now));conn.execute("DELETE FROM knowledge_graph_snapshot_nodes WHERE run_id=?",(run_id,));conn.execute("DELETE FROM knowledge_graph_snapshot_edges WHERE run_id=?",(run_id,));conn.execute("DELETE FROM knowledge_graph_validation_issues WHERE run_id=?",(run_id,))

    def _validate(self,nodes:dict[str,GraphNode],edges:dict[str,GraphEdge])->list[ValidationIssue]:
        issues=[];refs={e.subject_key for e in edges.values()}|{e.object_key for e in edges.values()}
        for node in nodes.values():
            if node.node_type not in {"company","financial_indicator"} and DOCUMENT_TITLE_PATTERN.search(node.canonical_name): issues.append(ValidationIssue("error","document_title_as_event","文档标题未作为风险事件发布",node.key,payload={"name":node.canonical_name}))
            if node.key not in refs and node.node_type!="company":issues.append(ValidationIssue("warning","isolated_node","节点没有关系",node.key))
        for edge in edges.values():
            if edge.subject_key not in nodes or edge.object_key not in nodes:issues.append(ValidationIssue("error","dangling_edge","关系端点缺失",edge_key=edge.key))
        return issues

    def _persist(self,conn:sqlite3.Connection,run_id:str,nodes:dict[str,GraphNode],edges:dict[str,GraphEdge],issues:list[ValidationIssue])->None:
        now=_now()
        for node in nodes.values():
            conn.execute("INSERT INTO knowledge_graph_nodes(node_key,node_type,canonical_name,attributes_json,confidence,needs_review,review_reason,first_seen_run_id,last_seen_run_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(node_key) DO UPDATE SET node_type=excluded.node_type,canonical_name=excluded.canonical_name,attributes_json=excluded.attributes_json,confidence=excluded.confidence,needs_review=excluded.needs_review,review_reason=excluded.review_reason,last_seen_run_id=excluded.last_seen_run_id,updated_at=excluded.updated_at",(node.key,node.node_type,node.canonical_name,_json(node.attributes),node.confidence,int(node.needs_review),node.review_reason,run_id,run_id,now,now));conn.execute("INSERT OR IGNORE INTO knowledge_graph_snapshot_nodes(run_id,node_key) VALUES (?,?)",(run_id,node.key))
        for edge in edges.values():
            conn.execute("INSERT INTO knowledge_graph_edges(edge_key,subject_key,relation_type,object_key,attributes_json,confidence,needs_review,review_reason,source_id,source_evidence_id,first_seen_run_id,last_seen_run_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(edge_key) DO UPDATE SET attributes_json=excluded.attributes_json,confidence=excluded.confidence,needs_review=excluded.needs_review,review_reason=excluded.review_reason,source_id=excluded.source_id,source_evidence_id=excluded.source_evidence_id,last_seen_run_id=excluded.last_seen_run_id,updated_at=excluded.updated_at",(edge.key,edge.subject_key,edge.relation_type,edge.object_key,_json(edge.attributes),edge.confidence,int(edge.needs_review),edge.review_reason,edge.source_id,edge.source_evidence_id,run_id,run_id,now,now));conn.execute("INSERT OR IGNORE INTO knowledge_graph_snapshot_edges(run_id,edge_key) VALUES (?,?)",(run_id,edge.key))
        for issue in issues:conn.execute("INSERT INTO knowledge_graph_validation_issues(run_id,severity,code,node_key,edge_key,message,payload_json,created_at) VALUES (?,?,?,?,?,?,?,?)",(run_id,issue.severity,issue.code,issue.node_key,issue.edge_key,issue.message,_json(issue.payload),now))
        conn.execute("UPDATE knowledge_graph_runs SET status='completed',finished_at=?,node_count=?,edge_count=?,validation_issue_count=?,review_count=?,updated_at=? WHERE run_id=?",(now,len(nodes),len(edges),len(issues),sum(n.needs_review for n in nodes.values())+sum(e.needs_review for e in edges.values()),now,run_id))

    def _fail_run(self,conn:sqlite3.Connection,run_id:str,error:str)->None:
        now=_now();conn.execute("INSERT INTO knowledge_graph_runs(run_id,company_id,status,started_at,finished_at,metadata_json,created_at,updated_at) VALUES (?,NULL,'failed',?,?,?,?,?) ON CONFLICT(run_id) DO UPDATE SET status='failed',finished_at=excluded.finished_at,metadata_json=excluded.metadata_json,updated_at=excluded.updated_at",(run_id,now,now,_json({"error":error,"agent_version":AGENT_VERSION}),now,now))


def run_r01r22_knowledge_graph_agent(db_path: Path, run_id: str, company: str = "", include_unreviewed: bool = False) -> dict[str, Any]:
    return R01R22KnowledgeGraphAgent(db_path).run(run_id=run_id, company=company, include_unreviewed=include_unreviewed)
