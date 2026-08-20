#!/usr/bin/env python3
"""Build a redistributable SQLite snapshot from the local master database.

The calculation-ready facts, source catalog, lineage, and audit tables are kept.
Paid API response bodies are removed and workstation paths are rewritten to
portable locators before the database is committed to the public repository.
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import sqlite3
from pathlib import Path


PAID_RESULT_TABLES = (
    "tyc_paid_api_company_results",
    "tyc_paid_key_person_results",
    "tyc_remaining_company_results",
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input_db", type=Path)
    parser.add_argument("output_db", type=Path)
    return parser.parse_args()


def quote(identifier: str) -> str:
    return '"' + identifier.replace('"', '""') + '"'


def has_table(connection: sqlite3.Connection, table: str) -> bool:
    return (
        connection.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)
        ).fetchone()
        is not None
    )


def portable_text(value: str) -> str:
    result = value.replace("\\", "/")
    result = re.sub(
        r"/[Uu]sers/[^/\"'\s]+/(?:[^\"'\r\n]*?/)?geng/",
        "external-source/",
        result,
    )
    result = re.sub(
        r"/[Hh]ome/[^/\"'\s]+/(?:[^\"'\r\n]*?/)?geng/",
        "external-source/",
        result,
    )
    result = re.sub(
        r"[A-Za-z]:/[Uu]sers/[^/\"'\s]+/(?:[^\"'\r\n]*?/)?",
        "external-source/",
        result,
    )
    result = re.sub(r"/[Uu]sers/[^/\"'\s]+/", "user-home/", result)
    result = re.sub(r"/[Hh]ome/[^/\"'\s]+/", "user-home/", result)
    return result


def rewrite_text_columns(connection: sqlite3.Connection) -> int:
    updates = 0
    tables = [
        row[0]
        for row in connection.execute(
            "SELECT name FROM sqlite_master "
            "WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
        )
    ]
    for table in tables:
        columns = [
            row[1]
            for row in connection.execute(f"PRAGMA table_info({quote(table)})")
            if not row[2]
            or "TEXT" in str(row[2]).upper()
            or "CHAR" in str(row[2]).upper()
        ]
        for column in columns:
            rows = connection.execute(
                f"SELECT rowid, {quote(column)} FROM {quote(table)} "
                f"WHERE {quote(column)} IS NOT NULL"
            ).fetchall()
            for rowid, value in rows:
                if not isinstance(value, str):
                    continue
                rewritten = portable_text(value)
                if rewritten == value:
                    continue
                connection.execute(
                    f"UPDATE {quote(table)} SET {quote(column)}=? WHERE rowid=?",
                    (rewritten, rowid),
                )
                updates += 1
    return updates


def redact_paid_payloads(connection: sqlite3.Connection) -> tuple[int, dict[str, int]]:
    total = 0
    counts: dict[str, int] = {}
    for table in PAID_RESULT_TABLES:
        if not has_table(connection, table):
            continue
        count = connection.execute(
            f"SELECT COUNT(*) FROM {quote(table)} WHERE result_json IS NOT NULL"
        ).fetchone()[0]
        connection.execute(
            f"UPDATE {quote(table)} SET result_json=NULL WHERE result_json IS NOT NULL"
        )
        counts[table] = count
        total += count
    return total, counts


def set_snapshot_metadata(connection: sqlite3.Connection) -> None:
    if not has_table(connection, "metadata"):
        return
    values = {
        "distribution_profile": "public-redistributable-snapshot",
        "paid_api_raw_payloads": "redacted; derived facts and audit counts retained",
        "workstation_paths": "rewritten to portable external-source locators",
    }
    connection.executemany(
        "INSERT OR REPLACE INTO metadata(key,value) VALUES(?,?)", values.items()
    )


def main() -> None:
    args = parse_args()
    if not args.input_db.is_file():
        raise FileNotFoundError(args.input_db)
    if args.output_db.exists():
        raise FileExistsError(args.output_db)
    args.output_db.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(args.input_db, args.output_db)

    connection = sqlite3.connect(args.output_db)
    try:
        connection.execute("PRAGMA foreign_keys=ON")
        redacted_total, redacted_by_table = redact_paid_payloads(connection)
        rewritten_values = rewrite_text_columns(connection)
        set_snapshot_metadata(connection)
        connection.commit()
        violations = connection.execute("PRAGMA foreign_key_check").fetchall()
        if violations:
            raise RuntimeError(f"foreign-key violations: {violations[:10]}")
        integrity = connection.execute("PRAGMA integrity_check").fetchone()[0]
        if integrity != "ok":
            raise RuntimeError(f"integrity check failed: {integrity}")
        connection.execute("VACUUM")
    finally:
        connection.close()

    payload = args.output_db.read_bytes()
    forbidden = (b"/Users/", b"/home/", b":/Users/", b":\\Users\\")
    found = [item.decode("utf-8", "replace") for item in forbidden if item in payload]
    if found:
        args.output_db.unlink(missing_ok=True)
        raise RuntimeError(f"snapshot still contains workstation paths: {found}")

    print(
        json.dumps(
            {
                "output_db": str(args.output_db),
                "redacted_payloads": redacted_total,
                "redacted_by_table": redacted_by_table,
                "rewritten_text_values": rewritten_values,
                "size_bytes": args.output_db.stat().st_size,
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
