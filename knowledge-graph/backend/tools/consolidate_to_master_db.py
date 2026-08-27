"""Consolidate auxiliary processed SQLite data into data/risk_data.sqlite.

The script is idempotent and never deletes source databases.  Deletion is a
separate, post-verification operation.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

from src.database import CRAWLER_TABLE_MAP, connect, init_db  # noqa: E402
from src.unified_storage import ensure_unified_storage_schema  # noqa: E402


MIGRATION_ID = "single-master-sqlite-20260827-v1"
IFIND_TABLE_ORDER = (
    "documents",
    "company_profiles",
    "company_statistics",
    "customers",
    "financing_events",
    "missing_fields",
    "news_events",
    "patents",
    "people",
    "raw_tables",
    "risk_raw_sections",
    "sections",
    "shareholders",
    "software_copyrights",
    "suppliers",
    "tenders",
    "trademarks",
)
LEGACY_CRAWLER_TABLE_ORDER = (
    "companies",
    "indicators",
    "data_types",
    "sources",
    "indicator_data_requirements",
    "pipeline_runs",
    "pipeline_source_runs",
    "review_feedback",
    "evidence",
    "indicator_scores",
    "entities",
    "entity_relations",
)
OBSOLETE_EMPTY_TABLES = (
    "review_feedback",
    "indicator_scores",
    "entity_relations",
    "entities",
    "evidence",
    "indicator_data_requirements",
    "pipeline_source_runs",
    "pipeline_runs",
    "data_types",
    "indicators",
)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, default=str)


def _read_only(path: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(f"file:{path.as_posix()}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    return connection


def _columns(conn: sqlite3.Connection, table: str) -> list[str]:
    return [str(row[1]) for row in conn.execute(f'PRAGMA table_info("{table}")')]


def _copy_table(
    source: sqlite3.Connection,
    target: sqlite3.Connection,
    table: str,
) -> dict[str, int]:
    source_columns = _columns(source, table)
    target_columns = _columns(target, table)
    if source_columns != target_columns:
        raise RuntimeError(
            f"Schema mismatch for {table}: source={source_columns}, target={target_columns}"
        )
    source_rows = source.execute(f'SELECT * FROM "{table}" ORDER BY rowid').fetchall()
    before = target.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0]
    if source_rows:
        placeholders = ",".join("?" for _ in source_columns)
        columns_sql = ",".join(f'"{column}"' for column in source_columns)
        target.executemany(
            f'INSERT OR IGNORE INTO "{table}" ({columns_sql}) VALUES ({placeholders})',
            [[row[column] for column in source_columns] for row in source_rows],
        )
    after = target.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0]
    missing = 0
    primary_keys = [
        str(row[1])
        for row in source.execute(f'PRAGMA table_info("{table}")')
        if int(row[5] or 0) > 0
    ]
    if primary_keys:
        for row in source_rows:
            where = " AND ".join(f'"{column}"=?' for column in primary_keys)
            params = tuple(row[column] for column in primary_keys)
            if not target.execute(
                f'SELECT 1 FROM "{table}" WHERE {where} LIMIT 1', params
            ).fetchone():
                missing += 1
    return {
        "source": len(source_rows),
        "before": int(before),
        "after": int(after),
        "inserted": int(after - before),
        "missing_after": int(missing),
    }


def _copy_legacy_table_to_crawler(
    source: sqlite3.Connection,
    target: sqlite3.Connection,
    source_table: str,
) -> dict[str, int]:
    target_table = CRAWLER_TABLE_MAP[source_table]
    source_columns = _columns(source, source_table)
    if not source_columns:
        return {"source": 0, "before": 0, "after": 0, "inserted": 0}
    target_columns = _columns(target, target_table)
    shared_columns = [column for column in source_columns if column in target_columns]
    if not shared_columns:
        raise RuntimeError(f"No compatible columns for {source_table} -> {target_table}")
    source_rows = source.execute(f'SELECT * FROM "{source_table}" ORDER BY rowid').fetchall()
    before = target.execute(f'SELECT COUNT(*) FROM "{target_table}"').fetchone()[0]
    if source_rows:
        placeholders = ",".join("?" for _ in shared_columns)
        columns_sql = ",".join(f'"{column}"' for column in shared_columns)
        target.executemany(
            f'INSERT OR IGNORE INTO "{target_table}" ({columns_sql}) VALUES ({placeholders})',
            [[row[column] for column in shared_columns] for row in source_rows],
        )
    after = target.execute(f'SELECT COUNT(*) FROM "{target_table}"').fetchone()[0]
    return {
        "source": len(source_rows),
        "before": int(before),
        "after": int(after),
        "inserted": int(after - before),
    }


def _drop_obsolete_empty_tables(target: sqlite3.Connection) -> list[str]:
    dropped: list[str] = []
    target.commit()
    target.execute("PRAGMA foreign_keys = OFF")
    try:
        for table in OBSOLETE_EMPTY_TABLES:
            exists = target.execute(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)
            ).fetchone()
            if not exists:
                continue
            count = target.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0]
            if count:
                raise RuntimeError(f"Refusing to drop non-empty obsolete table: {table} ({count})")
            target.execute(f'DROP TABLE "{table}"')
            dropped.append(table)
        target.commit()
    finally:
        target.execute("PRAGMA foreign_keys = ON")
    return dropped


def _register_dataset(
    target: sqlite3.Connection,
    *,
    dataset_id: str,
    source_system: str,
    source_table: str,
    source_path: Path,
    source_sha256: str,
    source_schema: str,
    record_count: int,
    imported_at: str,
    metadata: dict[str, Any] | None = None,
) -> None:
    target.execute(
        """INSERT INTO processed_source_datasets(
               dataset_id,source_system,source_table,source_file_name,source_sha256,
               source_schema_json,record_count,imported_at,metadata_json
           ) VALUES (?,?,?,?,?,?,?,?,?)
           ON CONFLICT(dataset_id) DO UPDATE SET
               source_sha256=excluded.source_sha256,
               source_schema_json=excluded.source_schema_json,
               record_count=excluded.record_count,
               imported_at=excluded.imported_at,
               metadata_json=excluded.metadata_json""",
        (
            dataset_id,
            source_system,
            source_table,
            source_path.name,
            source_sha256,
            _json({"create_sql": source_schema}),
            record_count,
            imported_at,
            _json(metadata or {}),
        ),
    )


def _archive_database(
    source_path: Path,
    target: sqlite3.Connection,
    source_system: str,
    imported_at: str,
) -> dict[str, int]:
    source = _read_only(source_path)
    source_hash = _sha256(source_path)
    result: dict[str, int] = {}
    try:
        tables = [
            str(row[0])
            for row in source.execute(
                """SELECT name FROM sqlite_master
                   WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"""
            )
        ]
        for table in tables:
            dataset_id = f"{source_system}:{table}"
            schema_row = source.execute(
                "SELECT sql FROM sqlite_master WHERE type='table' AND name=?", (table,)
            ).fetchone()
            rows = source.execute(f'SELECT rowid AS _source_rowid_, * FROM "{table}"').fetchall()
            columns_info = source.execute(f'PRAGMA table_info("{table}")').fetchall()
            primary_keys = [
                str(row[1]) for row in sorted(columns_info, key=lambda item: int(item[5] or 0))
                if int(row[5] or 0) > 0
            ]
            _register_dataset(
                target,
                dataset_id=dataset_id,
                source_system=source_system,
                source_table=table,
                source_path=source_path,
                source_sha256=source_hash,
                source_schema=str(schema_row[0] if schema_row else ""),
                record_count=len(rows),
                imported_at=imported_at,
                metadata={"storage": "normalized-json-archive"},
            )
            for row in rows:
                record = {key: row[key] for key in row.keys() if key != "_source_rowid_"}
                if primary_keys:
                    source_key = "|".join(str(record.get(key, "")) for key in primary_keys)
                else:
                    source_key = str(row["_source_rowid_"])
                record_json = _json(record)
                content_hash = hashlib.sha256(record_json.encode("utf-8")).hexdigest()
                target.execute(
                    """INSERT INTO processed_source_records(
                           dataset_id,source_row_key,record_json,content_hash,imported_at
                       ) VALUES (?,?,?,?,?)
                       ON CONFLICT(dataset_id,source_row_key) DO UPDATE SET
                           record_json=excluded.record_json,
                           content_hash=excluded.content_hash,
                           imported_at=excluded.imported_at""",
                    (dataset_id, source_key, record_json, content_hash, imported_at),
                )
            result[table] = len(rows)
    finally:
        source.close()
    return result


def consolidate(
    master_db: Path,
    ifind_reports_db: Path,
    pdf_registry_db: Path,
    legacy_ifind_db: Path,
) -> dict[str, Any]:
    for path in (master_db, ifind_reports_db, pdf_registry_db, legacy_ifind_db):
        if not path.is_file():
            raise FileNotFoundError(path)
    imported_at = _now()
    source_summary = {
        "ifind_reports": {"path": ifind_reports_db.name, "sha256": _sha256(ifind_reports_db)},
        "pdf_registry": {"path": pdf_registry_db.name, "sha256": _sha256(pdf_registry_db)},
        "legacy_ifind": {"path": legacy_ifind_db.name, "sha256": _sha256(legacy_ifind_db)},
    }
    target = connect(master_db)
    target.row_factory = sqlite3.Row
    target.execute("PRAGMA busy_timeout = 120000")
    target.execute("PRAGMA journal_mode = WAL")
    try:
        init_db(target)
        ifind_source = _read_only(ifind_reports_db)
        try:
            ifind_counts = {
                table: _copy_table(ifind_source, target, table) for table in IFIND_TABLE_ORDER
            }
            ifind_source_hash = source_summary["ifind_reports"]["sha256"]
            for table, counts in ifind_counts.items():
                schema_row = ifind_source.execute(
                    "SELECT sql FROM sqlite_master WHERE type='table' AND name=?", (table,)
                ).fetchone()
                _register_dataset(
                    target,
                    dataset_id=f"ifind-struct:{table}",
                    source_system="ifind-struct",
                    source_table=table,
                    source_path=ifind_reports_db,
                    source_sha256=ifind_source_hash,
                    source_schema=str(schema_row[0] if schema_row else ""),
                    record_count=counts["source"],
                    imported_at=imported_at,
                    metadata={"storage": "live-master-table", "target_table": table},
                )
        finally:
            ifind_source.close()

        pdf_source = _read_only(pdf_registry_db)
        try:
            pdf_counts = _copy_table(pdf_source, target, "pdf_documents")
            schema_row = pdf_source.execute(
                "SELECT sql FROM sqlite_master WHERE type='table' AND name='pdf_documents'"
            ).fetchone()
            _register_dataset(
                target,
                dataset_id="pdf-registry:pdf_documents",
                source_system="pdf-registry",
                source_table="pdf_documents",
                source_path=pdf_registry_db,
                source_sha256=source_summary["pdf_registry"]["sha256"],
                source_schema=str(schema_row[0] if schema_row else ""),
                record_count=pdf_counts["source"],
                imported_at=imported_at,
                metadata={"storage": "live-master-table", "target_table": "pdf_documents"},
            )
        finally:
            pdf_source.close()

        legacy_source = _read_only(legacy_ifind_db)
        try:
            crawler_counts = {
                table: _copy_legacy_table_to_crawler(legacy_source, target, table)
                for table in LEGACY_CRAWLER_TABLE_ORDER
            }
        finally:
            legacy_source.close()
        archived_counts = _archive_database(
            legacy_ifind_db, target, "legacy-ifind-risk-db", imported_at
        )
        result_summary = {
            "ifind_tables": ifind_counts,
            "pdf_documents": pdf_counts,
            "legacy_ifind_live_crawler_tables": crawler_counts,
            "legacy_ifind_archived": archived_counts,
        }
        missing_ifind = sum(row["missing_after"] for row in ifind_counts.values())
        verification = {
            "ifind_source_rows": sum(row["source"] for row in ifind_counts.values()),
            "ifind_missing_after": missing_ifind,
            "pdf_source_rows": pdf_counts["source"],
            "pdf_missing_after": pdf_counts["missing_after"],
            "legacy_ifind_archived_rows": sum(archived_counts.values()),
            "legacy_ifind_live_rows": sum(row["after"] for row in crawler_counts.values()),
        }
        if missing_ifind or pdf_counts["missing_after"]:
            raise RuntimeError(f"Migration row verification failed: {verification}")
        target.execute(f"PRAGMA user_version = 20260827")
        target.execute(
            """INSERT INTO unified_database_migrations(
                   migration_id,applied_at,source_summary_json,result_summary_json,verification_json
               ) VALUES (?,?,?,?,?)
               ON CONFLICT(migration_id) DO UPDATE SET
                   applied_at=excluded.applied_at,
                   source_summary_json=excluded.source_summary_json,
                   result_summary_json=excluded.result_summary_json,
                   verification_json=excluded.verification_json""",
            (
                MIGRATION_ID,
                imported_at,
                _json(source_summary),
                _json(result_summary),
                _json(verification),
            ),
        )
        target.commit()
        dropped_tables = _drop_obsolete_empty_tables(target)
        result_summary["dropped_obsolete_empty_tables"] = dropped_tables
        foreign_key_issues = target.execute("PRAGMA foreign_key_check").fetchall()
        if foreign_key_issues:
            raise RuntimeError(f"Foreign-key violations after migration: {foreign_key_issues[:5]}")
        verification["foreign_key_check"] = "ok"
        target.execute(
            """UPDATE unified_database_migrations
               SET result_summary_json=?, verification_json=? WHERE migration_id=?""",
            (_json(result_summary), _json(verification), MIGRATION_ID),
        )
        target.commit()
        return {
            "migration_id": MIGRATION_ID,
            "master_db": str(master_db),
            "source_summary": source_summary,
            "result_summary": result_summary,
            "verification": verification,
        }
    except Exception:
        target.rollback()
        raise
    finally:
        target.close()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--master-db", type=Path, default=Path("data/risk_data.sqlite"))
    parser.add_argument("--ifind-reports-db", type=Path, default=Path("data/ifind_reports.sqlite"))
    parser.add_argument("--pdf-registry-db", type=Path, default=Path("data/pdf_registry.sqlite"))
    parser.add_argument("--legacy-ifind-db", type=Path, default=Path("data/risk_data_ifind.sqlite"))
    args = parser.parse_args()

    def resolved(path: Path) -> Path:
        return path if path.is_absolute() else PROJECT_ROOT / path

    result = consolidate(
        resolved(args.master_db),
        resolved(args.ifind_reports_db),
        resolved(args.pdf_registry_db),
        resolved(args.legacy_ifind_db),
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
