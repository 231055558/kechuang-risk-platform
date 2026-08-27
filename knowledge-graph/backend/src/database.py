import json
import re
import sqlite3
from dataclasses import asdict
from pathlib import Path
from typing import Iterable

from .models import Evidence, EntityRecord, EntityRelation, IndicatorScore, PipelineRun, ReviewFeedback, utc_now_iso
from .evidence_review import apply_auto_review, should_apply_auto_review
from .unified_storage import ensure_unified_storage_schema


CRAWLER_TABLE_MAP = {
    "companies": "crawler_companies",
    "indicators": "crawler_indicators",
    "data_types": "crawler_data_types",
    "indicator_data_requirements": "crawler_indicator_data_requirements",
    "sources": "crawler_sources",
    "evidence": "crawler_evidence",
    "entities": "crawler_entities",
    "entity_relations": "crawler_entity_relations",
    "pipeline_runs": "crawler_pipeline_runs",
    "pipeline_source_runs": "crawler_pipeline_source_runs",
    "review_feedback": "crawler_review_feedback",
    "indicator_scores": "crawler_indicator_scores",
}


def crawler_sql(sql: str) -> str:
    """Map the legacy crawler schema into namespaced tables in the master DB."""
    rewritten = sql
    for source, target in sorted(CRAWLER_TABLE_MAP.items(), key=lambda item: -len(item[0])):
        escaped = re.escape(source)
        rewritten = re.sub(
            rf"(?i)(\bCREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+){escaped}\b",
            rf"\1{target}",
            rewritten,
        )
        rewritten = re.sub(
            rf"(?i)(\bCREATE\s+TABLE\s+){escaped}\b", rf"\1{target}", rewritten
        )
        rewritten = re.sub(
            rf"(?i)(\b(?:FROM|JOIN|INTO|UPDATE|REFERENCES|ALTER\s+TABLE|DELETE\s+FROM)\s+){escaped}\b",
            rf"\1{target}",
            rewritten,
        )
        rewritten = re.sub(
            rf"(?i)(\bON\s+){escaped}(?=\s*\()", rf"\1{target}", rewritten
        )
        rewritten = re.sub(
            rf"(?i)(PRAGMA\s+table_info\s*\(\s*){escaped}(\s*\))",
            rf"\1{target}\2",
            rewritten,
        )
        rewritten = re.sub(rf"(?i)\b{escaped}\.", f"{target}.", rewritten)
        rewritten = re.sub(
            rf"(?i)\bidx_{escaped}", f"idx_{target}", rewritten
        )
    return rewritten


class CrawlerConnection(sqlite3.Connection):
    def execute(self, sql: str, parameters=()):  # type: ignore[override]
        return super().execute(crawler_sql(sql), parameters)

    def executemany(self, sql: str, seq_of_parameters):  # type: ignore[override]
        return super().executemany(crawler_sql(sql), seq_of_parameters)

    def executescript(self, sql_script: str):  # type: ignore[override]
        return super().executescript(crawler_sql(sql_script))


