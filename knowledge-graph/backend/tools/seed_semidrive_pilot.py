"""Seed the public, Edge-verified SemiDrive pilot facts into the master DB.

The script is idempotent and writes only processed facts. Raw browser captures
remain under ``data/edge_captures`` and are linked through the ``sources``
table. No paid API is called by this tool.
"""

from __future__ import annotations

import argparse
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DB = ROOT / "data" / "risk_data.sqlite"
COMPANY_NAME = "北京芯驰半导体科技股份有限公司"
STOCK_CODE = "PRIVATE-SEMIDRIVE"
SOURCE_DATABASE_ID = "semidrive-edge-public-20260827"


SOURCES = {
    "profile": {
        "source_type": "企业官网",
        "institution": "芯驰科技",
        "title": "芯驰科技官网企业介绍",
        "publication_date": "2026-08-27",
        "url": "https://www.semidrive.com/aboutus/",
        "notes": "Edge公开页面核验；官网页脚确认法律主体。",
    },
    "partners": {
        "source_type": "企业官网",
        "institution": "芯驰科技",
        "title": "芯驰科技官网合作伙伴",
        "publication_date": "2026-08-27",
        "url": "https://www.semidrive.com/partners",
        "notes": "Edge公开页面核验；伙伴标识由可见页面截图复核。",
    },
    "founders": {
        "source_type": "企业官网",
        "institution": "芯驰科技",
        "title": "半导体行业的女性力量——芯驰科技首席执行官仇雨菁访谈",
        "publication_date": "2022-03-08",
        "url": "https://www.semidrive.com/news/view-MzYzMzM=.html",
        "notes": "Edge公开页面核验。",
    },
    "management": {
        "source_type": "企业官网",
        "institution": "芯驰科技",
        "title": "程泰毅先生加入芯驰任首席执行官，与团队齐心共进新征程",
        "publication_date": "2023-04-14",
        "url": "https://www.semidrive.com/news/corporate-news-11.html",
        "notes": "Edge检索到官网新闻目录及后续官网活动信息，确认程泰毅担任首席执行官。",
    },
    "financing": {
        "source_type": "企业官网",
        "institution": "芯驰科技",
        "title": "芯驰科技完成近1亿美元C轮融资",
        "publication_date": "2026-05-22",
        "url": "https://www.semidrive.com/news/view-NDUxMDU=.html",
        "notes": "Edge公开页面核验。",
    },
    "litigation": {
        "source_type": "公开行业媒体",
        "institution": "网络安全与数据治理",
        "title": "恩智浦起诉自动驾驶芯片厂商南京芯驰",
        "publication_date": "2019-02-21",
        "url": "https://www.pcachina.com/article/3000095584",
        "notes": "Edge公开页面核验；公开免费源未取得案号和裁判结果，事件结果仍需司法数据库补全。",
    },
    "business_pause": {
        "source_type": "公开行业媒体",
        "institution": "芯流智库／搜狐汽车",
        "title": "芯驰中止汽车智能驾驶芯片业务",
        "publication_date": "2023-12-26",
        "url": "https://news.sohu.com/a/747024842_121608821",
        "notes": "Edge公开页面核验；属于媒体独家报道，已在事件标题和限制说明中保留来源性质。",
    },
    "arm": {
        "source_type": "合作伙伴官方公告",
        "institution": "安谋控股新闻中心",
        "title": "安谋科技多数股东关于公司治理问题已解决的公告",
        "publication_date": "2022-04-29",
        "url": "https://newsroom.arm.com/news/arm-China-majority-shareholders-announce-the-companys-corporate-governance-issue-has-been-resolved",
        "notes": "既有免费官方证据复用。",
    },
    "synopsys": {
        "source_type": "合作伙伴官方公告",
        "institution": "新思科技投资者关系网站",
        "title": "新思科技关于近期对华出口限制解除的声明",
        "publication_date": "2025-07-02",
        "url": "https://investor.synopsys.com/news/news-details/2025/Synopsys-Issues-Statement-in-Connection-to-the-Lifting-of-Recent-U-S--Export-Restrictions-Related-to-China/default.aspx",
        "notes": "既有免费官方证据复用。",
    },
    "cadence": {
        "source_type": "美国政府公告",
        "institution": "美国司法部",
        "title": "美国司法部关于铿腾电子违规出口案件的公告",
        "publication_date": "2025-07-28",
        "url": "https://www.justice.gov/opa/pr/cadence-design-systems-agrees-plead-guilty-and-pay-over-140-million-unlawfully-exporting",
        "notes": "Edge公开搜索结果核验官方公告标题、日期和金额；官网本次访问超时。",
    },
    "tsmc_earthquake": {
        "source_type": "合作伙伴官方年报",
        "institution": "台积电投资者关系网站",
        "title": "台积电2024年度报告自然灾害与业务连续性风险说明",
        "publication_date": "2025-04-10",
        "url": "https://investor.tsmc.com/static/annualReports/2024/english/ebook/files/basic-html/page138.html",
        "notes": "免费公开年度报告；披露2025年1月地震造成的存货与设备损失。",
    },
    "customer_huayang": {
        "source_type": "企业官网",
        "institution": "芯驰科技",
        "title": "再获客户认可！芯驰科技获评华阳通用优秀供应商",
        "publication_date": "2024-04-02",
        "url": "https://img.semidrive.com/news/view-NDA5MjM=.html",
        "notes": "官网确认自2021年战略合作并有多个量产定点项目。",
    },
    "customer_desay": {
        "source_type": "企业官网",
        "institution": "芯驰科技",
        "title": "德赛西威与芯驰科技合作升级",
        "publication_date": "2025-04-27",
        "url": "https://img.semidrive.com/news/view-NDMzMDM=.html",
        "notes": "官网确认共同开发新一代智能座舱平台。",
    },
    "customer_yanfeng": {
        "source_type": "企业官网",
        "institution": "芯驰科技",
        "title": "芯驰科技与延锋国际求新共赢",
        "publication_date": "2025-04-14",
        "url": "https://www.semidrive.com/news/view-NDI1MjE=.html",
        "notes": "官网确认战略合作和多个座舱解决方案项目。",
    },
}


