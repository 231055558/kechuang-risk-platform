"""Verify that the consolidated SQLite master is safe to keep as the only DB."""

from __future__ import annotations

import argparse
import json
import sqlite3
from pathlib import Path


MIGRATION_ID = "single-master-sqlite-20260827-v1"
REQUIRED_COUNTS = {
    "companies": 98,
    "observations": 12033,
    "documents": 1,
    "pdf_documents": 15,
    "processed_source_records": 707,
    "crawler_companies": 4,
    "crawler_evidence": 562,
}


def verify(path: Path) -> dict:
    connection = sqlite3.connect(f"file:{path.as_posix()}?mode=ro", uri=True)
    try:
        integrity = connection.execute("PRAGMA integrity_check").fetchone()[0]
        foreign_keys = connection.execute("PRAGMA foreign_key_check").fetchall()
        migration = connection.execute(
            "SELECT COUNT(*) FROM unified_database_migrations WHERE migration_id=?",
            (MIGRATION_ID,),
        ).fetchone()[0]
        counts = {
            table: connection.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0]
            for table in REQUIRED_COUNTS
        }
        below_minimum = {
            table: {"actual": counts[table], "minimum": minimum}
            for table, minimum in REQUIRED_COUNTS.items()
            if counts[table] < minimum
        }
        result = {
            "path": str(path),
            "integrity_check": integrity,
            "foreign_key_issues": len(foreign_keys),
            "migration_count": migration,
            "user_version": connection.execute("PRAGMA user_version").fetchone()[0],
            "counts": counts,
            "below_minimum": below_minimum,
        }
        result["valid"] = (
            integrity == "ok"
            and not foreign_keys
            and migration == 1
            and not below_minimum
        )
        return result
    finally:
        connection.close()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", type=Path, required=True)
    args = parser.parse_args()
    result = verify(args.db)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    if not result["valid"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