SCHEMA = """
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS companies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    stock_code TEXT,
    credit_code TEXT,
    aliases_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS indicators (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    risk_category TEXT NOT NULL,
    calculation_rule TEXT NOT NULL,
    processing_complexity TEXT NOT NULL,
    availability TEXT NOT NULL,
    review_required INTEGER NOT NULL DEFAULT 0,
    indicator_kind TEXT NOT NULL DEFAULT 'risk',
    weight_policy TEXT NOT NULL DEFAULT 'included_weight_undefined',
    suggested_weight REAL,
    is_red_flag INTEGER NOT NULL DEFAULT 0,
    max_score REAL,
    is_current INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS data_types (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS indicator_data_requirements (
    indicator_id INTEGER NOT NULL,
    data_type_id INTEGER NOT NULL,
    is_required INTEGER NOT NULL DEFAULT 1,
    notes TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (indicator_id, data_type_id),
    FOREIGN KEY (indicator_id) REFERENCES indicators(id) ON DELETE CASCADE,
    FOREIGN KEY (data_type_id) REFERENCES data_types(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_key TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    source_type TEXT NOT NULL,
    reliability TEXT NOT NULL DEFAULT '',
    update_frequency TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS evidence (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL DEFAULT '',
    first_seen_run_id TEXT NOT NULL DEFAULT '',
    last_seen_run_id TEXT NOT NULL DEFAULT '',
    company_id INTEGER NOT NULL,
    indicator_id INTEGER NOT NULL,
    source_id INTEGER NOT NULL,
    publish_date TEXT NOT NULL DEFAULT '',
    fetched_at TEXT NOT NULL DEFAULT '',
    url TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL DEFAULT '',
    snippet TEXT NOT NULL DEFAULT '',
    value_json TEXT,
    confidence REAL NOT NULL DEFAULT 0,
    tags_json TEXT NOT NULL DEFAULT '[]',
    needs_review INTEGER NOT NULL DEFAULT 0,
    review_reason TEXT NOT NULL DEFAULT '',
    raw_json TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
    FOREIGN KEY (indicator_id) REFERENCES indicators(id) ON DELETE CASCADE,
    FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE,
    UNIQUE (content_hash)
);

CREATE INDEX IF NOT EXISTS idx_evidence_company_indicator ON evidence(company_id, indicator_id);
CREATE INDEX IF NOT EXISTS idx_evidence_publish_date ON evidence(publish_date);
CREATE INDEX IF NOT EXISTS idx_evidence_needs_review ON evidence(needs_review);

CREATE TABLE IF NOT EXISTS entities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type TEXT NOT NULL,
    canonical_name TEXT NOT NULL,
    identifier_type TEXT NOT NULL DEFAULT '',
    identifier_value TEXT NOT NULL DEFAULT '',
    aliases_json TEXT NOT NULL DEFAULT '[]',
    attributes_json TEXT NOT NULL DEFAULT '{}',
    confidence REAL NOT NULL DEFAULT 0,
    needs_review INTEGER NOT NULL DEFAULT 0,
    review_reason TEXT NOT NULL DEFAULT '',
    source_id INTEGER NOT NULL,
    source_evidence_id INTEGER NOT NULL DEFAULT 0,
    source_name TEXT NOT NULL DEFAULT '',
    source_type TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE,
    UNIQUE(entity_type, canonical_name, identifier_type, identifier_value)
);

CREATE INDEX IF NOT EXISTS idx_entities_type_name ON entities(entity_type, canonical_name);
CREATE INDEX IF NOT EXISTS idx_entities_review ON entities(needs_review);

CREATE TABLE IF NOT EXISTS entity_relations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subject_type TEXT NOT NULL,
    subject_name TEXT NOT NULL,
    relation_type TEXT NOT NULL,
    object_type TEXT NOT NULL,
    object_name TEXT NOT NULL,
    attributes_json TEXT NOT NULL DEFAULT '{}',
    confidence REAL NOT NULL DEFAULT 0,
    needs_review INTEGER NOT NULL DEFAULT 0,
    review_reason TEXT NOT NULL DEFAULT '',
    source_id INTEGER NOT NULL,
    source_evidence_id INTEGER NOT NULL DEFAULT 0,
    source_name TEXT NOT NULL DEFAULT '',
    source_type TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE,
    UNIQUE(subject_type, subject_name, relation_type, object_type, object_name)
);

CREATE INDEX IF NOT EXISTS idx_entity_relations_subject ON entity_relations(subject_type, subject_name);
CREATE INDEX IF NOT EXISTS idx_entity_relations_object ON entity_relations(object_type, object_name);

CREATE TABLE IF NOT EXISTS pipeline_runs (
    run_id TEXT PRIMARY KEY,
    version TEXT NOT NULL,
    config_path TEXT NOT NULL,
    status TEXT NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT NOT NULL DEFAULT '',
    evidence_count INTEGER NOT NULL DEFAULT 0,
    score_count INTEGER NOT NULL DEFAULT 0,
    review_count INTEGER NOT NULL DEFAULT 0,
    source_count INTEGER NOT NULL DEFAULT 0,
    error_message TEXT NOT NULL DEFAULT '',
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pipeline_source_runs (
    run_id TEXT NOT NULL,
    source_id TEXT NOT NULL,
    source_name TEXT NOT NULL DEFAULT '',
    source_type TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    evidence_count INTEGER NOT NULL DEFAULT 0,
    started_at TEXT NOT NULL DEFAULT '',
    finished_at TEXT NOT NULL DEFAULT '',
    duration_seconds REAL NOT NULL DEFAULT 0,
    error_message TEXT NOT NULL DEFAULT '',
    raw_path TEXT NOT NULL DEFAULT '',
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (run_id, source_id),
    FOREIGN KEY (run_id) REFERENCES pipeline_runs(run_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_pipeline_source_runs_status ON pipeline_source_runs(run_id, status);

CREATE TABLE IF NOT EXISTS review_feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL,
    company TEXT NOT NULL,
    indicator TEXT NOT NULL,
    item_type TEXT NOT NULL,
    item_id TEXT NOT NULL DEFAULT '',
    decision TEXT NOT NULL DEFAULT '',
    reviewer TEXT NOT NULL DEFAULT '',
    comment TEXT NOT NULL DEFAULT '',
    payload_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (run_id) REFERENCES pipeline_runs(run_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS indicator_scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL,
    indicator_id INTEGER NOT NULL,
    run_id TEXT NOT NULL,
    value_json TEXT,
    calculation_json TEXT NOT NULL DEFAULT '{}',
    score REAL,
    level TEXT NOT NULL DEFAULT '',
    evidence_count INTEGER NOT NULL DEFAULT 0,
    needs_review INTEGER NOT NULL DEFAULT 0,
    reason TEXT NOT NULL DEFAULT '',
    calculated_at TEXT NOT NULL,
    raw_json TEXT NOT NULL,
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
    FOREIGN KEY (indicator_id) REFERENCES indicators(id) ON DELETE CASCADE,
    UNIQUE (company_id, indicator_id, run_id)
);

CREATE TABLE IF NOT EXISTS knowledge_graph_runs (
    run_id TEXT PRIMARY KEY,
    company_id INTEGER,
    status TEXT NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT NOT NULL DEFAULT '',
    node_count INTEGER NOT NULL DEFAULT 0,
    edge_count INTEGER NOT NULL DEFAULT 0,
    validation_issue_count INTEGER NOT NULL DEFAULT 0,
    review_count INTEGER NOT NULL DEFAULT 0,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS knowledge_graph_nodes (
    node_key TEXT PRIMARY KEY,
    node_type TEXT NOT NULL,
    canonical_name TEXT NOT NULL,
    attributes_json TEXT NOT NULL DEFAULT '{}',
    confidence REAL NOT NULL DEFAULT 0,
    needs_review INTEGER NOT NULL DEFAULT 0,
    review_reason TEXT NOT NULL DEFAULT '',
    first_seen_run_id TEXT NOT NULL DEFAULT '',
    last_seen_run_id TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_knowledge_graph_nodes_type_name
    ON knowledge_graph_nodes(node_type, canonical_name);

CREATE TABLE IF NOT EXISTS knowledge_graph_edges (
    edge_key TEXT PRIMARY KEY,
    subject_key TEXT NOT NULL,
    relation_type TEXT NOT NULL,
    object_key TEXT NOT NULL,
    attributes_json TEXT NOT NULL DEFAULT '{}',
    confidence REAL NOT NULL DEFAULT 0,
    needs_review INTEGER NOT NULL DEFAULT 0,
    review_reason TEXT NOT NULL DEFAULT '',
    source_id INTEGER NOT NULL DEFAULT 0,
    source_evidence_id INTEGER NOT NULL DEFAULT 0,
    first_seen_run_id TEXT NOT NULL DEFAULT '',
    last_seen_run_id TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (subject_key) REFERENCES knowledge_graph_nodes(node_key) ON DELETE CASCADE,
    FOREIGN KEY (object_key) REFERENCES knowledge_graph_nodes(node_key) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_knowledge_graph_edges_subject ON knowledge_graph_edges(subject_key);
CREATE INDEX IF NOT EXISTS idx_knowledge_graph_edges_object ON knowledge_graph_edges(object_key);

CREATE TABLE IF NOT EXISTS knowledge_graph_snapshot_nodes (
    run_id TEXT NOT NULL,
    node_key TEXT NOT NULL,
    PRIMARY KEY (run_id, node_key),
    FOREIGN KEY (run_id) REFERENCES knowledge_graph_runs(run_id) ON DELETE CASCADE,
    FOREIGN KEY (node_key) REFERENCES knowledge_graph_nodes(node_key) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS knowledge_graph_snapshot_edges (
    run_id TEXT NOT NULL,
    edge_key TEXT NOT NULL,
    PRIMARY KEY (run_id, edge_key),
    FOREIGN KEY (run_id) REFERENCES knowledge_graph_runs(run_id) ON DELETE CASCADE,
    FOREIGN KEY (edge_key) REFERENCES knowledge_graph_edges(edge_key) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS knowledge_graph_validation_issues (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL,
    severity TEXT NOT NULL,
    code TEXT NOT NULL,
    node_key TEXT NOT NULL DEFAULT '',
    edge_key TEXT NOT NULL DEFAULT '',
    message TEXT NOT NULL,
    payload_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    FOREIGN KEY (run_id) REFERENCES knowledge_graph_runs(run_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_knowledge_graph_validation_run
    ON knowledge_graph_validation_issues(run_id, severity);
"""


