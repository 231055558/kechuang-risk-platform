import hashlib
import gzip
import shutil
import sqlite3
import urllib.request
from pathlib import Path
from urllib.parse import urlparse

from .models import utc_now_iso


PDF_SCHEMA = """
CREATE TABLE IF NOT EXISTS pdf_documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_name TEXT NOT NULL DEFAULT '',
    source_kind TEXT NOT NULL,
    source TEXT NOT NULL,
    file_name TEXT NOT NULL,
    local_path TEXT NOT NULL UNIQUE,
    sha256 TEXT NOT NULL UNIQUE,
    file_size INTEGER NOT NULL,
    report_type TEXT NOT NULL DEFAULT '',
    source_name TEXT NOT NULL DEFAULT '',
    downloaded_at TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_pdf_documents_company ON pdf_documents(company_name);
CREATE INDEX IF NOT EXISTS idx_pdf_documents_report_type ON pdf_documents(report_type);
"""


def connect_pdf_registry(db_path: Path) -> sqlite3.Connection:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.executescript(PDF_SCHEMA)
    conn.commit()
    return conn


def file_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def safe_pdf_name(company_name: str, source_name: str, original_name: str) -> str:
    stem = Path(original_name).stem
    parts = [part for part in [company_name, source_name, stem] if part]
    name = "_".join(parts) if parts else stem
    for char in '<>:"/\\|?*':
        name = name.replace(char, "_")
    return name[:180] + ".pdf"


def register_local_pdf(
    conn: sqlite3.Connection,
    source_path: Path,
    pdf_dir: Path,
    company_name: str = "",
    source_name: str = "iFinD",
    report_type: str = "ifind_enterprise_report",
    notes: str = "",
) -> Path:
    if not source_path.exists():
        raise FileNotFoundError(source_path)
    pdf_dir.mkdir(parents=True, exist_ok=True)
    digest = file_sha256(source_path)
    dest_name = safe_pdf_name(company_name, source_name, source_path.name)
    dest = pdf_dir / dest_name
    if dest.exists() and file_sha256(dest) != digest:
        dest = pdf_dir / f"{dest.stem}_{digest[:8]}.pdf"
    if not dest.exists():
        shutil.copy2(source_path, dest)
    upsert_pdf_record(
        conn,
        company_name=company_name,
        source_kind="local_file",
        source=str(source_path),
        local_path=dest,
        sha256=digest,
        report_type=report_type,
        source_name=source_name,
        notes=notes,
    )
    return dest


def download_pdf(
    conn: sqlite3.Connection,
    url: str,
    pdf_dir: Path,
    company_name: str = "",
    source_name: str = "",
    report_type: str = "",
    notes: str = "",
) -> Path:
    pdf_dir.mkdir(parents=True, exist_ok=True)
    parsed = urlparse(url)
    original_name = Path(parsed.path).name or "download.pdf"
    dest = pdf_dir / safe_pdf_name(company_name, source_name, original_name)
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 risk-research-crawler/0.1",
            "Accept": "application/pdf,*/*",
        },
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        data = response.read()
        if response.headers.get("Content-Encoding", "").lower() == "gzip" or data.startswith(b"\x1f\x8b"):
            data = gzip.decompress(data)
    if not data.startswith(b"%PDF"):
        raise ValueError(f"Downloaded content is not a PDF: {url}")
    dest.write_bytes(data)
    digest = file_sha256(dest)
    upsert_pdf_record(
        conn,
        company_name=company_name,
        source_kind="url",
        source=url,
        local_path=dest,
        sha256=digest,
        report_type=report_type,
        source_name=source_name,
        notes=notes,
    )
    return dest


def upsert_pdf_record(
    conn: sqlite3.Connection,
    company_name: str,
    source_kind: str,
    source: str,
    local_path: Path,
    sha256: str,
    report_type: str,
    source_name: str,
    notes: str,
) -> int:
    stat = local_path.stat()
    conn.execute(
        """
        INSERT INTO pdf_documents(
            company_name, source_kind, source, file_name, local_path, sha256,
            file_size, report_type, source_name, downloaded_at, notes
        )
        VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(sha256) DO UPDATE SET
            company_name=excluded.company_name,
            source_kind=excluded.source_kind,
            source=excluded.source,
            file_name=excluded.file_name,
            local_path=excluded.local_path,
            file_size=excluded.file_size,
            report_type=excluded.report_type,
            source_name=excluded.source_name,
            downloaded_at=excluded.downloaded_at,
            notes=excluded.notes
        """,
        (
            company_name,
            source_kind,
            source,
            local_path.name,
            str(local_path),
            sha256,
            stat.st_size,
            report_type,
            source_name,
            utc_now_iso(),
            notes,
        ),
    )
    conn.commit()
    return conn.execute("SELECT id FROM pdf_documents WHERE sha256 = ?", (sha256,)).fetchone()["id"]
