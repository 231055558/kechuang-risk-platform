import hashlib
import json
from pathlib import Path
from typing import Any

from .models import RawDocument


class RawStore:
    def __init__(self, base_dir: Path, run_id: str):
        self.base_dir = base_dir / run_id
        self.base_dir.mkdir(parents=True, exist_ok=True)

    def save(self, source_id: str, payload: Any, metadata: dict) -> RawDocument:
        serialized = json.dumps(payload, ensure_ascii=False, sort_keys=True)
        digest = hashlib.sha256(serialized.encode("utf-8")).hexdigest()[:16]
        path = self.base_dir / f"{source_id}_{digest}.json"
        path.write_text(
            json.dumps({"metadata": metadata, "payload": payload}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        return RawDocument(
            source_id=metadata["source_id"],
            source_name=metadata["source_name"],
            source_type=metadata["source_type"],
            fetched_at=metadata["fetched_at"],
            content_type="application/json",
            content=payload,
            raw_path=str(path),
        )

    def load(self, path: str | Path) -> RawDocument:
        """Rehydrate a saved response so an interrupted run can continue parsing it."""
        record_path = Path(path)
        item = json.loads(record_path.read_text(encoding="utf-8"))
        metadata = item["metadata"]
        return RawDocument(
            source_id=metadata["source_id"],
            source_name=metadata["source_name"],
            source_type=metadata["source_type"],
            fetched_at=metadata["fetched_at"],
            content_type="application/json",
            content=item["payload"],
            raw_path=str(record_path),
        )