DATA_TYPE_LABELS = {
    "financial_numeric": ("财务数值", "营收、研发费用、资产、负债、利息支出等结构化财务数据"),
    "market_numeric": ("市场数值", "股价、市值、资本成本等市场数据"),
    "text_news": ("新闻文本", "新闻、媒体报道、舆情文本"),
    "text_investor_qa": ("投资者问答文本", "互动易/E互动等投资者问答"),
    "text_company_disclosure": ("公司披露文本", "公告、年报、招股书、官网披露文本"),
    "text_third_party": ("第三方文本", "研报、媒体、审计、评级等第三方描述"),
    "dictionary_match": ("词典匹配", "关键词、情绪词、夸张性用词等词典型文本特征"),
    "embedding_vector": ("文本向量", "文本相似度、语义召回、段落聚类所需向量"),
    "business_segment": ("业务分部", "主营构成、地区收入、概念相关收入等"),
    "regulatory_event": ("监管事件", "处罚、监管措施、行政决定等事件"),
    "exchange_inquiry_event": ("交易所问询事件", "问询函、关注函、监管函等事件"),
    "company_announcement": ("公司公告", "交易所公告列表、公告PDF、公告摘要"),
    "litigation_event": ("诉讼事件", "法院案件、仲裁、被执行、标的金额"),
    "supplier_data": ("供应商数据", "前五大供应商、采购金额、供应商国家地区"),
    "country_region": ("国家地区", "供应商、客户、收入地区归属"),
    "sanction_list": ("制裁/管制清单", "BIS、OFAC、UVL、欧盟制裁等清单"),
    "controlled_component": ("受管制零部件/技术", "受出口管制影响的核心零部件或技术"),
    "supply_chain": ("供应链数据", "BOM、供应商层级、替代方案"),
    "equity_structure": ("股权结构", "创始人、实控人、董监高持股"),
    "person_profile": ("人员画像", "高管、核心技术人员身份和履历"),
    "related_entity": ("关联实体", "高管关联企业、任职、投资关系"),
    "negative_news": ("负面舆情", "负面新闻、事故报道、客户停运等"),
    "personnel_change": ("人员变动", "离职、变更、核心技术人员流失"),
    "technical_parameter": ("技术性能参数", "核心产品性能指标、测试工况"),
    "peer_benchmark": ("同业基准", "可比企业、行业分位、同赛道样本"),
    "test_condition": ("测试条件", "工况、标准、产品代际口径"),
    "paper_metadata": ("论文元数据", "论文题名、作者、机构、年份、领域"),
    "citation_metric": ("引用指标", "引用次数、领域标准化影响力、高被引"),
    "patent_data": ("专利数据", "专利族、申请、授权、引用、海外布局"),
    "patent_legal_status": ("专利法律状态", "有效、失效、无效、诉讼、许可"),
    "patent_claim_text": ("专利权利要求文本", "权利要求覆盖、保护范围"),
    "product_mapping": ("产品映射", "专利/论文/技术与主营产品对应关系"),
    "technology_evidence": ("技术证据", "样机、中试、客户验证、产品落地证据"),
    "technology_update_event": ("技术更新事件", "版本迭代、新工艺、新产品、新核心成果"),
    "trl_evidence": ("TRL证据", "NASA TRL 1-9 阶段证据"),
    "milestone_event": ("节点事件", "研发、验证、商业化节点兑现情况"),
    "rd_project": ("研发项目", "在研、结题、终止、验收项目"),
    "commercialization_event": ("商业化事件", "中试、量产、持续运营、客户应用"),
    "customer_acceptance": ("客户验收", "客户验收报告、真实运行、试用转正式"),
    "third_party_test": ("第三方测试", "有资质第三方检测、认证、审计"),
    "test_result": ("测试结果", "通过项、失败项、关键测试达标率"),
    "bom_sbom": ("BOM/SBOM", "物料清单、软件物料清单、关键模块"),
    "license_data": ("许可证数据", "外部授权、闭源技术、续期风险"),
    "quality_event": ("质量事件", "故障、召回、返工、停运、数据泄露"),
    "recall_notice": ("召回公告", "市场监管召回、公开召回通知")
}


