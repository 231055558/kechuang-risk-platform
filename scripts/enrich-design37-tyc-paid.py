#!/usr/bin/env python3
"""Add licensed Tianyancha API results to a versioned copy of the design37 DB."""

from __future__ import annotations

import argparse
import json
import re
import shutil
import sqlite3
from pathlib import Path
from typing import Any


ACCESS_DATE = "2026-08-20"
API_IDS = "820,821,1058,1076,1078,1114,1124"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("base_db", type=Path)
    parser.add_argument("api_json", type=Path)
    parser.add_argument("output_db", type=Path)
    parser.add_argument("--notes", type=Path)
    parser.add_argument("--actual-cost", type=float, required=True)
    parser.add_argument("--batch-cost", type=float, required=True)
    return parser.parse_args()


def result_total(payload: dict[str, Any] | None) -> int:
    if not payload:
        return 0
    result = payload.get("result")
    if not isinstance(result, dict):
        return 0
    total = result.get("total")
    if isinstance(total, (int, float)):
        return int(total)
    items = result.get("items")
    return len(items) if isinstance(items, list) else 0


def result_items(payload: dict[str, Any] | None) -> list[dict[str, Any]]:
    if not payload:
        return []
    result = payload.get("result")
    if not isinstance(result, dict):
        return []
    items = result.get("items")
    return [item for item in items if isinstance(item, dict)] if isinstance(items, list) else []


def numeric(value: Any) -> float | None:
    if isinstance(value, (int, float)):
        return float(value)
    if not isinstance(value, str):
        return None
    normalized = value.replace(",", "")
    match = re.search(r"-?\d+(?:\.\d+)?", normalized)
    return float(match.group()) if match else None


def risk_total(payload: dict[str, Any] | None) -> int:
    if not payload:
        return 0
    result = payload.get("result")
    if not isinstance(result, dict):
        return 0
    risk_list = result.get("riskList")
    if not isinstance(risk_list, list):
        return 0
    return sum(
        int(item.get("count", 0) or 0)
        for item in risk_list
        if isinstance(item, dict)
    )


