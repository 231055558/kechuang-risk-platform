import argparse
import json
import sqlite3
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

from src.knowledge_graph_agent import run_knowledge_graph_agent
from src.r01r22_knowledge_graph import run_r01r22_knowledge_graph_agent


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Build a validated, versioned risk knowledge-graph snapshot from existing crawler data."
    )
    parser.add_argument("--run-id", required=True, help="Unique graph snapshot id; safe to rerun for refresh.")
    parser.add_argument("--company", default="", help="Full company name or an unambiguous name fragment. Omit to build a whole-library snapshot.")
    parser.add_argument("--db", default="data/risk_data.sqlite", help="SQLite path relative to project root.")
    parser.add_argument(
        "--include-unreviewed",
        action="store_true",
        help="Include low-confidence/manual-review entities and relations in the graph snapshot.",
    )
    args = parser.parse_args()
    db_path = PROJECT_ROOT / args.db
    with sqlite3.connect(db_path) as probe:
        is_r01r22_master = bool(probe.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='indicator_catalog'"
        ).fetchone())
    builder = run_r01r22_knowledge_graph_agent if is_r01r22_master else run_knowledge_graph_agent
    output = builder(
        db_path,
        run_id=args.run_id,
        company=args.company,
        include_unreviewed=args.include_unreviewed,
    )
    print(json.dumps(output, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
