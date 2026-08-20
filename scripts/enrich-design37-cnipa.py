#!/usr/bin/env python3
"""Add official CNIPA applicant portfolios and verified legal-status events."""

from __future__ import annotations

import argparse
import json
import shutil
import sqlite3
from collections import Counter
from pathlib import Path
from typing import Any


ACCESS_DATE = "2026-08-20"
CNIPA_URL = "https://pss-system.cponline.cnipa.gov.cn/conventionalSearch"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("base_db", type=Path)
    parser.add_argument("cnipa_json", type=Path)
    parser.add_argument("output_db", type=Path)
    parser.add_argument("--notes", type=Path)
    return parser.parse_args()


def add_observation(
    connection: sqlite3.Connection,
    *,
    company_id: int,
    indicator_id: str,
    metric_name: str,
    value: float,
    unit: str,
    source_id: int,
    excerpt: str,
    formula: str,
    limitations: str,
    confidence: float,
) -> None:
    connection.execute(
        """
        INSERT INTO observations(
          company_id,indicator_id,metric_name,period_start,period_end,as_of_date,
          numeric_value,text_value,unit,status,is_derived,formula,source_id,
          source_page,evidence_excerpt,confidence,confidence_score,
          confidence_reason,limitations
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        """,
        (
            company_id,
            indicator_id,
            metric_name,
            ACCESS_DATE,
            ACCESS_DATE,
            ACCESS_DATE,
            value,
            None,
            unit,
            "partial",
            1,
            formula,
            source_id,
            None,
            excerpt,
            "高" if confidence >= 0.85 else "中",
            confidence,
            "国家知识产权局登录检索的结构化结果",
            limitations,
        ),
    )


def create_tables(connection: sqlite3.Connection) -> None:
    connection.executescript(
        """
        CREATE TABLE IF NOT EXISTS cnipa_applicant_portfolios (
          portfolio_id INTEGER PRIMARY KEY,
          company_id INTEGER NOT NULL REFERENCES companies(company_id),
          listed_name TEXT NOT NULL,
          query_name TEXT NOT NULL,
          entity_relation TEXT NOT NULL,
          database_scope TEXT NOT NULL,
          total_count INTEGER NOT NULL,
          valid_count INTEGER NOT NULL,
          invalid_count INTEGER NOT NULL,
          source_id INTEGER NOT NULL REFERENCES sources(source_id),
          accessed_at TEXT NOT NULL,
          UNIQUE(company_id, query_name)
        );

        CREATE TABLE IF NOT EXISTS cnipa_patent_legal_events (
          legal_event_id INTEGER PRIMARY KEY,
          company_id INTEGER NOT NULL REFERENCES companies(company_id),
          application_number TEXT NOT NULL,
          publication_number TEXT,
          patent_title TEXT NOT NULL,
          applicant TEXT NOT NULL,
          event_date TEXT NOT NULL,
          event_code TEXT NOT NULL,
          event_meaning TEXT NOT NULL,
          data_source TEXT NOT NULL,
          source_id INTEGER NOT NULL REFERENCES sources(source_id),
          UNIQUE(application_number, event_date, event_code)
        );
        """
    )


def write_notes(path: Path, output_db: Path, summary: dict[str, int]) -> None:
    path.write_text(
        f"""# 37家数字芯片设计企业国家知识产权局增强说明

更新日：{ACCESS_DATE}

## 本批新增

- 在用户授权登录会话中，按申请人精确名称检索国家知识产权局专利检索及分析系统；
- 覆盖 {summary['companies']} 家上市公司、{summary['portfolio_queries']} 个申请人主体；
- 保存总量、有效和无效三类系统口径；
- 对天眼查样本发现的 5 条不利状态逐件回到国知局法律状态页核验，5 条均得到 CNPRS_STD 事件记录；
- 格科微上市主体检索为 0，境内核心经营主体格科微电子（上海）有限公司检出 1,218 件，已分法人保存；
- 长鑫科技上市主体与长鑫存储技术有限公司分别保存，不跨法人简单相加。

## 口径限制

- “有效/无效”是国知局结果页筛选口径；无效可能包含期限届满、权利终止、撤回、驳回等多种情形，不能直接当成重大技术事故；
- 申请人存量不能替代 R05 所要求的近5年有效发明专利族、去自引前向引用及同业标准化；
- 本批只对已发现的 5 条不利法律状态逐件核验，其他公司的零事件不得由此推断；
- 核心经营主体与上市主体存在控制关系，但不是同一法人。

输出数据库：`{output_db.name}`
""",
        encoding="utf-8",
    )