def connect(db_path: Path) -> sqlite3.Connection:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    # A busy timeout turns transient concurrent writes into a recoverable wait.
    conn = sqlite3.connect(db_path, timeout=30, factory=CrawlerConnection)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA busy_timeout = 30000")
    return conn


def init_db(conn: sqlite3.Connection) -> None:
    conn.executescript(crawler_sql(SCHEMA))
    ensure_unified_storage_schema(conn)
    _migrate_schema(conn)
    conn.commit()


def _migrate_schema(conn: sqlite3.Connection) -> None:
    def execute(sql: str, parameters=()):
        return conn.execute(crawler_sql(sql), parameters)

    columns = {row["name"] for row in execute("PRAGMA table_info(evidence)").fetchall()}
    if "run_id" not in columns:
        execute("ALTER TABLE evidence ADD COLUMN run_id TEXT NOT NULL DEFAULT ''")
    if "first_seen_run_id" not in columns:
        execute("ALTER TABLE evidence ADD COLUMN first_seen_run_id TEXT NOT NULL DEFAULT ''")
    if "last_seen_run_id" not in columns:
        execute("ALTER TABLE evidence ADD COLUMN last_seen_run_id TEXT NOT NULL DEFAULT ''")
    execute("UPDATE evidence SET first_seen_run_id = run_id WHERE first_seen_run_id = ''")
    execute("UPDATE evidence SET last_seen_run_id = run_id WHERE last_seen_run_id = ''")
    execute("CREATE INDEX IF NOT EXISTS idx_evidence_run_id ON evidence(run_id)")
    execute("CREATE INDEX IF NOT EXISTS idx_evidence_first_seen_run_id ON evidence(first_seen_run_id)")
    score_columns = {row["name"] for row in execute("PRAGMA table_info(indicator_scores)").fetchall()}
    if "calculation_json" not in score_columns:
        execute("ALTER TABLE indicator_scores ADD COLUMN calculation_json TEXT NOT NULL DEFAULT '{}'")
    indicator_columns = {row["name"] for row in execute("PRAGMA table_info(indicators)").fetchall()}
    indicator_migrations = {
        "indicator_kind": "TEXT NOT NULL DEFAULT 'risk'",
        "weight_policy": "TEXT NOT NULL DEFAULT 'included_weight_undefined'",
        "suggested_weight": "REAL",
        "is_red_flag": "INTEGER NOT NULL DEFAULT 0",
        "max_score": "REAL",
        "is_current": "INTEGER NOT NULL DEFAULT 1",
    }
    for column, definition in indicator_migrations.items():
        if column not in indicator_columns:
            execute(f"ALTER TABLE indicators ADD COLUMN {column} {definition}")
    source_columns = {row["name"] for row in execute("PRAGMA table_info(pipeline_source_runs)").fetchall()}
    if "source_name" not in source_columns:
        execute("ALTER TABLE pipeline_source_runs ADD COLUMN source_name TEXT NOT NULL DEFAULT ''")
    if "source_type" not in source_columns:
        execute("ALTER TABLE pipeline_source_runs ADD COLUMN source_type TEXT NOT NULL DEFAULT ''")


