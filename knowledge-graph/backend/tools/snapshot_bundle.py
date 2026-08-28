"""Export/import a privacy-safe editable knowledge-graph snapshot bundle."""

from __future__ import annotations

import argparse
import json
import re
import sqlite3
from pathlib import Path
from typing import Any


TABLES = (
    "knowledge_graph_runs",
    "knowledge_graph_nodes",
    "knowledge_graph_edges",
    "knowledge_graph_snapshot_nodes",
    "knowledge_graph_snapshot_edges",
)
SENSITIVE_KEY = re.compile(
    r"password|passwd|secret|token|api[_-]?key|cookie|raw[_-]?(?:payload|response)|paid[_-]?raw",
    re.I,
)
LOCAL_PATH = re.compile(r"^[A-Za-z]:[\\/]")


def _sanitize(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            key: _sanitize(item)
            for key, item in value.items()
            if not SENSITIVE_KEY.search(str(key)) and str(key).lower() != "profile"
        }
    if isinstance(value, list):
        return [_sanitize(item) for item in value]
    if isinstance(value, str) and LOCAL_PATH.match(value.strip()):
        return "<local-path-removed>"
    return value


def _sanitize_row(row: sqlite3.Row) -> dict[str, Any]:
    result = dict(row)
    for key, value in list(result.items()):
        if SENSITIVE_KEY.search(key):
            result[key] = None
            continue
        if key.endswith("_json") and isinstance(value, str):
            try:
                result[key] = json.dumps(
                    _sanitize(json.loads(value or "{}")),
                    ensure_ascii=False,
                    sort_keys=True,
                )
            except json.JSONDecodeError:
                result[key] = "{}"
        else:
            result[key] = _sanitize(value)
    return result


def _fetch_rows(conn: sqlite3.Connection, table: str, run_id: str) -> list[dict[str, Any]]:
    if table == "knowledge_graph_runs":
        rows = conn.execute(f"SELECT * FROM {table} WHERE run_id=?", (run_id,)).fetchall()
    elif table in {"knowledge_graph_snapshot_nodes", "knowledge_graph_snapshot_edges"}:
        rows = conn.execute(f"SELECT * FROM {table} WHERE run_id=?", (run_id,)).fetchall()
    elif table == "knowledge_graph_nodes":
        snapshot_columns = {str(row[1]) for row in conn.execute("PRAGMA table_info(knowledge_graph_snapshot_nodes)")}
        if "attributes_json" in snapshot_columns:
            rows = conn.execute(
                """SELECT s.node_key,s.node_type,s.canonical_name,s.attributes_json,
                          s.confidence,s.needs_review,s.review_reason,
                          n.first_seen_run_id,n.last_seen_run_id,s.created_at,s.updated_at
                   FROM knowledge_graph_snapshot_nodes s
                   JOIN knowledge_graph_nodes n ON n.node_key=s.node_key
                   WHERE s.run_id=? ORDER BY s.node_key""",
                (run_id,),
            ).fetchall()
        else:
            rows = conn.execute(
                """SELECT n.* FROM knowledge_graph_snapshot_nodes s
                   JOIN knowledge_graph_nodes n ON n.node_key=s.node_key
                   WHERE s.run_id=? ORDER BY n.node_key""",
                (run_id,),
            ).fetchall()
    else:
        snapshot_columns = {str(row[1]) for row in conn.execute("PRAGMA table_info(knowledge_graph_snapshot_edges)")}
        if "attributes_json" in snapshot_columns:
            rows = conn.execute(
                """SELECT s.edge_key,s.subject_key,s.relation_type,s.object_key,s.attributes_json,
                          s.confidence,s.needs_review,s.review_reason,s.source_id,s.source_evidence_id,
                          e.first_seen_run_id,e.last_seen_run_id,s.created_at,s.updated_at
                   FROM knowledge_graph_snapshot_edges s
                   JOIN knowledge_graph_edges e ON e.edge_key=s.edge_key
                   WHERE s.run_id=? ORDER BY s.edge_key""",
                (run_id,),
            ).fetchall()
        else:
            rows = conn.execute(
                """SELECT e.* FROM knowledge_graph_snapshot_edges s
                   JOIN knowledge_graph_edges e ON e.edge_key=s.edge_key
                   WHERE s.run_id=? ORDER BY e.edge_key""",
                (run_id,),
            ).fetchall()
    return [_sanitize_row(row) for row in rows]


def export_bundle(source_db: Path, run_id: str, json_out: Path, sqlite_out: Path) -> None:
    for target in (json_out, sqlite_out):
        if target.exists():
            raise FileExistsError(f"Refusing to overwrite: {target}")
        target.parent.mkdir(parents=True, exist_ok=True)
    source = sqlite3.connect(f"file:{source_db.as_posix()}?mode=ro", uri=True)
    source.row_factory = sqlite3.Row
    schemas: dict[str, str] = {}
    records: dict[str, list[dict[str, Any]]] = {}
    for table in TABLES:
        schema_row = source.execute(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name=?", (table,)
        ).fetchone()
        if not schema_row or not schema_row["sql"]:
            raise RuntimeError(f"Missing source table: {table}")
        schemas[table] = schema_row["sql"]
        records[table] = _fetch_rows(source, table, run_id)
    source.close()
    if not records["knowledge_graph_runs"]:
        raise LookupError(f"Snapshot not found: {run_id}")
    payload = {
        "format": "kechuang-risk-knowledge-graph-snapshot-v1",
        "run_id": run_id,
        "privacy": "Graph projection only; no credentials, paid raw responses, or source business tables.",
        "schemas": schemas,
        "records": records,
    }
    json_out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    import_bundle(json_out, sqlite_out)


def import_bundle(json_path: Path, sqlite_out: Path) -> None:
    if sqlite_out.exists():
        raise FileExistsError(f"Refusing to overwrite: {sqlite_out}")
    payload = json.loads(json_path.read_text(encoding="utf-8"))
    if payload.get("format") != "kechuang-risk-knowledge-graph-snapshot-v1":
        raise ValueError("Unsupported snapshot format")
    sqlite_out.parent.mkdir(parents=True, exist_ok=True)
    target = sqlite3.connect(sqlite_out)
    try:
        for table in TABLES:
            target.execute(payload["schemas"][table])
        for table in TABLES:
            rows = payload["records"].get(table) or []
            if not rows:
                continue
            columns = list(rows[0])
            placeholders = ",".join("?" for _ in columns)
            sql = f"INSERT INTO {table} ({','.join(columns)}) VALUES ({placeholders})"
            target.executemany(sql, [[row.get(column) for column in columns] for row in rows])
        target.execute("PRAGMA user_version = 1")
        target.commit()
        violations = target.execute("PRAGMA foreign_key_check").fetchall()
        if violations:
            raise RuntimeError(f"Foreign key violations: {violations[:5]}")
    except Exception:
        target.close()
        sqlite_out.unlink(missing_ok=True)
        raise
    target.close()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    export = sub.add_parser("export")
    export.add_argument("--source-db", type=Path, required=True)
    export.add_argument("--run-id", required=True)
    export.add_argument("--json-out", type=Path, required=True)
    export.add_argument("--sqlite-out", type=Path, required=True)
    restore = sub.add_parser("import")
    restore.add_argument("--json", type=Path, required=True)
    restore.add_argument("--sqlite-out", type=Path, required=True)
    args = parser.parse_args()
    if args.command == "export":
        export_bundle(args.source_db, args.run_id, args.json_out, args.sqlite_out)
    else:
        import_bundle(args.json, args.sqlite_out)


if __name__ == "__main__":
    main()
