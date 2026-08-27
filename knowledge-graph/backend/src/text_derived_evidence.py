"""Derive traceable text features and events from already collected evidence."""

from __future__ import annotations

import hashlib
import re
from collections import Counter
from dataclasses import dataclass
from typing import Iterable

from .models import Evidence
from .text_processing import (
    dictionary_matches,
    dictionary_metadata,
    event_fingerprint,
    extract_text_events,
    locate_text_evidence,
    normalize_text,
    self_similarity_score,
    source_location_for_segment,
)


TEXT_TAGS = {"text_company_disclosure", "company_disclosure_text", "text_news", "text_investor_qa", "investor_qa"}
THIRD_PARTY_SOURCE_TYPES = {"search_web", "rss", "news", "web_text"}
TECHNOLOGY_UPDATE_TERMS = ("发布", "推出", "升级", "迭代", "新一代", "新产品", "研发成功", "技术突破", "性能提升")
MILESTONE_TERMS = ("完成", "通过验收", "量产", "客户验证", "进入量产", "落地", "实现商业化", "完成交付", "正式上线")


@dataclass
class TextDocument:
    company: str
    source_id: str
    source_name: str
    source_type: str
    publish_date: str
    fetched_at: str
    url: str
    title: str
    tags: set[str]
    snippets: list[str]

    @property
    def text(self) -> str:
        return "\n".join(self.snippets)


def derive_text_evidence(evidence: Iterable[Evidence]) -> list[Evidence]:
    """Create secondary evidence without treating inferred fields as source facts."""
    documents = _collect_documents(evidence)
    derived: list[Evidence] = []
    for document in documents:
        derived.extend(_third_party_text_evidence(document))
        derived.extend(_dictionary_evidence(document))
        derived.extend(_technology_events(document))
        derived.extend(_quality_events(document))
    derived.extend(_embedding_evidence(documents))
    return derived


def _collect_documents(evidence: Iterable[Evidence]) -> list[TextDocument]:
    grouped: dict[tuple[str, str, str, str], TextDocument] = {}
    seen_snippets: dict[tuple[str, str, str, str], set[str]] = {}
    for item in evidence:
        if not item.company or not (set(item.tags) & TEXT_TAGS):
            continue
        snippet = _text_from_evidence(item)
        if len(normalize_text(snippet)) < 8:
            continue
        key = (item.company, item.source_id, item.url, item.publish_date)
        document = grouped.get(key)
        if document is None:
            document = TextDocument(
                company=item.company,
                source_id=item.source_id,
                source_name=item.source_name,
                source_type=item.source_type,
                publish_date=item.publish_date,
                fetched_at=item.fetched_at,
                url=item.url,
                title=item.title,
                tags=set(item.tags),
                snippets=[],
            )
            grouped[key] = document
            seen_snippets[key] = set()
        document.tags.update(item.tags)
        normalized = normalize_text(snippet)
        if normalized not in seen_snippets[key]:
            document.snippets.append(snippet[:1200])
            seen_snippets[key].add(normalized)
    return list(grouped.values())


def _third_party_text_evidence(document: TextDocument) -> list[Evidence]:
    if "text_news" not in document.tags:
        return []
    return [
        _evidence(
            document,
            "第三方与自身表述偏差",
            document.snippets[0],
            {
                "derived_type": "third_party_text_source",
                "source_classification": "news_aggregation",
                "source_location": source_location_for_segment(document.text, document.snippets[0]),
                "text_length": len(document.text),
                "comparison_ready": False,
            },
            ["text_third_party", "text_news", "text_derived"],
            0.58,
            "新闻聚合文本可作为第三方表述来源，但报道原始媒体、全文完整性和与公司自述的可比性需要人工复核。",
        )
    ]


def _text_from_evidence(item: Evidence) -> str:
    values: list[str] = [item.title or "", item.snippet or ""]
    payload = item.value if isinstance(item.value, dict) else {}
    for key in ("segment", "normalized_segment", "text", "snippet", "raw_row_text"):
        value = payload.get(key)
        if isinstance(value, str):
            values.append(value)
    return "\n".join(part for part in values if part)


def _dictionary_evidence(document: TextDocument) -> list[Evidence]:
    rows: list[Evidence] = []
    for snippet_index, snippet in enumerate(document.snippets):
        matches = dictionary_matches(snippet)
        # Structural dictionaries describe document context, not narrative signals.
        matches = {name: terms for name, terms in matches.items() if name in {"narrative", "exaggeration", "vague_commitment", "risk_mitigation", "technical_quality_event", "quality_event"}}
        if not matches:
            continue
        terms = sorted({term for values in matches.values() for term in values}, key=len, reverse=True)
        tags = ["dictionary_match", "text_derived", "text_company_disclosure" if "text_company_disclosure" in document.tags else "text_news"]
        if "text_news" in document.tags:
            # Aggregated news is third-party narrative, not an issuer disclosure.
            tags.append("text_third_party")
        rows.append(
            _evidence(
                document,
                "第三方与自身表述偏差",
                snippet,
                {
                    "derived_type": "dictionary_match",
                    "dictionary_matches": matches,
                    "dictionary_versions": dictionary_metadata(),
                    "source_location": source_location_for_segment(document.text, snippet),
                    "evidence_spans": locate_text_evidence(document.text, terms),
                    "input_snippet_index": snippet_index,
                },
                tags,
                0.78,
                "词典命中是文本特征，不代表事实认定；需结合上下文确认表述主体和语义。",
            )
        )
    return rows


