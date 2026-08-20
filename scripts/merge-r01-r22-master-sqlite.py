#!/usr/bin/env python3
"""Merge prioritized R01-R22 industry databases into one auditable SQLite master."""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sqlite3
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable


MERGE_DATE = "2026-08-20"
MASTER_VERSION = "2026-08-20-r01-r22-master-v1"


@dataclass(frozen=True)
class SourceSpec:
    source_id: str
    label: str
    path: Path
    priority: int


CORE_CATALOG_TABLES = {"indicator_catalog", "bonus_catalog"}
COMMON_COMPANY_TABLES = {
    "indicator_coverage": None,
    "screening_hits": "hit_id",
    "inquiry_evidence": "evidence_id",
    "litigation_evidence": "evidence_id",
    "supplementary_observations": "supplementary_id",
    "report_availability": None,
    "deep_search_events": "event_id",
}
NON_BASE_AUXILIARY_TABLES = {"confidence_rules", "quality_checks", "update_audit"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("output_db", type=Path)
    parser.add_argument(
        "sources",
        nargs="+",
        help="Repeated triples: source_id label input.sqlite",
    )
    parser.add_argument("--notes", type=Path)
    args = parser.parse_args()
    if len(args.sources) % 3:
        parser.error("sources must be repeated triples: source_id label input.sqlite")
    return args


def source_specs(arguments: list[str]) -> list[SourceSpec]:
    specs = []
    for index in range(0, len(arguments), 3):
        specs.append(
            SourceSpec(
                source_id=arguments[index],
                label=arguments[index + 1],
                path=Path(arguments[index + 2]),
                priority=index // 3 + 1,
            )
        )
    return specs


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def has_table(connection: sqlite3.Connection, table: str) -> bool:
    return bool(
        connection.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)
        ).fetchone()
    )


def columns(connection: sqlite3.Connection, table: str) -> list[str]:
    return [row[1] for row in connection.execute(f'PRAGMA table_info("{table}")')]


def rows(
    connection: sqlite3.Connection,
    table: str,
    where: str = "",
    parameters: Iterable[Any] = (),
) -> list[dict[str, Any]]:
    query = f'SELECT * FROM "{table}"'
    if where:
        query += f" WHERE {where}"
    cursor = connection.execute(query, tuple(parameters))
    names = [item[0] for item in cursor.description]
    return [dict(zip(names, row)) for row in cursor.fetchall()]


def insert_dict(connection: sqlite3.Connection, table: str, record: dict[str, Any]) -> None:
    names = list(record)
    placeholders = ",".join("?" for _ in names)
    quoted = ",".join(f'"{name}"' for name in names)
    connection.execute(
        f'INSERT INTO "{table}"({quoted}) VALUES({placeholders})',
        tuple(record[name] for name in names),
    )


def next_id(connection: sqlite3.Connection, table: str, primary_key: str) -> int:
    return int(
        connection.execute(
            f'SELECT COALESCE(MAX("{primary_key}"),0)+1 FROM "{table}"'
        ).fetchone()[0]
    )


def add_column_if_missing(
    connection: sqlite3.Connection, table: str, definition: str
) -> None:
    name = definition.split()[0]
    if name not in columns(connection, table):
        connection.execute(f'ALTER TABLE "{table}" ADD COLUMN {definition}')


def selected_company_ids(
    source: sqlite3.Connection, seen_stock_codes: set[str]
) -> tuple[set[int], list[dict[str, Any]]]:
    selected: set[int] = set()
    duplicates: list[dict[str, Any]] = []
    for company in rows(source, "companies"):
        code = str(company["stock_code"])
        if code in seen_stock_codes:
            duplicates.append(company)
        else:
            selected.add(int(company["company_id"]))
    return selected, duplicates


def add_lineage(
    connection: sqlite3.Connection,
    *,
    table: str,
    merged_key: str,
    source_database_id: str,
    source_key: str,
    peer_group_id: str,
) -> None:
    connection.execute(
        """
        INSERT OR IGNORE INTO row_lineage(
          table_name,merged_row_key,source_database_id,source_row_key,peer_group_id
        ) VALUES(?,?,?,?,?)
        """,
        (table, merged_key, source_database_id, source_key, peer_group_id),
    )


