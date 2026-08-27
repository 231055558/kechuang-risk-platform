"""Generate data-source health reports from pipeline run records."""

from __future__ import annotations

import importlib.util
import sqlite3
from pathlib import Path

from .database import connect, init_db


PROJECT_ROOT = Path(__file__).resolve().parents[1]
_REPORT_PATH = PROJECT_ROOT / "tools" / "source_health_report.py"


def write_source_health_report(db_path: Path, report_path: Path, days: int = 30) -> str:
    spec = importlib.util.spec_from_file_location("risk_source_health_report", _REPORT_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"unable to load source health report module: {_REPORT_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    connection = connect(db_path)
    init_db(connection)
    summary, details = module.build_health_report(connection, days)
    connection.close()
    module.save_markdown(report_path, summary, details)
    return str(report_path)