def _technology_events(document: TextDocument) -> list[Evidence]:
    rows: list[Evidence] = []
    for snippet in document.snippets:
        update_terms = _matched_terms(snippet, TECHNOLOGY_UPDATE_TERMS)
        milestone_terms = _matched_terms(snippet, MILESTONE_TERMS)
        if update_terms:
            rows.append(_event_evidence(document, snippet, "持续创新能力", "technology_update_event", update_terms))
        if milestone_terms:
            rows.append(_event_evidence(document, snippet, "工程化与商业转化率", "commercialization_event", milestone_terms))
    return rows


def _event_evidence(document: TextDocument, snippet: str, indicator: str, event_type: str, terms: list[str]) -> Evidence:
    source_location = source_location_for_segment(document.text, snippet)
    payload = {
        "derived_type": event_type,
        "event_type": event_type,
        "company": document.company,
        "publish_date": document.publish_date,
        "source_date": document.publish_date[:10],
        "matched_terms": terms,
        "segment": snippet,
        "normalized_segment": normalize_text(snippet),
        "source_location": source_location,
        "evidence_spans": locate_text_evidence(document.text, terms),
        "dictionary_versions": dictionary_metadata(),
    }
    payload["event_fingerprint"] = event_fingerprint(payload)
    return _evidence(
        document,
        indicator,
        snippet,
        payload,
        [event_type, "text_derived", "event_fingerprint", "technology_evidence"],
        0.66,
        "技术进展/节点事件仅按明确触发词派生；产品、阶段、兑现时间和真实性必须人工复核。",
    )


def _quality_events(document: TextDocument) -> list[Evidence]:
    rows: list[Evidence] = []
    metadata = {"company": document.company, "publish_date": document.publish_date, "title": document.title}
    for event in extract_text_events(document.text, metadata):
        payload = {
            "derived_type": "quality_event",
            "base_score": 1,
            "event_type": event["event_type"],
            "severity": event["severity"],
            "severity_weight": event["severity_weight"],
            "matched_terms": event["matched_terms"],
            "dictionary_matches": event["dictionary_matches"],
            "segment": event["segment"],
            "normalized_segment": event["normalized_segment"],
            "source_date": event["source_date"],
            "source_location": event["source_location"],
            "evidence_spans": event["evidence_spans"],
            "dictionary_versions": dictionary_metadata(),
            "event_fingerprint": event["event_fingerprint"],
        }
        tags = ["quality_event", "technical_quality_event", "text_derived", "event_fingerprint"]
        if document.source_type in THIRD_PARTY_SOURCE_TYPES or "text_news" in document.tags:
            tags.append("negative_news")
        rows.append(
            _evidence(
                document,
                "重大技术质量事件指数",
                event["segment"],
                payload,
                tags,
                0.66,
                "质量事件由词典和原文位置派生，不得视作已确认事故；责任、影响和是否真实发生需要人工复核。",
            )
        )
    return rows


def _embedding_evidence(documents: list[TextDocument]) -> list[Evidence]:
    grouped: dict[str, list[TextDocument]] = {}
    for document in documents:
        if "text_company_disclosure" in document.tags:
            grouped.setdefault(document.company, []).append(document)
    rows: list[Evidence] = []
    for company, company_docs in grouped.items():
        if not company_docs:
            continue
        snippets = [doc.text for doc in company_docs]
        representative = company_docs[-1]
        features = _hashed_features("\n".join(snippets))
        rows.append(
            _evidence(
                representative,
                "自身评价一致性/稳定性",
                representative.text,
                {
                    "derived_type": "embedding_vector",
                    "embedding_method": "hashed_token_frequency_v1",
                    "vector_dimensions": 128,
                    "nonzero_dimensions": features,
                    "document_count": len(company_docs),
                    "consistency_score": self_similarity_score(snippets),
                    "document_keys": [f"{doc.source_id}:{doc.publish_date}:{doc.url}" for doc in company_docs],
                    "source_locations": [source_location_for_segment(doc.text, doc.snippets[0]) for doc in company_docs if doc.snippets],
                },
                ["embedding_vector", "text_derived", "text_company_disclosure"],
                0.72,
                "当前为可复现的本地哈希词频向量，不等同于语义模型；跨期可比性、文本口径和相似度解释需人工复核。",
            )
        )
    return rows


def _hashed_features(text: str, dimensions: int = 128) -> dict[str, int]:
    tokens = re.findall(r"[A-Za-z0-9]+|[\u4e00-\u9fff]{2,}", normalize_text(text).lower())
    counts: Counter[int] = Counter()
    for token in tokens:
        bucket = int(hashlib.sha256(token.encode("utf-8")).hexdigest()[:8], 16) % dimensions
        counts[bucket] += 1
    return {str(index): count for index, count in sorted(counts.items())}


def _matched_terms(text: str, terms: tuple[str, ...]) -> list[str]:
    return [term for term in terms if term in text]


def _evidence(document: TextDocument, indicator: str, snippet: str, value: dict, tags: list[str], confidence: float, review_reason: str) -> Evidence:
    return Evidence(
        company=document.company,
        indicator=indicator,
        source_id=f"text_derived_{document.source_id}",
        source_name=f"{document.source_name} 文本派生",
        publish_date=document.publish_date,
        fetched_at=document.fetched_at,
        url=document.url,
        title=f"{document.title} 文本派生",
        snippet=snippet[:300],
        value=value,
        confidence=confidence,
        tags=tags,
        needs_review=True,
        review_reason=review_reason,
        source_type="text_derived",
    )
