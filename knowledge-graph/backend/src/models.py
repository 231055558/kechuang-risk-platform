from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class SourceConfig:
    id: str
    name: str
    type: str
    parser: str
    reliability: str
    update_frequency: str
    indicators: list[str]
    path: str | None = None
    url: str | None = None
    params: dict[str, Any] | None = None
    enabled: bool = True


@dataclass
class RawDocument:
    source_id: str
    source_name: str
    source_type: str
    fetched_at: str
    content_type: str
    content: Any
    raw_path: str


@dataclass
class Evidence:
    company: str
    indicator: str
    source_id: str
    source_name: str
    publish_date: str
    fetched_at: str
    url: str
    title: str
    snippet: str
    value: Any = None
    confidence: float = 1.0
    tags: list[str] = field(default_factory=list)
    needs_review: bool = False
    review_reason: str = ""
    source_type: str = ""


@dataclass
class IndicatorScore:
    company: str
    indicator: str
    value: Any
    score: float | None
    level: str
    evidence_count: int
    needs_review: bool
    reason: str
    calculation: dict[str, Any] = field(default_factory=dict)
    score_type: str = "risk"
    weight_policy: str = "included_weight_undefined"
    is_red_flag: bool = False
    max_score: float | None = None


@dataclass
class EntityRecord:
    entity_type: str
    canonical_name: str
    source_id: str
    source_name: str
    source_type: str = ""
    source_evidence_id: str = ""
    identifier_type: str = ""
    identifier_value: str = ""
    aliases: list[str] = field(default_factory=list)
    attributes: dict[str, Any] = field(default_factory=dict)
    confidence: float = 1.0
    needs_review: bool = False
    review_reason: str = ""


@dataclass
class EntityRelation:
    subject_type: str
    subject_name: str
    relation_type: str
    object_type: str
    object_name: str
    source_id: str
    source_name: str
    source_type: str = ""
    source_evidence_id: str = ""
    confidence: float = 1.0
    attributes: dict[str, Any] = field(default_factory=dict)
    needs_review: bool = False
    review_reason: str = ""


@dataclass
class PipelineRun:
    run_id: str
    version: str
    config_path: str
    status: str
    started_at: str
    finished_at: str = ""
    evidence_count: int = 0
    score_count: int = 0
    review_count: int = 0
    source_count: int = 0
    error_message: str = ""
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class ReviewFeedback:
    run_id: str
    company: str
    indicator: str
    item_type: str
    item_id: str = ""
    decision: str = ""
    reviewer: str = ""
    comment: str = ""
    payload: dict[str, Any] = field(default_factory=dict)
