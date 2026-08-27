"""Merge the crawler/knowledge-graph SQLite into the R01--R22 master schema.

The R01--R22 master database remains the data-contract authority.  Legacy
``risk_data.sqlite`` rows are normalised into its Companies / Sources /
Observations / Supplementary observations / Deep-search-events chain.  Rows
which do not have an honest R01--R22 mapping are retained as supplementary or
auxiliary source rows; none are silently converted into a risk indicator.

The program always writes a *new* SQLite file and a JSON audit report.  It
does not mutate either source database.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import sqlite3
from collections import Counter
from datetime import date
from pathlib import Path
from typing import Any, Iterable


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = PROJECT_ROOT / "data"
DEFAULT_LEGACY = DATA_DIR / "risk_data.sqlite"

LEGACY_DATABASE_ID = "legacy-risk-data-20260821"

# The old crawler used earlier names for several indicators.  Only mappings
# that preserve the definition are allowed here.  Unmapped material is kept as
# supplementary evidence, never made to look like a calculated R indicator.
INDICATOR_MAP = {
    "叙事热度基本面背离度": "R01",
    "叙事热度与基本面背离度": "R01",
    "第三方与自身表述偏差": "R02",
    "自身评价一致性/稳定性": "R03",
    "概念股标签关联度": "R04",
    "核心专利质量与技术壁垒": "R05",
    "技术先进性—专利质量": "R05",
    "核心技术人员占比": "R06",
    "研发投入强度": "R07",
    "研发投入强度与趋势": "R07",
    "研发/募投里程碑兑现度": "R08",
    "重大技术质量事件指数": "R09",
    "重大技术与知识产权事件": "R09",
    "监管处罚次数": "R10",
    "交易所问询次数": "R11",
    "诉讼风险": "R12",
    "营业收入增长率": "R13",
    "无形资产减值风险": "R14",
    "融资成本": "R15",
    "经营现金流与短期偿债压力": "R16",
    "供应链进口依赖度": "R17",
    "关键供应链进口依赖度": "R17",
    "海外业务收入占比": "R18",
    "出口管制与制裁暴露度": "R19",
    "股权稀释程度": "R20",
    "控制权稀释与稳定性": "R20",
    "高管关联风险暴露度": "R21",
    "高管稳定性": "R22",
    "关键管理与技术人员稳定性": "R22",
}

EVENT_TYPES = {
    "R09": "重大技术与知识产权事件",
    "R10": "监管处罚事件",
    "R11": "交易所问询事件",
    "R12": "诉讼事件",
    "R19": "出口管制与制裁事件",
    "R21": "高管关联风险事件",
    "R22": "关键人员变动事件",
}


def norm(value: Any) -> str:
    """Conservative name normalisation for company and title matching."""
    return re.sub(r"[\s（）()【】\[\]—\-_.，,。]", "", str(value or "")).lower()


def scalar_or_none(value_json: str | None) -> float | None:
    if not value_json:
        return None
    try:
        value = json.loads(value_json)
    except (TypeError, ValueError):
        value = value_json
    if isinstance(value, bool):
        return float(value)
    if isinstance(value, (int, float)):
        return float(value)
    return None


def confidence_band(score: Any) -> str:
    try:
        score = float(score)
    except (TypeError, ValueError):
        return "未知"
    if score >= 0.85:
        return "高"
    if score >= 0.60:
        return "中"
    return "低"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def json_dump(row: sqlite3.Row | dict[str, Any]) -> str:
    return json.dumps(dict(row), ensure_ascii=False, sort_keys=True, default=str)


def existing_tables(conn: sqlite3.Connection) -> list[str]:
    return [
        row[0]
        for row in conn.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
        )
    ]


def build_company_index(conn: sqlite3.Connection) -> tuple[dict[str, int], dict[str, int]]:
    by_stock: dict[str, int] = {}
    by_name: dict[str, int] = {}
    for row in conn.execute("SELECT company_id, stock_code, short_name, full_name, aliases FROM companies"):
        if row["stock_code"]:
            by_stock[str(row["stock_code"])] = int(row["company_id"])
        for candidate in (row["short_name"], row["full_name"], row["aliases"]):
            if candidate:
                by_name.setdefault(norm(candidate), int(row["company_id"]))
    return by_stock, by_name


def source_key(row: sqlite3.Row) -> tuple[str, str, str, str]:
    return (
        str(row["source_id"] or ""),
        str(row["url"] or ""),
        norm(row["title"]),
        str(row["publish_date"] or ""),
    )


def evidence_fingerprint(
    company_id: int, indicator_id: str, source_id: int, as_of_date: str, excerpt: str, text_value: str
) -> tuple[Any, ...]:
    return (company_id, indicator_id, source_id, as_of_date or "", norm(excerpt), text_value or "")


def ensure_support_tables(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS legacy_merge_lineage (
          lineage_id INTEGER PRIMARY KEY,
          source_database_id TEXT NOT NULL,
          source_table TEXT NOT NULL,
          source_row_key TEXT NOT NULL,
          target_table TEXT NOT NULL,
          target_row_key TEXT NOT NULL,
          disposition TEXT NOT NULL,
          note TEXT NOT NULL DEFAULT '',
          UNIQUE(source_database_id, source_table, source_row_key, target_table)
        );
        CREATE INDEX IF NOT EXISTS idx_legacy_merge_lineage_target
          ON legacy_merge_lineage(target_table, target_row_key);
        """
    )


