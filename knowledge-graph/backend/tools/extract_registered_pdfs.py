import argparse
import json
import sqlite3
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

from src.database import connect, init_db, insert_many_evidence, upsert_company
from src.financial_pdf import extract_annual_report_sections, extract_financial_fields
from src.financial_pdf_evidence import evidence_from_exception, evidence_from_fields, evidence_from_financial_issues, evidence_from_sections
from src.pdf_registry import connect_pdf_registry


def load_pdf_rows(registry_db: Path, company: str = "", limit: int = 0) -> list[sqlite3.Row]:
    conn = connect_pdf_registry(registry_db)
    query = "SELECT * FROM pdf_documents"
    params = []
    if company:
        query += " WHERE company_name LIKE '%' || ? || '%'"
        params.append(company)
    query += " ORDER BY downloaded_at DESC, id DESC"
    if limit:
        query += " LIMIT ?"
        params.append(limit)
    rows = conn.execute(query, params).fetchall()
    conn.close()
    return rows


def main():
    parser = argparse.ArgumentParser(description="Extract financial and annual-report evidence from registered PDFs.")
    parser.add_argument("--registry-db", default="data/risk_data.sqlite")
    parser.add_argument("--risk-db", default="data/risk_data.sqlite")
    parser.add_argument("--company", default="")
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--run-id", default="")
    parser.add_argument("--include-text-fallback", action="store_true")
    parser.add_argument("--extract-sections", action="store_true")
    args = parser.parse_args()

    rows = load_pdf_rows(PROJECT_ROOT / args.registry_db, company=args.company, limit=args.limit)
    risk_conn = connect(PROJECT_ROOT / args.risk_db)
    init_db(risk_conn)

    summary = []
    for row in rows:
        pdf_path = Path(row["local_path"])
        company = row["company_name"]
        if not company or not pdf_path.exists():
            summary.append({"pdf": str(pdf_path), "status": "skipped", "reason": "missing company or file"})
            continue
        upsert_company(risk_conn, company)
        source_name = row["source_name"] or "PDF"
        try:
            fields = extract_financial_fields(pdf_path, include_text_fallback=args.include_text_fallback)
            sections = extract_annual_report_sections(pdf_path) if args.extract_sections else []
            status = "ok"
            error = ""
        except Exception as exc:
            fields = []
            sections = []
            status = "error"
            error = str(exc)

        field_out = PROJECT_ROOT / "data" / "financial_extracts" / f"{pdf_path.stem}.json"
        section_out = PROJECT_ROOT / "data" / "annual_report_extracts" / f"{pdf_path.stem}_sections.json"
        evidence_run_id = args.run_id or f"pdf_extract_{pdf_path.stem}"
        evidence_out = PROJECT_ROOT / "data" / "evidence" / evidence_run_id / "evidence.jsonl"
        field_out.parent.mkdir(parents=True, exist_ok=True)
        section_out.parent.mkdir(parents=True, exist_ok=True)
        evidence_out.parent.mkdir(parents=True, exist_ok=True)
        field_out.write_text(json.dumps(fields, ensure_ascii=False, indent=2), encoding="utf-8")
        if args.extract_sections:
            section_out.write_text(json.dumps(sections, ensure_ascii=False, indent=2), encoding="utf-8")

        if status == "ok":
            evidence = [
                *evidence_from_fields(company, pdf_path, fields, source_name),
                *evidence_from_financial_issues(company, pdf_path, fields, source_name),
                *evidence_from_sections(company, pdf_path, sections, source_name),
            ]
        else:
            evidence = evidence_from_exception(company, pdf_path, Exception(error), source_name)
        insert_many_evidence(risk_conn, evidence, run_id=evidence_run_id)
        evidence_out.write_text(
            "\n".join(json.dumps(item.__dict__, ensure_ascii=False, sort_keys=True) for item in evidence) + ("\n" if evidence else ""),
            encoding="utf-8",
        )
        summary.append(
            {
                "pdf": str(pdf_path),
                "company": company,
                "status": status,
                "error": error,
                "fields": len(fields),
                "sections": len(sections),
                "evidence": len(evidence),
                "field_out": str(field_out),
                "section_out": str(section_out) if args.extract_sections else "",
                "evidence_out": str(evidence_out),
            }
        )
    risk_conn.close()
    print(json.dumps({"pdfs": len(rows), "items": summary}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