def _json(value) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True)


def _now() -> str:
    return utc_now_iso()


def _safe_json(value) -> str:
    return json.dumps(value or {}, ensure_ascii=False, sort_keys=True)


def upsert_company(conn: sqlite3.Connection, name: str, stock_code: str = "", credit_code: str = "", aliases=None) -> int:
    if not (name or "").strip():
        raise ValueError("company name is empty")
    aliases = aliases or []
    now = _now()
    conn.execute(
        """
        INSERT INTO companies(name, stock_code, credit_code, aliases_json, created_at, updated_at)
        VALUES(?, ?, ?, ?, ?, ?)
        ON CONFLICT(name) DO UPDATE SET
            stock_code=CASE WHEN excluded.stock_code = '' THEN companies.stock_code ELSE excluded.stock_code END,
            credit_code=CASE WHEN excluded.credit_code = '' THEN companies.credit_code ELSE excluded.credit_code END,
            aliases_json=CASE WHEN excluded.aliases_json = '[]' THEN companies.aliases_json ELSE excluded.aliases_json END,
            updated_at=excluded.updated_at
        """,
        (name, stock_code, credit_code, _json(aliases), now, now),
    )
    return conn.execute("SELECT id FROM companies WHERE name = ?", (name,)).fetchone()["id"]


def upsert_source(conn: sqlite3.Connection, source_key: str, name: str, source_type: str, reliability: str = "", update_frequency: str = "") -> int:
    now = _now()
    conn.execute(
        """
        INSERT INTO sources(source_key, name, source_type, reliability, update_frequency, created_at, updated_at)
        VALUES(?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(source_key) DO UPDATE SET
            name=excluded.name,
            source_type=excluded.source_type,
            reliability=excluded.reliability,
            update_frequency=excluded.update_frequency,
            updated_at=excluded.updated_at
        """,
        (source_key, name, source_type, reliability, update_frequency, now, now),
    )
    return conn.execute("SELECT id FROM sources WHERE source_key = ?", (source_key,)).fetchone()["id"]


def upsert_indicator(conn: sqlite3.Connection, item: dict) -> int:
    now = _now()
    calculation_rule = item.get("calculation_rule") or item.get("definition") or ""
    conn.execute(
        """
        INSERT INTO indicators(
            name, risk_category, calculation_rule, processing_complexity, availability, review_required,
            indicator_kind, weight_policy, suggested_weight, is_red_flag, max_score, is_current,
            created_at, updated_at
        )
        VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(name) DO UPDATE SET
            risk_category=CASE
                WHEN excluded.risk_category IN ('', '未分类') THEN indicators.risk_category
                ELSE excluded.risk_category
            END,
            calculation_rule=CASE
                WHEN excluded.calculation_rule = '' THEN indicators.calculation_rule
                ELSE excluded.calculation_rule
            END,
            processing_complexity=CASE
                WHEN excluded.processing_complexity IN ('', 'unknown') THEN indicators.processing_complexity
                ELSE excluded.processing_complexity
            END,
            availability=CASE
                WHEN excluded.availability IN ('', 'unknown') THEN indicators.availability
                ELSE excluded.availability
            END,
            review_required=CASE
                WHEN excluded.risk_category IN ('', '未分类') AND excluded.calculation_rule = '' THEN indicators.review_required
                WHEN indicators.review_required = 1 THEN 1
                ELSE excluded.review_required
            END,
            indicator_kind=CASE
                WHEN excluded.risk_category IN ('', '未分类') AND excluded.calculation_rule = '' THEN indicators.indicator_kind
                ELSE excluded.indicator_kind
            END,
            weight_policy=CASE
                WHEN excluded.risk_category IN ('', '未分类') AND excluded.calculation_rule = '' THEN indicators.weight_policy
                ELSE excluded.weight_policy
            END,
            suggested_weight=CASE
                WHEN excluded.risk_category IN ('', '未分类') AND excluded.calculation_rule = '' THEN indicators.suggested_weight
                ELSE excluded.suggested_weight
            END,
            is_red_flag=CASE
                WHEN excluded.risk_category IN ('', '未分类') AND excluded.calculation_rule = '' THEN indicators.is_red_flag
                ELSE excluded.is_red_flag
            END,
            max_score=CASE
                WHEN excluded.risk_category IN ('', '未分类') AND excluded.calculation_rule = '' THEN indicators.max_score
                ELSE excluded.max_score
            END,
            is_current=CASE
                WHEN excluded.risk_category IN ('', '未分类') AND excluded.calculation_rule = '' THEN indicators.is_current
                ELSE excluded.is_current
            END,
            updated_at=excluded.updated_at
        """,
        (
            item["indicator"],
            item.get("risk_category", ""),
            calculation_rule,
            item.get("processing_complexity", ""),
            item.get("availability", ""),
            1 if item.get("review_required") else 0,
            item.get("indicator_kind", "risk"),
            item.get("weight_policy", "included_weight_undefined"),
            item.get("suggested_weight"),
            1 if item.get("is_red_flag") else 0,
            item.get("max_score"),
            1 if item.get("is_current", True) else 0,
            now,
            now,
        ),
    )
    return conn.execute("SELECT id FROM indicators WHERE name = ?", (item["indicator"],)).fetchone()["id"]


