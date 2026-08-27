import argparse
import json
import sqlite3
import time
from dataclasses import asdict
from pathlib import Path

from .connectors import CONNECTORS
from .database import connect, get_pipeline_source_run, init_db, insert_many_evidence, insert_review_feedback, upsert_entity, upsert_pipeline_run, upsert_pipeline_source_run, upsert_relation, upsert_company
from .entity_extraction import extract_entities_from_evidence
from .evidence_store import EvidenceStore
from .models import PipelineRun, ReviewFeedback, utc_now_iso
from .normalizer import normalize_evidence
from .parsers import PARSERS
from .raw_store import RawStore
from .review_queue import build_review_items, save_review_queue
from .source_health import write_source_health_report
from .source_registry import load_registry
from .text_derived_evidence import derive_text_evidence


def run_pipeline(
    config_path: Path,
    run_id: str,
    *,
    retries: int = 2,
    backoff_seconds: float = 2,
    source_delay_seconds: float = 0.2,
    resume: bool = True,
) -> dict:
    project_root = _project_root_for_config(config_path)
    db_path = project_root / "data" / "risk_data.sqlite"
    conn = connect(db_path)
    init_db(conn)
    sources, companies = load_registry(config_path)
    raw_store = RawStore(project_root / "data" / "raw", run_id)
    version = "1.2"
    started_at = utc_now_iso()
    upsert_pipeline_run(
        conn,
        PipelineRun(
            run_id=run_id,
            version=version,
            config_path=str(config_path),
            status="running",
            started_at=started_at,
            metadata={"config": str(config_path)},
        ),
    )
    for company in companies:
        if company.get("name"):
            upsert_company(
                conn,
                company["name"],
                stock_code=company.get("stock_code", ""),
                credit_code=company.get("credit_code", ""),
                aliases=company.get("aliases", []),
            )

    all_evidence = []
    all_entities = []
    all_relations = []
    source_results = []
    for source in sources:
        connector_cls = CONNECTORS.get(source.type)
        parser = PARSERS.get(source.parser)
        if not connector_cls:
            raise ValueError(f"unsupported connector type: {source.type}")
        if not parser:
            raise ValueError(f"unsupported parser: {source.parser}")

        prior = get_pipeline_source_run(conn, run_id, source.id) if resume else None
        source_started_at = utc_now_iso()
        started = time.monotonic()
        attempts = 0
        try:
            if prior and prior["status"] in {"ok", "ok_with_evidence", "ok_no_match", "partial", "partial_no_evidence"} and prior["raw_path"] and Path(prior["raw_path"]).is_file():
                raw_doc = raw_store.load(prior["raw_path"])
                metadata = {"resumed_from_raw": True}
                attempts = int(prior["attempt_count"])
            else:
                connector = connector_cls(project_root)
                payload, metadata, attempts = _fetch_with_retry(
                    connector, source, retries=retries, backoff_seconds=backoff_seconds
                )
                raw_doc = raw_store.save(source.id, payload, metadata)
            source_evidence = parser(raw_doc)
            all_evidence.extend(source_evidence)
            for evidence in source_evidence:
                entities, relations = extract_entities_from_evidence(evidence)
                all_entities.extend(entities)
                all_relations.extend(relations)
            duration = round(time.monotonic() - started, 3)
            status = _source_status(source_evidence, metadata)
            upsert_pipeline_source_run(
                conn, run_id, source.id, status, source_name=source.name, source_type=source.type,
                attempt_count=attempts, evidence_count=len(source_evidence),
                started_at=source_started_at, finished_at=utc_now_iso(), duration_seconds=duration,
                raw_path=raw_doc.raw_path, metadata=metadata,
            )
            source_results.append({"source_id": source.id, "status": status, "evidence_count": len(source_evidence), "attempts": attempts, "duration_seconds": duration, "resumed": bool(prior and metadata.get("resumed_from_raw")), "errors": _metadata_errors(metadata)})
        except Exception as exc:
            duration = round(time.monotonic() - started, 3)
            error_type = "timeout" if _is_timeout_error(exc) else "error"
            error_payload = {"source_id": source.id, "error": str(exc), "source": asdict(source)}
            error_doc = raw_store.save(
                source.id,
                error_payload,
                {
                    "source_id": source.id,
                    "source_name": source.name,
                    "source_type": source.type,
                    "fetched_at": utc_now_iso(),
                    "reliability": source.reliability,
                    "status": "error",
                },
            )
            upsert_pipeline_source_run(
                conn, run_id, source.id, error_type, source_name=source.name, source_type=source.type,
                attempt_count=attempts or retries + 1,
                started_at=source_started_at, finished_at=utc_now_iso(), duration_seconds=duration,
                error_message=str(exc), raw_path=error_doc.raw_path, metadata={"source": source.id},
            )
            source_results.append({"source_id": source.id, "status": error_type, "error": str(exc), "evidence_count": 0, "attempts": attempts or retries + 1, "duration_seconds": duration})
        if source_delay_seconds:
            time.sleep(source_delay_seconds)

    all_evidence = [item for item in normalize_evidence(all_evidence, companies) if item.company]
    all_evidence.extend(derive_text_evidence(all_evidence))
    all_evidence = [item for item in normalize_evidence(all_evidence, companies) if item.company]

    evidence_store = EvidenceStore(project_root / "data" / "evidence", run_id)
    evidence_store.save_many(all_evidence)
    _with_sqlite_lock_diagnostics(lambda: insert_many_evidence(conn, all_evidence, run_id=run_id), db_path)
    for entity in all_entities:
        upsert_entity(conn, entity)
    for relation in all_relations:
        upsert_relation(conn, relation)

    review_items = build_review_items(all_evidence)
    review_path = save_review_queue(project_root / "data" / "review", run_id, review_items)
    for item in review_items:
        feedback = ReviewFeedback(
            run_id=run_id,
            company=item.get("company", ""),
            indicator=item.get("indicator", ""),
            item_type=item.get("review_type", "evidence"),
            item_id=str(item.get("id", "")),
            decision=item.get("decision", ""),
            reviewer=item.get("reviewer", ""),
            comment=item.get("review_reason", "") or item.get("reason", ""),
            payload=item,
        )
        _with_sqlite_lock_diagnostics(lambda feedback=feedback: insert_review_feedback(conn, feedback), db_path)

    # Commit evidence/review writes before the health report opens a second read connection.
    # Without this, SQLite can self-lock while the main pipeline transaction is still open.
    conn.commit()
    health_report_path = write_source_health_report(db_path, project_root / "data" / "reports" / "source_health_report.md")

    finished_at = utc_now_iso()
    upsert_pipeline_run(
        conn,
        PipelineRun(
            run_id=run_id,
            version=version,
            config_path=str(config_path),
            status="completed",
            started_at=started_at,
            finished_at=finished_at,
            evidence_count=len(all_evidence),
            score_count=0,
            review_count=len(review_items),
            source_count=len(sources),
            metadata={"source_results": source_results, "evidence_path": str(evidence_store.path), "review_path": str(review_path), "source_health_report": health_report_path},
        ),
    )
    conn.commit()

    output = {
        "run_id": run_id,
        "version": version,
        "evidence_count": len(all_evidence),
        "review_count": len(review_items),
        "entity_count": len(all_entities),
        "relation_count": len(all_relations),
        "sources": source_results,
        "evidence_path": str(evidence_store.path),
        "review_path": str(review_path),
        "source_health_report": health_report_path,
    }
    print(json.dumps(output, ensure_ascii=False, indent=2))
    conn.close()
    return output


