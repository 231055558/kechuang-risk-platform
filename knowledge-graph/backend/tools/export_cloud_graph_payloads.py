"""Export complete FEE-KBG runtime views for PostgreSQL import.

The export contains processed graph nodes, directed relationships, weights and
source references only. Credentials and crawler raw responses are never read.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

from serve_fee_kbg_preview import SQLiteFeeReader


DEFAULT_RUN_IDS = (
    "cambricon_fee_kbg_20260826_v1",
    "semidrive_fee_kbg_20260827_v1",
)
THRESHOLDS = (0.35, 0.5, 0.75)


def digest(payload: object) -> str:
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--run-id", action="append", dest="run_ids")
    args = parser.parse_args()
    run_ids = tuple(args.run_ids or DEFAULT_RUN_IDS)
    companies = []
    snapshots = []
    for run_id in run_ids:
        reader = SQLiteFeeReader(args.db, run_id)
        reader.health()
        roots = reader.companies()
        if len(roots) != 1:
            raise RuntimeError(f"run {run_id} must contain exactly one company root")
        root = roots[0]
        company_key = root["id"]
        companies.append({
            "companyKey": company_key,
            "companyName": root["label"],
            "runId": run_id,
            "stockCode": str(root.get("attributes", {}).get("stock_code") or ""),
            "payload": root,
        })
        for threshold in THRESHOLDS:
            for view, payload in (
                ("fee-transmission", reader.fee_transmission(company_key, 800, threshold)),
                ("subject-panorama", reader.subject_panorama(company_key, 800, threshold)),
            ):
                snapshots.append({
                    "companyKey": company_key,
                    "runId": run_id,
                    "view": view,
                    "minWeight": threshold,
                    "payloadSha256": digest(payload),
                    "payload": payload,
                })
    output = {
        "schemaVersion": "KCR-RISK-GRAPH-POSTGRES-2026.08-v1",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "sourceDatabase": args.db.name,
        "companies": companies,
        "snapshots": snapshots,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(json.dumps({
        "output": str(args.output),
        "companyCount": len(companies),
        "snapshotCount": len(snapshots),
        "bytes": args.output.stat().st_size,
        "schemaVersion": output["schemaVersion"],
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