def create_master_tables(connection: sqlite3.Connection) -> None:
    connection.executescript(
        """
        CREATE TABLE IF NOT EXISTS peer_groups (
          peer_group_id TEXT PRIMARY KEY,
          label TEXT NOT NULL,
          priority INTEGER NOT NULL UNIQUE,
          reporting_period TEXT,
          company_count INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS source_databases (
          source_database_id TEXT PRIMARY KEY,
          label TEXT NOT NULL,
          priority INTEGER NOT NULL UNIQUE,
          input_path TEXT NOT NULL,
          sha256 TEXT NOT NULL,
          original_company_count INTEGER NOT NULL,
          selected_company_count INTEGER NOT NULL,
          metadata_json TEXT NOT NULL,
          merged_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS duplicate_companies (
          duplicate_id INTEGER PRIMARY KEY,
          stock_code TEXT NOT NULL,
          short_name TEXT,
          discarded_source_database_id TEXT NOT NULL,
          discarded_source_company_id INTEGER NOT NULL,
          kept_source_database_id TEXT NOT NULL,
          kept_company_id INTEGER NOT NULL REFERENCES companies(company_id),
          reason TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS row_lineage (
          lineage_id INTEGER PRIMARY KEY,
          table_name TEXT NOT NULL,
          merged_row_key TEXT NOT NULL,
          source_database_id TEXT NOT NULL,
          source_row_key TEXT NOT NULL,
          peer_group_id TEXT NOT NULL,
          UNIQUE(table_name, merged_row_key, source_database_id, source_row_key)
        );

        CREATE TABLE IF NOT EXISTS source_auxiliary_rows (
          auxiliary_row_id INTEGER PRIMARY KEY,
          source_database_id TEXT NOT NULL,
          table_name TEXT NOT NULL,
          source_row_key TEXT,
          row_json TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS observation_source_links (
          observation_id INTEGER NOT NULL REFERENCES observations(observation_id),
          source_id INTEGER NOT NULL REFERENCES sources(source_id),
          source_order INTEGER NOT NULL,
          PRIMARY KEY(observation_id, source_id)
        );

        CREATE TABLE IF NOT EXISTS master_merge_audit (
          audit_id INTEGER PRIMARY KEY,
          merge_date TEXT NOT NULL,
          action TEXT NOT NULL,
          details TEXT NOT NULL
        );
        """
    )
    add_column_if_missing(connection, "companies", "peer_group_id TEXT")
    add_column_if_missing(connection, "companies", "source_database_id TEXT")
    add_column_if_missing(connection, "companies", "source_company_id INTEGER")
    add_column_if_missing(connection, "sources", "peer_group_id TEXT")
    add_column_if_missing(connection, "sources", "source_database_id TEXT")
    add_column_if_missing(connection, "sources", "source_source_id INTEGER")


def assert_catalogs_match(specs: list[SourceSpec]) -> None:
    reference: dict[str, list[tuple[Any, ...]]] = {}
    for spec in specs:
        source = sqlite3.connect(f"file:{spec.path}?mode=ro", uri=True)
        try:
            for table in CORE_CATALOG_TABLES:
                current = source.execute(f'SELECT * FROM "{table}" ORDER BY 1').fetchall()
                if table not in reference:
                    reference[table] = current
                elif current != reference[table]:
                    raise RuntimeError(f"{table} differs in {spec.source_id}")
        finally:
            source.close()


def copy_common_table(
    master: sqlite3.Connection,
    source: sqlite3.Connection,
    *,
    spec: SourceSpec,
    table: str,
    primary_key: str | None,
    selected_ids: set[int],
    company_map: dict[int, int],
    source_map: dict[int, int],
) -> None:
    if not has_table(source, table) or not selected_ids:
        return
    placeholders = ",".join("?" for _ in selected_ids)
    records = rows(source, table, f"company_id IN ({placeholders})", selected_ids)
    generated_id = next_id(master, table, primary_key) if primary_key else None
    for record in records:
        source_primary_key = (
            str(record[primary_key])
            if primary_key
            else f'{record["company_id"]}:{record.get("indicator_id", "")}'
        )
        record["company_id"] = company_map[int(record["company_id"])]
        if "source_id" in record and record["source_id"] is not None:
            record["source_id"] = source_map[int(record["source_id"])]
        if primary_key:
            record[primary_key] = generated_id
            merged_key = str(generated_id)
            generated_id = int(generated_id) + 1
        else:
            merged_key = f'{record["company_id"]}:{record.get("indicator_id", "")}'
        insert_dict(master, table, record)
        add_lineage(
            master,
            table=table,
            merged_key=merged_key,
            source_database_id=spec.source_id,
            source_key=source_primary_key,
            peer_group_id=spec.source_id,
        )