def upsert_data_type(conn: sqlite3.Connection, code: str) -> int:
    name, description = DATA_TYPE_LABELS.get(code, (code, ""))
    conn.execute(
        """
        INSERT INTO data_types(code, name, description)
        VALUES(?, ?, ?)
        ON CONFLICT(code) DO UPDATE SET
            name=excluded.name,
            description=excluded.description
        """,
        (code, name, description),
    )
    return conn.execute("SELECT id FROM data_types WHERE code = ?", (code,)).fetchone()["id"]


def load_indicator_requirements(conn: sqlite3.Connection, requirements_path: Path) -> None:
    payload = json.loads(requirements_path.read_text(encoding="utf-8-sig"))
    current_items = [
        *payload.get("indicators", []),
        *payload.get("bonus_items", []),
        *payload.get("base_data_items", []),
    ]
    current_names = {item["indicator"] for item in current_items}
    if current_names:
        placeholders = ",".join("?" for _ in current_names)
        conn.execute(f"UPDATE indicators SET is_current = 0 WHERE name NOT IN ({placeholders})", tuple(sorted(current_names)))
    for item in current_items:
        indicator_id = upsert_indicator(conn, item)
        conn.execute("DELETE FROM indicator_data_requirements WHERE indicator_id = ?", (indicator_id,))
        for data_type in item.get("required_data_types", []):
            data_type_id = upsert_data_type(conn, data_type)
            conn.execute(
                """
                INSERT INTO indicator_data_requirements(indicator_id, data_type_id, is_required)
                VALUES(?, ?, 1)
                ON CONFLICT(indicator_id, data_type_id) DO UPDATE SET
                    is_required=excluded.is_required
                """,
                (indicator_id, data_type_id),
            )
    conn.commit()


def evidence_hash(evidence: Evidence, run_id: str = "") -> str:
    import hashlib

    key = {
        "company": evidence.company,
        "indicator": evidence.indicator,
        "source_id": evidence.source_id,
        "publish_date": evidence.publish_date,
        "url": evidence.url,
        "title": evidence.title,
        "value": evidence.value,
    }
    return hashlib.sha256(_json(key).encode("utf-8")).hexdigest()


def insert_evidence(conn: sqlite3.Connection, evidence: Evidence, run_id: str = "") -> int:
    # Apply a schema-aware quality gate only to source types with an explicit
    # deterministic policy.  Free text and PDF-section extracts keep their
    # upstream review status until a specialised extractor is available.
    if evidence.needs_review and should_apply_auto_review(evidence.source_type):
        apply_auto_review(evidence)
    company_id = upsert_company(conn, evidence.company)
    indicator_id = upsert_indicator(
        conn,
        {
            "indicator": evidence.indicator,
            "risk_category": "未分类",
            "calculation_rule": "",
            "processing_complexity": "unknown",
            "availability": "unknown",
            "review_required": evidence.needs_review,
        },
    )
    source_id = upsert_source(conn, evidence.source_id, evidence.source_name, evidence.source_type or "unknown")
    content_hash = evidence_hash(evidence, run_id=run_id)
    now = _now()
    conn.execute(
        """
        INSERT INTO evidence(
            run_id, first_seen_run_id, last_seen_run_id, company_id, indicator_id, source_id, publish_date, fetched_at, url, title,
            snippet, value_json, confidence, tags_json, needs_review, review_reason,
            raw_json, content_hash, created_at, updated_at
        )
        VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(content_hash) DO UPDATE SET
            run_id=excluded.run_id,
            last_seen_run_id=excluded.last_seen_run_id,
            confidence=excluded.confidence,
            tags_json=excluded.tags_json,
            needs_review=excluded.needs_review,
            review_reason=excluded.review_reason,
            raw_json=excluded.raw_json,
            updated_at=excluded.updated_at
        """,
        (
            run_id,
            run_id,
            run_id,
            company_id,
            indicator_id,
            source_id,
            evidence.publish_date,
            evidence.fetched_at,
            evidence.url,
            evidence.title,
            evidence.snippet,
            _json(evidence.value),
            evidence.confidence,
            _json(evidence.tags),
            1 if evidence.needs_review else 0,
            evidence.review_reason,
            _json(asdict(evidence)),
            content_hash,
            now,
            now,
        ),
    )
    return conn.execute("SELECT id FROM evidence WHERE content_hash = ?", (content_hash,)).fetchone()["id"]


