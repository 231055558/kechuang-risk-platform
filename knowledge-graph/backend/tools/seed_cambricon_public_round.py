"""Seed newly verified free public Cambricon risk disclosures.

No paid API is called. The script is idempotent and links each promoted event
to an official disclosure source retained in the master database.
"""

from __future__ import annotations

import argparse
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DB = ROOT / "data" / "risk_data.sqlite"
COMPANY = "中科寒武纪科技股份有限公司"
STOCK_CODE = "688256"
SOURCE_URL = "https://static.sse.com.cn/stock/disclosure/announcement/c/202506/688256_20250604_5OJ3.pdf"
SOURCE_TITLE = "中科寒武纪科技股份有限公司2025年度向特定对象发行股票募集说明书"
EVENT_DATE = "2025-06-04"
EVENT_TITLE = "2025年再融资募集说明书披露前五大客户收入占比持续超过80%"


def next_id(conn: sqlite3.Connection, table: str, column: str) -> int:
    return int(conn.execute(f"SELECT COALESCE(MAX({column}),0)+1 FROM {table}").fetchone()[0])


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", type=Path, default=DEFAULT_DB)
    args = parser.parse_args()
    now = datetime.now(timezone.utc).isoformat()
    with sqlite3.connect(args.db, timeout=120) as conn:
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys=ON")
        company = conn.execute("SELECT company_id FROM companies WHERE stock_code=?", (STOCK_CODE,)).fetchone()
        if not company:
            raise RuntimeError("寒武纪主库企业记录不存在")
        company_id = int(company["company_id"])

        source = conn.execute("SELECT source_id FROM sources WHERE url=?", (SOURCE_URL,)).fetchone()
        if source:
            source_id = int(source["source_id"])
            conn.execute(
                """UPDATE sources SET source_type='交易所官方披露',institution='上海证券交易所',
                   title=?,publication_date=?,accessed_at=?,notes=? WHERE source_id=?""",
                (
                    SOURCE_TITLE, EVENT_DATE, now,
                    "募集说明书披露前五大客户销售占比持续超过80%，并提示客户需求和新客户拓展风险。",
                    source_id,
                ),
            )
        else:
            source_id = next_id(conn, "sources", "source_id")
            conn.execute(
                """INSERT INTO sources(source_id,source_type,institution,title,publication_date,url,
                   local_evidence_file,accessed_at,notes,source_database_id)
                   VALUES (?,'交易所官方披露','上海证券交易所',?,?,?,'',?,?,?)""",
                (
                    source_id, SOURCE_TITLE, EVENT_DATE, SOURCE_URL, now,
                    "募集说明书披露前五大客户销售占比持续超过80%，并提示客户需求和新客户拓展风险。",
                    "cambricon-public-round-20260827",
                ),
            )

        event = conn.execute(
            "SELECT event_id FROM deep_search_events WHERE company_id=? AND event_date=? AND title=?",
            (company_id, EVENT_DATE, EVENT_TITLE),
        ).fetchone()
        notes = (
            "上交所官方募集说明书披露：报告期各期前五大客户销售占比均在80%以上；"
            "主要客户需求放缓或新客户拓展不及预期可能影响经营业绩。"
        )
        if event:
            event_id = int(event["event_id"])
            conn.execute(
                """UPDATE deep_search_events SET event_type='客户集中度风险披露',url=?,
                   source_channel='上海证券交易所',confidence='高',confidence_score=0.98,
                   related_indicator_id='R13',notes=? WHERE event_id=?""",
                (SOURCE_URL, notes, event_id),
            )
        else:
            event_id = next_id(conn, "deep_search_events", "event_id")
            conn.execute(
                """INSERT INTO deep_search_events(event_id,company_id,event_type,event_date,title,url,
                   source_channel,confidence,confidence_score,related_indicator_id,notes)
                   VALUES (?,?,'客户集中度风险披露',?,?,?,'上海证券交易所','高',0.98,'R13',?)""",
                (event_id, company_id, EVENT_DATE, EVENT_TITLE, SOURCE_URL, notes),
            )

        duplicate_key = f"{company_id}|{event_id}|客户集中度与新客户拓展压力|涉及|{EVENT_DATE}"
        conn.execute(
            """INSERT INTO external_subject_evidence(company_id,event_id,event_stable_id,source_id,
               subject_name,subject_type,relation_type,object_name,event_date,source_title,source_url,
               source_institution,source_type,publish_date,evidence_quote,retrieval_time,
               confidence_score,review_status,duplicate_key)
               VALUES (?,?,?,?,'客户集中度与新客户拓展压力','内部因素','涉及',?,?,?, ?,
               '上海证券交易所','交易所官方披露',?,?,?,?,'已确认',?)
               ON CONFLICT(duplicate_key) DO UPDATE SET source_id=excluded.source_id,
               evidence_quote=excluded.evidence_quote,retrieval_time=excluded.retrieval_time,
               confidence_score=excluded.confidence_score,review_status=excluded.review_status""",
            (
                company_id, event_id, f"event:{event_id}", source_id, COMPANY, EVENT_DATE,
                SOURCE_TITLE, SOURCE_URL, EVENT_DATE,
                "官方募集说明书明确披露前五大客户收入占比持续超过80%及新客户拓展压力。",
                now, 0.98, duplicate_key,
            ),
        )
        conn.commit()
    print(json.dumps({"company_id": company_id, "source_id": source_id, "event_id": event_id}, ensure_ascii=False))


if __name__ == "__main__":
    main()