def archive_auxiliary_rows(
    target: sqlite3.Connection,
    legacy: sqlite3.Connection,
    skip_tables: set[str],
    stats: Counter,
) -> None:
    """Preserve non-contract legacy tables in the master's auxiliary channel."""
    for table in existing_tables(legacy):
        if table in skip_tables:
            continue
        columns = [r[1] for r in legacy.execute(f'PRAGMA table_info("{table}")')]
        pk_col = next((r[1] for r in legacy.execute(f'PRAGMA table_info("{table}")') if r[5]), None)
        for row in legacy.execute(f'SELECT * FROM "{table}"'):
            key = str(row[pk_col]) if pk_col and row[pk_col] is not None else hashlib.sha256(json_dump(row).encode()).hexdigest()
            target.execute(
                """
                INSERT INTO source_auxiliary_rows(source_database_id, table_name, source_row_key, row_json)
                VALUES (?, ?, ?, ?)
                """,
                (LEGACY_DATABASE_ID, table, key, json_dump(row)),
            )
            stats[f"archived:{table}"] += 1


def merge(master: Path, legacy_path: Path, output: Path, report_path: Path) -> dict[str, Any]:
    if not master.is_file():
        raise FileNotFoundError(f"未找到 94 家主库：{master}")
    if not legacy_path.is_file():
        raise FileNotFoundError(f"未找到旧数据链库：{legacy_path}")
    if output.exists():
        raise FileExistsError(f"目标文件已存在，为防止覆盖已停止：{output}")

    output.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(master, output)
    target = sqlite3.connect(output)
    target.row_factory = sqlite3.Row
    legacy = sqlite3.connect(legacy_path)
    legacy.row_factory = sqlite3.Row
    stats: Counter = Counter()
    unmapped_indicators: Counter = Counter()
    unmatched_companies: list[dict[str, Any]] = []
    try:
        target.execute("PRAGMA foreign_keys = ON")
        ensure_support_tables(target)
        today = date.today().isoformat()
        target.execute(
            """
            INSERT INTO source_databases(
              source_database_id, label, priority, input_path, sha256,
              original_company_count, selected_company_count, metadata_json, merged_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                LEGACY_DATABASE_ID,
                "risk_data.sqlite 爬虫与知识图谱补充数据",
                99,
                str(legacy_path),
                sha256_file(legacy_path),
                legacy.execute("SELECT COUNT(*) FROM companies").fetchone()[0],
                legacy.execute("SELECT COUNT(*) FROM companies").fetchone()[0],
                json.dumps(
                    {
                        "merge_rule": "R01-R22 master data contract; mapped evidence -> observations; unmapped evidence -> supplementary_observations; remaining legacy tables -> source_auxiliary_rows",
                        "dedup_rule": "company identity + R indicator + document/source + date + evidence text/value",
                    },
                    ensure_ascii=False,
                ),
                today,
            ),
        )

        # 1. Company identity: stock code first, then normalised legal/short name.
        stock_index, name_index = build_company_index(target)
        company_map: dict[int, int] = {}
        for old in legacy.execute("SELECT * FROM companies ORDER BY id"):
            target_id = stock_index.get(str(old["stock_code"] or ""))
            if not target_id:
                for candidate in (old["name"], old["aliases_json"]):
                    target_id = name_index.get(norm(candidate))
                    if target_id:
                        break
            if target_id:
                company_map[int(old["id"])] = target_id
                stats["companies_matched"] += 1
                continue
            # The master format requires a stock_code.  A stable legacy key
            # preserves unlisted/external entities without pretending they are
            # listed companies.
            code = str(old["stock_code"] or "").strip() or f"LEGACY-RISK-{old['id']}"
            if code in stock_index:
                code = f"LEGACY-RISK-{old['id']}"
            cur = target.execute(
                """
                INSERT INTO companies(
                  stock_code, short_name, current_sse_name, full_name, aliases, chain_segment,
                  board, exchange, list_date, sse_industry, selection_reason, source_url,
                  confidence, confidence_score, confidence_reason, peer_group_id,
                  source_database_id, source_company_id
                ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, NULL, NULL, ?, NULL, ?, ?, ?, NULL, ?, ?)
                """,
                (
                    code, old["name"], old["name"], old["aliases_json"], "补充企业",
                    "补充数据", "risk_data.sqlite", "由旧数据链导入；尚未进入 94 家主样本", "中",
                    0.70, "旧库企业身份；未与 94 家主样本匹配", LEGACY_DATABASE_ID, old["id"],
                ),
            )
            target_id = int(cur.lastrowid)
            company_map[int(old["id"])] = target_id
            stock_index[code] = target_id
            name_index[norm(old["name"])] = target_id
            unmatched_companies.append({"legacy_company_id": old["id"], "name": old["name"], "stock_code": old["stock_code"], "new_company_id": target_id})
            stats["companies_appended"] += 1

        # 2. Source documents: URL wins.  This avoids duplicating documents
        # already present in the master chain.
        source_by_url: dict[str, int] = {}
        source_by_signature: dict[tuple[str, str, str], int] = {}
        for source in target.execute("SELECT source_id, title, publication_date, url FROM sources"):
            if source["url"]:
                source_by_url.setdefault(str(source["url"]), int(source["source_id"]))
            source_by_signature.setdefault((norm(source["title"]), str(source["publication_date"] or ""), str(source["url"] or "")), int(source["source_id"]))
        legacy_sources = {int(r["id"]): r for r in legacy.execute("SELECT * FROM sources")}
        document_source_cache: dict[tuple[str, str, str, str], int] = {}

        def get_document_source(evidence: sqlite3.Row) -> int:
            key = source_key(evidence)
            if key in document_source_cache:
                return document_source_cache[key]
            url = str(evidence["url"] or "")
            if url and url in source_by_url:
                result = source_by_url[url]
            else:
                signature = (norm(evidence["title"]), str(evidence["publish_date"] or ""), url)
                result = source_by_signature.get(signature)
                if result is None:
                    old_source = legacy_sources.get(int(evidence["source_id"]))
                    cur = target.execute(
                        """
                        INSERT INTO sources(
                          source_type, institution, title, publication_date, url, local_evidence_file,
                          accessed_at, notes, peer_group_id, source_database_id, source_source_id
                        ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, NULL, ?, ?)
                        """,
                        (
                            old_source["source_type"] if old_source else "legacy_evidence",
                            old_source["name"] if old_source else "risk_data.sqlite",
                            evidence["title"] or "未命名旧证据",
                            evidence["publish_date"] or None,
                            url or None,
                            evidence["fetched_at"] or None,
                            f"从 risk_data.sqlite 迁移；原来源：{old_source['source_key'] if old_source else ''}",
                            LEGACY_DATABASE_ID,
                            evidence["source_id"],
                        ),
                    )
                    result = int(cur.lastrowid)
                    if url:
                        source_by_url[url] = result
                    source_by_signature[signature] = result
                    stats["sources_added"] += 1
            document_source_cache[key] = result
            return result

        # Existing material is indexed before inserting anything.  We include
        # document source as part of the key so the same disclosure can support
        # multiple R indicators without being accidentally discarded.
        existing_observations: set[tuple[Any, ...]] = set()
        for row in target.execute("SELECT company_id, indicator_id, source_id, as_of_date, evidence_excerpt, text_value FROM observations"):
            existing_observations.add(evidence_fingerprint(row["company_id"], row["indicator_id"], row["source_id"], row["as_of_date"], row["evidence_excerpt"] or "", row["text_value"] or ""))
        existing_events: set[tuple[int, str, str, str]] = {
            (int(r["company_id"]), str(r["related_indicator_id"] or ""), str(r["url"] or ""), norm(r["title"]))
            for r in target.execute("SELECT company_id, related_indicator_id, url, title FROM deep_search_events")
        }
        supplementary_keys: set[tuple[Any, ...]] = {
            (int(r["company_id"]), str(r["fact_name"]), str(r["as_of_date"] or ""), int(r["source_id"] or 0), norm(r["evidence_excerpt"]), str(r["text_value"] or ""))
            for r in target.execute("SELECT company_id, fact_name, as_of_date, source_id, evidence_excerpt, text_value FROM supplementary_observations")
        }

        # 3. Convert legacy evidence into the master data chain.
        for evidence in legacy.execute(
            """
            SELECT e.*, c.name AS company_name, i.name AS indicator_name
            FROM evidence e
            JOIN companies c ON c.id = e.company_id
            JOIN indicators i ON i.id = e.indicator_id
            ORDER BY e.id
            """
        ):
            company_id = company_map[int(evidence["company_id"])]
            target_indicator = INDICATOR_MAP.get(str(evidence["indicator_name"]))
            source_id = get_document_source(evidence)
            source_text = str(evidence["value_json"] or "")
            excerpt = str(evidence["snippet"] or "")
            as_of = str(evidence["publish_date"] or "")
            raw_note = f"legacy evidence_id={evidence['id']}; original_indicator={evidence['indicator_name']}"
            if target_indicator:
                fp = evidence_fingerprint(company_id, target_indicator, source_id, as_of, excerpt, source_text)
                if fp in existing_observations:
                    stats["evidence_deduplicated"] += 1
                    target.execute(
                        "INSERT OR IGNORE INTO legacy_merge_lineage(source_database_id, source_table, source_row_key, target_table, target_row_key, disposition, note) VALUES (?, 'evidence', ?, 'observations', ?, 'deduplicated', ?)",
                        (LEGACY_DATABASE_ID, str(evidence["id"]), "existing", raw_note),
                    )
                else:
                    status = "legacy_review_pending" if evidence["needs_review"] else "legacy_evidence"
                    cur = target.execute(
                        """
                        INSERT INTO observations(
                          company_id, indicator_id, metric_name, period_start, period_end, as_of_date,
                          numeric_value, text_value, unit, status, is_derived, formula, source_id,
                          source_page, evidence_excerpt, confidence, confidence_score,
                          confidence_reason, limitations
                        ) VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, NULL, ?, 0, NULL, ?, NULL, ?, ?, ?, ?, ?)
                        """,
                        (
                            company_id, target_indicator, f"legacy_evidence:{evidence['indicator_name']}", as_of or None,
                            scalar_or_none(evidence["value_json"]), source_text or None, status, source_id, excerpt or None,
                            confidence_band(evidence["confidence"]), evidence["confidence"], raw_note,
                            evidence["review_reason"] or None,
                        ),
                    )
                    observation_id = int(cur.lastrowid)
                    target.execute(
                        "INSERT OR IGNORE INTO observation_source_links(observation_id, source_id, source_order) VALUES (?, ?, 1)",
                        (observation_id, source_id),
                    )
                    target.execute(
                        "INSERT OR IGNORE INTO legacy_merge_lineage(source_database_id, source_table, source_row_key, target_table, target_row_key, disposition, note) VALUES (?, 'evidence', ?, 'observations', ?, 'inserted', ?)",
                        (LEGACY_DATABASE_ID, str(evidence["id"]), str(observation_id), raw_note),
                    )
                    existing_observations.add(fp)
                    stats["observations_added"] += 1
                if target_indicator in EVENT_TYPES and (excerpt or evidence["title"]):
                    event_key = (company_id, target_indicator, str(evidence["url"] or ""), norm(evidence["title"]))
                    if event_key not in existing_events:
                        target.execute(
                            """
                            INSERT INTO deep_search_events(
                              company_id, event_type, event_date, title, url, source_channel,
                              confidence, confidence_score, related_indicator_id, notes
                            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                            """,
                            (
                                company_id, EVENT_TYPES[target_indicator], as_of or None,
                                evidence["title"] or excerpt or "未命名风险证据", evidence["url"] or None,
                                "risk_data.sqlite", confidence_band(evidence["confidence"]), evidence["confidence"],
                                target_indicator, raw_note,
                            ),
                        )
                        existing_events.add(event_key)
                        stats["deep_search_events_added"] += 1
            else:
                fact_name = f"旧数据链证据：{evidence['indicator_name']}"
                key = (company_id, fact_name, as_of, source_id, norm(excerpt), source_text)
                unmapped_indicators[str(evidence["indicator_name"])] += 1
                if key in supplementary_keys:
                    stats["supplementary_deduplicated"] += 1
                else:
                    cur = target.execute(
                        """
                        INSERT INTO supplementary_observations(
                          company_id, fact_name, period, as_of_date, numeric_value, text_value, unit,
                          related_indicator_id, source_id, source_page, evidence_excerpt,
                          confidence, confidence_score, confidence_reason, limitations
                        ) VALUES (?, ?, NULL, ?, ?, ?, NULL, NULL, ?, NULL, ?, ?, ?, ?, ?)
                        """,
                        (
                            company_id, fact_name, as_of or None, scalar_or_none(evidence["value_json"]),
                            source_text or None, source_id, excerpt or None, confidence_band(evidence["confidence"]),
                            evidence["confidence"], raw_note, evidence["review_reason"] or None,
                        ),
                    )
                    target.execute(
                        "INSERT OR IGNORE INTO legacy_merge_lineage(source_database_id, source_table, source_row_key, target_table, target_row_key, disposition, note) VALUES (?, 'evidence', ?, 'supplementary_observations', ?, 'unmapped_preserved', ?)",
                        (LEGACY_DATABASE_ID, str(evidence["id"]), str(cur.lastrowid), raw_note),
                    )
                    supplementary_keys.add(key)
                    stats["supplementary_added"] += 1

        # 4. Scores are retained as supplementary calculation facts.  The
        # authoritative R01--R22 definitions remain indicator_catalog.
        calc_source = target.execute(
            """
            INSERT INTO sources(source_type, institution, title, publication_date, url,
              local_evidence_file, accessed_at, notes, peer_group_id, source_database_id, source_source_id)
            VALUES ('legacy_calculation', 'risk_data.sqlite', '旧数据链指标计算结果', ?, NULL, NULL, ?, ?, NULL, ?, NULL)
            """,
            (today, today, "计算结果仅作补充复核，未替代 R01-R22 主库观测值。", LEGACY_DATABASE_ID),
        ).lastrowid
        for score in legacy.execute(
            """
            SELECT s.*, i.name AS indicator_name FROM indicator_scores s
            JOIN indicators i ON i.id = s.indicator_id ORDER BY s.id
            """
        ):
            company_id = company_map[int(score["company_id"])]
            indicator_id = INDICATOR_MAP.get(str(score["indicator_name"]))
            fact_name = f"旧数据链指标得分：{score['indicator_name']}"
            key = (company_id, fact_name, str(score["calculated_at"] or ""), int(calc_source), "", str(score["value_json"] or ""))
            if key in supplementary_keys:
                stats["scores_deduplicated"] += 1
                continue
            cur = target.execute(
                """
                INSERT INTO supplementary_observations(
                  company_id, fact_name, period, as_of_date, numeric_value, text_value, unit,
                  related_indicator_id, source_id, source_page, evidence_excerpt,
                  confidence, confidence_score, confidence_reason, limitations
                ) VALUES (?, ?, ?, ?, ?, ?, 'score', ?, ?, NULL, ?, ?, NULL, ?, ?)
                """,
                (
                    company_id, fact_name, score["run_id"] or None, score["calculated_at"] or None,
                    score["score"], score["value_json"] or None, indicator_id, calc_source,
                    f"run_id={score['run_id']}; evidence_count={score['evidence_count']}",
                    "中", score["reason"] or "从旧数据链指标计算迁移", score["calculation_json"] or score["raw_json"],
                ),
            )
            target.execute(
                "INSERT OR IGNORE INTO legacy_merge_lineage(source_database_id, source_table, source_row_key, target_table, target_row_key, disposition, note) VALUES (?, 'indicator_scores', ?, 'supplementary_observations', ?, 'inserted', ?)",
                (LEGACY_DATABASE_ID, str(score["id"]), str(cur.lastrowid), f"mapped_indicator={indicator_id or ''}"),
            )
            supplementary_keys.add(key)
            stats["scores_preserved"] += 1

        # 5. Retain raw rows, graph entities/relations, run metadata and review
        # feedback in the format already provided by the master for auxiliary
        # source tables.  Evidence and scores are also archived to retain their
        # original JSON fields alongside their normalised chain representation.
        archive_auxiliary_rows(target, legacy, {"companies", "sources"}, stats)

        target.execute(
            "INSERT OR REPLACE INTO metadata(key, value) VALUES (?, ?)",
            ("legacy_risk_data_merge", json.dumps({"legacy_path": str(legacy_path), "merged_at": today, "stats": dict(stats)}, ensure_ascii=False)),
        )
        audit_details = {
            "master_input": str(master), "legacy_input": str(legacy_path), "output": str(output),
            "stats": dict(stats), "unmapped_indicators_preserved": dict(unmapped_indicators),
            "companies_appended": unmatched_companies,
            "data_contract": "R01-R22 master schema",
        }
        target.execute(
            "INSERT INTO master_merge_audit(merge_date, action, details) VALUES (?, ?, ?)",
            (today, "合并 risk_data.sqlite（去重并按 R01-R22 数据链规范转换）", json.dumps(audit_details, ensure_ascii=False)),
        )
        target.commit()

        integrity = target.execute("PRAGMA integrity_check").fetchone()[0]
        if integrity != "ok":
            raise RuntimeError(f"合并后 SQLite 完整性检查失败：{integrity}")
        report = {
            **audit_details,
            "integrity_check": integrity,
            "output_counts": {
                table: target.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0]
                for table in ("companies", "sources", "observations", "supplementary_observations", "deep_search_events", "source_auxiliary_rows", "legacy_merge_lineage")
            },
        }
        report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        return report
    except Exception:
        target.rollback()
        target.close()
        legacy.close()
        if output.exists():
            output.unlink()
        raise
    finally:
        try:
            target.close()
        except sqlite3.Error:
            pass
        legacy.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Merge risk_data.sqlite into the R01-R22 master data-chain schema.")
    parser.add_argument("--master", type=Path, required=True, help="Explicit external master input; no secondary DB is assumed.")
    parser.add_argument("--legacy", type=Path, default=DEFAULT_LEGACY)
    parser.add_argument("--output", type=Path, required=True, help="Explicit migration output. The live master is never overwritten.")
    parser.add_argument("--report", type=Path, default=None)
    args = parser.parse_args()
    report = args.report or args.output.with_suffix(".merge-report.json")
    result = merge(args.master, args.legacy, args.output, report)
    print(json.dumps({"output": str(args.output), "report": str(report), "stats": result["stats"], "counts": result["output_counts"]}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