def insert_many_evidence(conn: sqlite3.Connection, items: Iterable[Evidence], run_id: str = "") -> int:
    count = 0
    for item in items:
        insert_evidence(conn, item, run_id=run_id)
        count += 1
    conn.commit()
    return count


def insert_score(conn: sqlite3.Connection, score: IndicatorScore, run_id: str) -> int:
    company_id = upsert_company(conn, score.company)
    indicator_id = upsert_indicator(
        conn,
        {
            "indicator": score.indicator,
            "risk_category": "未分类",
            "calculation_rule": "",
            "processing_complexity": "unknown",
            "availability": "unknown",
            "review_required": score.needs_review,
        },
    )
    now = _now()
    conn.execute(
        """
        INSERT INTO indicator_scores(
            company_id, indicator_id, run_id, value_json, calculation_json, score, level, evidence_count,
            needs_review, reason, calculated_at, raw_json
        )
        VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(company_id, indicator_id, run_id) DO UPDATE SET
            value_json=excluded.value_json,
            calculation_json=excluded.calculation_json,
            score=excluded.score,
            level=excluded.level,
            evidence_count=excluded.evidence_count,
            needs_review=excluded.needs_review,
            reason=excluded.reason,
            calculated_at=excluded.calculated_at,
            raw_json=excluded.raw_json
        """,
        (
            company_id,
            indicator_id,
            run_id,
            _json(score.value),
            _json(score.calculation),
            score.score,
            score.level,
            score.evidence_count,
            1 if score.needs_review else 0,
            score.reason,
            now,
            _json(asdict(score)),
        ),
    )
    return conn.execute(
        "SELECT id FROM indicator_scores WHERE company_id = ? AND indicator_id = ? AND run_id = ?",
        (company_id, indicator_id, run_id),
    ).fetchone()["id"]


def upsert_entity(conn: sqlite3.Connection, entity: EntityRecord) -> int:
    source_id = upsert_source(
        conn,
        entity.source_id,
        entity.source_name,
        entity.source_type or "unknown",
    )
    now = _now()
    conn.execute(
        """
        INSERT INTO entities(
            entity_type, canonical_name, identifier_type, identifier_value, aliases_json,
            attributes_json, confidence, needs_review, review_reason, source_id,
            source_evidence_id, source_name, source_type, created_at, updated_at
        )
        VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(entity_type, canonical_name, identifier_type, identifier_value) DO UPDATE SET
            aliases_json=excluded.aliases_json,
            attributes_json=excluded.attributes_json,
            confidence=excluded.confidence,
            needs_review=excluded.needs_review,
            review_reason=excluded.review_reason,
            source_id=excluded.source_id,
            source_evidence_id=excluded.source_evidence_id,
            source_name=excluded.source_name,
            source_type=excluded.source_type,
            updated_at=excluded.updated_at
        """,
        (
            entity.entity_type,
            entity.canonical_name,
            entity.identifier_type,
            entity.identifier_value,
            _json(entity.aliases),
            _safe_json(entity.attributes),
            entity.confidence,
            1 if entity.needs_review else 0,
            entity.review_reason,
            source_id,
            int(entity.source_evidence_id or 0),
            entity.source_name,
            entity.source_type,
            now,
            now,
        ),
    )
    row = conn.execute(
        """
        SELECT id FROM entities
        WHERE entity_type = ? AND canonical_name = ? AND identifier_type = ? AND identifier_value = ?
        """,
        (entity.entity_type, entity.canonical_name, entity.identifier_type, entity.identifier_value),
    ).fetchone()
    return row["id"]


