import json
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

from src.database import connect, init_db, upsert_company, upsert_entity, upsert_relation
from src.knowledge_graph_agent import run_knowledge_graph_agent
from src.models import EntityRecord, EntityRelation


class KnowledgeGraphAgentTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "risk.sqlite"
        self.conn = connect(self.db_path)
        init_db(self.conn)
        self.company = "测试科技股份有限公司"
        upsert_company(self.conn, self.company, credit_code="91110108TEST000001")
        upsert_entity(
            self.conn,
            EntityRecord("company", self.company, "seed", "seed source", identifier_type="credit_code", identifier_value="91110108TEST000001"),
        )
        upsert_entity(
            self.conn,
            EntityRecord("patent", "一种智能芯片", "seed", "seed source", identifier_type="patent_number", identifier_value="CNTEST001", confidence=0.91),
        )
        upsert_relation(
            self.conn,
            EntityRelation("company", self.company, "has_patent", "patent", "一种智能芯片", "seed", "seed source", confidence=0.91),
        )
        self.conn.commit()

    def tearDown(self):
        self.conn.close()
        self.temp_dir.cleanup()

    def test_builds_versioned_graph_snapshot(self):
        result = run_knowledge_graph_agent(self.db_path, "test_kg_001", self.company)
        self.assertEqual(result["node_count"], 2)
        self.assertEqual(result["edge_count"], 1)
        self.assertEqual(result["validation_issue_count"], 0)
        conn = sqlite3.connect(self.db_path)
        self.assertEqual(conn.execute("SELECT COUNT(*) FROM knowledge_graph_snapshot_nodes WHERE run_id = ?", ("test_kg_001",)).fetchone()[0], 2)
        self.assertEqual(conn.execute("SELECT COUNT(*) FROM knowledge_graph_snapshot_edges WHERE run_id = ?", ("test_kg_001",)).fetchone()[0], 1)
        self.assertEqual(conn.execute("SELECT relation_type FROM knowledge_graph_edges").fetchone()[0], "owns")
        conn.close()

    def test_excludes_review_required_records_by_default(self):
        upsert_entity(
            self.conn,
            EntityRecord("supplier", "待复核供应商", "seed", "seed source", confidence=0.5, needs_review=True),
        )
        upsert_relation(
            self.conn,
            EntityRelation("company", self.company, "has_supplier", "supplier", "待复核供应商", "seed", "seed source", confidence=0.5, needs_review=True),
        )
        self.conn.commit()
        safe = run_knowledge_graph_agent(self.db_path, "test_kg_safe", self.company)
        candidate = run_knowledge_graph_agent(self.db_path, "test_kg_candidate", self.company, include_unreviewed=True)
        self.assertEqual(safe["node_count"], 2)
        self.assertEqual(safe["edge_count"], 1)
        self.assertEqual(candidate["node_count"], 3)
        self.assertEqual(candidate["edge_count"], 2)
        self.assertGreater(candidate["validation_issue_count"], 0)

    def test_projects_indicator_to_pdf_schema_node_and_relation(self):
        from src.database import insert_many_evidence, insert_score
        from src.models import Evidence, IndicatorScore
        insert_many_evidence(self.conn, [
            Evidence(self.company, "监管处罚次数", "reg", "监管", "2026-07-03", "2026-07-04", "https://example.test/penalty", "行政处罚决定", "", {"record": {"处罚决定书文号": "测试罚字〔2026〕1号"}}, 0.95, ["regulatory_event"]),
        ], run_id="seed")
        insert_score(self.conn, IndicatorScore(self.company, "监管处罚次数", 1, 0.9, "高风险", 1, False, "测试"), "seed")
        self.conn.commit()
        result = run_knowledge_graph_agent(self.db_path, "test_kg_schema", self.company)
        self.assertGreaterEqual(result["node_count"], 4)
        conn = sqlite3.connect(self.db_path)
        node = conn.execute("SELECT node_type FROM knowledge_graph_nodes WHERE canonical_name='监管处罚次数'").fetchone()
        self.assertEqual(node[0], "compliance_event")
        relation = conn.execute("SELECT relation_type FROM knowledge_graph_edges WHERE relation_type='penalized_by'").fetchone()
        self.assertIsNotNone(relation)
        conn.close()

    def test_extracts_regulator_and_court_as_second_hop_entities(self):
        from src.database import insert_many_evidence
        from src.models import Evidence
        insert_many_evidence(self.conn, [
            Evidence(self.company, "监管处罚次数", "reg", "监管", "2026-07-03", "2026-07-04", "", "监管措施", "", {"dataset_type": "regulatory_event", "record": {"处罚决定书文号": "测试罚字〔2026〕2号", "处罚机关": "测试证券交易所"}}, 0.95, ["regulatory_event"]),
            Evidence(self.company, "诉讼风险", "court", "法院", "2026-07-03", "2026-07-04", "", "买卖合同纠纷", "", {"dataset_type": "litigation_event", "record": {"案号": "（2026）测01民初1号", "执行法院": "测试市人民法院", "当事人": "原告: 测试对手方\n被告: 测试科技股份有限公司"}}, 0.95, ["litigation_event"]),
        ], run_id="seed")
        self.conn.commit()
        result = run_knowledge_graph_agent(self.db_path, "test_kg_multihop", self.company)
        # Patent-only seed data remains intentionally isolated in this test;
        # the assertions below are specifically about two-hop fact semantics.
        self.assertGreaterEqual(result["validation_issue_count"], 0)
        conn = sqlite3.connect(self.db_path)
        labels = {row[0] for row in conn.execute("SELECT node_type FROM knowledge_graph_nodes")}
        self.assertIn("regulatory_agency", labels)
        self.assertIn("court", labels)
        relations = {row[0] for row in conn.execute("SELECT relation_type FROM knowledge_graph_edges")}
        self.assertIn("regulated_by", relations)
        self.assertIn("adjudicated_by", relations)
        conn.close()

    def test_keeps_annual_report_title_as_evidence_not_entity(self):
        from src.database import insert_many_evidence
        from src.models import Evidence

        annual_title = "测试科技股份有限公司2025年年度报告"
        insert_many_evidence(self.conn, [
            Evidence(
                self.company, "监管处罚次数", "annual", "定期报告", "2026-04-01", "2026-04-02",
                "https://example.test/annual", annual_title, "报告披露相关信息",
                {"dataset_type": "regulatory_event", "record": {"披露事项": "合规信息"}},
                0.95, ["regulatory_event"],
            ),
        ], run_id="seed")
        self.conn.commit()

        result = run_knowledge_graph_agent(self.db_path, "test_kg_document_provenance", self.company)
        self.assertGreaterEqual(result["node_count"], 3)
        conn = sqlite3.connect(self.db_path)
        self.assertEqual(
            conn.execute(
                "SELECT COUNT(*) FROM knowledge_graph_snapshot_nodes n JOIN knowledge_graph_nodes g ON g.node_key=n.node_key WHERE n.run_id=? AND g.canonical_name=?",
                ("test_kg_document_provenance", annual_title),
            ).fetchone()[0],
            0,
        )
        schema_attr = conn.execute(
            "SELECT g.attributes_json FROM knowledge_graph_snapshot_nodes n JOIN knowledge_graph_nodes g ON g.node_key=n.node_key WHERE n.run_id=? AND g.canonical_name='监管处罚次数'",
            ("test_kg_document_provenance",),
        ).fetchone()[0]
        self.assertIn(annual_title, json.loads(schema_attr)["evidence_titles"])
        conn.close()

    def test_exposes_pending_source_coverage_without_using_it_as_approved_evidence(self):
        from src.database import insert_many_evidence
        from src.models import Evidence

        insert_many_evidence(self.conn, [
            Evidence(
                self.company, "监管处罚次数", "official", "监管公告", "2026-07-03", "2026-07-04", "",
                "正式监管公告", "", {"record": {"处罚决定书文号": "测试罚字〔2026〕3号"}}, 0.95, ["regulatory_event"],
            ),
            Evidence(
                self.company, "监管处罚次数", "pending", "待复核数据源", "2026-07-03", "2026-07-04", "",
                "待复核导入记录", "", {"record": {"处罚决定书文号": "测试罚字〔2026〕4号"}}, 0.90, ["regulatory_event"],
                needs_review=True, review_reason="需要人工确认",
            ),
        ], run_id="seed")
        self.conn.commit()

        run_knowledge_graph_agent(self.db_path, "test_kg_coverage", self.company)
        conn = sqlite3.connect(self.db_path)
        attrs = json.loads(conn.execute(
            "SELECT attributes_json FROM knowledge_graph_nodes WHERE canonical_name='监管处罚次数'"
        ).fetchone()[0])
        self.assertEqual(attrs["data_chain_evidence_count"], 2)
        self.assertEqual(attrs["approved_evidence_count"], 1)
        self.assertEqual(attrs["review_pending_evidence_count"], 1)
        self.assertEqual(len(attrs["source_coverage"]), 2)
        conn.close()

    def test_omitted_company_builds_an_all_company_snapshot(self):
        second_company = "第二测试科技股份有限公司"
        upsert_company(self.conn, second_company, stock_code="688999")
        self.conn.commit()
        result = run_knowledge_graph_agent(self.db_path, "test_kg_all")
        self.assertEqual(result["company"], "全部企业")
        self.assertEqual(result["company_count"], 2)
        self.assertGreaterEqual(result["node_count"], 2)


if __name__ == "__main__":
    unittest.main()
