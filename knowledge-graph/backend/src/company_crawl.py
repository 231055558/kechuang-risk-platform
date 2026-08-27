"""Resolve a company request and build a scoped source registry at runtime."""

from __future__ import annotations

import json
import re
import sqlite3
from hashlib import sha1
from datetime import datetime
from pathlib import Path
from typing import Any


PERIODIC_CATEGORIES = "category_ndbg_szsh;category_bndbg_szsh;category_yjdbg_szsh;category_sjdbg_szsh"
REQUEST_PREFIX = re.compile(r"^\s*(?:帮我|麻烦|请|我要|我想|需要)?\s*(?:获取|爬取|采集|查询|分析|收集)?\s*")
REQUEST_SUFFIX = re.compile(r"\s*(?:的)?(?:数据|信息|风险数据|风险信息|资料|相关内容)(?:吧|一下|即可|就行)?\s*$")


def resolve_company_request(project_root: Path, request: str, stock_code: str = "") -> dict[str, Any]:
    """Prefer known names/codes; allow an unlisted-company web-only request."""
    candidates = _known_companies(project_root)
    code = _first_stock_code(stock_code or request)
    # A full legal name can contain words such as "公司" and must be matched
    # before command wording is removed.
    matched = _match_known_company(candidates, request, code)
    if matched:
        return matched
    query = _clean_request(request)

    matched = _match_known_company(candidates, query, code)
    if matched:
        return matched
    if code:
        if stock_code and len(query) >= 2:
            return {
                "name": query,
                "aliases": [query],
                "stock_code": code,
                "credit_code": "",
                "listed": True,
                "resolution": "provided_name_and_stock_code",
            }
        raise ValueError("未能从本地企业库或既有配置识别该股票代码；请同时提供公司全称。")
    if len(query) < 2:
        raise ValueError("请提供公司名称，或提供公司名称和六位股票代码。")
    return {"name": query, "aliases": [query], "stock_code": "", "credit_code": "", "listed": False, "resolution": "name_only"}


def build_company_registry(company: dict[str, Any], mode: str = "standard") -> dict[str, Any]:
    name = company["name"]
    stock_code = company.get("stock_code", "")
    aliases = _unique([name, *(company.get("aliases") or []), stock_code])
    target = {"name": name, "aliases": aliases, "stock_code": stock_code, "credit_code": company.get("credit_code", "")}
    slug = _slug(stock_code or name)
    sources = _web_sources(slug, target)
    if stock_code:
        sources = _listed_sources(slug, target, mode) + sources
    return {"sources": sources, "target_companies": [target], "generated": {"mode": mode, "listed": bool(stock_code), "resolution": company.get("resolution", "")}}


