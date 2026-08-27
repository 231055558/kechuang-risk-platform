import argparse
import sqlite3
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

from src.database import connect, init_db


def print_rows(rows):
    for row in rows:
        print(dict(row))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", default="data/risk_data.sqlite")
    parser.add_argument("--company", default="")
    parser.add_argument("--category", default="", help="Filter evidence by its collection category.")
    parser.add_argument("--evidence", action="store_true")
    args = parser.parse_args()

    project_root = PROJECT_ROOT
    conn = connect(project_root / args.db)
    init_db(conn)

    if args.evidence:
        sql = """
        SELECT c.name AS company, i.name AS category, e.publish_date, e.title, e.url, e.confidence,
               e.needs_review, e.review_reason
        FROM evidence e
        JOIN companies c ON c.id = e.company_id
        JOIN indicators i ON i.id = e.indicator_id
        WHERE (? = '' OR c.name LIKE '%' || ? || '%')
          AND (? = '' OR i.name LIKE '%' || ? || '%')
        ORDER BY e.publish_date DESC, e.id DESC
        LIMIT 50
        """
        print_rows(conn.execute(sql, (args.company, args.company, args.category, args.category)).fetchall())
    else:
        sql = """
        SELECT c.name AS company, COUNT(e.id) AS evidence_count
        FROM companies c
        LEFT JOIN evidence e ON e.company_id = c.id
        WHERE (? = '' OR c.name LIKE '%' || ? || '%')
        GROUP BY c.id
        ORDER BY evidence_count DESC, c.name
        """
        print_rows(conn.execute(sql, (args.company, args.company)).fetchall())
    conn.close()


if __name__ == "__main__":
    main()
