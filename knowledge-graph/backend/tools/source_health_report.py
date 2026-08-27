"""Summarize source health from persisted per-source pipeline run records."""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from collections import defaultdict
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

from src.database import connect, init_db


def build_health_report(conn: sqlite3.Connection, days: int = 30) -> tuple[dict, list[dict]]:
    rows = conn.execute(
        """
        SELECT source_id, source_name, source_type, status, attempt_count, evidence_count,
               duration_seconds, finished_at, error_message
        FROM pipeline_source_runs
        WHERE finished_at >= datetime('now', ?)
        ORDER BY finished_at DESC
        """,
        (f"-{max(days, 1)} days",),
    ).fetchall()
    grouped: dict[str, list[sqlite3.Row]] = defaultdict(list)
    for row in rows:
        grouped[row["source_id"]].append(row)
    details = []
    for source_id, items in grouped.items():
        latest = items[0]
        statuses = [item["status"] for item in items]
        successful = [item for item in items if item["status"] in {"ok_with_evidence", "ok_no_match", "partial", "partial_no_evidence"}]
        evidence_runs = [item for item in items if item["status"] == "ok_with_evidence"]
        failures = [item for item in items if item["status"] in {"error", "timeout", "blocked_or_dynamic_session"}]
        durations = [float(item["duration_seconds"] or 0) for item in items]
        consecutive_failures = 0
        for status in statuses:
            if status in {"error", "timeout", "blocked_or_dynamic_session"}:
                consecutive_failures += 1
            else:
                break
        run_count = len(items)
        health = "healthy"
        if consecutive_failures >= 3 or not successful:
            health = "unhealthy"
        elif failures or not evidence_runs:
            health = "attention"
        details.append(
            {
                "source_id": source_id,
                "source_name": latest["source_name"] or source_id,
                "source_type": latest["source_type"],
                "health": health,
                "latest_status": latest["status"],
                "latest_finished_at": latest["finished_at"],
                "run_count": run_count,
                "success_rate": round(len(successful) / run_count, 4),
                "evidence_run_rate": round(len(evidence_runs) / run_count, 4),
                "empty_or_no_match_rate": round(sum(status == "ok_no_match" for status in statuses) / run_count, 4),
                "failure_rate": round(len(failures) / run_count, 4),
                "average_duration_seconds": round(sum(durations) / run_count, 3),
                "average_attempts": round(sum(int(item["attempt_count"] or 0) for item in items) / run_count, 2),
                "consecutive_failures": consecutive_failures,
                "latest_error": latest["error_message"],
            }
        )
    details.sort(key=lambda item: ({"unhealthy": 0, "attention": 1, "healthy": 2}[item["health"]], item["source_name"]))
    summary = {
        "window_days": days,
        "source_count": len(details),
        "healthy_count": sum(item["health"] == "healthy" for item in details),
        "attention_count": sum(item["health"] == "attention" for item in details),
        "unhealthy_count": sum(item["health"] == "unhealthy" for item in details),
    }
    return summary, details


def save_markdown(path: Path, summary: dict, details: list[dict]) -> None:
    lines = [
        "# 数据源健康度报告", "",
        f"- 统计窗口：最近 {summary['window_days']} 天",
        f"- 数据源数：{summary['source_count']}",
        f"- 健康：{summary['healthy_count']}",
        f"- 关注：{summary['attention_count']}",
        f"- 异常：{summary['unhealthy_count']}", "",
        "| 状态 | 数据源 | 类型 | 最近状态 | 成功率 | 有证据率 | 失败率 | 平均耗时(秒) | 连续失败 | 最近错误 |",
        "|---|---|---|---|---:|---:|---:|---:|---:|---|",
    ]
    for item in details:
        error = str(item["latest_error"] or "").replace("|", "\\|").replace("\n", " ")[:160]
        lines.append(
            f"| {item['health']} | {item['source_name']} | {item['source_type']} | {item['latest_status']} | "
            f"{item['success_rate']:.1%} | {item['evidence_run_rate']:.1%} | {item['failure_rate']:.1%} | "
            f"{item['average_duration_seconds']:.3f} | {item['consecutive_failures']} | {error or '-'} |"
        )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate source health report from pipeline_source_runs.")
    parser.add_argument("--db", default="data/risk_data.sqlite")
    parser.add_argument("--days", type=int, default=30)
    parser.add_argument("--markdown", default="data/reports/source_health_report.md")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    conn = connect(PROJECT_ROOT / args.db)
    init_db(conn)
    summary, details = build_health_report(conn, args.days)
    conn.close()
    output = PROJECT_ROOT / args.markdown
    save_markdown(output, summary, details)
    result = {"summary": summary, "sources": details, "markdown": str(output)}
    print(json.dumps(result, ensure_ascii=False, indent=2) if args.json else f"健康度报告已更新: {output}")


if __name__ == "__main__":
    main()
