import json
from pathlib import Path

from .models import SourceConfig


def load_registry(path: Path) -> tuple[list[SourceConfig], list[dict]]:
    # Accept UTF-8 files created by both PowerShell 5 (with BOM) and newer
    # editors, while keeping the registry format portable.
    payload = json.loads(path.read_text(encoding="utf-8-sig"))
    # Licensed endpoint templates remain inert until their documented request
    # details and entitlement have been verified.
    sources = [SourceConfig(**item) for item in payload["sources"] if item.get("enabled", True)]
    companies = payload.get("target_companies", [])
    return sources, companies
