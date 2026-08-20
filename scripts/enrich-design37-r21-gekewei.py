#!/usr/bin/env python3
"""Fill Gekewei R21 using its domestic operating entity and key-person links."""

from __future__ import annotations

import argparse
import json
import shutil
import sqlite3
from pathlib import Path
from typing import Any


ACCESS_DATE = "2026-08-20"
AS_OF_TIMESTAMP = "2026-08-20T14:27:00+08:00"
COMPANY_URL = "https://www.tianyancha.com/company/857967018"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("base_db", type=Path)
    parser.add_argument("r21_json", type=Path)
    parser.add_argument("output_db", type=Path)
    parser.add_argument("--notes", type=Path)
    return parser.parse_args()


def create_tables(connection: sqlite3.Connection) -> None:
    connection.executescript(
        """
        CREATE TABLE IF NOT EXISTS tyc_gekewei_r21_people (
          person_row_id INTEGER PRIMARY KEY,
          company_id INTEGER NOT NULL REFERENCES companies(company_id),
          person_name TEXT NOT NULL,
          person_id TEXT,
          person_hcgid TEXT,
          positions_json TEXT,
          associated_company_count INTEGER NOT NULL,
          dishonest_count INTEGER NOT NULL,
          limit_count INTEGER NOT NULL,
          self_risk_count INTEGER NOT NULL,
          surrounding_risk_count INTEGER NOT NULL,
          warning_count INTEGER NOT NULL,
          historical_risk_count INTEGER NOT NULL,
          person_risk_json TEXT NOT NULL,
          source_id INTEGER NOT NULL REFERENCES sources(source_id),
          UNIQUE(company_id, person_name)
        );

        CREATE TABLE IF NOT EXISTS tyc_gekewei_r21_associated_companies (
          association_id INTEGER PRIMARY KEY,
          company_id INTEGER NOT NULL REFERENCES companies(company_id),
          person_name TEXT NOT NULL,
          associated_company_id TEXT,
          associated_company_name TEXT NOT NULL,
          role TEXT,
          registration_status TEXT,
          source_id INTEGER NOT NULL REFERENCES sources(source_id),
          UNIQUE(company_id, person_name, associated_company_id)
        );

        CREATE TABLE IF NOT EXISTS tyc_gekewei_r21_entity_risk (
          risk_row_id INTEGER PRIMARY KEY,
          company_id INTEGER NOT NULL REFERENCES companies(company_id),
          screened_entity TEXT NOT NULL,
          risk_group TEXT NOT NULL,
          risk_count INTEGER NOT NULL,
          risk_json TEXT,
          source_id INTEGER NOT NULL REFERENCES sources(source_id),
          UNIQUE(company_id, risk_group)
        );
        """
    )


def add_observation(
    connection: sqlite3.Connection,
    *,
    company_id: int,
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
            "R21",
            metric_name,
            ACCESS_DATE,
            ACCESS_DATE,
            AS_OF_TIMESTAMP,
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
            "境内核心经营主体、人员ID及关联企业ID经天眼查结构化接口消歧",
            limitations,
        ),
    )


def write_notes(path: Path, output_db: Path, payload: dict[str, Any]) -> None:
    summary = payload["derived_summary"]
    source = payload["source"]
    path.write_text(
        f"""# 格科微 R21 高管关联风险补数说明

更新日：{ACCESS_DATE}

## 主体修正

- 上市主体 `格科微有限公司` 为境外主体，原天眼查接口无结果；
- 本批改以境内核心经营主体 `格科微电子（上海）有限公司`（天眼查ID {source['screened_entity_id']}）核验；
- 主要人员 2 人：赵立新（执行董事）、付磊（监事）。

## 结果

- 人员—关联公司关系 {summary['person_company_link_count']} 条，去重关联企业 {summary['unique_associated_company_count']} 家；
- 两名人员自身风险合计 {summary['direct_person_self_risk_count']} 条；失信 {summary['direct_person_dishonest_count']} 条；个人限消 {summary['direct_person_limit_count']} 条；
- 人员周边风险聚合 {summary['person_surrounding_risk_count']} 条，其中高风险标签事件聚合 {summary['person_surrounding_high_risk_event_count']} 条；
- 境内核心经营主体天眼风险聚合 {summary['core_entity_risk_total']} 条；
- 付磊关联的雷奇节能科技股份有限公司存在限消、被执行、终本及经营异常聚合记录；赵立新关联的上海算芯微电子有限公司存在注销备案和清算信息；
- R21 由 `NA-公开数据不足` 更新为 `部分覆盖`，仍不可直接评分。

## 费用与限制

- 本批实际余额减少：{source['actual_cost_cny']:.2f} 元；调用后余额：{source['balance_after_cny']:.2f} 元；API Token 未保存；
- 聚合风险可能在两名人员之间重复，不能把 141 条直接视为独立案件数；
- 关联企业风险不等于人员本人违法或失信；
- 目前只核验境内核心经营主体登记的2名主要人员，不代表上市公司全部历史董监高和核心技术人员；
- 如需形成正式分值，仍需逐件读取裁判文书、执行文书、处罚决定书并建立严重度和责任系数。

输出数据库：`{output_db.name}`
""",
        encoding="utf-8",
    )


