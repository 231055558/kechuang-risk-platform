import argparse
import json
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

from src.announcement_classifier import is_periodic_report, periodic_report_type
from src.connectors.cninfo_announcements import CninfoAnnouncementsConnector
from src.models import SourceConfig
from src.pdf_registry import connect_pdf_registry, download_pdf


PERIODIC_REPORT_CATEGORIES = "category_ndbg_szsh;category_bndbg_szsh;category_yjdbg_szsh;category_sjdbg_szsh"


def main():
    parser = argparse.ArgumentParser(description="Download periodic report PDFs from CNINFO announcements.")
    parser.add_argument("--stock-code", required=True)
    parser.add_argument("--company", required=True)
    parser.add_argument("--searchkey", default="", help="Defaults to stock code. Can use company short name.")
    parser.add_argument("--column", default="sse", help="sse, szse, bj, etc.")
    parser.add_argument("--plate", default="sse")
    parser.add_argument("--page-size", type=int, default=30)
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--include-summary", action="store_true")
    parser.add_argument("--pdf-dir", default="data/pdfs/reports")
    parser.add_argument("--registry-db", default="data/risk_data.sqlite")
    parser.add_argument("--manifest", default="")
    args = parser.parse_args()

    source = SourceConfig(
        id=f"cninfo_{args.stock_code}_periodic_reports",
        name=f"巨潮资讯{args.company}定期报告",
        type="cninfo_announcements",
        parser="cninfo_announcements",
        reliability="official",
        update_frequency="daily",
        indicators=["公司公告"],
        params={
            "page_size": args.page_size,
            "column": args.column,
            "plate": args.plate,
            "searchkey": args.searchkey or args.stock_code,
            "category": PERIODIC_REPORT_CATEGORIES,
        },
    )
    payload, _ = CninfoAnnouncementsConnector(PROJECT_ROOT).fetch(source)
    records = [
        row for row in payload.get("announcements") or []
        if is_periodic_report(row.get("announcementTitle", ""), args.include_summary)
    ]
    if args.limit:
        records = records[: args.limit]

    conn = connect_pdf_registry(PROJECT_ROOT / args.registry_db)
    downloaded = []
    for row in records:
        adjunct_url = row.get("adjunctUrl", "")
        if not adjunct_url:
            continue
        url = f"http://static.cninfo.com.cn/{adjunct_url}"
        title = row.get("announcementTitle", "")
        local_path = download_pdf(
            conn,
            url,
            PROJECT_ROOT / args.pdf_dir,
            company_name=args.company,
            source_name="CNINFO",
            report_type=periodic_report_type(title),
            notes=title,
        )
        downloaded.append(
            {
                "company": args.company,
                "stock_code": args.stock_code,
                "title": title,
                "publish_date": row.get("announcementTime", ""),
                "url": url,
                "local_path": str(local_path),
                "report_type": periodic_report_type(title),
                "source": "CNINFO",
            }
        )
    conn.close()

    manifest_path = PROJECT_ROOT / (args.manifest or f"data/pdf_manifests/cninfo_{args.stock_code}_periodic_reports.json")
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(downloaded, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"downloaded": len(downloaded), "manifest": str(manifest_path)}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