def write_company_registry(project_root: Path, registry: dict[str, Any], run_id: str, output_path: str = "") -> Path:
    path = Path(output_path) if output_path else project_root / "data" / "generated_configs" / f"{run_id}.json"
    if not path.is_absolute():
        path = project_root / path
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(registry, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


def default_run_id(company: dict[str, Any]) -> str:
    return f"{_slug(company.get('stock_code') or company['name'])}_{datetime.now().strftime('%Y%m%d_%H%M%S_%f')}"


def _listed_sources(slug: str, target: dict[str, Any], mode: str) -> list[dict[str, Any]]:
    code = target["stock_code"]
    exchange = _cninfo_exchange(code)
    listed = [
        _source(f"{slug}_cninfo_announcements", "巨潮资讯公司公告", "cninfo_announcements", "cninfo_announcements", ["公司公告", "交易所问询次数"], {
            "page_size": 30, "max_pages": 3, "column": exchange, "plate": exchange, "searchkey": code,
        }, "official"),
        _source(f"{slug}_cninfo_exchange_inquiries", "巨潮资讯问询函与监管函", "cninfo_announcements", "cninfo_announcements", ["交易所问询次数", "公司公告"], {
            "page_size": 30, "max_pages": 40, "column": exchange, "plate": exchange,
            "search_keys": [code], "title_keywords": ["问询函", "问询", "关注函", "监管函"],
            "stock_code": code,
        }, "official"),
    ]
    if code.startswith(("6", "68")):
        listed.append(_source(f"{slug}_sse_static", "上交所公告静态源", "sse_static_stock", "sse_static_stock", ["公司公告", "交易所问询次数"], {"stock_code": code}, "official"))
        listed.append(_source(f"{slug}_sse_regulatory_measures", "上交所监管措施与监管问询", "sse_regulatory_measures", "sse_regulatory_measures", ["监管处罚次数", "交易所问询次数"], {
            "targets": [target], "page_size": 25, "max_pages": 20, "site_id": "28",
        }, "official"))
    if code.startswith(("0", "3")):
        listed.append(_source(f"{slug}_szse_announcements", "深交所公司公告", "szse_announcements", "szse_announcements", ["公司公告", "交易所问询次数"], {
            "targets": [target], "max_pages": 3, "page_size": 30,
        }, "official"))
    if code.startswith(("4", "8", "92")):
        listed.append(_source(f"{slug}_bse_announcements", "北交所公司公告", "bse_announcements", "bse_announcements", ["公司公告", "交易所问询次数"], {"targets": [target], "max_pages": 3, "page_size": 20}, "official"))
    if mode == "full":
        listed.append(_source(f"{slug}_cninfo_periodic_pdfs", "巨潮资讯定期报告PDF", "cninfo_periodic_report_pdfs", "cninfo_periodic_report_pdfs", ["营业收入增长率", "研发投入强度", "海外业务收入占比", "工程化与商业转化率", "高管稳定性", "持续创新能力", "技术先进性-专利产出效率", "公司公告"], {
            "company": target["name"], "stock_code": code, "page_size": 30, "max_pages": 3,
            "column": exchange, "plate": exchange, "searchkey": code, "category": PERIODIC_CATEGORIES,
            "limit": 6, "include_text_fallback": True, "pdf_dir": "data/pdfs/reports",
            "registry_db": "data/pdf_registry.sqlite", "manifest": f"data/pdf_manifests/{code}_periodic_reports.json", "source_name": "CNINFO",
        }, "official"))
    return listed


def _web_sources(slug: str, target: dict[str, Any]) -> list[dict[str, Any]]:
    name = target["name"]
    common = {"url_templates": ["https://www.bing.com/search?q={query_plus}"], "targets": [target], "query_limit": 0, "result_limit": 5, "fetch_result_pages": True, "parse_search_pages": False, "timeout": 12}
    official_common = {
        "url_templates": ["https://www.bing.com/search?q={query_plus}"],
        "targets": [target],
        "query_limit": 0,
        "result_limit": 5,
        "timeout": 12,
        "min_document_chars": 160,
    }
    official_sources = [
        _source(f"{slug}_court_announcements", "人民法院公告网", "court_announcements", "official_court_announcements", ["诉讼风险"], {"targets": [target], "max_rows": 30}, "official"),
        _source(f"{slug}_csrc_official_documents", "证监会及派出机构处罚/监管措施详情", "csrc_company_search", "regulatory_text", ["监管处罚次数"], {
            "targets": [target],
            "queries": [name, f"{name} 行政处罚", f"{name} 监管措施"],
            "max_queries": 3,
            "max_links_per_query": 20,
            "include_terms": ["行政处罚", "行政监管措施", "监管措施", "警示函", "纪律处分", "监管工作函", "责令改正", "立案"],
            "min_document_chars": 160,
            "timeout": 25,
        }, "official"),
        _source(f"{slug}_official_patents", "国家知识产权局公开专利线索", "official_site_search", "patent_text", ["技术先进性-专利产出效率"], {**official_common, "official_domains": ["cnipa.gov.cn", "cponline.cnipa.gov.cn"], "queries": [f"site:cnipa.gov.cn {name} 专利", f"site:cponline.cnipa.gov.cn {name} 专利"]}, "official"),
        _source(f"{slug}_official_regulatory", "官方监管处罚与监管措施公开文书", "official_site_search", "regulatory_text", ["监管处罚次数"], {**official_common, "official_domains": ["csrc.gov.cn", "samr.gov.cn", "miit.gov.cn", "cac.gov.cn", "sse.com.cn", "szse.cn", "bse.cn"], "queries": [f"site:csrc.gov.cn {name} 行政处罚", f"site:samr.gov.cn {name} 行政处罚", f"site:sse.com.cn {name} 监管措施", f"site:szse.cn {name} 监管措施", f"site:bse.cn {name} 纪律处分", f"{name} 警示函 监管措施"]}, "official"),
        _source(f"{slug}_official_recalls", "市场监管总局召回公告", "samr_column", "recall_text", ["重大技术质量事件指数"], {"column_kind": "recall", "targets": [target], "max_pages": 5, "page_size": 20, "timeout": 25}, "official"),
        _source(f"{slug}_official_court_documents", "法院公开文书线索", "official_site_search", "litigation_text", ["诉讼风险"], {**official_common, "official_domains": ["court.gov.cn", "chinacourt.org", "wenshu.court.gov.cn", "zxgk.court.gov.cn"], "queries": [f"site:rmfygg.court.gov.cn {name}", f"site:wenshu.court.gov.cn {name}", f"site:zxgk.court.gov.cn {name}"]}, "official"),
    ]
    return official_sources + [
        _source(f"{slug}_rss_news", "公开新闻 RSS（可选）", "rss_feed", "rss_news", ["叙事热度基本面背离度"], {
            "url_templates": ["https://news.google.com/rss/search?q={query_plus}&hl=zh-CN&gl=CN&ceid=CN:zh-Hans"],
            "queries": [f"{name} 新闻", f"{name} 技术", f"{name} 风险"], "targets": [target], "timeout": 12,
            "max_errors": 1,
            "fetch_article_pages": True, "article_timeout": 15, "min_article_chars": 240,
            "allowed_domains": ["stcn.com", "cnstock.com", "cs.com.cn", "xinhua.net", "people.com.cn", "finance.sina.com.cn", "eastmoney.com", "cls.cn", "yicai.com", "sse.com.cn", "cninfo.com.cn"],
        }, "public_search", enabled=False),
        _source(f"{slug}_authoritative_news", "权威媒体新闻正文", "search_web", "news_event", ["叙事热度基本面背离度", "重大技术质量事件指数"], {**common, "queries": [f"{name} 故障 事故 质量", f"{name} 负面 风险 诉讼", f"{name} 技术 发布 量产"], "allowed_domains": ["stcn.com", "cnstock.com", "cs.com.cn", "xinhua.net", "people.com.cn", "finance.sina.com.cn", "eastmoney.com", "cls.cn", "yicai.com"], "min_article_chars": 240}, "public_media"),
        _source(f"{slug}_regulatory", "公开网页监管事件检索", "search_web", "regulatory_text", ["监管处罚次数"], {**common, "queries": [f"{name} 行政处罚", f"{name} 监管措施", f"{name} 立案"]}, "public_search"),
        _source(f"{slug}_litigation", "公开网页诉讼检索", "search_web", "litigation_text", ["诉讼风险"], {**common, "queries": [f"{name} 诉讼 判决", f"{name} 仲裁 开庭", f"{name} 被执行"]}, "public_search"),
        _source(f"{slug}_recall", "公开网页召回与质量检索", "search_web", "recall_text", ["重大技术质量事件指数"], {**common, "queries": [f"{name} 召回", f"{name} 产品故障", f"{name} 质量事件"]}, "public_search"),
    ]


def _source(source_id: str, name: str, source_type: str, parser: str, indicators: list[str], params: dict[str, Any], reliability: str, enabled: bool = True) -> dict[str, Any]:
    return {"id": source_id, "name": name, "type": source_type, "reliability": reliability, "update_frequency": "on_demand", "parser": parser, "indicators": indicators, "params": params, "enabled": enabled}


def _known_companies(project_root: Path) -> list[dict[str, Any]]:
    candidates: list[dict[str, Any]] = []
    db_path = project_root / "data" / "risk_data.sqlite"
    if db_path.exists():
        conn = sqlite3.connect(db_path)
        try:
            for name, stock_code, credit_code, aliases_json in conn.execute("SELECT name, stock_code, credit_code, aliases_json FROM companies"):
                candidates.append({"name": name, "stock_code": stock_code or "", "credit_code": credit_code or "", "aliases": json.loads(aliases_json or "[]"), "resolution": "local_database"})
        finally:
            conn.close()
    for path in (project_root / "config").glob("*.json"):
        try:
            for item in json.loads(path.read_text(encoding="utf-8")).get("target_companies", []):
                candidates.append({**item, "resolution": f"config:{path.name}"})
        except (json.JSONDecodeError, OSError):
            continue
    return _merge_company_candidates(candidates)


def _merge_company_candidates(candidates: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Combine repeated registrations while preserving the listed-company identity."""
    merged: dict[str, dict[str, Any]] = {}
    for item in candidates:
        name = str(item.get("name") or "").strip()
        if not name:
            continue
        key = _compact(name)
        current = merged.get(key)
        if current is None:
            merged[key] = {
                **item,
                "name": name,
                "aliases": _unique([*(item.get("aliases") or [])]),
                "stock_code": str(item.get("stock_code") or ""),
                "credit_code": str(item.get("credit_code") or ""),
            }
            continue
        current["aliases"] = _unique([
            *(current.get("aliases") or []),
            *(item.get("aliases") or []),
        ])
        if not current.get("stock_code") and item.get("stock_code"):
            current["stock_code"] = str(item["stock_code"])
            current["resolution"] = item.get("resolution", current.get("resolution", ""))
        if not current.get("credit_code") and item.get("credit_code"):
            current["credit_code"] = str(item["credit_code"])
    return list(merged.values())


def _match_known_company(candidates: list[dict[str, Any]], query: str, code: str) -> dict[str, Any] | None:
    matches = []
    for item in candidates:
        names = [item.get("name", ""), *(item.get("aliases") or []), item.get("stock_code", "")]
        if code and code == item.get("stock_code", ""):
            matches.append(item)
        elif query and any(_compact(query) == _compact(name) or _compact(query) in _compact(name) or _compact(name) in _compact(query) for name in names if name):
            matches.append(item)
    unique = {item.get("name", ""): item for item in matches}
    if len(unique) == 1:
        result = next(iter(unique.values())).copy()
        result["listed"] = bool(result.get("stock_code"))
        return result
    return None


def _clean_request(value: str) -> str:
    text = re.sub(r"\d{6}", "", value or "").strip()
    text = REQUEST_PREFIX.sub("", text)
    text = REQUEST_SUFFIX.sub("", text)
    return re.sub(r"[，,。.!！?？\s]+", "", text).strip()


def _first_stock_code(value: str) -> str:
    match = re.search(r"(?<!\d)(\d{6})(?!\d)", value or "")
    return match.group(1) if match else ""


def _compact(value: str) -> str:
    return re.sub(r"\s+", "", value or "").lower()


def _unique(values: list[str]) -> list[str]:
    return list(dict.fromkeys(value for value in values if value))


def _slug(value: str) -> str:
    compact = re.sub(r"[^A-Za-z0-9]+", "_", value).strip("_").lower()
    if compact:
        return compact[:48]
    return "company_" + sha1(value.encode("utf-8")).hexdigest()[:12]


def _cninfo_exchange(stock_code: str) -> str:
    if stock_code.startswith(("0", "3")):
        return "szse"
    if stock_code.startswith(("4", "8")):
        return "neeq"
    return "sse"