PARTNERS = [
    ("安谋科技（中国）有限公司", "官网核心知识产权合作伙伴", 1),
    ("新思科技有限公司", "官网核心电子设计自动化合作伙伴", 0),
    ("安特瑞斯知识产权公司", "官网知识产权合作伙伴", 0),
    ("西门子电子设计自动化", "官网电子设计自动化合作伙伴", 0),
    ("想象科技", "官网知识产权合作伙伴", 0),
    ("铿腾电子设计系统公司", "官网核心电子设计自动化合作伙伴", 0),
    ("台积电", "官网核心晶圆代工合作伙伴", 0),
    ("宜特科技", "官网供应链验证合作伙伴", 0),
    ("通富微电子股份有限公司", "官网封装测试合作伙伴", 1),
    ("日月光集团", "官网封装测试合作伙伴", 0),
]


CUSTOMERS = [
    ("惠州市华阳多媒体电子有限公司", "2024-04-02", "战略合作与多个量产定点项目", "customer_huayang"),
    ("惠州市德赛西威汽车电子股份有限公司", "2025-04-27", "共同开发新一代智能座舱平台", "customer_desay"),
    ("延锋国际汽车技术有限公司", "2025-04-14", "战略合作与多个座舱解决方案项目", "customer_yanfeng"),
]


PEOPLE = [
    {
        "key": "semidrive-person-qiu-yujing",
        "name": "仇雨菁",
        "position": "联合创始人、董事长（曾任首席执行官）",
        "profile": "2018年联合创立芯驰科技，长期从事车规芯片研发与公司战略。",
        "source": "founders",
        "needs_review": False,
    },
    {
        "key": "semidrive-person-zhang-qiang",
        "name": "张强",
        "position": "联合创始人、战略市场与销售管理",
        "profile": "2018年联合创立芯驰科技，负责战略市场拓展和产业合作。",
        "source": "founders",
        "needs_review": False,
    },
    {
        "key": "semidrive-person-cheng-taiyi",
        "name": "程泰毅",
        "position": "首席执行官（2023年加入）",
        "profile": "2023年4月加入芯驰科技，负责总体战略、营运与管理。",
        "source": "management",
        "needs_review": False,
    },
]


INVESTORS = ["苏产投", "陕汽鸿德投资", "亦庄国投", "北京市先进制造基金", "西安财金", "益中亘泰"]


