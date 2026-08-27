import json
from dataclasses import asdict
from pathlib import Path

from .models import Evidence


class EvidenceStore:
    def __init__(self, base_dir: Path, run_id: str):
        self.base_dir = base_dir / run_id
        self.base_dir.mkdir(parents=True, exist_ok=True)
        self.path = self.base_dir / "evidence.jsonl"

    def save_many(self, evidence: list[Evidence]) -> None:
        with self.path.open("w", encoding="utf-8") as file:
            for item in evidence:
                file.write(json.dumps(asdict(item), ensure_ascii=False) + "\n")