def main() -> None:
    args = parse_args()
    payload: dict[str, Any] = json.loads(args.cnipa_json.read_text(encoding="utf-8"))
    args.output_db.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(args.base_db, args.output_db)
    connection = sqlite3.connect(args.output_db)
    connection.execute("PRAGMA foreign_keys=ON")
    try:
        create_tables(connection)
        company_ids = {
            row[0]: int(row[1])
            for row in connection.execute("SELECT stock_code,company_id FROM companies")
        }
        portfolio_sources: dict[tuple[str, str], int] = {}
        for row in payload["portfolios"]:
            company_id = company_ids[row["stock_code"]]
            source_cursor = connection.execute(
                """
                INSERT INTO sources(
                  source_type,institution,title,publication_date,url,
                  local_evidence_file,accessed_at,notes
                ) VALUES(?,?,?,?,?,?,?,?)
                """,
                (
                    "官方专利检索",
                    "国家知识产权局",
                    f'{row["stock_code"]} {row["short_name"]} 申请人精确检索：{row["query_name"]}',
                    ACCESS_DATE,
                    CNIPA_URL,
                    str(args.cnipa_json.resolve()),
                    ACCESS_DATE,
                    f'CNDB,WPDB；申请人精确检索；{row["relation"]}；有效/无效为系统筛选口径。',
                ),
            )
            source_id = int(source_cursor.lastrowid)
            portfolio_sources[(row["stock_code"], row["query_name"])] = source_id
            connection.execute(
                """
                INSERT INTO cnipa_applicant_portfolios(
                  company_id,listed_name,query_name,entity_relation,database_scope,
                  total_count,valid_count,invalid_count,source_id,accessed_at
                ) VALUES(?,?,?,?,?,?,?,?,?,?)
                """,
                (
                    company_id,
                    row["listed_name"],
                    row["query_name"],
                    row["relation"],
                    "CNDB,WPDB",
                    row["total"],
                    row["valid"],
                    row["invalid"],
                    source_id,
                    ACCESS_DATE,
                ),
            )
            relation_slug = "listed_entity" if row["relation"] == "上市主体" else "core_operating_entity"
            excerpt = (
                f'申请人“{row["query_name"]}”（{row["relation"]}）精确检索：'
                f'总量{row["total"]}，有效{row["valid"]}，无效{row["invalid"]}。'
            )
            for suffix, value in (
                ("total_count", row["total"]),
                ("valid_count", row["valid"]),
                ("invalid_count", row["invalid"]),
            ):
                add_observation(
                    connection,
                    company_id=company_id,
                    indicator_id="R05",
                    metric_name=f"cnipa_{relation_slug}_{suffix}",
                    value=float(value),
                    unit="项",
                    source_id=source_id,
                    excerpt=excerpt,
                    formula="国家知识产权局申请人精确检索及有效/无效筛选返回数量",
                    limitations=(
                        "申请人专利存量及有效性分类不能替代有效发明专利族、去自引前向引用和同业标准化；"
                        "核心经营主体与上市主体不得跨法人简单相加。"
                    ),
                    confidence=0.92,
                )

        legal_sources: dict[str, int] = {}
        adverse_counts: Counter[str] = Counter()
        for event in payload["verified_legal_events"]:
            company_id = company_ids[event["stock_code"]]
            source_cursor = connection.execute(
                """
                INSERT INTO sources(
                  source_type,institution,title,publication_date,url,
                  local_evidence_file,accessed_at,notes
                ) VALUES(?,?,?,?,?,?,?,?)
                """,
                (
                    "官方专利法律状态",
                    "国家知识产权局",
                    f'{event["application_number"]} {event["event_meaning"]}',
                    event["event_date"],
                    CNIPA_URL,
                    str(args.cnipa_json.resolve()),
                    ACCESS_DATE,
                    f'法律状态数据源{event["data_source"]}；事件代码{event["event_code"]}。',
                ),
            )
            source_id = int(source_cursor.lastrowid)
            legal_sources[event["application_number"]] = source_id
            connection.execute(
                """
                INSERT INTO cnipa_patent_legal_events(
                  company_id,application_number,publication_number,patent_title,
                  applicant,event_date,event_code,event_meaning,data_source,source_id
                ) VALUES(?,?,?,?,?,?,?,?,?,?)
                """,
                (
                    company_id,
                    event["application_number"],
                    event["publication_number"],
                    event["title"],
                    event["applicant"],
                    event["event_date"],
                    event["event_code"],
                    event["event_meaning"],
                    event["data_source"],
                    source_id,
                ),
            )
            connection.execute(
                """
                INSERT INTO deep_search_events(
                  company_id,event_type,event_date,title,url,source_channel,
                  confidence,confidence_score,related_indicator_id,notes
                ) VALUES(?,?,?,?,?,?,?,?,?,?)
                """,
                (
                    company_id,
                    "知识产权法律状态",
                    event["event_date"],
                    f'{event["event_meaning"]}：{event["title"]}',
                    CNIPA_URL,
                    "国家知识产权局专利检索及分析系统",
                    "高",
                    0.97,
                    "R09",
                    f'申请号{event["application_number"]}；公开号{event["publication_number"]}；'
                    f'事件代码{event["event_code"]}；数据源{event["data_source"]}。',
                ),
            )
            adverse_counts[event["stock_code"]] += 1

        for stock_code, count in adverse_counts.items():
            company_id = company_ids[stock_code]
            company_events = [
                item
                for item in payload["verified_legal_events"]
                if item["stock_code"] == stock_code
            ]
            source_id = legal_sources[company_events[0]["application_number"]]
            excerpt = "；".join(
                f'{item["application_number"]} {item["event_date"]} {item["event_meaning"]}'
                for item in company_events
            )
            add_observation(
                connection,
                company_id=company_id,
                indicator_id="R09",
                metric_name="cnipa_verified_adverse_patent_legal_event_count",
                value=float(count),
                unit="项",
                source_id=source_id,
                excerpt=excerpt,
                formula="逐件打开国家知识产权局法律状态页并统计IW01/RJ01不利事件",
                limitations="只核验已由前序样本发现的事件，不代表全量不利知识产权事件数量或现实损失严重度。",
                confidence=0.97,
            )

        # CNIPA provides a useful R09 screening proxy for all companies, but it is
        # deliberately kept non-scoreable because the invalid filter is not a major-event label.
        for company_id in company_ids.values():
            connection.execute(
                """
                UPDATE indicator_coverage
                SET coverage_status='部分覆盖', usable_for_scoring=0,
                    confidence='中', confidence_score=0.76,
                    reason='已取得国知局申请人总量及有效/无效存量口径；无效筛选不等于重大无效宣告或现实损失，仍需逐件法律状态审阅。',
                    recommended_next_source='国家知识产权局逐件法律状态、无效宣告决定、裁判文书及损失金额'
                WHERE company_id=? AND indicator_id='R09'
                """,
                (company_id,),
            )

        connection.executemany(
            "INSERT OR REPLACE INTO metadata(key,value) VALUES(?,?)",
            [
                ("data_version", "2026-08-20-design37-cnipa-v6"),
                ("cnipa_search_status", "用户授权登录后完成37家公司、39个申请人主体精确检索"),
                ("cnipa_portfolio_queries", str(len(payload["portfolios"]))),
                ("cnipa_verified_legal_events", str(len(payload["verified_legal_events"]))),
                ("cnipa_scope_note", "有效/无效为系统筛选口径；核心经营主体与上市主体分开保存"),
            ],
        )
        connection.execute(
            "INSERT INTO deep_search_audit(update_date,method,details) VALUES(?,?,?)",
            (
                ACCESS_DATE,
                "国家知识产权局登录检索",
                "37家公司、39个申请人主体精确检索；有效/无效筛选；5条不利法律状态逐件核验。",
            ),
        )
        connection.commit()
        violations = connection.execute("PRAGMA foreign_key_check").fetchall()
        if violations:
            raise RuntimeError(f"Foreign-key violations: {violations[:5]}")
    finally:
        connection.close()

    summary = {
        "companies": len({item["stock_code"] for item in payload["portfolios"]}),
        "portfolio_queries": len(payload["portfolios"]),
        "verified_legal_events": len(payload["verified_legal_events"]),
    }
    if args.notes:
        write_notes(args.notes, args.output_db, summary)
    print(json.dumps({"output_db": str(args.output_db), "summary": summary}, ensure_ascii=False))


if __name__ == "__main__":
    main()
