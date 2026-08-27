from __future__ import annotations

import argparse
import json
import sqlite3
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    parser = argparse.ArgumentParser(description="Verify a completed Cambricon FEE-KBG pilot snapshot.")
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--db", default="data/risk_data.sqlite")
    args = parser.parse_args()
    db_path = Path(args.db)
    if not db_path.is_absolute():
        db_path = PROJECT_ROOT / db_path
    conn = sqlite3.connect(f"file:{db_path.as_posix()}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    run = conn.execute("SELECT * FROM fee_kbg_runs WHERE run_id=?", (args.run_id,)).fetchone()
    if not run:
        raise SystemExit(f"FEE-KBG run not found: {args.run_id}")
    dangling = conn.execute(
        """SELECT COUNT(*) FROM knowledge_graph_snapshot_edges se
           JOIN knowledge_graph_edges e ON e.edge_key=se.edge_key
           LEFT JOIN knowledge_graph_snapshot_nodes ss ON ss.run_id=se.run_id AND ss.node_key=e.subject_key
           LEFT JOIN knowledge_graph_snapshot_nodes os ON os.run_id=se.run_id AND os.node_key=e.object_key
           WHERE se.run_id=? AND (ss.node_key IS NULL OR os.node_key IS NULL)""",
        (args.run_id,),
    ).fetchone()[0]
    non_forward = conn.execute(
        """SELECT COUNT(*) FROM fee_event_evolution_edges e
           JOIN fee_event_instances s ON s.run_id=e.run_id AND s.event_key=e.source_event_key
           JOIN fee_event_instances t ON t.run_id=e.run_id AND t.event_key=e.target_event_key
           WHERE e.run_id=? AND s.event_date>=t.event_date""",
        (args.run_id,),
    ).fetchone()[0]
    other_companies = conn.execute(
        """SELECT COUNT(*) FROM knowledge_graph_snapshot_nodes s
           JOIN knowledge_graph_nodes n ON n.node_key=s.node_key
           WHERE s.run_id=? AND n.node_type='company'
             AND json_extract(n.attributes_json,'$.stock_code')<>'688256'""",
        (args.run_id,),
    ).fetchone()[0]
    invalid_impact_weights = conn.execute(
        """SELECT COUNT(*) FROM fee_subject_impacts
           WHERE run_id=? AND (influence_weight<0 OR influence_weight>1)""",
        (args.run_id,),
    ).fetchone()[0]
    subject_impact_count = conn.execute(
        "SELECT COUNT(*) FROM fee_subject_impacts WHERE run_id=?", (args.run_id,)
    ).fetchone()[0]
    invalid_influence_weights = conn.execute(
        """SELECT COUNT(*) FROM fee_subject_influences
           WHERE run_id=? AND (influence_weight<0 OR influence_weight>1)""",
        (args.run_id,),
    ).fetchone()[0]
    subject_influence_count = conn.execute(
        "SELECT COUNT(*) FROM fee_subject_influences WHERE run_id=?", (args.run_id,)
    ).fetchone()[0]
    external_event_count = conn.execute(
        "SELECT COUNT(*) FROM fee_external_subject_events WHERE run_id=?", (args.run_id,)
    ).fetchone()[0]
    external_path_count = conn.execute(
        "SELECT COUNT(*) FROM fee_external_transmission_paths WHERE run_id=?", (args.run_id,)
    ).fetchone()[0]
    invalid_external_weights = conn.execute(
        """SELECT COUNT(*) FROM fee_external_transmission_paths
           WHERE run_id=? AND (path_weight<0 OR path_weight>1)""",
        (args.run_id,),
    ).fetchone()[0]
    target_owned_external_events = conn.execute(
        """SELECT COUNT(*) FROM fee_external_subject_events e
           JOIN fee_entities n ON n.run_id=e.run_id AND n.entity_key=e.event_owner_key
           WHERE e.run_id=? AND n.entity_type='company'""",
        (args.run_id,),
    ).fetchone()[0]
    score_rows = conn.execute(
        """SELECT score_type,score_value,coverage_ratio,risk_level,limitations
           FROM fee_risk_scores WHERE run_id=? ORDER BY score_type""",
        (args.run_id,),
    ).fetchall()
    issue_rows = conn.execute(
        "SELECT severity,code,message FROM fee_validation_issues WHERE run_id=? ORDER BY severity,code",
        (args.run_id,),
    ).fetchall()
    result = {
        "run_id": args.run_id,
        "status": run["status"],
        "stock_code": run["stock_code"],
        "entity_count": run["entity_count"],
        "entity_relationship_count": run["entity_relationship_count"],
        "event_count": run["event_count"],
        "event_argument_count": run["event_argument_count"],
        "evolution_edge_count": run["evolution_edge_count"],
        "subject_impact_count": subject_impact_count,
        "subject_influence_count": subject_influence_count,
        "external_subject_event_count": external_event_count,
        "external_transmission_path_count": external_path_count,
        "risk_scores": [dict(row) for row in score_rows],
        "validation_issues": [dict(row) for row in issue_rows],
        "checks": {
            "completed": run["status"] == "completed",
            "cambricon_only": run["stock_code"] == "688256" and other_companies == 0,
            "no_dangling_edges": dangling == 0,
            "all_evolution_edges_forward": non_forward == 0,
            "subject_impact_weights_valid": invalid_impact_weights == 0 and subject_impact_count > 0,
            "subject_influence_weights_valid": invalid_influence_weights == 0 and subject_influence_count > 0,
            "external_paths_are_independent": (
                external_event_count > 0 and external_path_count > 0
                and invalid_external_weights == 0 and target_owned_external_events == 0
            ),
            "has_three_layers": all(run[key] > 0 for key in ("entity_count", "event_count", "risk_score_count")),
        },
    }
    result["valid"] = all(result["checks"].values()) and not any(
        issue["severity"] == "error" for issue in result["validation_issues"]
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))
    conn.close()
    if not result["valid"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