def write_notes(
    path: Path,
    output_db: Path,
    specs: list[SourceSpec],
    counts: dict[str, int],
    duplicate_codes: list[str],
) -> None:
    sources = "\n".join(
        f'- `{spec.source_id}`：{spec.label}（`{spec.path.name}`）' for spec in specs
    )
    path.write_text(
        f"""# 科创企业 R01–R22 总数据库说明

生成日：{MERGE_DATE}

## 输入库与优先级

{sources}

导入顺序就是重复企业优先级。重复股票代码只保留更具体行业库的数据，未把同一企业重复计算。

## 总库规模

- 唯一企业：{counts['companies']} 家；
- R01–R22 指标：{counts['indicators']} 项；
- 主观测：{counts['observations']} 条；
- 企业×指标覆盖：{counts['coverage']} 条；
- 来源目录：{counts['sources']} 条；
- 补充事实：{counts['supplementary']} 条；
- 深搜事件：{counts['deep_events']} 条；
- 问询证据：{counts['inquiry']} 条；诉讼证据：{counts['litigation']} 条；清单命中：{counts['screening']} 条；
- 正式报告覆盖：{counts['reports']} 家；
- 重复企业：{counts['duplicates']} 家，股票代码为 {', '.join(duplicate_codes)}。

## 数据保留方式

- `companies`、`sources` 新增来源库与同业组字段；
- `peer_groups` 和 `source_databases` 保存合并边界、优先级、输入哈希与原始元数据；
- `row_lineage` 保存合并后ID到输入库ID的映射；
- 数字芯片库中的新闻、天眼查、国知局、欧盟制裁和格科微R21专用明细表原样保留；
- 化学制剂的置信度规则、质量检查和补充样本的更新审计保存在 `source_auxiliary_rows`；
- 未知值继续保持 NA，不以0填补；授权派生数据仍不得脱离原许可传播。

输出数据库：`{output_db.name}`
""",
        encoding="utf-8",
    )


