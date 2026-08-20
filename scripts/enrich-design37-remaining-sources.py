#!/usr/bin/env python3
"""Add targeted supplier, patent, R18 and Changxin official-report evidence."""

from __future__ import annotations

import argparse
import json
import re
import shutil
import sqlite3
from pathlib import Path
from typing import Any


ACCESS_DATE = "2026-08-20"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("base_db", type=Path)
    parser.add_argument("remaining_json", type=Path)
    parser.add_argument("output_db", type=Path)
    parser.add_argument("--notes", type=Path)
    parser.add_argument("--actual-cost", type=float, required=True)
    return parser.parse_args()


def result_total(payload: dict[str, Any] | None) -> int:
    result = payload.get("result") if isinstance(payload, dict) else None
    if not isinstance(result, dict):
        return 0
    try:
        return int(result.get("total", 0) or 0)
    except (TypeError, ValueError):
        return 0


def patent_items(payload: dict[str, Any] | None) -> list[dict[str, Any]]:
    result = payload.get("result") if isinstance(payload, dict) else None
    items = result.get("items") if isinstance(result, dict) else None
    return [item for item in items if isinstance(item, dict)] if isinstance(items, list) else []


def supplier_items(payload: dict[str, Any] | None) -> list[dict[str, Any]]:
    result = payload.get("result") if isinstance(payload, dict) else None
    page_bean = result.get("pageBean") if isinstance(result, dict) else None
    items = page_bean.get("result") if isinstance(page_bean, dict) else None
    return [item for item in items if isinstance(item, dict)] if isinstance(items, list) else []


def parse_percent(value: Any) -> float | None:
    if not isinstance(value, str):
        return float(value) if isinstance(value, (int, float)) else None
    match = re.search(r"-?\d+(?:\.\d+)?", value.replace(",", ""))
    return float(match.group()) if match else None


