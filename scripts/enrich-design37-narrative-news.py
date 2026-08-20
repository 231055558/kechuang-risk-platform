#!/usr/bin/env python3
"""Add auditable finance-news narrative proxies to a copy of the design37 DB."""

from __future__ import annotations

import argparse
import json
import shutil
import sqlite3
from pathlib import Path


ACCESS_DATE = "2026-08-20"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("base_db", type=Path)
    parser.add_argument("news_json", type=Path)
    parser.add_argument("output_db", type=Path)
    parser.add_argument("--notes", type=Path)
    return parser.parse_args()


def confidence_label(score: float) -> str:
    return "高" if score >= 0.85 else "中" if score >= 0.60 else "低"


def create_tables(connection: sqlite3.Connection) -> None:
    connection.executescript(
        """
        CREATE TABLE IF NOT EXISTS narrative_news_evidence (
          news_id INTEGER PRIMARY KEY,
          company_id INTEGER NOT NULL REFERENCES companies(company_id),
          article_code TEXT,
          published_at TEXT,
          title TEXT NOT NULL,
          summary TEXT,
          media_name TEXT,
          url TEXT NOT NULL,
          positive_flag INTEGER NOT NULL,
          negative_flag INTEGER NOT NULL,
          concept_flag INTEGER NOT NULL,
          concept_keywords TEXT,
          source_id INTEGER NOT NULL REFERENCES sources(source_id),
          accessed_at TEXT NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_narrative_news_company_url
          ON narrative_news_evidence(company_id, url);
        CREATE INDEX IF NOT EXISTS idx_narrative_news_company_date
          ON narrative_news_evidence(company_id, published_at);

        CREATE TABLE IF NOT EXISTS narrative_news_metrics (
          company_id INTEGER PRIMARY KEY REFERENCES companies(company_id),
          cutoff_date TEXT NOT NULL,
          newest_date TEXT,
          oldest_date TEXT,
          hits_total INTEGER,
          retrieved_count INTEGER NOT NULL,
          media_count INTEGER NOT NULL,
          positive_count INTEGER NOT NULL,
          negative_count INTEGER NOT NULL,
          concept_count INTEGER NOT NULL,
          positive_share_pct REAL,
          negative_share_pct REAL,
          tone_balance_pct REAL,
          concept_share_pct REAL,
          pages_fetched INTEGER NOT NULL,
          truncated INTEGER NOT NULL,
          source_id INTEGER NOT NULL REFERENCES sources(source_id),
          limitations TEXT NOT NULL
        );
        """
    )


def add_observation(
    connection: sqlite3.Connection,
    *,
    company_id: int,
    indicator_id: str,
    metric_name: str,
    value: float,
    unit: str,
    formula: str,
    source_id: int,
    excerpt: str,
    confidence: float,
    limitations: str,
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
            "2025-08-20",
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
            confidence_label(confidence),
            confidence,
            "财经新闻搜索结果的可复现计数与规则词典代理",
            limitations,
        ),
    )


def update_coverage(
    connection: sqlite3.Connection,
    company_id: int,
    indicator_id: str,
    reason: str,
    recommended_source: str,
    confidence: float,
) -> None:
    connection.execute(
        """
        UPDATE indicator_coverage
        SET coverage_status='部分覆盖', usable_for_scoring=0,
            confidence=?, confidence_score=?, reason=?, recommended_next_source=?
        WHERE company_id=? AND indicator_id=?
        """,
        (
            confidence_label(confidence),
            confidence,
            reason,
            recommended_source,
            company_id,
            indicator_id,
        ),
    )


def write_notes(path: Path, *, output_db: Path, company_count: int, news_count: int) -> None:
    path.write_text(
        f"""# 37家数字芯片设计企业叙事新闻增强说明

数据更新日：{ACCESS_DATE}

## 新增内容

- 企业：{company_count} 家；
- 财经新闻证据：{news_count:,} 条；
- 来源：东方财富资讯搜索返回的媒体名称、发布日期、标题、搜索摘要和文章链接；
- 新增表：`narrative_news_evidence`、`narrative_news_metrics`；
- 新增观测：R01、R02、R04 的检索数量、媒体多样性、正负向词典和概念关键词代理。

## 口径限制

- 搜索最多抓取每家公司按时间排序的 5 页×50 条，热门公司存在截断；
- 搜索摘要、转载和行情消息不能代替完整财经新闻数据库；
- 情感与概念标签由固定关键词词典生成，不代表人工事实认定；
- R01 仍缺完整月度语料及与基本面统一建模；
- R02 仍缺公司自述与第三方全文的逐项对齐；
- R04 仍缺概念标签对应业务收入分母；
- 因此三项均标为“部分覆盖”，`usable_for_scoring=0`。

## 天眼查付费 API

本版未产生付费调用。浏览器中的普通天眼查账号已登录，但开放平台返回“请先登录”，相关接口仍显示“申请接口”，尚无可用 API 授权和余额上下文。

输出数据库：`{output_db.name}`
""",
        encoding="utf-8",
    )


