import json
from dataclasses import asdict
from pathlib import Path

from .models import Evidence


def build_review_items(evidence: list[Evidence]) -> list[dict]:
    items = []
    for item in evidence:
        if item.needs_review or item.confidence < 0.75:
            row = asdict(item)
            row["review_type"] = "evidence"
            items.append(row)
    return items


def save_review_queue(base_dir: Path, run_id: str, items: list[dict]) -> Path:
    out_dir = base_dir / run_id
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / "review_queue.jsonl"
    with path.open("w", encoding="utf-8") as file:
        for item in items:
            file.write(json.dumps(item, ensure_ascii=False) + "\n")
    return path
