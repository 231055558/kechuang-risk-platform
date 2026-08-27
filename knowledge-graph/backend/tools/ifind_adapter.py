import argparse
import json
import sqlite3
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

from src.database import connect, init_db, insert_many_evidence, upsert_company
from src.models import Evidence, utc_now_iso


def rows(conn, sql, params=()):
    conn.row_factory = sqlite3.Row
    return conn.execute(sql, params).fetchall()


def make_evidence(company, indicator, source_id, source_name, title, snippet, value, tags, publish_date="", url=""):
    return Evidence(
        company=company,
        indicator=indicator,
        source_id=source_id,
        source_name=source_name,
        publish_date=publish_date,
        fetched_at=utc_now_iso(),
        url=url,
        title=title,
        snippet=snippet[:300],
        value=value,
        confidence=0.85,
        tags=tags,
        needs_review=False,
        review_reason="",
    )


def convert_document(ifind_conn, document_id):
    doc = rows(ifind_conn, "SELECT * FROM documents WHERE id = ?", (document_id,))[0]
    company = doc["company_name"]
    source_id = f"ifind_pdf_{document_id}"
    source_name = "iFinD企业库PDF"
    source_path = doc["source_path"]
    evidence = []

    profile = rows(ifind_conn, "SELECT * FROM company_profiles WHERE document_id = ?", (document_id,))
    if profile:
        item = dict(profile[0])
        evidence.append(make_evidence(
            company,
            "公司公告",
            source_id,
            source_name,
            "iFinD企业工商信息",
            f"统一社会信用代码:{item.get('unified_social_credit_code')}；法定代表人:{item.get('legal_representative')}；行业:{item.get('national_industry')}",
            item,
            ["ifind_pdf", "company_profile", "company_announcement"],
            url=source_path,
        ))

    shareholder_rows = rows(ifind_conn, "SELECT * FROM shareholders WHERE document_id = ?", (document_id,))
    if shareholder_rows:
        shareholder_data = [dict(row) for row in shareholder_rows]
        evidence.append(make_evidence(
            company,
            "股权稀释程度",
            source_id,
            source_name,
            "iFinD股东信息",
            "；".join(f"{r['shareholder_name']}:{r['shareholding_ratio']}%" for r in shareholder_data[:10]),
            shareholder_data,
            ["ifind_pdf", "equity_structure"],
            url=source_path,
        ))

    people_rows = rows(ifind_conn, "SELECT * FROM people WHERE document_id = ?", (document_id,))
    if people_rows:
        people_data = [dict(row) for row in people_rows]
        evidence.append(make_evidence(
            company,
            "高管关联风险暴露度",
            source_id,
            source_name,
            "iFinD高管/主要人员信息",
            "；".join(f"{r['name']}:{r['role']}" for r in people_data[:10]),
            people_data,
            ["ifind_pdf", "person_profile"],
            url=source_path,
        ))

    financing_rows = rows(ifind_conn, "SELECT * FROM financing_events WHERE document_id = ?", (document_id,))
    if financing_rows:
        financing_data = [dict(row) for row in financing_rows]
        evidence.append(make_evidence(
            company,
            "累计融资金额",
            source_id,
            source_name,
            "iFinD融资事件",
            "；".join(f"{r['event_date']} {r['round_name']} {r['financing_amount']}" for r in financing_data[:10]),
            financing_data,
            ["ifind_pdf", "financing_event"],
            url=source_path,
        ))

    customer_rows = rows(ifind_conn, "SELECT * FROM customers WHERE document_id = ?", (document_id,))
    if customer_rows:
        customer_data = [dict(row) for row in customer_rows]
        evidence.append(make_evidence(
            company,
            "工程化与商业转化率",
            source_id,
            source_name,
            "iFinD客户/中标项目信息",
            "；".join(f"{r['customer_name']}:{r['sales_amount_10k']}" for r in customer_data[:10]),
            customer_data,
            ["ifind_pdf", "customer_acceptance", "commercialization_event"],
            url=source_path,
        ))

    supplier_rows = rows(ifind_conn, "SELECT * FROM suppliers WHERE document_id = ?", (document_id,))
    if supplier_rows:
        supplier_data = [dict(row) for row in supplier_rows]
        evidence.append(make_evidence(
            company,
            "供应链进口依赖度",
            source_id,
            source_name,
            "iFinD供应商信息",
            "；".join(f"{r['supplier_name']}:{r['purchase_amount_10k']}" for r in supplier_data[:10]),
            supplier_data,
            ["ifind_pdf", "supplier_data"],
            url=source_path,
        ))

    news_rows = rows(ifind_conn, "SELECT * FROM news_events WHERE document_id = ?", (document_id,))
    if news_rows:
        news_data = [dict(row) for row in news_rows]
        negative = [r for r in news_data if r.get("sentiment") == "负面"]
        evidence.append(make_evidence(
            company,
            "叙事热度基本面背离度",
            source_id,
            source_name,
            "iFinD新闻舆情",
            f"新闻{len(news_data)}条，负面{len(negative)}条",
            news_data,
            ["ifind_pdf", "text_news", "narrative", "negative_news"],
            url=source_path,
        ))
        if negative:
            evidence.append(make_evidence(
                company,
                "重大技术质量事件指数",
                source_id,
                source_name,
                "iFinD负面新闻",
                "；".join(f"{r['publish_date']} {r['title']}" for r in negative[:10]),
                negative,
                ["ifind_pdf", "negative_news", "technical_quality_event"],
                url=source_path,
            ))

    patent_rows = rows(ifind_conn, "SELECT * FROM patents WHERE document_id = ?", (document_id,))
    if patent_rows:
        patent_data = [dict(row) for row in patent_rows]
        evidence.append(make_evidence(
            company,
            "技术先进性-专利产出效率",
            source_id,
            source_name,
            "iFinD专利信息",
            f"专利记录{len(patent_data)}条；示例：" + "；".join(r["patent_name"] for r in patent_data[:5]),
            patent_data,
            ["ifind_pdf", "patent_data", "patent_legal_status"],
            url=source_path,
        ))

    risk_rows = rows(ifind_conn, "SELECT * FROM risk_raw_sections WHERE document_id = ?", (document_id,))
    legal_like = [dict(row) for row in risk_rows if any(k in (row["section_title"] or "") for k in ["司法", "开庭", "裁判", "执行", "诉讼"])]
    if legal_like:
        evidence.append(make_evidence(
            company,
            "诉讼风险",
            source_id,
            source_name,
            "iFinD司法风险原文段",
            "；".join(r["section_title"] for r in legal_like[:10]),
            legal_like,
            ["ifind_pdf", "litigation_event"],
            url=source_path,
        ))

    missing_rows = rows(ifind_conn, "SELECT * FROM missing_fields WHERE document_id = ?", (document_id,))
    if missing_rows:
        missing_data = [dict(row) for row in missing_rows]
        evidence.append(make_evidence(
            company,
            "公司公告",
            source_id,
            source_name,
            "iFinD报告缺失字段说明",
            "；".join(f"{r['module']}:{r['field_name']}" for r in missing_data[:20]),
            missing_data,
            ["ifind_pdf", "missing_field"],
            url=source_path,
        ))

    return company, evidence


def main():
    parser = argparse.ArgumentParser(description="Convert iFinD-struct SQLite output into risk evidence database.")
    parser.add_argument("--ifind-db", default="data/risk_data.sqlite")
    parser.add_argument("--risk-db", default="data/risk_data.sqlite")
    args = parser.parse_args()

    ifind_conn = sqlite3.connect(PROJECT_ROOT / args.ifind_db)
    ifind_conn.row_factory = sqlite3.Row
    risk_conn = connect(PROJECT_ROOT / args.risk_db)
    init_db(risk_conn)

    total = 0
    companies = []
    for doc in rows(ifind_conn, "SELECT id, company_name FROM documents ORDER BY id"):
        company, evidence = convert_document(ifind_conn, doc["id"])
        upsert_company(risk_conn, company)
        total += insert_many_evidence(risk_conn, evidence)
        companies.append(company)

    print(json.dumps({"companies": companies, "evidence_converted": total}, ensure_ascii=False, indent=2))
    ifind_conn.close()
    risk_conn.close()


if __name__ == "__main__":
    main()