def main() -> None:
    args = parse_args()
    payload = json.loads(args.news_json.read_text(encoding="utf-8"))
    args.output_db.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(args.base_db, args.output_db)

    connection = sqlite3.connect(args.output_db)
    connection.execute("PRAGMA foreign_keys=ON")
    try:
        create_tables(connection)
        company_ids = {
            row[0]: row[1]
            for row in connection.execute(
                "SELECT stock_code,company_id FROM companies"
            )
        }
        total_news = 0
        for company in payload["companies"]:
            company_id = company_ids[company["stock_code"]]
            confidence = 0.62 if company["truncated"] else 0.70
            source_title = (
                f'{company["stock_code"]} {company["short_name"]}'
                " 东方财富财经新闻检索"
            )
            cursor = connection.execute(
                """
                INSERT INTO sources(
                  source_type,institution,title,publication_date,url,
                  local_evidence_file,accessed_at,notes
                ) VALUES(?,?,?,?,?,?,?,?)
                """,
                (
                    "财经新闻检索语料",
                    "东方财富资讯搜索（媒体聚合）",
                    source_title,
                    company.get("newest_date"),
                    company["search_url"],
                    str(args.news_json.resolve()),
                    ACCESS_DATE,
                    "最多5页×50条；标题或摘要命中公司简称；按URL去重。",
                ),
            )
            source_id = int(cursor.lastrowid)

            for article in company["articles"]:
                connection.execute(
                    """
                    INSERT OR IGNORE INTO narrative_news_evidence(
                      company_id,article_code,published_at,title,summary,media_name,url,
                      positive_flag,negative_flag,concept_flag,concept_keywords,
                      source_id,accessed_at
                    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
                    """,
                    (
                        company_id,
                        article.get("article_code"),
                        article.get("published_at"),
                        article["title"],
                        article.get("summary"),
                        article.get("media_name"),
                        article["url"],
                        int(article.get("positive_flag", False)),
                        int(article.get("negative_flag", False)),
                        int(article.get("concept_flag", False)),
                        ";".join(article.get("concept_keywords", [])),
                        source_id,
                        ACCESS_DATE,
                    ),
                )
                total_news += 1

            retrieved = int(company["retrieved_count"])
            divisor = retrieved or 1
            positive_share = 100.0 * company["positive_count"] / divisor
            negative_share = 100.0 * company["negative_count"] / divisor
            tone_balance = 100.0 * (
                company["positive_count"] - company["negative_count"]
            ) / divisor
            concept_share = 100.0 * company["concept_count"] / divisor
            limitations = (
                "检索结果存在截断、转载和行情噪声；仅表示已抓取语料的代理，"
                "不能解释为新闻全量或风险概率。"
            )
            connection.execute(
                """
                INSERT OR REPLACE INTO narrative_news_metrics VALUES(
                  ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?
                )
                """,
                (
                    company_id,
                    company["cutoff_date"],
                    company.get("newest_date"),
                    company.get("oldest_date"),
                    company.get("hits_total"),
                    retrieved,
                    company["media_count"],
                    company["positive_count"],
                    company["negative_count"],
                    company["concept_count"],
                    round(positive_share, 6),
                    round(negative_share, 6),
                    round(tone_balance, 6),
                    round(concept_share, 6),
                    company["pages_fetched"],
                    int(company["truncated"]),
                    source_id,
                    limitations,
                ),
            )
            excerpt = (
                f'抓取{retrieved}条，媒体{company["media_count"]}家，'
                f'正向词典{company["positive_count"]}条，'
                f'负向词典{company["negative_count"]}条，'
                f'概念关键词{company["concept_count"]}条；'
                f'检索截断={int(company["truncated"])}。'
            )
            add_observation(
                connection,
                company_id=company_id,
                indicator_id="R01",
                metric_name="finance_news_retrieved_count_proxy",
                value=retrieved,
                unit="条",
                formula="东方财富资讯按时间排序最多5页×50条；简称命中并按URL去重",
                source_id=source_id,
                excerpt=excerpt,
                confidence=confidence,
                limitations="缺完整月度新闻库与基本面联合标准化，不直接评分。",
            )
            add_observation(
                connection,
                company_id=company_id,
                indicator_id="R01",
                metric_name="finance_news_media_diversity_proxy",
                value=company["media_count"],
                unit="家媒体",
                formula="去重新闻的media_name去重计数",
                source_id=source_id,
                excerpt=excerpt,
                confidence=confidence,
                limitations="媒体名称来自聚合搜索结果，转载关系未完全消除。",
            )
            add_observation(
                connection,
                company_id=company_id,
                indicator_id="R02",
                metric_name="third_party_positive_news_share_pct_proxy",
                value=round(positive_share, 6),
                unit="%",
                formula="正向词典命中新闻数÷已抓取新闻数×100%",
                source_id=source_id,
                excerpt=excerpt,
                confidence=confidence,
                limitations="固定词典不能替代第三方全文与公司自述的逐项语义对齐。",
            )
            add_observation(
                connection,
                company_id=company_id,
                indicator_id="R02",
                metric_name="third_party_negative_news_share_pct_proxy",
                value=round(negative_share, 6),
                unit="%",
                formula="负向词典命中新闻数÷已抓取新闻数×100%",
                source_id=source_id,
                excerpt=excerpt,
                confidence=confidence,
                limitations="固定词典不能替代第三方全文与公司自述的逐项语义对齐。",
            )
            add_observation(
                connection,
                company_id=company_id,
                indicator_id="R02",
                metric_name="third_party_tone_balance_pct_proxy",
                value=round(tone_balance, 6),
                unit="百分点",
                formula="(正向词典命中数-负向词典命中数)÷已抓取新闻数×100",
                source_id=source_id,
                excerpt=excerpt,
                confidence=confidence,
                limitations="同时命中正负词的新闻未做上下文消歧。",
            )
            add_observation(
                connection,
                company_id=company_id,
                indicator_id="R04",
                metric_name="concept_keyword_news_share_pct_proxy",
                value=round(concept_share, 6),
                unit="%",
                formula="概念关键词命中新闻数÷已抓取新闻数×100%",
                source_id=source_id,
                excerpt=excerpt,
                confidence=confidence,
                limitations="新闻概念热度没有对应业务收入分母，不直接评分。",
            )

            update_coverage(
                connection,
                company_id,
                "R01",
                "新增财经新闻检索数量与媒体多样性代理；仍缺完整月度语料和基本面联合建模。",
                "授权财经新闻数据库、月度搜索热度与季度基本面",
                confidence,
            )
            update_coverage(
                connection,
                company_id,
                "R02",
                "新增第三方财经新闻正负向固定词典代理；仍缺公司自述与第三方全文逐项对齐。",
                "公司公告/互动文本与权威媒体全文语料",
                confidence,
            )
            update_coverage(
                connection,
                company_id,
                "R04",
                "新增财经新闻概念关键词占比代理；仍缺概念标签对应业务收入分母。",
                "概念标签库、产品收入及分部收入",
                confidence,
            )

        connection.executemany(
            "INSERT OR REPLACE INTO metadata(key,value) VALUES(?,?)",
            [
                ("data_version", "2026-08-20-design37-narrative-news-v3"),
                ("narrative_news_source", "东方财富资讯搜索；最多5页×50条"),
                ("narrative_news_articles", str(total_news)),
                (
                    "paid_api_usage",
                    "0元；天眼查开放平台未绑定，接口仍为申请状态，未发起付费调用",
                ),
            ],
        )
        connection.execute(
            "INSERT INTO deep_search_audit(update_date,method,details) VALUES(?,?,?)",
            (
                ACCESS_DATE,
                "Ego财经新闻检索",
                f"37家公司；东方财富资讯搜索证据{total_news}条；R01/R02/R04仅部分覆盖，不直接评分。",
            ),
        )
        connection.commit()
        violations = connection.execute("PRAGMA foreign_key_check").fetchall()
        if violations:
            raise RuntimeError(f"Foreign-key violations: {violations[:5]}")
    finally:
        connection.close()

    if args.notes:
        write_notes(
            args.notes,
            output_db=args.output_db,
            company_count=len(payload["companies"]),
            news_count=total_news,
        )
    print(
        json.dumps(
            {
                "output_db": str(args.output_db),
                "companies": len(payload["companies"]),
                "news": total_news,
                "paid_api_cost_cny": 0,
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
