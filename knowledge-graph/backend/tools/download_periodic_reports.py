import argparse
import json
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

from src.connectors.sse_static_stock import SseStaticStockConnector
from src.announcement_classifier import is_periodic_report, periodic_report_type
from src.models import SourceConfig
from src.pdf_registry import connect_pdf_registry, download_pdf


def main():
    parser = argparse.ArgumentParser(description="Download periodic report PDFs from SSE static stock announcements.")
    parser.add_argument("--stock-code", required=True)
    parser.add_argument("--company", required=True)
    parser.add_argument("--include-summary", action="store_true")
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--pdf-dir", default="data/pdfs/reports")
    parser.add_argument("--registry-db", default="data/risk_data.sqlite")
    parser.add_argument("--manifest", default="")
    args = parser.parse_args()

    source = SourceConfig(
        id=f"sse_static_{args.stock_code}",
        name=f"上交所{args.company}公告静态源",
        type="sse_static_stock",
        parser="sse_static_stock",
        reliability="official",
        update_frequency="daily",
        indicators=["公司公告"],
        params={"stock_code": args.stock_code},
    )
    payload, _ = SseStaticStockConnector(PROJECT_ROOT).fetch(source)
    records = [
        row for row in payload.get("records", [])
        if is_periodic_report(row.get("bulletin_title", ""), args.include_summary)
    ]
    if args.limit:
        records = records[: args.limit]

    conn = connect_pdf_registry(PROJECT_ROOT / args.registry_db)
    downloaded = []
    for row in records:
        path = row.get("bulletin_file_url", "")
        if not path:
            continue
        url = f"https://static.sse.com.cn{path}" if path.startswith("/") else path
        title = row.get("bulletin_title", "")
        local_path = download_pdf(
            conn,
            url,
            PROJECT_ROOT / args.pdf_dir,
            company_name=args.company,
            source_name="SSE",
            report_type=periodic_report_type(title),
            notes=title,
        )
        downloaded.append(
            {
                "company": args.company,
                "stock_code": args.stock_code,
                "title": title,
                "publish_date": row.get("bulletin_date", ""),
                "url": url,
                "local_path": str(local_path),
                "report_type": periodic_report_type(title),
            }
        )
    conn.close()

    manifest_path = PROJECT_ROOT / (args.manifest or f"data/pdf_manifests/{args.stock_code}_periodic_reports.json")
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(downloaded, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"downloaded": len(downloaded), "manifest": str(manifest_path)}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