EVENTS = [
    {
        "key": "litigation",
        "event_type": "不正当竞争诉讼事件",
        "event_date": "2019-02-21",
        "title": "恩智浦起诉南京芯驰及其子公司不正当竞争纠纷进入司法程序",
        "source": "litigation",
        "confidence": 0.82,
        "related_indicator_id": "R12",
        "notes": "公开行业媒体与公开诉讼索引交叉核验事件存在；案号、裁判结果和当前效力尚未由免费司法来源确认。",
    },
    {
        "key": "management",
        "event_type": "核心管理层变动事件",
        "event_date": "2023-04-14",
        "title": "程泰毅加入芯驰担任首席执行官并调整联合创始人分工",
        "source": "management",
        "confidence": 0.96,
        "related_indicator_id": "R22",
        "notes": "芯驰官网新闻目录与后续官网活动信息确认程泰毅担任首席执行官。",
    },
    {
        "key": "business_pause",
        "event_type": "智能驾驶业务调整事件",
        "event_date": "2023-12-26",
        "title": "媒体报道芯驰中止汽车智能驾驶芯片业务并实施组织调整",
        "source": "business_pause",
        "confidence": 0.8,
        "related_indicator_id": "R08",
        "notes": "芯流智库经搜狐发布的独家报道；报道提及战略资源冲突、组织调整和部分中层人员流失，未来是否重启待确认。",
    },
]


ARGUMENTS = [
    {
        "event": "litigation",
        "subject_name": "恩智浦（中国）管理有限公司",
        "subject_type": "企业",
        "relation_type": "涉及",
        "source": "litigation",
        "confidence": 0.82,
        "quote": "公开报道明确记载恩智浦起诉南京芯驰及其全资子公司，案件进入司法程序。",
    },
    {
        "event": "management",
        "subject_name": "程泰毅",
        "subject_type": "人员",
        "relation_type": "涉及",
        "source": "management",
        "confidence": 0.96,
        "quote": "芯驰官网信息确认程泰毅于2023年加入并担任首席执行官。",
    },
    {
        "event": "business_pause",
        "subject_name": "智能驾驶业务与组织调整",
        "subject_type": "内部因素",
        "relation_type": "涉及",
        "source": "business_pause",
        "confidence": 0.8,
        "quote": "媒体报道将业务中止与战略资源冲突、组织调整及部分中层人员流失联系起来。",
    },
]


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def next_id(conn: sqlite3.Connection, table: str, column: str) -> int:
    return int(conn.execute(f"SELECT COALESCE(MAX({column}), 0) + 1 FROM {table}").fetchone()[0])


def latest_capture_for_url(url: str) -> str:
    capture_dir = ROOT / "data" / "edge_captures"
    candidates: list[tuple[float, Path]] = []
    for path in capture_dir.glob("edge_capture_*.json"):
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if payload.get("page_url") == url and payload.get("company") == COMPANY_NAME:
            candidates.append((path.stat().st_mtime, path))
    if not candidates:
        return ""
    return str(max(candidates, key=lambda item: item[0])[1])


def upsert_source(conn: sqlite3.Connection, spec: dict[str, Any], accessed_at: str) -> int:
    row = conn.execute("SELECT source_id FROM sources WHERE url=? ORDER BY source_id LIMIT 1", (spec["url"],)).fetchone()
    local_file = latest_capture_for_url(spec["url"])
    if row:
        source_id = int(row["source_id"])
        conn.execute(
            """UPDATE sources SET source_type=?,institution=?,title=?,publication_date=?,
               local_evidence_file=?,accessed_at=?,notes=? WHERE source_id=?""",
            (
                spec["source_type"], spec["institution"], spec["title"], spec["publication_date"],
                local_file, accessed_at, spec["notes"], source_id,
            ),
        )
        return source_id
    source_id = next_id(conn, "sources", "source_id")
    conn.execute(
        """INSERT INTO sources(
               source_id,source_type,institution,title,publication_date,url,
               local_evidence_file,accessed_at,notes,source_database_id
           ) VALUES (?,?,?,?,?,?,?,?,?,?)""",
        (
            source_id, spec["source_type"], spec["institution"], spec["title"],
            spec["publication_date"], spec["url"], local_file, accessed_at,
            spec["notes"], SOURCE_DATABASE_ID,
        ),
    )
    return source_id