def main() -> None:
    args = parse_args()
    specs = source_specs(args.sources)
    if not specs:
        raise RuntimeError("At least one source database is required")
    for spec in specs:
        if not spec.path.exists():
            raise FileNotFoundError(spec.path)
    assert_catalogs_match(specs)

    args.output_db.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(specs[0].path, args.output_db)
    master = sqlite3.connect(args.output_db)
    master.execute("PRAGMA foreign_keys=ON")
    seen_stock_codes: set[str] = set()
    kept_company_by_code: dict[str, tuple[str, int]] = {}
    duplicate_codes: list[str] = []

    try:
        create_master_tables(master)
        master.execute(
            "UPDATE companies SET peer_group_id=?,source_database_id=?,source_company_id=company_id",
            (specs[0].source_id, specs[0].source_id),
        )
        master.execute(
            "UPDATE sources SET peer_group_id=?,source_database_id=?,source_source_id=source_id",
            (specs[0].source_id, specs[0].source_id),
        )

        # Register the base database and its already-copied rows.
        base = sqlite3.connect(f"file:{specs[0].path}?mode=ro", uri=True)
        base_metadata = dict(base.execute("SELECT key,value FROM metadata"))
        base_companies = rows(base, "companies")
        master.execute(
            """
            INSERT INTO source_databases VALUES(?,?,?,?,?,?,?,?,?)
            """,
            (
                specs[0].source_id,
                specs[0].label,
                specs[0].priority,
                str(specs[0].path.resolve()),
                sha256(specs[0].path),
                len(base_companies),
                len(base_companies),
                json.dumps(base_metadata, ensure_ascii=False),
                MERGE_DATE,
            ),
        )
        master.execute(
            "INSERT INTO peer_groups VALUES(?,?,?,?,?)",
            (
                specs[0].source_id,
                specs[0].label,
                specs[0].priority,
                base_metadata.get("reporting_period") or base_metadata.get("report_scope"),
                len(base_companies),
            ),
        )
        for company in base_companies:
            company_id = int(company["company_id"])
            code = str(company["stock_code"])
            seen_stock_codes.add(code)
            kept_company_by_code[code] = (specs[0].source_id, company_id)
            add_lineage(
                master,
                table="companies",
                merged_key=str(company_id),
                source_database_id=specs[0].source_id,
                source_key=str(company_id),
                peer_group_id=specs[0].source_id,
            )
        for source_row in rows(base, "sources"):
            source_id = int(source_row["source_id"])
            add_lineage(
                master,
                table="sources",
                merged_key=str(source_id),
                source_database_id=specs[0].source_id,
                source_key=str(source_id),
                peer_group_id=specs[0].source_id,
            )
        for observation in rows(base, "observations"):
            observation_id = int(observation["observation_id"])
            add_lineage(
                master,
                table="observations",
                merged_key=str(observation_id),
                source_database_id=specs[0].source_id,
                source_key=str(observation_id),
                peer_group_id=specs[0].source_id,
            )
        for table, primary_key in COMMON_COMPANY_TABLES.items():
            if not has_table(base, table):
                continue
            for record in rows(base, table):
                if primary_key:
                    row_key = str(record[primary_key])
                else:
                    row_key = f'{record["company_id"]}:{record.get("indicator_id", "")}'
                add_lineage(
                    master,
                    table=table,
                    merged_key=row_key,
                    source_database_id=specs[0].source_id,
                    source_key=row_key,
                    peer_group_id=specs[0].source_id,
                )
        base.close()

        for spec in specs[1:]:
            source = sqlite3.connect(f"file:{spec.path}?mode=ro", uri=True)
            try:
                metadata = dict(source.execute("SELECT key,value FROM metadata"))
                all_companies = rows(source, "companies")
                selected_ids, duplicates = selected_company_ids(source, seen_stock_codes)
                company_map: dict[int, int] = {}
                new_company_id = next_id(master, "companies", "company_id")
                for company in all_companies:
                    old_company_id = int(company["company_id"])
                    code = str(company["stock_code"])
                    if old_company_id not in selected_ids:
                        kept_source, kept_company_id = kept_company_by_code[code]
                        master.execute(
                            """
                            INSERT INTO duplicate_companies(
                              stock_code,short_name,discarded_source_database_id,
                              discarded_source_company_id,kept_source_database_id,
                              kept_company_id,reason
                            ) VALUES(?,?,?,?,?,?,?)
                            """,
                            (
                                code,
                                company.get("short_name"),
                                spec.source_id,
                                old_company_id,
                                kept_source,
                                kept_company_id,
                                "按输入优先级保留更具体行业库记录",
                            ),
                        )
                        duplicate_codes.append(code)
                        continue
                    old_key = old_company_id
                    company["company_id"] = new_company_id
                    company["peer_group_id"] = spec.source_id
                    company["source_database_id"] = spec.source_id
                    company["source_company_id"] = old_key
                    insert_dict(master, "companies", company)
                    company_map[old_key] = new_company_id
                    seen_stock_codes.add(code)
                    kept_company_by_code[code] = (spec.source_id, new_company_id)
                    add_lineage(
                        master,
                        table="companies",
                        merged_key=str(new_company_id),
                        source_database_id=spec.source_id,
                        source_key=str(old_key),
                        peer_group_id=spec.source_id,
                    )
                    new_company_id += 1

                # Preserve the full source catalog of each input database.
                source_map: dict[int, int] = {}
                new_source_id = next_id(master, "sources", "source_id")
                for source_record in rows(source, "sources"):
                    old_source_id = int(source_record["source_id"])
                    source_record["source_id"] = new_source_id
                    source_record["peer_group_id"] = spec.source_id
                    source_record["source_database_id"] = spec.source_id
                    source_record["source_source_id"] = old_source_id
                    insert_dict(master, "sources", source_record)
                    source_map[old_source_id] = new_source_id
                    add_lineage(
                        master,
                        table="sources",
                        merged_key=str(new_source_id),
                        source_database_id=spec.source_id,
                        source_key=str(old_source_id),
                        peer_group_id=spec.source_id,
                    )
                    new_source_id += 1

                observation_map: dict[int, int] = {}
                new_observation_id = next_id(master, "observations", "observation_id")
                if selected_ids:
                    placeholders = ",".join("?" for _ in selected_ids)
                    selected_observations = rows(
                        source,
                        "observations",
                        f"company_id IN ({placeholders})",
                        selected_ids,
                    )
                    for observation in selected_observations:
                        old_observation_id = int(observation["observation_id"])
                        observation["observation_id"] = new_observation_id
                        observation["company_id"] = company_map[int(observation["company_id"])]
                        if observation["source_id"] is not None:
                            observation["source_id"] = source_map[int(observation["source_id"])]
                        insert_dict(master, "observations", observation)
                        observation_map[old_observation_id] = new_observation_id
                        add_lineage(
                            master,
                            table="observations",
                            merged_key=str(new_observation_id),
                            source_database_id=spec.source_id,
                            source_key=str(old_observation_id),
                            peer_group_id=spec.source_id,
                        )
                        new_observation_id += 1

                for table, primary_key in COMMON_COMPANY_TABLES.items():
                    copy_common_table(
                        master,
                        source,
                        spec=spec,
                        table=table,
                        primary_key=primary_key,
                        selected_ids=selected_ids,
                        company_map=company_map,
                        source_map=source_map,
                    )

                if has_table(source, "observation_source_links"):
                    for link in rows(source, "observation_source_links"):
                        old_observation_id = int(link["observation_id"])
                        if old_observation_id not in observation_map:
                            continue
                        master.execute(
                            """
                            INSERT OR IGNORE INTO observation_source_links(
                              observation_id,source_id,source_order
                            ) VALUES(?,?,?)
                            """,
                            (
                                observation_map[old_observation_id],
                                source_map[int(link["source_id"])],
                                link["source_order"],
                            ),
                        )

                if has_table(source, "deep_search_audit"):
                    audit_id = next_id(master, "deep_search_audit", "audit_id")
                    for audit in rows(source, "deep_search_audit"):
                        master.execute(
                            """
                            INSERT INTO deep_search_audit(
                              audit_id,update_date,method,details
                            ) VALUES(?,?,?,?)
                            """,
                            (
                                audit_id,
                                audit.get("update_date"),
                                f'[{spec.source_id}] {audit.get("method") or ""}',
                                audit.get("details"),
                            ),
                        )
                        audit_id += 1

                for table in NON_BASE_AUXILIARY_TABLES:
                    if not has_table(source, table):
                        continue
                    table_columns = columns(source, table)
                    primary_columns = [
                        row[1]
                        for row in source.execute(f'PRAGMA table_info("{table}")')
                        if row[5]
                    ]
                    for record in rows(source, table):
                        source_row_key = ":".join(
                            str(record.get(name)) for name in primary_columns
                        ) or None
                        master.execute(
                            """
                            INSERT INTO source_auxiliary_rows(
                              source_database_id,table_name,source_row_key,row_json
                            ) VALUES(?,?,?,?)
                            """,
                            (
                                spec.source_id,
                                table,
                                source_row_key,
                                json.dumps(
                                    {name: record.get(name) for name in table_columns},
                                    ensure_ascii=False,
                                ),
                            ),
                        )

                master.execute(
                    """
                    INSERT INTO source_databases VALUES(?,?,?,?,?,?,?,?,?)
                    """,
                    (
                        spec.source_id,
                        spec.label,
                        spec.priority,
                        str(spec.path.resolve()),
                        sha256(spec.path),
                        len(all_companies),
                        len(selected_ids),
                        json.dumps(metadata, ensure_ascii=False),
                        MERGE_DATE,
                    ),
                )
                master.execute(
                    "INSERT INTO peer_groups VALUES(?,?,?,?,?)",
                    (
                        spec.source_id,
                        spec.label,
                        spec.priority,
                        metadata.get("reporting_period")
                        or metadata.get("report_scope")
                        or metadata.get("data_as_of"),
                        len(selected_ids),
                    ),
                )
            finally:
                source.close()

        master.execute("DROP VIEW IF EXISTS v_master_company_directory")
        master.execute(
            """
            CREATE VIEW v_master_company_directory AS
            SELECT c.company_id,c.stock_code,c.short_name,c.full_name,
                   c.peer_group_id,p.label AS peer_group_label,
                   c.board,c.exchange,c.list_date,c.chain_segment,
                   c.confidence,c.confidence_score
            FROM companies c
            LEFT JOIN peer_groups p ON p.peer_group_id=c.peer_group_id
            """
        )
        master.execute("DROP VIEW IF EXISTS v_master_coverage_summary")
        master.execute(
            """
            CREATE VIEW v_master_coverage_summary AS
            SELECT c.peer_group_id,ic.indicator_id,ic.coverage_status,
                   COUNT(*) AS company_count,
                   SUM(ic.usable_for_scoring) AS score_ready_count
            FROM indicator_coverage ic
            JOIN companies c ON c.company_id=ic.company_id
            GROUP BY c.peer_group_id,ic.indicator_id,ic.coverage_status
            """
        )

        counts = {
            "companies": master.execute("SELECT COUNT(*) FROM companies").fetchone()[0],
            "indicators": master.execute("SELECT COUNT(*) FROM indicator_catalog").fetchone()[0],
            "sources": master.execute("SELECT COUNT(*) FROM sources").fetchone()[0],
            "observations": master.execute("SELECT COUNT(*) FROM observations").fetchone()[0],
            "coverage": master.execute("SELECT COUNT(*) FROM indicator_coverage").fetchone()[0],
            "screening": master.execute("SELECT COUNT(*) FROM screening_hits").fetchone()[0],
            "inquiry": master.execute("SELECT COUNT(*) FROM inquiry_evidence").fetchone()[0],
            "litigation": master.execute("SELECT COUNT(*) FROM litigation_evidence").fetchone()[0],
            "supplementary": master.execute("SELECT COUNT(*) FROM supplementary_observations").fetchone()[0],
            "deep_events": master.execute("SELECT COUNT(*) FROM deep_search_events").fetchone()[0],
            "reports": master.execute("SELECT COUNT(*) FROM report_availability").fetchone()[0],
            "duplicates": master.execute("SELECT COUNT(*) FROM duplicate_companies").fetchone()[0],
        }
        master.executemany(
            "INSERT OR REPLACE INTO metadata(key,value) VALUES(?,?)",
            [
                ("database_name", "科创企业R01-R22风险指标总数据库（94家）"),
                ("data_version", MASTER_VERSION),
                ("created_at", MERGE_DATE),
                ("sample_size", str(counts["companies"])),
                ("indicator_count", str(counts["indicators"])),
                ("source_database_count", str(len(specs))),
                ("peer_group_count", str(len(specs))),
                ("duplicate_company_count", str(counts["duplicates"])),
                ("source_count", str(counts["sources"])),
                ("observation_count", str(counts["observations"])),
                ("coverage_count", str(counts["coverage"])),
                ("supplementary_observation_count", str(counts["supplementary"])),
                ("deep_search_event_count", str(counts["deep_events"])),
                ("merge_priority", ">".join(spec.source_id for spec in specs)),
                ("null_semantics", "未知值保持NA，不以0填补"),
                ("master_scope", "R01-R22核心表、来源、事件、证据及数字芯片专用增强明细"),
            ],
        )
        master.execute(
            "INSERT INTO master_merge_audit(merge_date,action,details) VALUES(?,?,?)",
            (
                MERGE_DATE,
                "合并四个最新R01-R22数据库",
                json.dumps(counts, ensure_ascii=False, sort_keys=True),
            ),
        )
        master.commit()

        foreign_key_violations = master.execute("PRAGMA foreign_key_check").fetchall()
        if foreign_key_violations:
            raise RuntimeError(f"Foreign-key violations: {foreign_key_violations[:10]}")
        integrity = master.execute("PRAGMA integrity_check").fetchone()[0]
        if integrity != "ok":
            raise RuntimeError(f"Integrity check failed: {integrity}")
    finally:
        master.close()

    check = sqlite3.connect(args.output_db)
    try:
        counts = {
            "companies": check.execute("SELECT COUNT(*) FROM companies").fetchone()[0],
            "indicators": check.execute("SELECT COUNT(*) FROM indicator_catalog").fetchone()[0],
            "sources": check.execute("SELECT COUNT(*) FROM sources").fetchone()[0],
            "observations": check.execute("SELECT COUNT(*) FROM observations").fetchone()[0],
            "coverage": check.execute("SELECT COUNT(*) FROM indicator_coverage").fetchone()[0],
            "screening": check.execute("SELECT COUNT(*) FROM screening_hits").fetchone()[0],
            "inquiry": check.execute("SELECT COUNT(*) FROM inquiry_evidence").fetchone()[0],
            "litigation": check.execute("SELECT COUNT(*) FROM litigation_evidence").fetchone()[0],
            "supplementary": check.execute("SELECT COUNT(*) FROM supplementary_observations").fetchone()[0],
            "deep_events": check.execute("SELECT COUNT(*) FROM deep_search_events").fetchone()[0],
            "reports": check.execute("SELECT COUNT(*) FROM report_availability").fetchone()[0],
            "duplicates": check.execute("SELECT COUNT(*) FROM duplicate_companies").fetchone()[0],
        }
        duplicate_codes = [
            row[0]
            for row in check.execute(
                "SELECT stock_code FROM duplicate_companies ORDER BY stock_code"
            )
        ]
    finally:
        check.close()

    if args.notes:
        write_notes(args.notes, args.output_db, specs, counts, duplicate_codes)
    print(
        json.dumps(
            {
                "output_db": str(args.output_db),
                "data_version": MASTER_VERSION,
                "counts": counts,
                "duplicate_stock_codes": duplicate_codes,
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