def upsert_relation(conn: sqlite3.Connection, relation: EntityRelation) -> int:
    source_id = upsert_source(
        conn,
        relation.source_id,
        relation.source_name,
        relation.source_type or "unknown",
    )
    now = _now()
    conn.execute(
        """
        INSERT INTO entity_relations(
            subject_type, subject_name, relation_type, object_type, object_name,
            attributes_json, confidence, needs_review, review_reason, source_id,
            source_evidence_id, source_name, source_type, created_at, updated_at
        )
        VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(subject_type, subject_name, relation_type, object_type, object_name) DO UPDATE SET
            attributes_json=excluded.attributes_json,
            confidence=excluded.confidence,
            needs_review=excluded.needs_review,
            review_reason=excluded.review_reason,
            source_id=excluded.source_id,
            source_evidence_id=excluded.source_evidence_id,
            source_name=excluded.source_name,
            source_type=excluded.source_type,
            updated_at=excluded.updated_at
        """,
        (
            relation.subject_type,
            relation.subject_name,
            relation.relation_type,
            relation.object_type,
            relation.object_name,
            _safe_json(relation.attributes),
            relation.confidence,
            1 if relation.needs_review else 0,
            relation.review_reason,
            source_id,
            int(relation.source_evidence_id or 0),
            relation.source_name,
            relation.source_type,
            now,
            now,
        ),
    )
    row = conn.execute(
        """
        SELECT id FROM entity_relations
        WHERE subject_type = ? AND subject_name = ? AND relation_type = ? AND object_type = ? AND object_name = ?
        """,
        (relation.subject_type, relation.subject_name, relation.relation_type, relation.object_type, relation.object_name),
    ).fetchone()
    return row["id"]


def upsert_pipeline_run(conn: sqlite3.Connection, run: PipelineRun) -> str:
    now = _now()
    conn.execute(
        """
        INSERT INTO pipeline_runs(
            run_id, version, config_path, status, started_at, finished_at,
            evidence_count, score_count, review_count, source_count, error_message,
            metadata_json, created_at, updated_at
        )
        VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(run_id) DO UPDATE SET
            version=excluded.version,
            config_path=excluded.config_path,
            status=excluded.status,
            started_at=excluded.started_at,
            finished_at=excluded.finished_at,
            evidence_count=excluded.evidence_count,
            score_count=excluded.score_count,
            review_count=excluded.review_count,
            source_count=excluded.source_count,
            error_message=excluded.error_message,
            metadata_json=excluded.metadata_json,
            updated_at=excluded.updated_at
        """,
        (
            run.run_id,
            run.version,
            run.config_path,
            run.status,
            run.started_at,
            run.finished_at,
            run.evidence_count,
            run.score_count,
            run.review_count,
            run.source_count,
            run.error_message,
            _safe_json(run.metadata),
            now,
            now,
        ),
    )
    return run.run_id


def get_pipeline_source_run(conn: sqlite3.Connection, run_id: str, source_id: str):
    return conn.execute(
        "SELECT * FROM pipeline_source_runs WHERE run_id = ? AND source_id = ?",
        (run_id, source_id),
    ).fetchone()


def upsert_pipeline_source_run(
    conn: sqlite3.Connection,
    run_id: str,
    source_id: str,
    status: str,
    *,
    source_name: str = "",
    source_type: str = "",
    attempt_count: int = 0,
    evidence_count: int = 0,
    started_at: str = "",
    finished_at: str = "",
    duration_seconds: float = 0,
    error_message: str = "",
    raw_path: str = "",
    metadata=None,
) -> None:
    now = _now()
    conn.execute(
        """
        INSERT INTO pipeline_source_runs(
            run_id, source_id, source_name, source_type, status, attempt_count, evidence_count, started_at, finished_at,
            duration_seconds, error_message, raw_path, metadata_json, created_at, updated_at
        )
        VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(run_id, source_id) DO UPDATE SET
            source_name=excluded.source_name, source_type=excluded.source_type,
            status=excluded.status, attempt_count=excluded.attempt_count,
            evidence_count=excluded.evidence_count, started_at=excluded.started_at,
            finished_at=excluded.finished_at, duration_seconds=excluded.duration_seconds,
            error_message=excluded.error_message, raw_path=excluded.raw_path,
            metadata_json=excluded.metadata_json, updated_at=excluded.updated_at
        """,
        (
            run_id, source_id, source_name, source_type, status, attempt_count, evidence_count, started_at, finished_at,
            duration_seconds, error_message, raw_path, _safe_json(metadata), now, now,
        ),
    )
    conn.commit()


def insert_review_feedback(conn: sqlite3.Connection, feedback: ReviewFeedback) -> int:
    now = _now()
    conn.execute(
        """
        INSERT INTO review_feedback(
            run_id, company, indicator, item_type, item_id, decision, reviewer, comment,
            payload_json, created_at, updated_at
        )
        VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            feedback.run_id,
            feedback.company,
            feedback.indicator,
            feedback.item_type,
            feedback.item_id,
            feedback.decision,
            feedback.reviewer,
            feedback.comment,
            _safe_json(feedback.payload),
            now,
            now,
        ),
    )
    return conn.execute("SELECT last_insert_rowid() AS id").fetchone()["id"]