def _project_root_for_config(config_path: Path) -> Path:
    """Support both checked-in config files and generated per-run registries."""
    resolved = config_path.resolve()
    for parent in (resolved.parent, *resolved.parents):
        if (parent / "config" / "source_registry.json").is_file():
            return parent
    raise FileNotFoundError(
        f"could not locate project root for config: {config_path}; "
        "expected config/source_registry.json in an ancestor directory"
    )


def _fetch_with_retry(connector, source, retries: int = 2, backoff_seconds: float = 2):
    last_exc = None
    for attempt in range(retries + 1):
        try:
            payload, metadata = connector.fetch(source)
            if _metadata_requires_retry(payload, metadata):
                errors = _metadata_errors(metadata)
                raise RuntimeError(f"source returned only errors: {json.dumps(errors, ensure_ascii=False)}")
            return payload, metadata, attempt + 1
        except Exception as exc:
            last_exc = exc
            if attempt >= retries:
                break
            time.sleep(backoff_seconds * (attempt + 1))
    raise last_exc


def _is_timeout_error(exc: Exception) -> bool:
    return isinstance(exc, TimeoutError) or "timed out" in str(exc).lower()


def _metadata_requires_retry(payload, metadata: dict) -> bool:
    """Retry connector-level failures that were reported without raising an exception."""
    if isinstance(metadata, dict) and metadata.get("retryable") is False:
        return False
    # A search provider's placeholder/anti-bot page will not become a usable
    # result by immediately issuing the same query again. Keep the failure in
    # source health and move on to independent sources.
    if isinstance(metadata, dict) and metadata.get("search_unavailable_count"):
        return False
    if not _metadata_errors(metadata):
        return False
    if isinstance(payload, dict):
        for key in ("records", "announcements", "data"):
            if payload.get(key):
                return False
    if isinstance(payload, list) and payload:
        return False
    return True


def _metadata_errors(metadata: dict) -> list:
    errors = metadata.get("errors", []) if isinstance(metadata, dict) else []
    return errors if isinstance(errors, list) else [str(errors)]


def _source_status(evidence: list, metadata: dict) -> str:
    """Keep a successful empty search distinct from blocked or partial collection."""
    errors = _metadata_errors(metadata)
    if evidence:
        return "partial" if errors else "ok_with_evidence"
    if not errors:
        return "ok_no_match"
    text = json.dumps(errors, ensure_ascii=False).lower()
    if "timed out" in text or "timeout" in text:
        return "timeout"
    if "no parseable" in text or "search_unavailable" in text:
        return "blocked_or_dynamic_session"
    if any(token in text for token in ("captcha", "验证码", "dynamic", "会话", "forbidden", "403", "blocked")):
        return "blocked_or_dynamic_session"
    if "http 5" in text or "internal server error" in text:
        return "error"
    return "partial_no_evidence"


def _with_sqlite_lock_diagnostics(operation, db_path: Path):
    try:
        return operation()
    except sqlite3.OperationalError as exc:
        if "locked" not in str(exc).lower():
            raise
        journal_paths = [str(path) for path in (db_path.with_name(db_path.name + "-wal"), db_path.with_name(db_path.name + "-journal")) if path.exists()]
        raise RuntimeError(
            f"SQLite database is locked: {db_path}. Close other processes using this database and retry with the same run_id. "
            f"Journal files: {journal_paths or 'none'}"
        ) from exc


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--retries", type=int, default=2)
    parser.add_argument("--source-delay", type=float, default=0.2)
    parser.add_argument("--no-resume", action="store_true")
    args = parser.parse_args()
    run_pipeline(Path(args.config), args.run_id, retries=args.retries, source_delay_seconds=args.source_delay, resume=not args.no_resume)


if __name__ == "__main__":
    main()