def main() -> None:
    args = parse_args()
    payload: dict[str, Any] = json.loads(args.r21_json.read_text(encoding="utf-8"))
    args.output_db.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(args.base_db, args.output_db)
    connection = sqlite3.connect(args.output_db)
    connection.execute("PRAGMA foreign_keys=ON")
    try:
        create_tables(connection)
        company_row = connection.execute(
            "SELECT company_id FROM companies WHERE stock_code='688728'"
        ).fetchone()
        if not company_row:
            raise RuntimeError("Missing company 688728")
        company_id = int(company_row[0])
        source_cursor = connection.execute(
            """
            INSERT INTO sources(
              source_type,institution,title,publication_date,url,
              local_evidence_file,accessed_at,notes
            ) VALUES(?,?,?,?,?,?,?,?)
            """,
            (
                "天眼查付费API派生",
                "天眼查数据开放平台",
                "688728 格科微 R21 境内主体及关键人员穿透",
                ACCESS_DATE,
                COMPANY_URL,
                str(args.r21_json.resolve()),
                ACCESS_DATE,
                "接口820/450/1076/1078/1058/427；实际费用12.75元；原始结果仅本地留存。",
            ),
        )
        source_id = int(source_cursor.lastrowid)

        for order, person in enumerate(payload["people"], start=1):
            risk = person["person_risk"]
            connection.execute(
                """
                INSERT INTO tyc_gekewei_r21_people(
                  company_id,person_name,person_id,person_hcgid,positions_json,
                  associated_company_count,dishonest_count,limit_count,
                  self_risk_count,surrounding_risk_count,warning_count,
                  historical_risk_count,person_risk_json,source_id
                ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                """,
                (
                    company_id,
                    person["name"],
                    str(person["id"]),
                    person["hcgid"],
                    json.dumps(person["positions"], ensure_ascii=False),
                    person["associated_companies_total"],
                    person["dishonest"]["total"],
                    person["consumption_restriction"]["total"],
                    risk["self_risk_count"],
                    risk["surrounding_risk_count"],
                    risk["warning_count"],
                    risk["historical_risk_count"],
                    json.dumps(risk, ensure_ascii=False),
                    source_id,
                ),
            )
            connection.execute(
                """
                INSERT OR REPLACE INTO tyc_key_person_selection(
                  company_id,person_name,person_id,person_hcgid,positions_json,
                  selection_order,source_id
                ) VALUES(?,?,?,?,?,?,?)
                """,
                (
                    company_id,
                    person["name"],
                    str(person["id"]),
                    person["hcgid"],
                    json.dumps(person["positions"], ensure_ascii=False),
                    order,
                    source_id,
                ),
            )
            for association in person["associated_companies"]:
                connection.execute(
                    """
                    INSERT INTO tyc_gekewei_r21_associated_companies(
                      company_id,person_name,associated_company_id,
                      associated_company_name,role,registration_status,source_id
                    ) VALUES(?,?,?,?,?,?,?)
                    """,
                    (
                        company_id,
                        person["name"],
                        str(association["cid"]),
                        association["name"],
                        association["role"],
                        association["reg_status"],
                        source_id,
                    ),
                )
            for api_id, api_name, result_key in (
                (1076, "失信被执行人（人员）", "dishonest"),
                (1078, "限制消费令（人员）", "consumption_restriction"),
                (427, "人员天眼风险", "person_risk"),
            ):
                result = person[result_key]
                total = (
                    result.get("total", 0)
                    if api_id != 427
                    else sum(
                        int(result.get(key, 0) or 0)
                        for key in (
                            "self_risk_count",
                            "surrounding_risk_count",
                            "warning_count",
                            "historical_risk_count",
                        )
                    )
                )
                connection.execute(
                    """
                    INSERT OR REPLACE INTO tyc_paid_key_person_results(
                      company_id,person_name,api_id,api_name,error_code,reason,
                      total_count,result_json,source_id,accessed_at
                    ) VALUES(?,?,?,?,?,?,?,?,?,?)
                    """,
                    (
                        company_id,
                        person["name"],
                        api_id,
                        api_name,
                        result["error_code"],
                        result["reason"],
                        total,
                        json.dumps(result, ensure_ascii=False),
                        source_id,
                        ACCESS_DATE,
                    ),
                )

        for group in payload["core_entity_risk"]["groups"]:
            connection.execute(
                """
                INSERT INTO tyc_gekewei_r21_entity_risk(
                  company_id,screened_entity,risk_group,risk_count,
                  risk_json,source_id
                ) VALUES(?,?,?,?,?,?)
                """,
                (
                    company_id,
                    payload["source"]["screened_entity"],
                    group["name"],
                    group["count"],
                    json.dumps(payload["core_entity_risk"], ensure_ascii=False),
                    source_id,
                ),
            )

        summary = payload["derived_summary"]
        excerpt = (
            "境内主体主要人员2人；人员—公司关系35条、去重关联企业34家；"
            "人员自身风险0、失信0、个人限消0；人员周边风险聚合141，"
            "其中高风险标签事件聚合33；境内主体风险聚合222。"
        )
        metrics = [
            ("tyc_core_entity_main_staff_count", summary["key_person_count"], "人", "主要人员API返回total"),
            ("tyc_key_person_company_link_count", summary["person_company_link_count"], "条", "人员所有公司API返回关系条数合计"),
            ("tyc_key_person_unique_associated_company_count", summary["unique_associated_company_count"], "家", "关联企业ID去重数"),
            ("tyc_key_person_self_risk_count", summary["direct_person_self_risk_count"], "条", "两名人员天眼风险自身风险count合计"),
            ("tyc_key_person_dishonest_hit_count", summary["direct_person_dishonest_count"], "条", "两名人员失信API返回total合计"),
            ("tyc_key_person_limit_consumption_hit_count", summary["direct_person_limit_count"], "条", "两名人员限消API返回total合计"),
            ("tyc_key_person_surrounding_risk_count", summary["person_surrounding_risk_count"], "条", "两名人员天眼风险周边风险count合计"),
            ("tyc_key_person_surrounding_high_risk_event_count", summary["person_surrounding_high_risk_event_count"], "条", "人员周边风险中高风险标签类别total合计"),
            ("tyc_core_entity_enterprise_risk_total_asof", summary["core_entity_risk_total"], "条", "境内主体企业天眼风险各组count合计"),
        ]
        for metric_name, value, unit, formula in metrics:
            add_observation(
                connection,
                company_id=company_id,
                metric_name=metric_name,
                value=float(value),
                unit=unit,
                source_id=source_id,
                excerpt=excerpt,
                formula=formula,
                limitations=(
                    "关联风险不等于人员本人违法；不同人员和企业之间可能重复；"
                    "未覆盖上市公司全部历史董监高及核心技术人员，不能直接评分。"
                ),
                confidence=0.86 if value else 0.80,
            )

        connection.execute(
            """
            UPDATE indicator_coverage
            SET coverage_status='部分覆盖', usable_for_scoring=0,
                confidence='中', confidence_score=0.84,
                reason='已按境内核心经营主体取得2名主要人员、35条人员—公司关系、个人失信/限消及人员/企业风险聚合；仍缺全部历史董监高、逐件责任和严重度。',
                recommended_next_source='上市公司全部历史董监高与核心技术人员名单、逐件裁判文书/执行文书/处罚决定及责任严重度'
            WHERE company_id=? AND indicator_id='R21'
            """,
            (company_id,),
        )
        connection.executemany(
            "INSERT OR REPLACE INTO metadata(key,value) VALUES(?,?)",
            [
                ("data_version", "2026-08-20-design37-gekewei-r21-v8"),
                ("r21_gekewei_screened_entity", payload["source"]["screened_entity"]),
                ("r21_gekewei_api_ids", ",".join(map(str, payload["source"]["api_ids"]))),
                ("r21_gekewei_api_cost", f'{payload["source"]["actual_cost_cny"]:.2f}元'),
                ("r21_gekewei_balance_after", f'{payload["source"]["balance_after_cny"]:.2f}元'),
                ("paid_api_token_stored", "false"),
            ],
        )
        connection.execute(
            "INSERT INTO deep_search_audit(update_date,method,details) VALUES(?,?,?)",
            (
                ACCESS_DATE,
                "格科微R21境内主体及关键人员付费穿透",
                "接口820/450/1076/1078/1058/427；2名人员、35条关系、个人直接风险0、周边风险141；实际费用12.75元。",
            ),
        )
        connection.commit()
        violations = connection.execute("PRAGMA foreign_key_check").fetchall()
        if violations:
            raise RuntimeError(f"Foreign-key violations: {violations[:5]}")
    finally:
        connection.close()

    if args.notes:
        write_notes(args.notes, args.output_db, payload)
    print(
        json.dumps(
            {
                "output_db": str(args.output_db),
                "coverage_status": "部分覆盖",
                "actual_cost_cny": payload["source"]["actual_cost_cny"],
                "balance_after_cny": payload["source"]["balance_after_cny"],
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