def upsert_company(conn: sqlite3.Connection) -> int:
    row = conn.execute("SELECT company_id FROM companies WHERE stock_code=?", (STOCK_CODE,)).fetchone()
    values = (
        "芯驰科技", COMPANY_NAME, "芯驰科技;南京芯驰半导体科技有限公司;SemiDrive",
        "车规芯片设计与智能汽车计算", "未上市", "非上市", "汽车半导体与集成电路设计",
        "新增非上市车规芯片企业试点；使用官网与免费公开证据构建。",
        SOURCES["profile"]["url"], "高", 0.98,
        "官网页脚确认法律主体，官网与多项公开来源交叉核验。",
    )
    if row:
        company_id = int(row["company_id"])
        conn.execute(
            """UPDATE companies SET short_name=?,current_sse_name=?,full_name=?,aliases=?,
               chain_segment=?,board=?,exchange=?,sse_industry=?,selection_reason=?,source_url=?,
               confidence=?,confidence_score=?,confidence_reason=?,source_database_id=?
               WHERE company_id=?""",
            (
                values[0], values[1], values[1], values[2], values[3], values[4], values[5],
                values[6], values[7], values[8], values[9], values[10], values[11],
                SOURCE_DATABASE_ID, company_id,
            ),
        )
        return company_id
    company_id = next_id(conn, "companies", "company_id")
    crawler = conn.execute("SELECT id FROM crawler_companies WHERE name=?", (COMPANY_NAME,)).fetchone()
    conn.execute(
        """INSERT INTO companies(
               company_id,stock_code,short_name,current_sse_name,full_name,aliases,chain_segment,
               board,exchange,list_date,sse_industry,selection_reason,source_url,confidence,
               confidence_score,confidence_reason,source_database_id,source_company_id
           ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (
            company_id, STOCK_CODE, values[0], values[1], values[1], values[2], values[3],
            values[4], values[5], "", values[6], values[7], values[8], values[9],
            values[10], values[11], SOURCE_DATABASE_ID, int(crawler["id"]) if crawler else None,
        ),
    )
    return company_id


def upsert_supplier_profiles(conn: sqlite3.Connection, company_id: int, source_id: int) -> int:
    changed = 0
    for index, (name, relationship, domestic) in enumerate(PARTNERS, start=1):
        row = conn.execute(
            "SELECT profile_id FROM tyc_supplier_profiles WHERE company_id=? AND supplier_name=? AND source_id=?",
            (company_id, name, source_id),
        ).fetchone()
        values = (
            f"semidrive-official-partner-{index:02d}", name, "2026-08-27", "", "",
            relationship, 0, name, "", "", "", domestic, source_id,
        )
        if row:
            conn.execute(
                """UPDATE tyc_supplier_profiles SET supplier_graph_id=?,announcement_date=?,
                   purchase_amount=?,purchase_ratio=?,relationship=?,profile_error_code=?,
                   profile_name=?,profile_base=?,profile_city=?,profile_reg_location=?,domestic_flag=?
                   WHERE profile_id=?""",
                (
                    values[0], values[2], values[3], values[4], values[5], values[6],
                    values[7], values[8], values[9], values[10], values[11], int(row["profile_id"]),
                ),
            )
        else:
            profile_id = next_id(conn, "tyc_supplier_profiles", "profile_id")
            conn.execute(
                """INSERT INTO tyc_supplier_profiles(
                       profile_id,company_id,supplier_graph_id,supplier_name,announcement_date,
                       purchase_amount,purchase_ratio,relationship,profile_error_code,profile_name,
                       profile_base,profile_city,profile_reg_location,domestic_flag,source_id
                   ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (profile_id, company_id, *values),
            )
        changed += 1
    return changed


def upsert_auxiliary_relation(conn: sqlite3.Connection, key: str, item: dict[str, Any]) -> None:
    payload = json.dumps(item, ensure_ascii=False, sort_keys=True)
    row = conn.execute(
        "SELECT auxiliary_row_id FROM source_auxiliary_rows WHERE source_database_id=? AND table_name='entity_relations' AND source_row_key=?",
        (SOURCE_DATABASE_ID, key),
    ).fetchone()
    if row:
        conn.execute("UPDATE source_auxiliary_rows SET row_json=? WHERE auxiliary_row_id=?", (payload, int(row["auxiliary_row_id"])))
        return
    conn.execute(
        "INSERT INTO source_auxiliary_rows(auxiliary_row_id,source_database_id,table_name,source_row_key,row_json) VALUES (?,?,?,?,?)",
        (next_id(conn, "source_auxiliary_rows", "auxiliary_row_id"), SOURCE_DATABASE_ID, "entity_relations", key, payload),
    )


def upsert_people_and_investors(conn: sqlite3.Connection, source_ids: dict[str, int]) -> None:
    for person in PEOPLE:
        attrs = {
            "姓名": person["name"], "职务": person["position"], "人物介绍": person["profile"],
            "人物标签": person["position"], "证据网址": SOURCES[person["source"]]["url"],
        }
        item = {
            "id": person["key"], "subject_name": COMPANY_NAME, "object_name": person["name"],
            "relation_type": "has_person", "needs_review": person["needs_review"],
            "confidence": 0.96, "source_name": SOURCES[person["source"]]["title"],
            "source_id": source_ids[person["source"]], "attributes_json": json.dumps(attrs, ensure_ascii=False),
        }
        upsert_auxiliary_relation(conn, person["key"], item)
    for index, investor in enumerate(INVESTORS, start=1):
        key = f"semidrive-investor-{index:02d}"
        attrs = {
            "股东名称": investor, "股东性质": "产业投资机构", "股本性质": "C轮融资投资方",
            "持股比例(%)": "", "持股数额": "", "证据网址": SOURCES["financing"]["url"],
        }
        item = {
            "id": key, "subject_name": COMPANY_NAME, "object_name": investor,
            "relation_type": "has_person", "needs_review": True, "confidence": 0.93,
            "source_name": SOURCES["financing"]["title"], "source_id": source_ids["financing"],
            "attributes_json": json.dumps(attrs, ensure_ascii=False),
        }
        upsert_auxiliary_relation(conn, key, item)


def upsert_customer_relations(conn: sqlite3.Connection, source_ids: dict[str, int]) -> int:
    for index, (name, publish_date, relationship, source_key) in enumerate(CUSTOMERS, start=1):
        key = f"semidrive-customer-{index:02d}"
        attrs = {
            "counterparty_name": name,
            "publish_date": publish_date,
            "relationship": relationship,
            "evidence_url": SOURCES[source_key]["url"],
        }
        item = {
            "id": key,
            "subject_name": COMPANY_NAME,
            "object_name": name,
            "relation_type": "has_customer",
            "needs_review": False,
            "confidence": 0.95,
            "source_name": SOURCES[source_key]["title"],
            "source_id": source_ids[source_key],
            "attributes_json": json.dumps(attrs, ensure_ascii=False),
        }
        upsert_auxiliary_relation(conn, key, item)
    return len(CUSTOMERS)


def upsert_events(conn: sqlite3.Connection, company_id: int, source_ids: dict[str, int]) -> dict[str, int]:
    event_ids: dict[str, int] = {}
    for event in EVENTS:
        source = SOURCES[event["source"]]
        row = conn.execute(
            "SELECT event_id FROM deep_search_events WHERE company_id=? AND event_date=? AND title=?",
            (company_id, event["event_date"], event["title"]),
        ).fetchone()
        notes = f"{event['notes']} source_id={source_ids[event['source']]}"
        if row:
            event_id = int(row["event_id"])
            conn.execute(
                """UPDATE deep_search_events SET event_type=?,url=?,source_channel=?,confidence=?,
                   confidence_score=?,related_indicator_id=?,notes=? WHERE event_id=?""",
                (
                    event["event_type"], source["url"], source["institution"], "中",
                    event["confidence"], event["related_indicator_id"], notes, event_id,
                ),
            )
        else:
            event_id = next_id(conn, "deep_search_events", "event_id")
            conn.execute(
                """INSERT INTO deep_search_events(
                       event_id,company_id,event_type,event_date,title,url,source_channel,
                       confidence,confidence_score,related_indicator_id,notes
                   ) VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    event_id, company_id, event["event_type"], event["event_date"], event["title"],
                    source["url"], source["institution"], "中", event["confidence"],
                    event["related_indicator_id"], notes,
                ),
            )
        event_ids[event["key"]] = event_id
    return event_ids


def upsert_arguments(
    conn: sqlite3.Connection,
    company_id: int,
    event_ids: dict[str, int],
    source_ids: dict[str, int],
    retrieved_at: str,
) -> int:
    count = 0
    for argument in ARGUMENTS:
        event_id = event_ids[argument["event"]]
        source = SOURCES[argument["source"]]
        duplicate_key = "|".join(
            (str(company_id), str(event_id), argument["subject_name"], argument["relation_type"], source["publication_date"])
        )
        values = (
            company_id, event_id, f"event:{event_id}", source_ids[argument["source"]],
            argument["subject_name"], argument["subject_type"], argument["relation_type"],
            COMPANY_NAME, source["publication_date"], source["title"], source["url"],
            source["institution"], source["source_type"], source["publication_date"],
            argument["quote"], retrieved_at, argument["confidence"], "已确认", duplicate_key,
        )
        conn.execute(
            """INSERT INTO external_subject_evidence(
                   company_id,event_id,event_stable_id,source_id,subject_name,subject_type,
                   relation_type,object_name,event_date,source_title,source_url,source_institution,
                   source_type,publish_date,evidence_quote,retrieval_time,confidence_score,
                   review_status,duplicate_key
               ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
               ON CONFLICT(duplicate_key) DO UPDATE SET
                   source_id=excluded.source_id,source_title=excluded.source_title,
                   source_url=excluded.source_url,evidence_quote=excluded.evidence_quote,
                   retrieval_time=excluded.retrieval_time,confidence_score=excluded.confidence_score,
                   review_status=excluded.review_status""",
            values,
        )
        count += 1
    return count


def upsert_indicator_coverage(conn: sqlite3.Connection, company_id: int) -> None:
    covered = {"R06", "R07", "R08", "R09", "R12", "R16", "R17", "R19", "R21", "R22"}
    for indicator_id in covered:
        if not conn.execute("SELECT 1 FROM indicator_catalog WHERE indicator_id=?", (indicator_id,)).fetchone():
            continue
        conn.execute(
            """INSERT INTO indicator_coverage(
                   company_id,indicator_id,coverage_status,usable_for_scoring,confidence,
                   confidence_score,reason,recommended_next_source
               ) VALUES (?,?,'partial',0,'中',0.82,?,?)
               ON CONFLICT(company_id,indicator_id) DO UPDATE SET
                   coverage_status=excluded.coverage_status,
                   usable_for_scoring=excluded.usable_for_scoring,
                   confidence=excluded.confidence,
                   confidence_score=excluded.confidence_score,
                   reason=excluded.reason,
                   recommended_next_source=excluded.recommended_next_source""",
            (
                company_id, indicator_id,
                "已取得官网和公开事件证据，但缺少完整财务、持股比例或司法裁判结构化字段。",
                "优先补充企业授权财务报表、股东持股比例和公开裁判结果。",
            ),
        )


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed the Edge-verified SemiDrive FEE-KBG pilot.")
    parser.add_argument("--db", type=Path, default=DEFAULT_DB)
    args = parser.parse_args()
    accessed_at = now_iso()
    with sqlite3.connect(args.db, timeout=120) as conn:
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute("PRAGMA busy_timeout = 120000")
        source_ids = {key: upsert_source(conn, spec, accessed_at) for key, spec in SOURCES.items()}
        company_id = upsert_company(conn)
        supplier_count = upsert_supplier_profiles(conn, company_id, source_ids["partners"])
        upsert_people_and_investors(conn, source_ids)
        customer_count = upsert_customer_relations(conn, source_ids)
        event_ids = upsert_events(conn, company_id, source_ids)
        argument_count = upsert_arguments(conn, company_id, event_ids, source_ids, accessed_at)
        upsert_indicator_coverage(conn, company_id)
        conn.commit()
    print(json.dumps({
        "company_id": company_id,
        "company": COMPANY_NAME,
        "stock_code": STOCK_CODE,
        "source_count": len(source_ids),
        "supplier_count": supplier_count,
        "customer_count": customer_count,
        "event_ids": event_ids,
        "argument_count": argument_count,
        "db": str(args.db),
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
