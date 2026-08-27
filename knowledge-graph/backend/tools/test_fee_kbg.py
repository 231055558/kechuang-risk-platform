from __future__ import annotations

import json
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

from src.fee_kbg import run_cambricon_fee_kbg


FIXTURE_SCHEMA = """
CREATE TABLE companies (
    company_id INTEGER PRIMARY KEY, stock_code TEXT, short_name TEXT, full_name TEXT,
    aliases TEXT, chain_segment TEXT, sse_industry TEXT, exchange TEXT,
    confidence_score REAL
);
CREATE TABLE indicator_catalog (
    indicator_id TEXT PRIMARY KEY, primary_category TEXT, secondary_indicator TEXT,
    definition TEXT, calculation_rule TEXT, update_frequency TEXT
);
CREATE TABLE observations (
    observation_id INTEGER PRIMARY KEY, company_id INTEGER, indicator_id TEXT
);
CREATE TABLE deep_search_events (
    event_id INTEGER PRIMARY KEY, company_id INTEGER, event_type TEXT, event_date TEXT,
    title TEXT, url TEXT, source_channel TEXT, confidence_score REAL,
    related_indicator_id TEXT, notes TEXT
);
CREATE TABLE external_subject_evidence (
    evidence_id INTEGER PRIMARY KEY, company_id INTEGER, event_id INTEGER,
    event_stable_id TEXT, source_id INTEGER, subject_name TEXT, subject_type TEXT,
    relation_type TEXT, object_name TEXT, event_date TEXT, source_title TEXT,
    source_url TEXT, source_institution TEXT, source_type TEXT, publish_date TEXT,
    evidence_quote TEXT, retrieval_time TEXT, confidence_score REAL,
    review_status TEXT, duplicate_key TEXT
);
CREATE TABLE tyc_supplier_profiles (
    profile_id INTEGER PRIMARY KEY, company_id INTEGER, supplier_graph_id TEXT,
    supplier_name TEXT, announcement_date TEXT, purchase_amount TEXT,
    purchase_ratio TEXT, relationship TEXT, profile_error_code TEXT,
    profile_name TEXT, profile_base TEXT, profile_city TEXT,
    profile_reg_location TEXT, domestic_flag INTEGER, source_id INTEGER
);
CREATE TABLE narrative_news_evidence (
    news_id INTEGER PRIMARY KEY, company_id INTEGER, concept_flag INTEGER,
    concept_keywords TEXT
);
CREATE TABLE source_auxiliary_rows (
    auxiliary_row_id INTEGER PRIMARY KEY, source_database_id TEXT, table_name TEXT,
    source_row_key TEXT, row_json TEXT
);
CREATE TABLE indicator_coverage (
    company_id INTEGER, indicator_id TEXT, coverage_status TEXT,
    usable_for_scoring INTEGER
);
"""


class CambriconFEEKBGTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "fee.sqlite"
        conn = sqlite3.connect(self.db_path)
        conn.executescript(FIXTURE_SCHEMA)
        conn.execute(
            "INSERT INTO companies VALUES (8,'688256','寒武纪','中科寒武纪科技股份有限公司',?,?,?,?,?)",
            (
                "CAMBRICON", "数字芯片设计", "信息传输、软件和信息技术服务业",
                "上海证券交易所", 0.98,
            ),
        )
        indicators = [
            ("R07", "技术风险", "研发投入强度与趋势"),
            ("R08", "技术风险", "研发/募投里程碑兑现度"),
            ("R13", "财务融资风险", "营业收入增长率"),
            ("R14", "财务融资风险", "无形资产减值风险"),
            ("R16", "财务融资风险", "经营现金流与短期偿债压力"),
            ("R17", "外部环境风险", "关键供应链进口依赖度"),
            ("R18", "外部环境风险", "海外业务收入占比"),
            ("R19", "外部环境风险", "出口管制与制裁暴露度"),
        ]
        conn.executemany(
            "INSERT INTO indicator_catalog VALUES (?,?,?,?,?,?)",
            [(key, category, name, f"{name}定义", "测试规则", "年度") for key, category, name in indicators],
        )
        events = [
            (
                1, 8, "出口管制与制裁事件", "2022-12-19",
                "Additions and Revisions to the Entity List and Conforming Removal From the Unverified List",
                "https://www.federalregister.gov/documents/test", "BIS", 0.98, "R19", "官方行动",
            ),
            (
                2, 8, "募投结项", "2023-07-19", "关于首次公开发行股票募投项目结项的公告",
                "https://www.sse.com.cn/test/project", "上海证券交易所", 0.92, "R08", "正式公告",
            ),
            (
                3, 8, "供应链稳定风险披露", "2025-08-29", "实体清单引致供应链稳定风险提示",
                "https://www.sse.com.cn/test/supply", "上海证券交易所", 0.9, "R19", "供应链稳定风险",
            ),
            (
                4, 8, "资产减值计提事件", "2026-04-30", "存货战略备货引致资产减值计提",
                "https://www.sse.com.cn/test/impairment", "上海证券交易所", 0.9, "R14", "减值准备",
            ),
            (
                5, 8, "关键人员变动事件", "025-11-229", "核心技术人员变动",
                "https://www.sse.com.cn/test/bad-date", "上海证券交易所", 0.9, "R22", "非法日期",
            ),
        ]
        conn.executemany("INSERT INTO deep_search_events VALUES (?,?,?,?,?,?,?,?,?,?)", events)
        conn.execute(
            """INSERT INTO external_subject_evidence VALUES (
                   1,8,1,'event:1',0,'美国商务部工业与安全局（BIS）','监管机构',
                   '列入实体清单','中科寒武纪科技股份有限公司','2022-12-19',
                   '实体清单调整','https://www.federalregister.gov/documents/test','BIS',
                   '官方清单','2022-12-19','官方条目明确列示企业','2026-08-26',0.98,'已确认','fee-test'
               )"""
        )
        conn.execute(
            """INSERT INTO tyc_supplier_profiles VALUES (
                   1,8,'supplier:1','测试供应商','2026-01-01','100','10%','无关联关系','',
                   '测试供应商','{}','上海市','上海市',1,0
               )"""
        )
        conn.executemany(
            "INSERT INTO narrative_news_evidence VALUES (?,?,?,?)",
            [(1, 8, 1, "AI;芯片"), (2, 8, 1, "AI;算力")],
        )
        conn.executemany(
            "INSERT INTO indicator_coverage VALUES (?,?,?,?)",
            [(8, key, "covered", 1) for key, _category, _name in indicators],
        )
        conn.commit()
        conn.close()

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_builds_three_layers_and_forward_evolution(self) -> None:
        result = run_cambricon_fee_kbg(self.db_path, "fee_test")
        self.assertEqual(result["event_count"], 4)
        self.assertGreater(result["evolution_edge_count"], 0)
        self.assertGreaterEqual(result["subject_impact_count"], 2)
        self.assertGreaterEqual(result["subject_influence_count"], 1)
        self.assertIn("H_historical", result["risk_scores"])
        conn = sqlite3.connect(self.db_path)
        node_types = {
            row[0] for row in conn.execute(
                """SELECT n.node_type FROM knowledge_graph_snapshot_nodes s
                   JOIN knowledge_graph_nodes n ON n.node_key=s.node_key WHERE s.run_id='fee_test'"""
            )
        }
        self.assertTrue({"company", "risk_event", "event_topic", "risk_indicator", "risk_category", "warning_score"}.issubset(node_types))
        self.assertEqual(
            conn.execute("SELECT COUNT(*) FROM fee_event_instances WHERE run_id='fee_test' AND event_date='025-11-229'").fetchone()[0],
            0,
        )
        backward = conn.execute(
            """SELECT COUNT(*) FROM fee_event_evolution_edges e
               JOIN fee_event_instances s ON s.run_id=e.run_id AND s.event_key=e.source_event_key
               JOIN fee_event_instances t ON t.run_id=e.run_id AND t.event_key=e.target_event_key
               WHERE e.run_id='fee_test' AND s.event_date>=t.event_date"""
        ).fetchone()[0]
        self.assertEqual(backward, 0)
        self.assertGreater(
            conn.execute("SELECT COUNT(*) FROM fee_event_evolution_edges WHERE run_id='fee_test'").fetchone()[0],
            0,
        )
        self.assertGreaterEqual(
            conn.execute("SELECT COUNT(*) FROM fee_subject_impacts WHERE run_id='fee_test' AND influence_weight>=0.35").fetchone()[0],
            2,
        )
        self.assertGreaterEqual(
            conn.execute("SELECT COUNT(*) FROM fee_subject_influences WHERE run_id='fee_test' AND influence_weight>=0.35").fetchone()[0],
            1,
        )
        self.assertEqual(
            conn.execute("SELECT COUNT(*) FROM fee_subject_influences WHERE run_id='fee_test' AND subject_type='regulator'").fetchone()[0],
            0,
        )
        warning = conn.execute(
            "SELECT score_value,coverage_ratio,components_json FROM fee_risk_scores WHERE run_id='fee_test' AND score_type='W_auxiliary_warning'"
        ).fetchone()
        self.assertIsNotNone(warning)
        self.assertIn("H_historical", json.loads(warning[2]))
        conn.close()

    def test_rerun_is_idempotent(self) -> None:
        first = run_cambricon_fee_kbg(self.db_path, "fee_same")
        second = run_cambricon_fee_kbg(self.db_path, "fee_same")
        self.assertEqual(first["node_count"], second["node_count"])
        self.assertEqual(first["edge_count"], second["edge_count"])
        conn = sqlite3.connect(self.db_path)
        self.assertEqual(
            conn.execute("SELECT COUNT(*) FROM knowledge_graph_snapshot_nodes WHERE run_id='fee_same'").fetchone()[0],
            second["node_count"],
        )
        conn.close()


if __name__ == "__main__":
    unittest.main()
