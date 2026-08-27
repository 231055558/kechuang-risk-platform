import argparse
import json
import sys
from dataclasses import asdict
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

from src.database import connect, init_db, insert_many_evidence, upsert_company
from src.financial_pdf import extract_annual_report_sections, extract_financial_fields
from src.financial_pdf_evidence import evidence_from_exception, evidence_from_fields, evidence_from_financial_issues, evidence_from_sections


def main():
    parser = argparse.ArgumentParser(description="Extract traceable financial fields and annual-report sections from PDFs.")
    parser.add_argument("--pdf", required=True)
    parser.add_argument("--company", required=True)
    parser.add_argument("--risk-db", default="data/risk_data.sqlite")
    parser.add_argument("--out", default="")
    parser.add_argument("--sections-out", default="")
    parser.add_argument("--evidence-out", default="")
    parser.add_argument("--run-id", default="")
    parser.add_argument("--include-text-fallback", action="store_true")
    parser.add_argument("--extract-sections", action="store_true")
    args = parser.parse_args()

    pdf_path = Path(args.pdf)
    if not pdf_path.is_absolute():
        pdf_path = PROJECT_ROOT / pdf_path

    fields = []
    sections = []
    source_name = "定期报告PDF"
    try:
        fields = extract_financial_fields(pdf_path, include_text_fallback=args.include_text_fallback)
        sections = extract_annual_report_sections(pdf_path) if args.extract_sections else []
        extraction_evidence = [
            *evidence_from_fields(args.company, pdf_path, fields, source_name),
            *evidence_from_financial_issues(args.company, pdf_path, fields, source_name),
            *evidence_from_sections(args.company, pdf_path, sections, source_name),
        ]
    except Exception as exc:
        extraction_evidence = evidence_from_exception(args.company, pdf_path, exc, source_name)

    out_path = PROJECT_ROOT / (args.out or f"data/financial_extracts/{pdf_path.stem}.json")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(fields, ensure_ascii=False, indent=2), encoding="utf-8")

    sections_out = PROJECT_ROOT / (args.sections_out or f"data/annual_report_extracts/{pdf_path.stem}_sections.json")
    if args.extract_sections:
        sections_out.parent.mkdir(parents=True, exist_ok=True)
        sections_out.write_text(json.dumps(sections, ensure_ascii=False, indent=2), encoding="utf-8")

    conn = connect(PROJECT_ROOT / args.risk_db)
    init_db(conn)
    upsert_company(conn, args.company)
    insert_many_evidence(conn, extraction_evidence, run_id=args.run_id)
    conn.close()

    evidence_run_id = args.run_id or f"financial_pdf_{pdf_path.stem}"
    evidence_out = PROJECT_ROOT / (args.evidence_out or f"data/evidence/{evidence_run_id}/evidence.jsonl")
    evidence_out.parent.mkdir(parents=True, exist_ok=True)
    evidence_out.write_text(
        "\n".join(json.dumps(asdict(item), ensure_ascii=False, sort_keys=True) for item in extraction_evidence) + ("\n" if extraction_evidence else ""),
        encoding="utf-8",
    )
    print(json.dumps({
        "fields": len(fields),
        "sections": len(sections),
        "evidence": len(extraction_evidence),
        "out": str(out_path),
        "sections_out": str(sections_out) if args.extract_sections else "",
        "evidence_out": str(evidence_out),
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