def create_tables(connection: sqlite3.Connection) -> None:
    connection.executescript(
        """
        CREATE TABLE IF NOT EXISTS tyc_paid_api_company_results (
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

        CREATE TABLE IF NOT EXISTS tyc_key_person_selection (
          selection_id INTEGER PRIMARY KEY,
          company_id INTEGER NOT NULL REFERENCES companies(company_id),
          person_name TEXT NOT NULL,
          person_id TEXT,
          person_hcgid TEXT,
          positions_json TEXT,
          selection_order INTEGER NOT NULL,
          source_id INTEGER NOT NULL REFERENCES sources(source_id),
          UNIQUE(company_id, person_name)
        );

        CREATE TABLE IF NOT EXISTS tyc_paid_key_person_results (
          result_id INTEGER PRIMARY KEY,
          company_id INTEGER NOT NULL REFERENCES companies(company_id),
          person_name TEXT NOT NULL,
          api_id INTEGER NOT NULL,
          api_name TEXT NOT NULL,
          error_code INTEGER,
          reason TEXT,
          total_count INTEGER,
          result_json TEXT,
          source_id INTEGER NOT NULL REFERENCES sources(source_id),
          accessed_at TEXT NOT NULL,
          UNIQUE(company_id, person_name, api_id)
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
            "天眼查付费API结构化返回的派生计数",
            limitations,
        ),
    )


def add_supplementary(
    connection: sqlite3.Connection,
    *,
    company_id: int,
    fact_name: str,
    value: float,
    unit: str,
    indicator_id: str,
    source_id: int,
    excerpt: str,
    limitations: str,
) -> None:
    connection.execute(
        """
        INSERT INTO supplementary_observations(
          company_id,fact_name,period,as_of_date,numeric_value,text_value,unit,
          related_indicator_id,source_id,source_page,evidence_excerpt,confidence,
          confidence_score,confidence_reason,limitations
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        """,
        (
            company_id,
            fact_name,
            "截至查询日",
            ACCESS_DATE,
            value,
            None,
            unit,
            indicator_id,
            source_id,
            None,
            excerpt,
            "中",
            0.78,
            "天眼查付费API结构化返回",
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
) -> None:
    connection.execute(
        """
        UPDATE indicator_coverage
        SET coverage_status='部分覆盖', usable_for_scoring=0,
            confidence='中', confidence_score=0.78,
            reason=?, recommended_next_source=?
        WHERE company_id=? AND indicator_id=?
        """,
        (reason, next_source, company_id, indicator_id),
    )


def store_company_result(
    connection: sqlite3.Connection,
    *,
    company_id: int,
    api_id: int,
    api_name: str,
    payload: dict[str, Any],
    source_id: int,
    total: int | None = None,
) -> None:
    connection.execute(
        """
        INSERT OR REPLACE INTO tyc_paid_api_company_results(
          company_id,api_id,api_name,error_code,reason,total_count,result_json,
          source_id,accessed_at
        ) VALUES(?,?,?,?,?,?,?,?,?)
        """,
        (
            company_id,
            api_id,
            api_name,
            payload.get("error_code"),
            payload.get("reason"),
            result_total(payload) if total is None else total,
            json.dumps(payload.get("result"), ensure_ascii=False),
            source_id,
            ACCESS_DATE,
        ),
    )


def write_notes(
    path: Path,
    *,
    output_db: Path,
    actual_cost: float,
    batch_cost: float,
    summary: dict[str, int],
) -> None:
    path.write_text(
        f"""# 37家数字芯片设计企业叙事与天眼查增强说明

更新日：{ACCESS_DATE}

## 本次付费调用

- API：{API_IDS}；
- 批量调用实际费用：{batch_cost:.2f} 元；
- 含前置测试的余额实际减少：{actual_cost:.2f} 元；
- API Token 未写入文件或数据库；
- 公司级成功返回：主要人员 {summary['staff_success']} 家、股东 {summary['holders_success']} 家、诉讼 {summary['lawsuits_success']} 家、行政处罚 {summary['penalties_success']} 家、企业风险 {summary['risk_success']} 家；
- 关键人员：{summary['key_people']} 人，失信命中 {summary['dishonest_hits']} 人，限消命中 {summary['limit_hits']} 人。

## 指标处理

- R10：增加当前行政处罚总数及网安/数据/隐私关键词专项命中代理；
- R12：增加诉讼总数、案件金额合计代理；
- R20：增加股东总数等股权结构背景数据；
- R21：增加主要人员数量、企业风险总量、关键人员失信/限消核查；
- 所有新增指标均保持“部分覆盖”且不直接评分；
- API返回 `300000` 表示天眼查本次查询无结果，不解释为事实上的绝对零风险。

## 本地许可边界

付费API原始结果仅保存在本地工作目录及本数据库的许可派生表中，不进入公开前端JSON。前端只读取脱敏计数、覆盖状态、来源和限制说明。

输出数据库：`{output_db.name}`
""",
        encoding="utf-8",
    )


def main() -> None:
    args = parse_args()
    payload = json.loads(args.api_json.read_text(encoding="utf-8"))
    args.output_db.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(args.base_db, args.output_db)
    connection = sqlite3.connect(args.output_db)
    connection.execute("PRAGMA foreign_keys=ON")
    summary = {
        "staff_success": 0,
        "holders_success": 0,
        "lawsuits_success": 0,
        "penalties_success": 0,
        "risk_success": 0,
        "key_people": 0,
        "dishonest_hits": 0,
        "limit_hits": 0,
    }
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
                    f'{company["stock_code"]} {company["short_name"]} 付费API批次',
                    ACCESS_DATE,
                    info["source_url"] or "https://www.tianyancha.com/",
                    str(args.api_json.resolve()),
                    ACCESS_DATE,
                    f"接口ID {API_IDS}；原始结果受许可限制，仅本地留存。",
                ),
            )
            source_id = int(cursor.lastrowid)

            company_payloads = [
                (820, "主要人员", company["staff"]),
                (821, "企业股东", company["holders"]),
                (1114, "法律诉讼", company["lawsuits"]),
                (1124, "行政处罚", company["penalties"]),
                (1058, "企业天眼风险", company["risk"]),
            ]
            for api_id, api_name, api_payload in company_payloads:
                total = risk_total(api_payload) if api_id == 1058 else None
                store_company_result(
                    connection,
                    company_id=company_id,
                    api_id=api_id,
                    api_name=api_name,
                    payload=api_payload,
                    source_id=source_id,
                    total=total,
                )

            staff_total = int(company["staff"].get("result", {}).get("total") or 0)
            holder_total = result_total(company["holders"])
            lawsuit_total = result_total(company["lawsuits"])
            penalty_total = result_total(company["penalties"])
            enterprise_risk_total = risk_total(company["risk"])
            if company["staff"].get("error_code") == 0:
                summary["staff_success"] += 1
            if company["holders"].get("error_code") == 0:
                summary["holders_success"] += 1
            if company["lawsuits"].get("error_code") == 0:
                summary["lawsuits_success"] += 1
            if company["penalties"].get("error_code") == 0:
                summary["penalties_success"] += 1
            if company["risk"].get("error_code") == 0:
                summary["risk_success"] += 1

            person_dishonest_hits = 0
            person_limit_hits = 0
            for order, person_record in enumerate(company["key_people"], start=1):
                person = person_record["person"]
                person_name = person["name"]
                summary["key_people"] += 1
                connection.execute(
                    """
                    INSERT OR REPLACE INTO tyc_key_person_selection(
                      company_id,person_name,person_id,person_hcgid,positions_json,
                      selection_order,source_id
                    ) VALUES(?,?,?,?,?,?,?)
                    """,
                    (
                        company_id,
                        person_name,
                        str(person.get("id")) if person.get("id") is not None else None,
                        person.get("hcgid"),
                        json.dumps(person.get("typeJoin"), ensure_ascii=False),
                        order,
                        source_id,
                    ),
                )
                for api_id, api_name, key in [
                    (1076, "失信被执行人（人员）", "dishonest"),
                    (1078, "限制消费令（人员）", "limit"),
                ]:
                    api_payload = person_record[key]
                    count = result_total(api_payload)
                    connection.execute(
                        """
                        INSERT OR REPLACE INTO tyc_paid_key_person_results(
                          company_id,person_name,api_id,api_name,error_code,reason,
                          total_count,result_json,source_id,accessed_at
                        ) VALUES(?,?,?,?,?,?,?,?,?,?)
                        """,
                        (
                            company_id,
                            person_name,
                            api_id,
                            api_name,
                            api_payload.get("error_code"),
                            api_payload.get("reason"),
                            count,
                            json.dumps(api_payload.get("result"), ensure_ascii=False),
                            source_id,
                            ACCESS_DATE,
                        ),
                    )
                    if key == "dishonest":
                        person_dishonest_hits += count
                    else:
                        person_limit_hits += count

            summary["dishonest_hits"] += person_dishonest_hits
            summary["limit_hits"] += person_limit_hits
            targeted_penalties = sum(
                1
                for item in result_items(company["penalties"])
                if re.search(
                    r"网络安全|数据安全|个人信息|隐私|算法|网信|信息保护",
                    json.dumps(item, ensure_ascii=False),
                )
            )
            lawsuit_money = sum(
                amount
                for item in result_items(company["lawsuits"])
                if (amount := numeric(item.get("caseMoney"))) is not None
            )
            excerpt = (
                f"主要人员{staff_total}，股东{holder_total}，诉讼{lawsuit_total}，"
                f"处罚{penalty_total}，企业风险{enterprise_risk_total}，"
                f"关键人员核查{len(company['key_people'])}人，"
                f"失信{person_dishonest_hits}，限消{person_limit_hits}。"
            )
            add_observation(
                connection,
                company_id=company_id,
                indicator_id="R10",
                metric_name="tyc_paid_admin_penalty_total_asof",
                value=penalty_total,
                unit="条",
                source_id=source_id,
                excerpt=excerpt,
                formula="天眼查行政处罚API当前返回总数",
                limitations="未命中不代表绝对无处罚；总数包含非网安/数据/隐私类型。",
            )
            add_observation(
                connection,
                company_id=company_id,
                indicator_id="R10",
                metric_name="tyc_paid_data_privacy_penalty_keyword_hit_count",
                value=targeted_penalties,
                unit="条",
                source_id=source_id,
                excerpt=excerpt,
                formula="处罚返回文本命中网安/数据/隐私固定关键词的条数",
                limitations="关键词规则不能替代处罚决定书人工法律定性。",
            )
            add_observation(
                connection,
                company_id=company_id,
                indicator_id="R12",
                metric_name="tyc_paid_lawsuit_total_asof",
                value=lawsuit_total,
                unit="件",
                source_id=source_id,
                excerpt=excerpt,
                formula="天眼查法律诉讼API当前返回总数",
                limitations="累计案件不等同报告期被告案件，未命中不代表绝对无诉讼。",
            )
            add_observation(
                connection,
                company_id=company_id,
                indicator_id="R12",
                metric_name="tyc_paid_lawsuit_case_money_sum_proxy",
                value=lawsuit_money,
                unit="元",
                source_id=source_id,
                excerpt=excerpt,
                formula="本次返回案件caseMoney可解析数值之和",
                limitations="仅第一页最多20条，币种和缺失金额未完全标准化。",
            )
            add_supplementary(
                connection,
                company_id=company_id,
                fact_name="天眼查付费API股东总数",
                value=holder_total,
                unit="名/家",
                indicator_id="R20",
                source_id=source_id,
                excerpt=excerpt,
                limitations="股东总数不能替代控制权和表决权穿透。",
            )
            add_observation(
                connection,
                company_id=company_id,
                indicator_id="R21",
                metric_name="tyc_paid_main_staff_count",
                value=staff_total,
                unit="人",
                source_id=source_id,
                excerpt=excerpt,
                formula="主要人员API返回total",
                limitations="只核查主要人员第一页并选择最多3人，不代表全部核心人员。",
            )
            add_observation(
                connection,
                company_id=company_id,
                indicator_id="R21",
                metric_name="tyc_paid_enterprise_risk_total_asof",
                value=enterprise_risk_total,
                unit="条",
                source_id=source_id,
                excerpt=excerpt,
                formula="企业天眼风险API各风险分类count合计",
                limitations="企业风险不能直接归因于高管关联实体。",
            )
            add_observation(
                connection,
                company_id=company_id,
                indicator_id="R21",
                metric_name="tyc_paid_key_person_dishonest_hit_count",
                value=person_dishonest_hits,
                unit="条",
                source_id=source_id,
                excerpt=excerpt,
                formula="最多3名关键人员失信API返回total合计",
                limitations="未覆盖全部董监高、历史人员及同名消歧之外的关联主体。",
            )
            add_observation(
                connection,
                company_id=company_id,
                indicator_id="R21",
                metric_name="tyc_paid_key_person_limit_consumption_hit_count",
                value=person_limit_hits,
                unit="条",
                source_id=source_id,
                excerpt=excerpt,
                formula="最多3名关键人员限消API返回total合计",
                limitations="未覆盖全部董监高、历史人员及其投资任职企业。",
            )

            update_coverage(
                connection,
                company_id=company_id,
                indicator_id="R10",
                reason="已调用行政处罚付费API并做网安/数据/隐私关键词筛查；仍需处罚决定书人工定性。",
                next_source="处罚决定书原文、网信和数据保护监管机关公告",
            )
            update_coverage(
                connection,
                company_id=company_id,
                indicator_id="R12",
                reason="已调用法律诉讼付费API并提取案件数和金额代理；仍缺完整报告期被告口径。",
                next_source="全量案件分页、裁判文书和案件角色人工复核",
            )
            update_coverage(
                connection,
                company_id=company_id,
                indicator_id="R20",
                reason="已调用股东付费API补充股权背景；仍缺完整控制链和表决权穿透。",
                next_source="股权穿透、表决权协议及一致行动关系",
            )
            if company["staff"].get("error_code") == 0:
                update_coverage(
                    connection,
                    company_id=company_id,
                    indicator_id="R21",
                    reason="已取得主要人员并核查最多3名关键人员失信/限消及企业风险；仍缺全部关联企业风险穿透。",
                    next_source="人员所有公司、对外投资及关联实体司法处罚风险",
                )

        connection.executemany(
            "INSERT OR REPLACE INTO metadata(key,value) VALUES(?,?)",
            [
                ("data_version", "2026-08-20-design37-narrative-tyc-paid-v4"),
                ("paid_api_ids", API_IDS),
                ("paid_api_usage", f"实际余额减少{args.actual_cost:.2f}元；批量{args.batch_cost:.2f}元；含测试调用"),
                ("paid_api_token_stored", "false"),
            ],
        )
        connection.execute(
            "INSERT INTO deep_search_audit(update_date,method,details) VALUES(?,?,?)",
            (
                ACCESS_DATE,
                "天眼查付费API受控批次",
                f"接口{API_IDS}；主要人员/股东/诉讼/处罚/企业风险及最多3名关键人员风险；实际费用{args.actual_cost:.2f}元。",
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
            batch_cost=args.batch_cost,
            summary=summary,
        )
    print(
        json.dumps(
            {
                "output_db": str(args.output_db),
                "actual_cost_cny": args.actual_cost,
                "batch_cost_cny": args.batch_cost,
                "summary": summary,
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
