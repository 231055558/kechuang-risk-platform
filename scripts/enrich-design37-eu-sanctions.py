#!/usr/bin/env python3
"""Add auditable EU FSD exact-name screening results to the design37 database."""

from __future__ import annotations

import argparse
import json
import shutil
import sqlite3
from pathlib import Path
from typing import Any


ACCESS_DATE = "2026-08-20"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("base_db", type=Path)
    parser.add_argument("eu_json", type=Path)
    parser.add_argument("output_db", type=Path)
    parser.add_argument("--notes", type=Path)
    return parser.parse_args()


def create_table(connection: sqlite3.Connection) -> None:
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS eu_fsd_screening_results (
          screening_id INTEGER PRIMARY KEY,
          company_id INTEGER NOT NULL REFERENCES companies(company_id),
          query_count INTEGER NOT NULL,
          returned_candidate_count INTEGER NOT NULL,
          exact_match_count INTEGER NOT NULL,
          candidates_json TEXT,
          candidate_disposition TEXT,
          source_id INTEGER NOT NULL REFERENCES sources(source_id),
          accessed_at TEXT NOT NULL,
          UNIQUE(company_id)
        )
        """
    )


def add_observation(
    connection: sqlite3.Connection,
    *,
    company_id: int,
    value: int,
    source_id: int,
    excerpt: str,
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
            "R19",
            "eu_fsd_exact_name_hit_count",
            ACCESS_DATE,
            ACCESS_DATE,
            ACCESS_DATE,
            float(value),
            None,
            "项",
            "partial",
            1,
            "EU Sanctions Map FSD站内检索：中文全称、英文品牌名、英文全称及必要核心经营主体；仅明确同一主体计命中",
            source_id,
            None,
            excerpt,
            "中",
            0.84,
            "European Commission官方制裁地图FSD检索接口返回并逐候选复核",
            "零精确命中不等于集团、控股股东、历史名称或未收录别名绝对无暴露；不包含受管制技术/BOM影响度。",
        ),
    )


def write_notes(path: Path, output_db: Path, payload: dict[str, Any]) -> None:
    summary = payload["summary"]
    path.write_text(
        f"""# 37家数字芯片设计企业欧盟制裁清单筛查增强说明

更新日：{ACCESS_DATE}

## 本批新增

- 此前网络失败的 EU Sanctions Map、data.europa.eu 与欧盟金融制裁总览页已恢复访问；
- 欧盟金融官网原 `eu-sanctions-map_en` 链接现为 404，已定位当前正式入口 `overview-sanctions-and-related-resources_en`；
- 使用 EU Sanctions Map 的 FSD（From FSD）站内检索接口，对 37 家企业执行 {summary['query_count']} 个中文名、英文品牌名、英文全称和必要核心经营主体查询；
- 请求错误 {summary['request_error_count']} 个，精确主体命中 {summary['exact_match_count']} 个；
- 优迅短词 `UX IC` 返回 2 条法语政府机构候选，经主体名称复核均排除；
- R19 仍保持“部分覆盖”、不可直接评分。

## 口径限制

- 本批是官方名单的名称与别名核验，不是集团穿透或最终制裁法律意见；
- 零精确命中不代表控股股东、子公司、历史名称或其他未收录别名绝对无暴露；
- 未计算受管制核心部件、技术或 BOM 的影响度；
- data.europa.eu 列出的 XML/CSV 公共下载端点本次仍超时，FSD 文件页要求 EU Login；因此以同属 European Commission 官方 EU Sanctions Map 已公开加载的 FSD 检索接口完成逐主体核验。

输出数据库：`{output_db.name}`
""",
        encoding="utf-8",
    )


def main() -> None:
    args = parse_args()
    payload: dict[str, Any] = json.loads(args.eu_json.read_text(encoding="utf-8"))
    args.output_db.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(args.base_db, args.output_db)
    connection = sqlite3.connect(args.output_db)
    connection.execute("PRAGMA foreign_keys=ON")
    try:
        create_table(connection)
        company_ids = {
            row[0]: int(row[1])
            for row in connection.execute("SELECT stock_code,company_id FROM companies")
        }
        source = payload["source"]
        source_cursor = connection.execute(
            """
            INSERT INTO sources(
              source_type,institution,title,publication_date,url,
              local_evidence_file,accessed_at,notes
            ) VALUES(?,?,?,?,?,?,?,?)
            """,
            (
                "官方制裁清单筛查",
                "European Commission / EU Sanctions Map",
                "37家数字芯片设计企业 EU Financial Sanctions Database 精确名称筛查",
                source["map_displayed_update"],
                source["map_url"],
                str(args.eu_json.resolve()),
                ACCESS_DATE,
                "FSD search_type=2；115个名称与别名查询；零精确命中；候选逐项复核。",
            ),
        )
        source_id = int(source_cursor.lastrowid)

        for result in payload["results"]:
            company_id = company_ids[result["stock_code"]]
            candidates = result.get("candidates", [])
            disposition = result.get("candidate_disposition")
            connection.execute(
                """
                INSERT INTO eu_fsd_screening_results(
                  company_id,query_count,returned_candidate_count,
                  exact_match_count,candidates_json,candidate_disposition,
                  source_id,accessed_at
                ) VALUES(?,?,?,?,?,?,?,?)
                """,
                (
                    company_id,
                    result["query_count"],
                    result["returned_candidate_count"],
                    result["exact_match_count"],
                    json.dumps(candidates, ensure_ascii=False),
                    disposition,
                    source_id,
                    ACCESS_DATE,
                ),
            )
            excerpt = (
                f'FSD查询{result["query_count"]}个名称/别名；返回候选'
                f'{result["returned_candidate_count"]}个；精确主体命中'
                f'{result["exact_match_count"]}个。'
            )
            if disposition:
                excerpt += disposition
            add_observation(
                connection,
                company_id=company_id,
                value=result["exact_match_count"],
                source_id=source_id,
                excerpt=excerpt,
            )
            connection.execute(
                """
                UPDATE indicator_coverage
                SET coverage_status='部分覆盖', usable_for_scoring=0,
                    confidence='中', confidence_score=0.82,
                    reason='已完成美国官方CSL与欧盟FSD官方名称/别名筛查；仍缺集团穿透及受管制核心技术/BOM影响度。',
                    recommended_next_source='控股股东与子公司穿透、历史名称库、出口管制分类及核心技术/BOM台账'
                WHERE company_id=? AND indicator_id='R19'
                """,
                (company_id,),
            )

        connection.executemany(
            "INSERT OR REPLACE INTO metadata(key,value) VALUES(?,?)",
            [
                ("data_version", "2026-08-20-design37-eu-fsd-v7"),
                ("eu_sanctions_status", "EU Sanctions Map/FSD访问成功；37家公司115个名称查询；零精确命中"),
                ("eu_sanctions_map_displayed_update", source["map_displayed_update"]),
                ("eu_fsd_screening_date", ACCESS_DATE),
                ("eu_fsd_query_count", str(payload["summary"]["query_count"])),
                ("eu_fsd_exact_match_count", str(payload["summary"]["exact_match_count"])),
            ],
        )
        connection.execute(
            "INSERT INTO deep_search_audit(update_date,method,details) VALUES(?,?,?)",
            (
                ACCESS_DATE,
                "欧盟官方制裁名单筛查",
                "EU Sanctions Map FSD search_type=2；37家公司115个名称/别名查询；0个精确命中；优迅2个法语候选排除。",
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
                "company_count": payload["summary"]["company_count"],
                "query_count": payload["summary"]["query_count"],
                "exact_match_count": payload["summary"]["exact_match_count"],
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
