"""Build a minimal, public-only crawl registry from latest coverage gaps.

This tool deliberately does not run a crawl.  It translates actual missing
indicator inputs into an auditable registry and a task list.  Commercial
enterprise APIs (including Tianyancha), Qichacha and MCP endpoints are always
excluded; their use needs a separately authorised configuration.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
import sys
import urllib.parse
from collections import defaultdict
from datetime import datetime
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

from src.company_crawl import PERIODIC_CATEGORIES  # noqa: E402
from src.database import connect, init_db  # noqa: E402


EXCLUDED_SOURCE_TYPES = (
    "tianyancha_openapi", "tianyancha_person_fanout", "qichacha_openapi", "mcp_streamable_http",
)
PUBLIC_SOURCE_TYPES = {
    "cninfo_announcements", "cninfo_periodic_report_pdfs", "sse_regulatory_measures",
    "court_announcements", "remote_screening_list",
}


def _source(source_id: str, name: str, source_type: str, parser: str, indicators: list[str], params: dict, *, url: str = "") -> dict:
    return {
        "id": source_id, "name": name, "type": source_type, "parser": parser, "url": url,
        "reliability": "official", "update_frequency": "on_demand", "indicators": indicators,
        "params": params, "enabled": True,
    }


def _exchange(code: str) -> str:
    if code.startswith(("0", "3")):
        return "szse"
    if code.startswith(("4", "8", "92")):
        return "neeq"
    return "sse"


def _safe_id(code: str, suffix: str, company_name: str = "") -> str:
    """Return a unique, deterministic source id even for unlisted companies."""
    base = code or ("unlisted_" + hashlib.sha1(company_name.encode("utf-8")).hexdigest()[:10])
    return f"gap_{base}_{suffix}"


def _targets(conn: sqlite3.Connection) -> dict[int, dict]:
    rows = conn.execute("SELECT id,name,stock_code,credit_code,aliases_json FROM companies ORDER BY name").fetchall()
    result = {}
    for row in rows:
        try:
            aliases = json.loads(row[4] or "[]")
        except json.JSONDecodeError:
            aliases = []
        result[int(row[0])] = {
            "name": row[1], "stock_code": str(row[2] or "").zfill(6) if row[2] else "",
            "credit_code": row[3] or "", "aliases": [str(item) for item in aliases if str(item).strip()],
        }
    return result


def _gaps(conn: sqlite3.Connection, score_run_id: str) -> dict[int, set[str]]:
    rows = conn.execute(
        """
        SELECT company_id, indicator_id
        FROM indicator_scores
        WHERE run_id=? AND json_extract(calculation_json, '$.source_coverage_status')='missing'
        """,
        (score_run_id,),
    ).fetchall()
    names = {int(row[0]): row[1] for row in conn.execute("SELECT id,name FROM indicators")}
    result: dict[int, set[str]] = defaultdict(set)
    for company_id, indicator_id in rows:
        result[int(company_id)].add(str(names[int(indicator_id)]))
    return result


def build_registry(db_path: Path, score_run_id: str, output_path: Path, task_path: Path) -> dict:
    conn = connect(db_path)
    try:
        init_db(conn)
        companies = _targets(conn)
        gaps = _gaps(conn, score_run_id)
    finally:
        conn.close()

    sources: list[dict] = []
    tasks: list[dict] = []
    selected_companies: list[dict] = []
    for company_id, indicator_names in sorted(gaps.items(), key=lambda item: companies.get(item[0], {}).get("name", "")):
        company = companies.get(company_id)
        if not company:
            continue
        selected_companies.append(company)
        code = company["stock_code"]
        target = {key: company[key] for key in ("name", "aliases", "stock_code", "credit_code")}
        category = _exchange(code) if code else ""
        needs_regulatory = bool({"监管处罚次数", "交易所问询次数"}.intersection(indicator_names))
        needs_financial = bool({"营业收入增长率", "无形资产减值风险", "融资成本", "经营现金流与短期偿债压力"}.intersection(indicator_names))
        needs_litigation = "诉讼风险" in indicator_names
        needs_sanctions = "出口管制与制裁暴露度" in indicator_names

        if code and needs_regulatory:
            sources.append(_source(
                _safe_id(code, "cninfo_inquiries", company["name"]), "巨潮资讯问询/监管公告补采", "cninfo_announcements", "cninfo_announcements",
                ["交易所问询次数", "监管处罚次数"],
                {"page_size": 30, "max_pages": 12, "column": category, "plate": category,
                 "search_keys": [code], "title_keywords": ["问询函", "问询", "关注函", "监管函", "纪律处分", "警示函", "处罚"], "stock_code": code},
                url="http://www.cninfo.com.cn/new/hisAnnouncement/query",
            ))
            if code.startswith(("6", "68")):
                sources.append(_source(
                    _safe_id(code, "sse_regulatory", company["name"]), "上交所监管措施/问询补采", "sse_regulatory_measures", "sse_regulatory_measures",
                    ["交易所问询次数", "监管处罚次数"], {"targets": [target], "page_size": 25, "max_pages": 12, "site_id": "28"},
                    url="https://query.sse.com.cn/commonSoaQuery.do",
                ))
        if code and needs_financial:
            sources.append(_source(
                _safe_id(code, "periodic_reports", company["name"]), "巨潮资讯定期报告财务字段补采", "cninfo_periodic_report_pdfs", "cninfo_periodic_report_pdfs",
                ["营业收入增长率", "无形资产减值风险", "融资成本", "经营现金流与短期偿债压力"],
                {"company": company["name"], "stock_code": code, "page_size": 30, "max_pages": 3,
                 "column": category, "plate": category, "searchkey": code, "category": PERIODIC_CATEGORIES,
                 "limit": 2, "include_text_fallback": True, "pdf_dir": "data/pdfs/gap_reports",
                 "registry_db": "data/risk_data.sqlite", "manifest": f"data/pdf_manifests/gap_{code}_periodic_reports.json", "source_name": "CNINFO"},
                url="http://www.cninfo.com.cn/new/hisAnnouncement/query",
            ))
        if needs_litigation:
            sources.append(_source(
                _safe_id(code, "court_announcements", company["name"]), "人民法院公告网诉讼线索补采", "court_announcements", "official_court_announcements",
                ["诉讼风险"], {"targets": [target], "max_rows": 30},
                url="https://rmfygg.court.gov.cn/web/rmfyportal/noticeinfo",
            ))
        if needs_sanctions:
            query_name = urllib.parse.quote(company["name"])
            sources.append(_source(
                _safe_id(code, "ita_csl", company["name"]), "美国 ITA Consolidated Screening List 筛查补采", "remote_screening_list", "screening_list",
                ["出口管制与制裁暴露度"], {"format": "json", "targets": [target],
                 "urls": [f"https://data.trade.gov/consolidated_screening_list/v1/search?size=100&name={query_name}"]},
                url="https://data.trade.gov/consolidated_screening_list/v1/search",
            ))
        tasks.append({
            "company": company["name"], "stock_code": code, "missing_indicators": sorted(indicator_names),
            "planned_public_sources": [source["type"] for source in sources if source["id"].startswith(_safe_id(code, "", company["name"]))],
            "unfilled_without_authorised_structured_source": sorted(
                indicator_names.intersection({"关键供应链进口依赖度", "海外业务收入占比", "高管关联风险暴露度", "叙事热度基本面背离度", "第三方与自身表述偏差", "自身评价一致性/稳定性", "概念股标签关联度"})
            ),
        })

    registry = {
        "sources": sources,
        "target_companies": selected_companies,
        "generated": {
            "score_run_id": score_run_id, "mode": "coverage_gap_public_only",
            "excluded_source_types": list(EXCLUDED_SOURCE_TYPES),
            "allowed_source_types": sorted(PUBLIC_SOURCE_TYPES),
            "created_at": datetime.now().astimezone().isoformat(),
        },
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(registry, ensure_ascii=False, indent=2), encoding="utf-8")
    task_path.parent.mkdir(parents=True, exist_ok=True)
    task_path.write_text(json.dumps({"score_run_id": score_run_id, "tasks": tasks}, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"registry": str(output_path), "task_file": str(task_path), "company_count": len(selected_companies), "source_count": len(sources), "excluded_source_types": list(EXCLUDED_SOURCE_TYPES)}


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate a public-only crawl registry from indicator coverage gaps.")
    parser.add_argument("--db", default="data/risk_data.sqlite")
    parser.add_argument("--score-run-id", required=True)
    parser.add_argument("--output", default="data/generated_configs/coverage_gap_public_only.json")
    parser.add_argument("--tasks", default="data/reports/coverage_gap_public_only_tasks.json")
    args = parser.parse_args()
    db = Path(args.db)
    output = Path(args.output)
    tasks = Path(args.tasks)
    if not db.is_absolute():
        db = PROJECT_ROOT / db
    if not output.is_absolute():
        output = PROJECT_ROOT / output
    if not tasks.is_absolute():
        tasks = PROJECT_ROOT / tasks
    if not db.is_file():
        raise SystemExit(f"数据库不存在：{db}")
    print(json.dumps(build_registry(db, args.score_run_id, output, tasks), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
