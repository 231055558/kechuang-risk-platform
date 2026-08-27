import argparse
import json
import os
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

from src.neo4j_sync import Neo4jRiskGraphSync


def main() -> None:
    parser = argparse.ArgumentParser(description="Initialize Neo4j risk schema or synchronise a completed SQLite graph snapshot.")
    parser.add_argument("--uri", default=os.getenv("NEO4J_URI", "bolt://localhost:7687"))
    parser.add_argument("--username", default=os.getenv("NEO4J_USERNAME", "neo4j"))
    parser.add_argument("--password", default=os.getenv("NEO4J_PASSWORD", ""), help="Prefer NEO4J_PASSWORD environment variable.")
    parser.add_argument("--database", default=os.getenv("NEO4J_DATABASE", "neo4j"))
    parser.add_argument("--db", default="data/risk_data.sqlite", help="SQLite path relative to project root.")
    parser.add_argument("--init-only", action="store_true", help="Create Neo4j constraint and indexes, without data synchronisation.")
    parser.add_argument("--run-id", help="Completed SQLite knowledge graph run id to synchronise.")
    parser.add_argument("--mark-not-in-snapshot", action="store_true", help="Mark (not delete) older members as not in this snapshot.")
    parser.add_argument("--replace-relation-types", action="store_true", help="After syncing Chinese relation types, delete only old English copies carrying a managed edge_key.")
    args = parser.parse_args()
    if not args.password:
        parser.error("provide --password or set NEO4J_PASSWORD")
    if not args.init_only and not args.run_id:
        parser.error("provide --run-id unless --init-only is used")
    sync = Neo4jRiskGraphSync(PROJECT_ROOT / args.db, args.uri, args.username, args.password, args.database)
    result = sync.initialize_schema()
    if not args.init_only:
        result.update(sync.sync_snapshot(args.run_id, prune_snapshot_members=args.mark_not_in_snapshot, replace_relation_types=args.replace_relation_types))
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
