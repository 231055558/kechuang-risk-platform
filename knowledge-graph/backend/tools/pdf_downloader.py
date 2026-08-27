import argparse
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

from src.pdf_registry import connect_pdf_registry, download_pdf, register_local_pdf


def main():
    parser = argparse.ArgumentParser(description="Download or register PDF resources for risk data extraction.")
    parser.add_argument("--local-pdf", default="", help="Existing local PDF path to copy into the project PDF store.")
    parser.add_argument("--url", default="", help="PDF URL to download.")
    parser.add_argument("--company", default="", help="Company name.")
    parser.add_argument("--source-name", default="iFinD", help="Source label, e.g. iFinD, SSE, CNINFO.")
    parser.add_argument("--report-type", default="ifind_enterprise_report", help="Report type code.")
    parser.add_argument("--notes", default="")
    parser.add_argument("--db", default="data/risk_data.sqlite")
    parser.add_argument("--pdf-dir", default="data/pdfs/ifind")
    args = parser.parse_args()

    if not args.local_pdf and not args.url:
        raise SystemExit("Provide --local-pdf or --url")

    conn = connect_pdf_registry(PROJECT_ROOT / args.db)
    if args.local_pdf:
        path = register_local_pdf(
            conn,
            Path(args.local_pdf),
            PROJECT_ROOT / args.pdf_dir,
            company_name=args.company,
            source_name=args.source_name,
            report_type=args.report_type,
            notes=args.notes,
        )
    else:
        path = download_pdf(
            conn,
            args.url,
            PROJECT_ROOT / args.pdf_dir,
            company_name=args.company,
            source_name=args.source_name,
            report_type=args.report_type,
            notes=args.notes,
        )
    print(path)
    conn.close()


if __name__ == "__main__":
    main()