def create_tables(connection: sqlite3.Connection) -> None:
    connection.executescript(
        """
        CREATE TABLE IF NOT EXISTS tyc_remaining_company_results (
          result_id INTEGER PRIMARY KEY,
          company_id INTEGER NOT NULL REFERENCES companies(company_id),
          api_id INTEGER NOT NULL,
          api_name TEXT NOT NULL,
          error_code INTEGER,
          reason TEXT,
          total_count INTEGER,
          result_json TEXT,
          source_id INTEGER NOT NULL REFERENCES sources(source_id),
          accessed_at TEXT NOT NULL,
          UNIQUE(company_id, api_id)
        );

        CREATE TABLE IF NOT EXISTS tyc_supplier_profiles (
          profile_id INTEGER PRIMARY KEY,
          company_id INTEGER NOT NULL REFERENCES companies(company_id),
          supplier_graph_id TEXT,
          supplier_name TEXT,
          announcement_date TEXT,
          purchase_amount TEXT,
          purchase_ratio TEXT,
          relationship TEXT,
          profile_error_code INTEGER,
          profile_name TEXT,
          profile_base TEXT,
          profile_city TEXT,
          profile_reg_location TEXT,
          domestic_flag INTEGER,
          source_id INTEGER NOT NULL REFERENCES sources(source_id)
        );

        CREATE TABLE IF NOT EXISTS tyc_patent_status_sample (
          patent_row_id INTEGER PRIMARY KEY,
          company_id INTEGER NOT NULL REFERENCES companies(company_id),
          patent_id TEXT,
          patent_name TEXT,
          patent_number TEXT,
          patent_type TEXT,
          patent_status TEXT,
          application_time TEXT,
          publication_date TEXT,
          grant_date TEXT,
          ipc_main TEXT,
          legal_status_json TEXT,
          adverse_status_flag INTEGER NOT NULL,
          source_id INTEGER NOT NULL REFERENCES sources(source_id)
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
    source_id: int,
    excerpt: str,
    formula: str,
    limitations: str,
    confidence: float = 0.78,
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
            "中",
            confidence,
            "目标数据源结构化返回或正式报告明确披露",
            limitations,
        ),
    )


def update_coverage(
    connection: sqlite3.Connection,
    *,
    company_id: int,
    indicator_id: str,
    reason: str,
    next_source: str,
    confidence: float = 0.78,
) -> None:
    connection.execute(
        """
        UPDATE indicator_coverage
        SET coverage_status='部分覆盖', usable_for_scoring=0,
            confidence='中', confidence_score=?, reason=?, recommended_next_source=?
        WHERE company_id=? AND indicator_id=?
        """,
        (confidence, reason, next_source, company_id, indicator_id),
    )


def write_notes(
    path: Path,
    *,
    output_db: Path,
    actual_cost: float,
    summary: dict[str, int],
) -> None:
    path.write_text(
        f"""# 37家数字芯片设计企业多源定向补数说明

更新日：{ACCESS_DATE}

## 新增来源

- 天眼查供应商 API 946；
- 天眼查专利 API 1137；
- 天眼查企业基本信息 API 1116（供应商注册地核验）；
- 国家知识产权局专利检索及分析系统：可访问，但结果检索要求登录，本次未绕过登录；
- 欧盟制裁官方站点：当前网络返回 `ERR_CONNECTION_CLOSED`，未生成伪造的欧盟筛查结果；
- 长鑫科技招股说明书（上交所正式披露）；
- 东方财富资讯搜索中的严格公司级海外业务表述。

## 结果

- 专利接口成功：{summary['patent_success']} 家；第一页专利 {summary['patent_rows']} 条；不利法律状态样本 {summary['adverse_patents']} 条；
- 供应商接口成功：{summary['supplier_success']} 家；供应商记录 {summary['supplier_rows']} 条；供应商注册地成功核验 {summary['supplier_profile_success']} 个；
- R18公司级海外业务严格线索：{summary['r18_company_clues']} 家；
- 长鑫科技 R15：从招股说明书补充2025利息费用及平均有息债务成本代理；
- 本批付费实际费用：{actual_cost:.2f} 元；API Token 未保存。

## 口径限制

- 专利只取第一页最多20条，不能替代完整专利族、前向引用和法律状态全量库；
- 不利状态仅表示样本中出现无效宣告/驳回等记录，需要逐项人工复核；
- 供应商仅取第一页及每家公司最多5个供应商注册地，匿名供应商和境外主体可能无法匹配；
- 新闻中的海外表述只作为线索，没有地区收入分母；
- 所有新增项保持部分覆盖，不直接评分。

输出数据库：`{output_db.name}`
""",
        encoding="utf-8",
    )


def main() -> None:
    args = parse_args()
    payload = json.loads(args.remaining_json.read_text(encoding="utf-8"))
    args.output_db.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(args.base_db, args.output_db)
    connection = sqlite3.connect(args.output_db)
    connection.execute("PRAGMA foreign_keys=ON")
    summary = {
        "patent_success": 0,
        "patent_rows": 0,
        "adverse_patents": 0,
        "supplier_success": 0,
        "supplier_rows": 0,
        "supplier_profile_success": 0,
        "r18_company_clues": 0,
    }
    adverse_pattern = re.compile(r"无效|终止|失效|驳回|撤回")
    try:
        create_tables(connection)
        company_rows = {
            row[0]: {"company_id": row[1], "source_url": row[2]}
            for row in connection.execute(
                "SELECT stock_code,company_id,source_url FROM companies"
            )
        }
        for company in payload["companies"]:
            info = company_rows[company["stock_code"]]
            company_id = int(info["company_id"])
            cursor = connection.execute(
                """
                INSERT INTO sources(
                  source_type,institution,title,publication_date,url,
                  local_evidence_file,accessed_at,notes
                ) VALUES(?,?,?,?,?,?,?,?)
                """,
                (
                    "天眼查付费API派生",
                    "天眼查数据开放平台",
                    f'{company["stock_code"]} {company["short_name"]} 专利/供应商定向批次',
                    ACCESS_DATE,
                    info["source_url"] or "https://www.tianyancha.com/",
                    str(args.remaining_json.resolve()),
                    ACCESS_DATE,
                    "API 1137/946/1116；原始结果仅本地留存。",
                ),
            )
            source_id = int(cursor.lastrowid)

            patents = company["patents"]
            patent_total = result_total(patents)
            items = patent_items(patents)
            adverse_count = 0
            granted_count = 0
            if patents.get("error_code") == 0:
                summary["patent_success"] += 1
            for item in items:
                status_text = f'{item.get("patentStatus", "")} {json.dumps(item.get("lawStatus"), ensure_ascii=False)}'
                adverse = bool(adverse_pattern.search(status_text))
                adverse_count += int(adverse)
                granted_count += int(
                    "授权" in str(item.get("patentStatus", ""))
                    or bool(item.get("grantDate"))
                )
                connection.execute(
                    """
                    INSERT INTO tyc_patent_status_sample(
                      company_id,patent_id,patent_name,patent_number,patent_type,
                      patent_status,application_time,publication_date,grant_date,
                      ipc_main,legal_status_json,adverse_status_flag,source_id
                    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
                    """,
                    (
                        company_id,
                        str(item.get("id")) if item.get("id") is not None else None,
                        item.get("patentName") or item.get("title"),
                        item.get("patentNum") or item.get("appnumber"),
                        item.get("patentType"),
                        item.get("patentStatus"),
                        item.get("applicationTime"),
                        item.get("pubDate") or item.get("applicationPublishTime"),
                        item.get("grantDate"),
                        item.get("mainCatNum"),
                        json.dumps(item.get("lawStatus"), ensure_ascii=False),
                        int(adverse),
                        source_id,
                    ),
                )
            summary["patent_rows"] += len(items)
            summary["adverse_patents"] += adverse_count
            connection.execute(
                """
                INSERT OR REPLACE INTO tyc_remaining_company_results(
                  company_id,api_id,api_name,error_code,reason,total_count,
                  result_json,source_id,accessed_at
                ) VALUES(?,?,?,?,?,?,?,?,?)
                """,
                (
                    company_id,
                    1137,
                    "企业专利信息",
                    patents.get("error_code"),
                    patents.get("reason"),
                    patent_total,
                    json.dumps(patents.get("result"), ensure_ascii=False),
                    source_id,
                    ACCESS_DATE,
                ),
            )
            if patents.get("error_code") == 0:
                excerpt = (
                    f"专利总量{patent_total}；第一页样本{len(items)}条；"
                    f"授权状态{granted_count}条；不利法律状态{adverse_count}条。"
                )
                add_observation(
                    connection,
                    company_id=company_id,
                    indicator_id="R05",
                    metric_name="tyc_paid_patent_total_asof",
                    value=patent_total,
                    unit="项",
                    source_id=source_id,
                    excerpt=excerpt,
                    formula="天眼查专利API返回total",
                    limitations="总量不能替代专利族、前向引用、去自引和权利要求质量。",
                )
                add_observation(
                    connection,
                    company_id=company_id,
                    indicator_id="R05",
                    metric_name="tyc_paid_patent_page_granted_count",
                    value=granted_count,
                    unit="项",
                    source_id=source_id,
                    excerpt=excerpt,
                    formula="第一页专利中状态含授权或grantDate非空的条数",
                    limitations="仅第一页最多20条，不是全量授权率。",
                )
                add_observation(
                    connection,
                    company_id=company_id,
                    indicator_id="R09",
                    metric_name="tyc_paid_patent_page_adverse_status_count",
                    value=adverse_count,
                    unit="项",
                    source_id=source_id,
                    excerpt=excerpt,
                    formula="第一页专利状态/法律状态命中无效、终止、失效、驳回、撤回的条数",
                    limitations="样本不利状态需人工逐项复核；零值不代表全量无重大知识产权事件。",
                )
                update_coverage(
                    connection,
                    company_id=company_id,
                    indicator_id="R09",
                    reason="已取得专利法律状态第一页样本并筛查不利状态；仍缺召回、泄露、质量事故和损失严重度全量事件。",
                    next_source="国家知识产权局登录检索、监管召回、裁判文书及数据安全事件库",
                )

            suppliers = company.get("suppliers")
            supplier_rows = supplier_items(suppliers)
            if isinstance(suppliers, dict):
                connection.execute(
                    """
                    INSERT OR REPLACE INTO tyc_remaining_company_results(
                      company_id,api_id,api_name,error_code,reason,total_count,
                      result_json,source_id,accessed_at
                    ) VALUES(?,?,?,?,?,?,?,?,?)
                    """,
                    (
                        company_id,
                        946,
                        "供应商",
                        suppliers.get("error_code"),
                        suppliers.get("reason"),
                        len(supplier_rows),
                        json.dumps(suppliers.get("result"), ensure_ascii=False),
                        source_id,
                        ACCESS_DATE,
                    ),
                )
                if suppliers.get("error_code") == 0:
                    summary["supplier_success"] += 1
            summary["supplier_rows"] += len(supplier_rows)
            domestic_count = 0
            unresolved_count = 0
            ratio_sum = 0.0
            for record in company.get("supplier_profiles", []):
                supplier = record["supplier"]
                profile = record["profile"]
                result = profile.get("result") if isinstance(profile, dict) else None
                result = result if isinstance(result, dict) else {}
                domestic = int(bool(result.get("base") or result.get("city")))
                domestic_count += domestic
                unresolved_count += int(profile.get("error_code") != 0)
                ratio = parse_percent(supplier.get("ratio"))
                if ratio is not None:
                    ratio_sum += ratio
                if profile.get("error_code") == 0:
                    summary["supplier_profile_success"] += 1
                connection.execute(
                    """
                    INSERT INTO tyc_supplier_profiles(
                      company_id,supplier_graph_id,supplier_name,announcement_date,
                      purchase_amount,purchase_ratio,relationship,profile_error_code,
                      profile_name,profile_base,profile_city,profile_reg_location,
                      domestic_flag,source_id
                    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                    """,
                    (
                        company_id,
                        str(supplier.get("supplier_graphId"))
                        if supplier.get("supplier_graphId") is not None
                        else None,
                        supplier.get("supplier_name"),
                        str(supplier.get("announcement_date"))
                        if supplier.get("announcement_date") is not None
                        else None,
                        supplier.get("amt"),
                        supplier.get("ratio"),
                        supplier.get("relationship"),
                        profile.get("error_code"),
                        result.get("name"),
                        result.get("base"),
                        result.get("city"),
                        result.get("regLocation"),
                        domestic,
                        source_id,
                    ),
                )
            if isinstance(suppliers, dict) and suppliers.get("error_code") == 0:
                excerpt = (
                    f"供应商记录{len(supplier_rows)}条；定向核验"
                    f"{len(company.get('supplier_profiles', []))}个；"
                    f"境内注册{domestic_count}个；未解析{unresolved_count}个；"
                    f"披露比例合计代理{ratio_sum:.2f}%。"
                )
                add_observation(
                    connection,
                    company_id=company_id,
                    indicator_id="R17",
                    metric_name="tyc_paid_supplier_disclosed_count",
                    value=len(supplier_rows),
                    unit="条",
                    source_id=source_id,
                    excerpt=excerpt,
                    formula="供应商API第一页返回条数",
                    limitations="只覆盖公开披露和第一页，不能代表完整采购台账。",
                )
                add_observation(
                    connection,
                    company_id=company_id,
                    indicator_id="R17",
                    metric_name="tyc_paid_supplier_domestic_profile_count",
                    value=domestic_count,
                    unit="家",
                    source_id=source_id,
                    excerpt=excerpt,
                    formula="定向供应商基本信息中base或city非空的境内注册主体数",
                    limitations="注册地不等于实际生产国，未匹配主体不能按境外认定。",
                )
                add_observation(
                    connection,
                    company_id=company_id,
                    indicator_id="R17",
                    metric_name="tyc_paid_supplier_ratio_sum_proxy_pct",
                    value=round(ratio_sum, 6),
                    unit="%",
                    source_id=source_id,
                    excerpt=excerpt,
                    formula="本次返回记录中可解析采购比例之和",
                    limitations="报告期可能重复，不能直接作为进口依赖率。",
                )
                update_coverage(
                    connection,
                    company_id=company_id,
                    indicator_id="R17",
                    reason="已取得供应商披露及最多5个供应商注册地；仍缺完整采购台账、实际生产国和进口金额。",
                    next_source="海关数据、完整供应商清单、采购金额与BOM",
                )

        # Longxin R15 from the SSE-filed prospectus already preserved locally.
        longxin = company_rows["688825"]["company_id"]
        source_row = connection.execute(
            """
            SELECT source_id FROM sources
            WHERE title LIKE '%长鑫%招股%' OR url LIKE '%688825%'
            ORDER BY source_id LIMIT 1
            """
        ).fetchone()
        if source_row:
            source_id = int(source_row[0])
            interest_expense = 2_989_197_168.22
            debt_2025 = 9_675_900_538.61 + 118_825_342_726.71 + 15_398_784_800.00
            debt_2024 = 1_796_482_216.39 + 95_993_810_675.95 + 30_947_175_200.00
            average_debt = (debt_2025 + debt_2024) / 2
            cost_proxy = interest_expense / average_debt * 100
            excerpt = (
                "长鑫科技招股说明书：2025利息费用2,989,197,168.22元；"
                "2025/2024短期借款、长期借款和一年内到期长期借款用于平均债务代理。"
            )
            add_observation(
                connection,
                company_id=longxin,
                indicator_id="R15",
                metric_name="interest_expense_yuan",
                value=interest_expense,
                unit="元",
                source_id=source_id,
                excerpt=excerpt,
                formula="招股说明书2025年利息费用",
                limitations="不含股权融资成本。",
                confidence=0.95,
            )
            add_observation(
                connection,
                company_id=longxin,
                indicator_id="R15",
                metric_name="debt_financing_cost_average_debt_proxy_pct",
                value=round(cost_proxy, 6),
                unit="%",
                source_id=source_id,
                excerpt=excerpt,
                formula="2025利息费用÷2024/2025期末有息债务代理平均值×100%",
                limitations="期末平均债务代理不是逐月平均余额，也不是完整WACC。",
                confidence=0.88,
            )
            update_coverage(
                connection,
                company_id=longxin,
                indicator_id="R15",
                reason="已从上交所招股说明书取得2025利息费用并计算平均期末债务成本代理；仍非完整WACC。",
                next_source="逐月平均有息负债、融资工具利率及权益资本成本",
                confidence=0.88,
            )

        # Strict company-level overseas-business statements from the news corpus.
        overseas_pattern = re.compile(
            r"海外业务|海外收入|境外收入|出口收入|境外销售|海外客户|境外客户|"
            r"海外市场|新加坡子公司|海外终端|出口一直都占公司收入"
        )
        missing_r18 = {
            row[0]
            for row in connection.execute(
                "SELECT company_id FROM indicator_coverage WHERE indicator_id='R18' AND coverage_status LIKE 'NA%'"
            )
        }
        for company_id in missing_r18:
            clues = [
                row
                for row in connection.execute(
                    """
                    SELECT news_id,title,summary,source_id FROM narrative_news_evidence
                    WHERE company_id=? ORDER BY published_at DESC
                    """,
                    (company_id,),
                )
                if overseas_pattern.search(f"{row[1] or ''} {row[2] or ''}")
            ]
            if not clues:
                continue
            source_id = int(clues[0][3])
            excerpt = "；".join(row[1] for row in clues[:3])
            add_observation(
                connection,
                company_id=company_id,
                indicator_id="R18",
                metric_name="finance_news_overseas_business_clue_count",
                value=len(clues),
                unit="条",
                source_id=source_id,
                excerpt=excerpt,
                formula="公司财经新闻中严格海外业务固定短语命中数",
                limitations="公司海外业务表述没有地区收入金额和统一分母，不直接评分。",
                confidence=0.68,
            )
            update_coverage(
                connection,
                company_id=company_id,
                indicator_id="R18",
                reason="取得公司级海外业务公开表述，但缺境外收入金额及总收入分母。",
                next_source="地区收入附注、境外交付收入和出口台账",
                confidence=0.68,
            )
            summary["r18_company_clues"] += 1

        connection.executemany(
            "INSERT OR REPLACE INTO metadata(key,value) VALUES(?,?)",
            [
                ("data_version", "2026-08-20-design37-multisource-v5"),
                ("remaining_source_api_ids", "946,1116,1137"),
                ("remaining_source_api_cost", f"{args.actual_cost:.2f}元"),
                ("cnipa_search_status", "网站可访问；结果检索要求登录；未绕过登录"),
                ("eu_sanctions_status", "官方站点当前网络ERR_CONNECTION_CLOSED；未生成筛查结论"),
            ],
        )
        connection.execute(
            "INSERT INTO deep_search_audit(update_date,method,details) VALUES(?,?,?)",
            (
                ACCESS_DATE,
                "缺口数据源定向补查",
                f"供应商946、专利1137、供应商基本信息1116；长鑫上交所招股书；严格海外业务新闻；实际费用{args.actual_cost:.2f}元。",
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
            actual_cost=args.actual_cost,
            summary=summary,
        )
    print(
        json.dumps(
            {
                "output_db": str(args.output_db),
                "actual_cost_cny": args.actual_cost,
                "summary": summary,
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
