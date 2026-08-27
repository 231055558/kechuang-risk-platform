from __future__ import annotations

import hashlib
import json
import re
from collections import Counter
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any, Iterable, Sequence

try:
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.metrics.pairwise import cosine_similarity
except Exception:  # pragma: no cover - fallback when sklearn is unavailable
    TfidfVectorizer = None
    cosine_similarity = None


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DICTIONARY_CONFIG_PATH = PROJECT_ROOT / "config" / "text_dictionaries.json"


DEFAULT_DICTIONARY_SPEC: dict[str, dict[str, Any]] = {
    "technical_quality_event": {
        "description": "技术质量事件、可靠性事故、产品缺陷和交付失败词典",
        "version": "2026-07-27",
        "terms": [
            {"term": "中断", "severity": "high", "weight": 3, "category": "availability"},
            {"term": "停运", "severity": "high", "weight": 3, "category": "availability"},
            {"term": "停机", "severity": "high", "weight": 3, "category": "availability"},
            {"term": "宕机", "severity": "high", "weight": 3, "category": "availability"},
            {"term": "故障", "severity": "medium", "weight": 2, "category": "reliability"},
            {"term": "失效", "severity": "medium", "weight": 2, "category": "reliability"},
            {"term": "缺陷", "severity": "medium", "weight": 2, "category": "quality"},
            {"term": "不合格", "severity": "medium", "weight": 2, "category": "quality"},
            {"term": "返工", "severity": "medium", "weight": 2, "category": "quality"},
            {"term": "召回", "severity": "critical", "weight": 5, "category": "recall"},
            {"term": "批量召回", "severity": "critical", "weight": 6, "category": "recall"},
            {"term": "泄露", "severity": "critical", "weight": 5, "category": "security"},
            {"term": "数据泄露", "severity": "critical", "weight": 6, "category": "security"},
            {"term": "事故", "severity": "high", "weight": 4, "category": "incident"},
            {"term": "安全事故", "severity": "critical", "weight": 6, "category": "incident"},
            {"term": "客户投诉", "severity": "low", "weight": 1, "category": "customer"},
            {"term": "交付延期", "severity": "medium", "weight": 2, "category": "delivery"},
            {"term": "验收未通过", "severity": "high", "weight": 4, "category": "delivery"},
        ],
    },
    "narrative": {
        "description": "叙事热度、领先性和前景表述词典",
        "version": "2026-07-27",
        "terms": [
            {"term": "领先", "weight": 1},
            {"term": "首创", "weight": 2},
            {"term": "自主可控", "weight": 2},
            {"term": "颠覆", "weight": 2},
            {"term": "新一代", "weight": 1},
            {"term": "核心技术", "weight": 1},
            {"term": "市场前景", "weight": 1},
            {"term": "全球第一", "weight": 3},
            {"term": "唯一", "weight": 2},
            {"term": "突破", "weight": 1},
            {"term": "国产替代", "weight": 1},
            {"term": "卡脖子", "weight": 2},
        ],
    },
    "exaggeration": {
        "description": "夸张、绝对化和宣传性表述词典",
        "version": "2026-07-27",
        "terms": [
            {"term": "史诗级", "weight": 3},
            {"term": "革命性", "weight": 3},
            {"term": "碾压", "weight": 3},
            {"term": "震撼", "weight": 2},
            {"term": "顶级", "weight": 2},
            {"term": "最强", "weight": 3},
            {"term": "无敌", "weight": 3},
            {"term": "遥遥领先", "weight": 3},
            {"term": "全球领先", "weight": 2},
            {"term": "绝对领先", "weight": 3},
            {"term": "完全解决", "weight": 3},
            {"term": "彻底改变", "weight": 3},
        ],
    },
    "vague_commitment": {
        "description": "模糊承诺、弱兑现和不确定计划表述词典",
        "version": "2026-07-27",
        "terms": [
            {"term": "力争", "weight": 2},
            {"term": "有望", "weight": 2},
            {"term": "预计", "weight": 1},
            {"term": "计划", "weight": 1},
            {"term": "争取", "weight": 2},
            {"term": "尽快", "weight": 2},
            {"term": "持续推进", "weight": 1},
            {"term": "积极推进", "weight": 1},
            {"term": "逐步实现", "weight": 1},
            {"term": "适时", "weight": 2},
            {"term": "条件成熟后", "weight": 3},
        ],
    },
    "risk_mitigation": {
        "description": "风险缓释、风险提示和补救措施表述词典",
        "version": "2026-07-27",
        "terms": [
            {"term": "风险提示", "weight": 2},
            {"term": "不构成承诺", "weight": 3},
            {"term": "存在不确定性", "weight": 3},
            {"term": "可能存在", "weight": 2},
            {"term": "采取措施", "weight": 1},
            {"term": "整改", "weight": 2},
            {"term": "补救", "weight": 2},
            {"term": "加强管理", "weight": 1},
            {"term": "应急预案", "weight": 2},
            {"term": "持续跟踪", "weight": 1},
            {"term": "尚需验证", "weight": 3},
        ],
    },
    "regulator": {
        "description": "监管、司法和行政机构词典",
        "version": "2026-07-27",
        "terms": ["证监会", "上交所", "深交所", "交易所", "市场监管", "工信部", "法院", "仲裁委", "海关", "发改委"],
    },
    "sanction": {
        "description": "制裁、出口管制和限制清单词典",
        "version": "2026-07-27",
        "terms": ["BIS", "OFAC", "UVL", "Entity List", "欧盟制裁", "制裁清单", "出口管制", "最终用户清单"],
    },
    "personnel": {
        "description": "董监高和核心人员词典",
        "version": "2026-07-27",
        "terms": ["董事长", "总经理", "CEO", "CFO", "CTO", "核心技术人员", "董事", "监事", "高管", "首席科学家"],
    },
    "supplier": {
        "description": "供应链和采购词典",
        "version": "2026-07-27",
        "terms": ["供应商", "采购", "上游", "原材料", "外协", "外包", "进口", "替代供应商"],
    },
    "customer": {
        "description": "客户、验收和商业化词典",
        "version": "2026-07-27",
        "terms": ["客户", "下游", "验证客户", "终端客户", "批量交付", "验收", "试用转正"],
    },
    "patent": {
        "description": "专利文本词典",
        "version": "2026-07-27",
        "terms": ["专利", "发明", "实用新型", "权利要求", "授权", "申请号", "公开号", "法律状态"],
    },
    "paper": {
        "description": "论文和学术成果词典",
        "version": "2026-07-27",
        "terms": ["论文", "期刊", "会议", "作者", "引用", "DOI", "arXiv", "OpenAlex", "Crossref"],
    },
    "product": {
        "description": "产品、技术路线和版本词典",
        "version": "2026-07-27",
        "terms": ["产品", "设备", "工艺", "平台", "版本", "路线图", "工艺路线", "量产"],
    },
    "quality_event": {
        "description": "质量事件别名词典",
        "version": "2026-07-27",
        "terms": ["召回", "返工", "停产", "停运", "失效", "缺陷", "故障", "不合格"],
    },
}

PROMPT_TEMPLATES: dict[str, dict[str, str]] = {
    "bounded_text_classification": {
        "system": (
            "你是风险文本分类器。只能在给定 allowed_labels 中选择 label。"
            "禁止创建新字段、禁止推断原文没有的事实、禁止输出 Markdown。"
        ),
        "user": (
            "allowed_labels: {allowed_labels}\n"
            "只输出 JSON 对象。字段: label, confidence, evidence_spans, reason。\n"
            "evidence_spans 每项必须包含 quote、start、end，quote 必须逐字来自原文。\n"
            "原文:\n{text}"
        ),
    },
    "technical_quality_event_extraction": {
        "system": (
            "你是技术质量事件抽取器。所有字段必须由 evidence_spans 支撑。"
            "原文没有的字段填空字符串，不得补全，禁止输出 Markdown。"
        ),
        "user": (
            "severity 只能是 low/medium/high/critical。\n"
            "只输出 JSON 对象。字段: event_type, severity, company, date, product, impact, mitigation, evidence_spans。\n"
            "evidence_spans 每项必须包含 quote、start、end，quote 必须逐字来自原文。\n"
            "原文:\n{text}"
        ),
    },
    "document_field_extraction": {
        "system": (
            "你是文档字段抽取器。只抽取原文显式出现的处罚决定/公告/年报字段。"
            "禁止补写缺失字段，禁止输出 Markdown。"
        ),
        "user": (
            "只输出 JSON 对象。字段: document_type, decision_no, agency, party, unified_social_credit_code, "
            "violation_facts, penalty_basis, penalty_result, decision_date, evidence_spans。\n"
            "缺失字段填空字符串。evidence_spans 的 quote 必须逐字来自原文。\n"
            "原文:\n{text}"
        ),
    },
}


@dataclass(frozen=True)
class RecallHit:
    index: int
    score: float
    text: str


@dataclass(frozen=True)
class TextLocation:
    char_start: int
    char_end: int
    paragraph_index: int
    sentence_index: int
    quote: str
    snippet: str


def _term_value(item: Any) -> str:
    if isinstance(item, dict):
        return str(item.get("term", ""))
    return str(item)


def _term_weight(item: Any) -> float:
    if isinstance(item, dict):
        try:
            return float(item.get("weight", 1))
        except Exception:
            return 1.0
    return 1.0


def _merge_dictionary_specs(base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    merged = json.loads(json.dumps(base, ensure_ascii=False))
    for name, spec in override.items():
        if not isinstance(spec, dict):
            continue
        bucket = merged.setdefault(name, {"description": "", "version": "", "terms": []})
        bucket["description"] = spec.get("description", bucket.get("description", ""))
        bucket["version"] = spec.get("version", bucket.get("version", ""))
        existing = {_term_value(item): item for item in bucket.get("terms", [])}
        for item in spec.get("terms", []):
            term = _term_value(item)
            if term:
                existing[term] = item
        bucket["terms"] = list(existing.values())
    return merged


@lru_cache(maxsize=1)
def load_dictionary_specs() -> dict[str, dict[str, Any]]:
    specs = DEFAULT_DICTIONARY_SPEC
    if DICTIONARY_CONFIG_PATH.exists():
        payload = json.loads(DICTIONARY_CONFIG_PATH.read_text(encoding="utf-8"))
        specs = _merge_dictionary_specs(specs, payload.get("dictionaries", {}))
    return specs


def dictionary_terms(dictionary_name: str) -> list[str]:
    spec = load_dictionary_specs().get(dictionary_name, {})
    return [_term_value(item) for item in spec.get("terms", []) if _term_value(item)]


DICTIONARY_MAINTENANCE_POLICY: dict[str, Any] = {
    "owner": "risk_text_processing",
    "review_required_for": [
        "technical_quality_event",
        "exaggeration",
        "vague_commitment",
        "risk_mitigation",
    ],
    "required_term_fields": {
        "technical_quality_event": ["term", "severity", "weight", "category"],
        "exaggeration": ["term", "weight"],
        "vague_commitment": ["term", "weight"],
        "risk_mitigation": ["term", "weight"],
    },
    "allowed_severities": ["low", "medium", "high", "critical"],
}


def dictionary_metadata() -> dict[str, dict[str, Any]]:
    return {
        name: {
            "description": spec.get("description", ""),
            "version": spec.get("version", ""),
            "term_count": len(spec.get("terms", [])),
            "review_required": name in DICTIONARY_MAINTENANCE_POLICY["review_required_for"],
        }
        for name, spec in load_dictionary_specs().items()
    }


def validate_dictionary_specs(specs: dict[str, dict[str, Any]] | None = None) -> dict[str, Any]:
    specs = specs or load_dictionary_specs()
    errors: list[str] = []
    warnings: list[str] = []
    for name, spec in specs.items():
        if not isinstance(spec, dict):
            errors.append(f"{name}:dictionary_spec_not_object")
            continue
        terms = spec.get("terms", [])
        if not isinstance(terms, list):
            errors.append(f"{name}:terms_not_list")
            continue
        required_fields = DICTIONARY_MAINTENANCE_POLICY["required_term_fields"].get(name, ["term"])
        seen: set[str] = set()
        for index, item in enumerate(terms):
            term = _term_value(item).strip()
            if not term:
                errors.append(f"{name}[{index}]:empty_term")
                continue
            if term in seen:
                warnings.append(f"{name}[{index}]:duplicate_term:{term}")
            seen.add(term)
            if isinstance(item, dict):
                for field in required_fields:
                    if field not in item or item.get(field) in ("", None):
                        errors.append(f"{name}[{index}]:missing_{field}:{term}")
                if "severity" in item and item["severity"] not in DICTIONARY_MAINTENANCE_POLICY["allowed_severities"]:
                    errors.append(f"{name}[{index}]:invalid_severity:{term}:{item['severity']}")
                if "weight" in item:
                    try:
                        weight = float(item["weight"])
                        if weight <= 0:
                            errors.append(f"{name}[{index}]:non_positive_weight:{term}")
                    except Exception:
                        errors.append(f"{name}[{index}]:weight_not_numeric:{term}")
            elif required_fields != ["term"]:
                errors.append(f"{name}[{index}]:term_metadata_required:{term}")
    return {
        "valid": not errors,
        "errors": errors,
        "warnings": warnings,
        "dictionary_count": len(specs),
        "term_count": sum(len(spec.get("terms", [])) for spec in specs.values() if isinstance(spec, dict)),
        "maintenance_policy": DICTIONARY_MAINTENANCE_POLICY,
    }


def dictionary_term_records(dictionary_name: str) -> list[dict[str, Any]]:
    spec = load_dictionary_specs().get(dictionary_name, {})
    rows = []
    for item in spec.get("terms", []):
        if isinstance(item, dict):
            rows.append(dict(item))
        else:
            rows.append({"term": str(item), "weight": 1})
    return rows


TECH_QUALITY_EVENT_TERMS = dictionary_terms("technical_quality_event")
NARRATIVE_TERMS = dictionary_terms("narrative")
EXAGGERATED_TERMS = dictionary_terms("exaggeration")
VAGUE_COMMITMENT_TERMS = dictionary_terms("vague_commitment")
RISK_MITIGATION_TERMS = dictionary_terms("risk_mitigation")
KEYWORD_DICTIONARIES: dict[str, list[str]] = {name: dictionary_terms(name) for name in load_dictionary_specs()}


LLM_TASK_SCHEMAS: dict[str, dict[str, Any]] = {
    "bounded_text_classification": {
        "allowed_labels": [
            "technical_quality_event",
            "regulatory_event",
            "litigation_event",
            "narrative",
            "risk_mitigation",
            "vague_commitment",
            "irrelevant",
        ],
        "allowed_fields": ["label", "confidence", "evidence_spans", "reason"],
        "required_fields": ["label", "confidence", "evidence_spans"],
        "field_types": {"label": "string", "confidence": "number", "evidence_spans": "array", "reason": "string"},
    },
    "technical_quality_event_extraction": {
        "allowed_labels": ["technical_quality_event"],
        "allowed_fields": [
            "event_type",
            "severity",
            "company",
            "date",
            "product",
            "impact",
            "mitigation",
            "evidence_spans",
        ],
        "required_fields": ["event_type", "severity", "evidence_spans"],
        "allowed_severities": ["low", "medium", "high", "critical"],
        "field_types": {
            "event_type": "string",
            "severity": "string",
            "company": "string",
            "date": "string",
            "product": "string",
            "impact": "string",
            "mitigation": "string",
            "evidence_spans": "array",
        },
    },
    "document_field_extraction": {
        "allowed_fields": [
            "document_type",
            "decision_no",
            "agency",
            "party",
            "unified_social_credit_code",
            "violation_facts",
            "penalty_basis",
            "penalty_result",
            "decision_date",
            "evidence_spans",
        ],
        "required_fields": ["document_type", "evidence_spans"],
        "field_types": {
            "document_type": "string",
            "decision_no": "string",
            "agency": "string",
            "party": "string",
            "unified_social_credit_code": "string",
            "violation_facts": "string",
            "penalty_basis": "string",
            "penalty_result": "string",
            "decision_date": "string",
            "evidence_spans": "array",
        },
    },
}


def normalize_text(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def split_paragraphs(text: str) -> list[str]:
    normalized = (text or "").replace("\r", "\n")
    blocks: list[str] = []
    for raw_block in re.split(r"\n{2,}", normalized):
        block = raw_block.strip()
        if not block:
            continue
        sentences = split_sentences(block)
        if sentences:
            blocks.extend(sentences)
        else:
            blocks.append(normalize_text(block))
    return [block for block in blocks if block]


def split_sentences(text: str) -> list[str]:
    normalized = normalize_text(text)
    if not normalized:
        return []
    parts = re.split(r"(?<=[。！？；!?;])\s*", normalized)
    return [part.strip() for part in parts if part.strip()]


def line_col_for_offset(text: str, offset: int) -> tuple[int, int]:
    if offset < 0:
        return -1, -1
    prefix = (text or "")[:offset]
    line_no = prefix.count("\n") + 1
    last_newline = prefix.rfind("\n")
    col_no = offset + 1 if last_newline < 0 else offset - last_newline
    return line_no, col_no


def paragraph_spans(text: str) -> list[dict[str, Any]]:
    spans: list[dict[str, Any]] = []
    for index, match in enumerate(re.finditer(r"\S(?:.*?)(?=\n{2,}|\Z)", (text or "").replace("\r", "\n"), flags=re.S)):
        raw = match.group(0).strip()
        if raw:
            spans.append({"paragraph_index": index, "start": match.start(), "end": match.end(), "text": raw})
    if not spans and text:
        spans.append({"paragraph_index": 0, "start": 0, "end": len(text), "text": text})
    return spans


def sentence_spans(text: str) -> list[dict[str, Any]]:
    source = text or ""
    spans: list[dict[str, Any]] = []
    for paragraph in paragraph_spans(source):
        paragraph_text = paragraph["text"]
        cursor = 0
        for sentence_index, sentence in enumerate(split_sentences(paragraph_text)):
            local_start = paragraph_text.find(sentence, cursor)
            if local_start < 0:
                local_start = paragraph_text.find(sentence)
            if local_start < 0:
                continue
            start = paragraph["start"] + local_start
            end = start + len(sentence)
            cursor = local_start + len(sentence)
            spans.append(
                {
                    "paragraph_index": paragraph["paragraph_index"],
                    "sentence_index": sentence_index,
                    "start": start,
                    "end": end,
                    "text": sentence,
                }
            )
    return spans


def match_terms(text: str, terms: Sequence[str]) -> list[str]:
    return [term for term in terms if term and term in text]


@lru_cache(maxsize=256)
def _compiled_terms(name: str) -> tuple[str, ...]:
    return tuple(dictionary_terms(name))


def dictionary_matches(text: str, dictionary_name: str | None = None) -> dict[str, list[str]]:
    normalized = text or ""
    if dictionary_name:
        return {dictionary_name: match_terms(normalized, _compiled_terms(dictionary_name))}
    matches: dict[str, list[str]] = {}
    for name in load_dictionary_specs():
        hit = match_terms(normalized, _compiled_terms(name))
        if hit:
            matches[name] = hit
    return matches


def weighted_dictionary_score(dictionary_name: str, matched_terms: Sequence[str]) -> float:
    spec = load_dictionary_specs().get(dictionary_name, {})
    weights = {_term_value(item): _term_weight(item) for item in spec.get("terms", [])}
    return sum(weights.get(term, 1.0) for term in matched_terms)


def locate_text_evidence(text: str, terms_or_quotes: Sequence[str], context_chars: int = 80) -> list[dict[str, Any]]:
    source = text or ""
    locations: list[dict[str, Any]] = []
    seen: set[tuple[str, int, int]] = set()
    paragraphs = paragraph_spans(source)
    sentences = sentence_spans(source)
    for term in terms_or_quotes:
        if not term:
            continue
        normalized_term = normalize_text(str(term))
        start = source.find(str(term))
        exact_quote = str(term)
        if start < 0 and normalized_term:
            compact_source = normalize_text(source)
            compact_start = compact_source.find(normalized_term)
            if compact_start >= 0:
                approximate = source.find(normalized_term[: min(len(normalized_term), 16)])
                start = approximate if approximate >= 0 else compact_start
                exact_quote = source[start : start + len(normalized_term)]
        while start >= 0:
            end = start + len(term)
            quote = source[start:end] if 0 <= start < len(source) else str(term)
            key = (quote, start, end)
            if key not in seen:
                seen.add(key)
                paragraph_index = 0
                paragraph_text = source
                paragraph_start = 0
                for paragraph in paragraphs:
                    if paragraph["start"] <= start <= paragraph["end"]:
                        paragraph_index = paragraph["paragraph_index"]
                        paragraph_text = paragraph["text"]
                        paragraph_start = paragraph["start"]
                        break
                sentence_index = 0
                sentence_start = start
                sentence_end = end
                for sentence in sentences:
                    if sentence["start"] <= start <= sentence["end"]:
                        sentence_index = sentence["sentence_index"]
                        sentence_start = sentence["start"]
                        sentence_end = sentence["end"]
                        break
                line_no, col_no = line_col_for_offset(source, start)
                locations.append(
                    {
                        "char_start": start,
                        "char_end": end,
                        "line_no": line_no,
                        "column_no": col_no,
                        "paragraph_index": paragraph_index,
                        "sentence_index": sentence_index,
                        "sentence_char_start": sentence_start,
                        "sentence_char_end": sentence_end,
                        "quote": quote,
                        "snippet": source[max(0, start - context_chars) : min(len(source), end + context_chars)],
                        "match_type": "exact" if quote == str(term) else "normalized",
                    }
                )
            if exact_quote != str(term):
                break
            start = source.find(str(term), start + 1)
    return sorted(locations, key=lambda item: (item["char_start"], item["char_end"]))


def source_location_for_segment(text: str, segment: str) -> dict[str, Any]:
    source = text or ""
    segment = segment or ""
    start = source.find(segment)
    if start < 0:
        compact = normalize_text(segment)
        start = normalize_text(source).find(compact) if compact else -1
    if start < 0:
        return {"char_start": -1, "char_end": -1, "paragraph_index": -1, "sentence_index": -1, "quote": segment[:120], "snippet": segment[:240]}
    end = start + len(segment)
    locations = locate_text_evidence(source, [segment[: min(len(segment), 80)]], context_chars=120)
    if locations:
        location = dict(locations[0])
        location["char_start"] = start
        location["char_end"] = end
        location["quote"] = segment[:240]
        return location
    return {"char_start": start, "char_end": end, "paragraph_index": 0, "sentence_index": 0, "quote": segment[:240], "snippet": source[max(0, start - 120) : min(len(source), end + 120)]}


def text_signal_summary(text: str) -> dict[str, object]:
    paragraphs = split_paragraphs(text)
    matches = dictionary_matches(text)
    technical_terms = matches.get("technical_quality_event", [])
    narrative_terms = matches.get("narrative", [])
    exaggeration_terms = matches.get("exaggeration", [])
    vague_terms = matches.get("vague_commitment", [])
    mitigation_terms = matches.get("risk_mitigation", [])
    consistency = self_similarity_score(paragraphs)
    hype_score = min(
        1.0,
        0.08 * weighted_dictionary_score("narrative", narrative_terms)
        + 0.12 * weighted_dictionary_score("exaggeration", exaggeration_terms)
        + 0.05 * weighted_dictionary_score("vague_commitment", vague_terms),
    )
    severity = severity_from_terms(technical_terms, exaggeration_terms, hype_score)
    return {
        "paragraphs": paragraphs,
        "dictionary_matches": matches,
        "dictionary_versions": dictionary_metadata(),
        "technical_terms": technical_terms,
        "narrative_terms": narrative_terms,
        "exaggeration_terms": exaggeration_terms,
        "vague_commitment_terms": vague_terms,
        "risk_mitigation_terms": mitigation_terms,
        "consistency_score": consistency,
        "hype_score": hype_score,
        "severity": severity,
        "severity_weight": severity_weight(severity, technical_terms),
        "source_locations": locate_text_evidence(text, sorted({*technical_terms, *narrative_terms, *exaggeration_terms, *vague_terms, *mitigation_terms}, key=len, reverse=True)),
    }


def classify_news_text(text: str) -> tuple[list[str], float, list[str]]:
    analysis = text_signal_summary(text)
    tags: list[str] = []
    evidence_terms: list[str] = []

    if analysis["technical_terms"]:
        tags.append("technical_quality_event")
        evidence_terms.extend(analysis["technical_terms"])
    if analysis["narrative_terms"]:
        tags.append("narrative")
        evidence_terms.extend(analysis["narrative_terms"])
    if analysis["exaggeration_terms"]:
        tags.append("exaggerated_statement")
        evidence_terms.extend(analysis["exaggeration_terms"])
    if analysis["vague_commitment_terms"]:
        tags.append("vague_commitment")
        evidence_terms.extend(analysis["vague_commitment_terms"])
    if analysis["risk_mitigation_terms"]:
        tags.append("risk_mitigation")
        evidence_terms.extend(analysis["risk_mitigation_terms"])
    if analysis["consistency_score"] < 0.6 and len(analysis["paragraphs"]) > 1:
        tags.append("inconsistent_statement")

    confidence = 0.15
    confidence += 0.08 * len(set(evidence_terms))
    confidence += 0.15 * float(analysis["consistency_score"])
    confidence += 0.12 * float(analysis["hype_score"])
    if "exaggerated_statement" in tags or "vague_commitment" in tags:
        confidence -= 0.05
    confidence = max(0.1, min(0.98, confidence))
    return tags, confidence, evidence_terms


def severity_from_terms(technical_terms: Sequence[str], exaggeration_terms: Sequence[str], hype_score: float) -> str:
    score = weighted_dictionary_score("technical_quality_event", technical_terms)
    score += 0.5 * weighted_dictionary_score("exaggeration", exaggeration_terms)
    score += hype_score * 2
    if score >= 8:
        return "critical"
    if score >= 5:
        return "high"
    if score >= 2:
        return "medium"
    return "low"


def severity_weight(severity: str, technical_terms: Sequence[str] | None = None) -> float:
    base = {"low": 0.5, "medium": 1.0, "high": 2.0, "critical": 3.5}.get(severity, 1.0)
    return round(base + min(2.0, 0.1 * weighted_dictionary_score("technical_quality_event", technical_terms or [])), 4)


def self_similarity_score(paragraphs: Sequence[str]) -> float:
    cleaned = [normalize_text(paragraph) for paragraph in paragraphs if normalize_text(paragraph)]
    if len(cleaned) < 2:
        return 1.0
    if TfidfVectorizer is None or cosine_similarity is None:
        lengths = [len(paragraph) for paragraph in cleaned]
        spread = max(lengths) - min(lengths)
        return max(0.1, min(1.0, 1.0 - spread / max(max(lengths), 1)))
    try:
        vectorizer = TfidfVectorizer(analyzer="char_wb", ngram_range=(2, 4), min_df=1)
        matrix = vectorizer.fit_transform(cleaned)
        scores = cosine_similarity(matrix)
    except ValueError:
        lengths = [len(paragraph) for paragraph in cleaned]
        spread = max(lengths) - min(lengths)
        return max(0.1, min(1.0, 1.0 - spread / max(max(lengths), 1)))
    total = 0.0
    count = 0
    for i in range(len(cleaned)):
        for j in range(i + 1, len(cleaned)):
            total += float(scores[i, j])
            count += 1
    return total / count if count else 1.0


def vector_recall(query: str, corpus: Sequence[str], top_k: int = 5) -> list[RecallHit]:
    texts = [normalize_text(item) for item in corpus if normalize_text(item)]
    if not query or not texts:
        return []
    if TfidfVectorizer is None or cosine_similarity is None:
        query_terms = set(re.findall(r"[\w\u4e00-\u9fff]+", query.lower()))
        hits = []
        for index, text in enumerate(texts):
            corpus_terms = set(re.findall(r"[\w\u4e00-\u9fff]+", text.lower()))
            overlap = len(query_terms & corpus_terms)
            score = overlap / max(len(query_terms), 1)
            if score > 0:
                hits.append(RecallHit(index=index, score=score, text=text))
        return sorted(hits, key=lambda item: item.score, reverse=True)[:top_k]
    try:
        vectorizer = TfidfVectorizer(analyzer="char_wb", ngram_range=(2, 4), min_df=1)
        matrix = vectorizer.fit_transform([query, *texts])
    except ValueError:
        return []
    scores = cosine_similarity(matrix[0:1], matrix[1:]).ravel()
    ranked = sorted(
        (RecallHit(index=i, score=float(score), text=texts[i]) for i, score in enumerate(scores)),
        key=lambda item: item.score,
        reverse=True,
    )
    return ranked[:top_k]


def bounded_text_classify(
    text: str,
    allowed_labels: Sequence[str],
    label_keywords: dict[str, Sequence[str]] | None = None,
    minimum_confidence: float = 0.55,
) -> dict[str, object]:
    label_keywords = label_keywords or {}
    normalized = text or ""
    scored: list[tuple[str, float, list[str]]] = []
    for label in allowed_labels:
        terms = list(label_keywords.get(label) or dictionary_terms(label))
        matched = match_terms(normalized, terms)
        score = 0.08 * weighted_dictionary_score(label, matched) if label in load_dictionary_specs() else 0.12 * len(matched)
        if matched:
            score += 0.25
        if label in normalized:
            score += 0.1
        scored.append((label, min(score, 0.99), matched))
    if not scored:
        return {"label": "", "confidence": 0.0, "needs_review": True, "reasons": ["no_allowed_labels"]}
    scored.sort(key=lambda item: item[1], reverse=True)
    top_label, top_score, top_terms = scored[0]
    second_score = scored[1][1] if len(scored) > 1 else 0.0
    needs_review = top_score < minimum_confidence or (top_score - second_score) < 0.12
    return {
        "label": top_label,
        "confidence": round(top_score, 4),
        "needs_review": needs_review,
        "matched_terms": top_terms,
        "candidate_scores": [{"label": label, "score": round(score, 4), "matched_terms": terms} for label, score, terms in scored],
        "allowed_labels": list(allowed_labels),
        "llm_schema": LLM_TASK_SCHEMAS["bounded_text_classification"],
    }


def event_segments(text: str) -> list[str]:
    segments = split_paragraphs(text)
    if len(segments) <= 1:
        return segments
    event_terms = set(dictionary_terms("technical_quality_event") + dictionary_terms("regulator") + dictionary_terms("quality_event"))
    focused = [segment for segment in segments if len(segment) > 8 and any(term in segment for term in event_terms)]
    return focused or [segment for segment in segments if len(segment) > 8]


def merge_dictionary_hits(*hit_sets: dict[str, list[str]]) -> dict[str, list[str]]:
    merged: dict[str, list[str]] = {}
    for hit_set in hit_sets:
        for key, values in hit_set.items():
            bucket = merged.setdefault(key, [])
            for value in values:
                if value not in bucket:
                    bucket.append(value)
    return merged


ANNUAL_SECTION_PATTERNS: dict[str, list[str]] = {
    "management_discussion": [r"(?:第[一二三四五六七八九十]+节\s*)?(?:管理层讨论与分析|经营情况讨论与分析)"],
    "major_risk": [r"(?:重大风险提示|风险因素|可能面对的风险|重要风险提示)"],
    "rd": [r"(?:研发投入|研发情况|核心技术|研发项目|研发人员)"],
    "main_business": [r"(?:主营业务|主要业务|主营构成|营业收入构成|分行业、分产品、分地区情况)"],
    "supplier_customer": [r"(?:主要供应商|前五名供应商|主要客户|前五名客户|客户集中度|供应商集中度)"],
    "financial_statement": [r"(?:财务报表|合并资产负债表|合并利润表|现金流量表|母公司资产负债表)"],
    "corporate_governance": [r"(?:公司治理|董事、监事、高级管理人员|董监高|核心技术人员变动)"],
    "patent_technology": [r"(?:专利|知识产权|技术路线|核心技术来源|技术先进性)"],
}


ANNOUNCEMENT_PARAGRAPH_PATTERNS: dict[str, list[str]] = {
    "subject": [r"(?:一、|1[.、])\s*.*?(?:事项|概述|情况|背景)", r"事项概述"],
    "risk_warning": [r"(?:风险提示|特别提示|重大风险|不确定性|可能导致)"],
    "impact": [r"(?:对公司的影响|影响分析|对生产经营的影响|财务影响)"],
    "commitment": [r"(?:承诺|计划|安排|预计|有望|力争)"],
    "mitigation": [r"(?:整改|措施|预案|补救|已采取|将采取|风险缓释)"],
    "decision": [r"(?:董事会决议|监事会决议|审议通过|决定如下)"],
}


PENALTY_FIELD_PATTERNS: dict[str, list[str]] = {
    "decision_no": [r"(?:行政处罚决定书文号|处罚决定书编号|文号)[:：\s]*([^\n。；;]+)"],
    "agency": [r"(?:作出机关|处罚机关|决定机关)[:：\s]*([^\n。；;]+)", r"([^\n，。；;]{2,30}(?:证监局|市场监督管理局|交易所|海关|生态环境局))"],
    "party": [r"(?:当事人|被处罚人|处罚对象)[:：\s]*([^\n。；;]+)"],
    "unified_social_credit_code": [r"(?:统一社会信用代码)[:：\s]*([0-9A-Z]{18})"],
    "violation_facts": [r"(?:违法事实|违规事实|经查明)[:：\s]*([^\n]+)"],
    "penalty_basis": [r"(?:处罚依据|依据)[:：\s]*([^\n]+)"],
    "penalty_result": [r"(?:处罚结果|决定如下|处罚如下)[:：\s]*([^\n]+)"],
    "decision_date": [r"(\d{4}年\d{1,2}月\d{1,2}日)", r"(\d{4}-\d{1,2}-\d{1,2})"],
}


def detect_document_structure(text: str, doc_type: str = "auto") -> dict[str, Any]:
    source = text or ""
    inferred = doc_type if doc_type != "auto" else infer_document_type(source)
    sections = []
    fields: dict[str, Any] = {}
    if inferred == "annual_report":
        sections = recognize_sections(source, ANNUAL_SECTION_PATTERNS)
    elif inferred == "announcement":
        sections = recognize_sections(source, ANNOUNCEMENT_PARAGRAPH_PATTERNS)
    elif inferred == "penalty_decision":
        sections = recognize_sections(source, ANNOUNCEMENT_PARAGRAPH_PATTERNS)
        fields = extract_penalty_decision_fields(source)
    else:
        sections = classify_paragraphs(source)
    return {
        "document_type": inferred,
        "sections": sections,
        "fields": fields,
        "structure_confidence": document_structure_confidence(inferred, sections, fields),
        "paragraph_count": len(paragraph_spans(source)),
        "sentence_count": len(sentence_spans(source)),
    }


def infer_document_type(text: str) -> str:
    source = text or ""
    if any(term in source for term in ["行政处罚决定书", "处罚决定书", "违法事实", "处罚依据"]):
        return "penalty_decision"
    if any(term in source for term in ["年度报告", "半年度报告", "季度报告", "管理层讨论与分析", "合并资产负债表"]):
        return "annual_report"
    if any(term in source for term in ["公告", "董事会", "特别提示", "风险提示"]):
        return "announcement"
    return "plain_text"


def document_structure_confidence(document_type: str, sections: list[dict[str, Any]], fields: dict[str, Any]) -> float:
    if document_type == "penalty_decision":
        required = ["agency", "party", "violation_facts", "penalty_result", "decision_date"]
        present = sum(1 for field in required if fields.get(field))
        return round(min(0.95, 0.35 + 0.12 * present + 0.04 * len(sections)), 4)
    if document_type in {"annual_report", "announcement"}:
        return round(min(0.95, 0.45 + 0.08 * len(sections)), 4)
    return round(min(0.8, 0.2 + 0.05 * len(sections)), 4)


def recognize_sections(text: str, patterns: dict[str, list[str]]) -> list[dict[str, Any]]:
    source = text or ""
    hits: list[dict[str, Any]] = []
    for section_type, exprs in patterns.items():
        for expr in exprs:
            match = re.search(expr, source)
            if match:
                line_no, col_no = line_col_for_offset(source, match.start())
                hits.append(
                    {
                        "section_type": section_type,
                        "heading": match.group(0)[:80],
                        "char_start": match.start(),
                        "char_end": match.end(),
                        "line_no": line_no,
                        "column_no": col_no,
                        "confidence": 0.8,
                    }
                )
                break
    hits.sort(key=lambda item: item["char_start"])
    for index, hit in enumerate(hits):
        next_start = hits[index + 1]["char_start"] if index + 1 < len(hits) else min(len(source), hit["char_start"] + 3000)
        hit["text_preview"] = source[hit["char_start"] : next_start][:300]
        hit["source_location"] = source_location_for_segment(source, hit["heading"])
    return hits


def classify_paragraphs(text: str) -> list[dict[str, Any]]:
    rows = []
    for paragraph in paragraph_spans(text):
        matches = dictionary_matches(paragraph["text"])
        if not matches:
            continue
        rows.append(
            {
                "section_type": "paragraph",
                "paragraph_index": paragraph["paragraph_index"],
                "char_start": paragraph["start"],
                "char_end": paragraph["end"],
                "dictionary_matches": matches,
                "text_preview": paragraph["text"][:300],
            }
        )
    return rows


def extract_penalty_decision_fields(text: str) -> dict[str, Any]:
    source = text or ""
    fields: dict[str, Any] = {}
    evidence_spans: list[dict[str, Any]] = []
    field_locations: dict[str, Any] = {}
    for field, patterns in PENALTY_FIELD_PATTERNS.items():
        value = ""
        for pattern in patterns:
            match = re.search(pattern, source)
            if match:
                value = normalize_text(match.group(1))
                evidence_spans.extend(locate_text_evidence(source, [match.group(0)], context_chars=80))
                field_locations[field] = source_location_for_segment(source, match.group(0))
                break
        fields[field] = value
    fields["evidence_spans"] = evidence_spans
    fields["field_locations"] = field_locations
    fields["missing_fields"] = [field for field, value in fields.items() if field not in {"evidence_spans", "field_locations", "missing_fields"} and not value]
    return fields


def extract_text_events(text: str, metadata: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    metadata = metadata or {}
    events: list[dict[str, Any]] = []
    source_date = str(metadata.get("publish_date", ""))[:10]
    for segment in event_segments(text):
        matches = dictionary_matches(segment)
        technical_terms = matches.get("technical_quality_event", []) or matches.get("quality_event", [])
        if not technical_terms:
            continue
        severity = severity_from_terms(technical_terms, matches.get("exaggeration", []), 0)
        event = {
            "event_type": "technical_quality_event",
            "severity": severity,
            "severity_weight": severity_weight(severity, technical_terms),
            "company": metadata.get("company", ""),
            "publish_date": metadata.get("publish_date", ""),
            "title": metadata.get("title", ""),
            "matched_terms": technical_terms,
            "dictionary_matches": matches,
            "segment": segment,
            "source_location": source_location_for_segment(text, segment),
            "evidence_spans": locate_text_evidence(text, technical_terms),
            "source_date": source_date,
            "normalized_segment": normalize_text(segment),
        }
        event["event_fingerprint"] = event_fingerprint(event)
        events.append(event)
    return events


def event_fingerprint(event: dict[str, Any]) -> str:
    stable = {
        "company": normalize_text(str(event.get("company", "")))[:80],
        "event_type": event.get("event_type", ""),
        "publish_month": str(event.get("source_date") or event.get("publish_date", ""))[:7],
        "severity": event.get("severity", ""),
        "terms": sorted(set(event.get("matched_terms", [])))[:8],
        "segment_key": re.sub(r"\W+", "", normalize_text(str(event.get("normalized_segment") or event.get("segment", ""))).lower())[:180],
        "dict_key": json.dumps(event.get("dictionary_matches", {}), ensure_ascii=False, sort_keys=True)[:240],
    }
    return hashlib.sha256(json.dumps(stable, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()


def event_signature(value: dict[str, Any], item: Any) -> dict[str, Any]:
    terms = set(value.get("matched_terms", []) or [])
    dict_matches = value.get("dictionary_matches", {}) or {}
    for matches in dict_matches.values():
        terms.update(matches or [])
    text = normalize_text(str(value.get("normalized_segment") or value.get("segment") or getattr(item, "snippet", "") or getattr(item, "title", "")))
    tokens = set(re.findall(r"[\w\u4e00-\u9fff]{2,}", text.lower()))
    return {
        "event_type": value.get("event_type", ""),
        "severity": value.get("severity", ""),
        "publish_month": str(value.get("source_date") or getattr(item, "publish_date", ""))[:7],
        "terms": terms,
        "tokens": tokens,
    }


def similar_event_signature(left: dict[str, Any], right: dict[str, Any]) -> bool:
    if left.get("event_type") != right.get("event_type"):
        return False
    if left.get("publish_month") and right.get("publish_month") and left["publish_month"] != right["publish_month"]:
        return False
    term_overlap = jaccard(left.get("terms", set()), right.get("terms", set()))
    token_overlap = jaccard(left.get("tokens", set()), right.get("tokens", set()))
    return term_overlap >= 0.6 or token_overlap >= 0.72


def jaccard(left: set[str], right: set[str]) -> float:
    if not left or not right:
        return 0.0
    return len(left & right) / len(left | right)


def deduplicate_evidence_events(evidence: Iterable[Any]) -> list[Any]:
    kept: list[Any] = []
    by_key: dict[tuple[str, str, str], Any] = {}
    signatures: dict[tuple[str, str], list[tuple[dict[str, Any], Any]]] = {}
    for item in evidence:
        value = item.value if isinstance(getattr(item, "value", None), dict) else {}
        fingerprint = value.get("event_fingerprint") or value.get("dedup_key")
        if not fingerprint:
            kept.append(item)
            continue
        key = (getattr(item, "company", ""), getattr(item, "indicator", ""), fingerprint)
        existing = by_key.get(key)
        signature_bucket_key = (getattr(item, "company", ""), getattr(item, "indicator", ""))
        signature = event_signature(value, item)
        if not existing:
            for existing_signature, existing_item in signatures.get(signature_bucket_key, []):
                if similar_event_signature(signature, existing_signature):
                    existing = existing_item
                    break
        if not existing:
            if "event_fingerprint" not in value:
                value["event_fingerprint"] = fingerprint
                item.value = value
            by_key[key] = item
            signatures.setdefault(signature_bucket_key, []).append((signature, item))
            kept.append(item)
            continue
        existing_value = existing.value if isinstance(existing.value, dict) else {}
        sources = existing_value.setdefault("duplicate_sources", [])
        sources.append(
            {
                "source_id": getattr(item, "source_id", ""),
                "source_name": getattr(item, "source_name", ""),
                "publish_date": getattr(item, "publish_date", ""),
                "url": getattr(item, "url", ""),
                "title": getattr(item, "title", ""),
                "source_location": value.get("source_location") if isinstance(value, dict) else None,
            }
        )
        existing_value["duplicate_count"] = len(sources) + 1
        existing_value["source_locations"] = [existing_value.get("source_location"), *(src.get("source_location") for src in sources if src.get("source_location"))]
        existing.value = existing_value
        existing.tags = sorted(set(getattr(existing, "tags", []) + ["event_deduplicated"]))
        existing.confidence = max(float(getattr(existing, "confidence", 0) or 0), float(getattr(item, "confidence", 0) or 0))
        existing.needs_review = bool(getattr(existing, "needs_review", False) or getattr(item, "needs_review", False))
        if getattr(item, "review_reason", "") and getattr(item, "review_reason", "") not in getattr(existing, "review_reason", ""):
            existing.review_reason = (getattr(existing, "review_reason", "") + "；" + getattr(item, "review_reason", "")).strip("；")
    return kept


def build_llm_prompt(task_name: str, text: str, metadata: dict[str, Any] | None = None) -> dict[str, Any]:
    if task_name not in PROMPT_TEMPLATES or task_name not in LLM_TASK_SCHEMAS:
        raise ValueError(f"unsupported llm task: {task_name}")
    metadata = metadata or {}
    schema = LLM_TASK_SCHEMAS.get(task_name, {})
    allowed_labels = metadata.get("allowed_labels") or schema.get("allowed_labels", [])
    template = PROMPT_TEMPLATES[task_name]
    return {
        "task_name": task_name,
        "schema": schema,
        "messages": [
            {"role": "system", "content": template["system"]},
            {"role": "user", "content": template["user"].format(text=text, allowed_labels=", ".join(allowed_labels))},
        ],
        "output_contract": {
            "allowed_fields": schema.get("allowed_fields", []),
            "required_fields": schema.get("required_fields", []),
            "no_hallucinated_fields": True,
            "no_new_labels": True,
            "field_types": schema.get("field_types", {}),
            "allowed_labels": schema.get("allowed_labels", []),
            "allowed_severities": schema.get("allowed_severities", []),
            "evidence_quote_must_exist_in_source_text": True,
        },
    }


def validate_llm_output(task_name: str, output: dict[str, Any], source_text: str) -> dict[str, Any]:
    schema = LLM_TASK_SCHEMAS.get(task_name)
    if not schema:
        return {"valid": False, "errors": [f"unsupported_task:{task_name}"], "normalized": {}, "needs_review": True}
    allowed_fields = set(schema.get("allowed_fields", []))
    required_fields = set(schema.get("required_fields", []))
    errors: list[str] = []
    normalized: dict[str, Any] = {}
    if not isinstance(output, dict):
        return {"valid": False, "errors": ["output_not_object"], "normalized": {}, "needs_review": True}
    unknown = sorted(set(output) - allowed_fields)
    if unknown:
        errors.append("unknown_fields:" + ",".join(unknown))
    for field in required_fields:
        if field not in output:
            errors.append(f"missing_required_field:{field}")
    for field in allowed_fields:
        default = [] if field == "evidence_spans" else ""
        normalized[field] = output.get(field, default)
    if "label" in normalized and schema.get("allowed_labels") and normalized["label"] not in schema["allowed_labels"]:
        errors.append(f"label_out_of_boundary:{normalized['label']}")
    if "severity" in normalized and normalized["severity"] and normalized["severity"] not in schema.get("allowed_severities", []):
        errors.append(f"severity_out_of_boundary:{normalized['severity']}")
    if "confidence" in allowed_fields:
        try:
            confidence = float(normalized.get("confidence", 0))
            if confidence < 0 or confidence > 1:
                errors.append("confidence_out_of_range")
            normalized["confidence"] = confidence
        except Exception:
            errors.append("confidence_not_numeric")
            normalized["confidence"] = 0.0
    spans = normalized.get("evidence_spans") or []
    if not isinstance(spans, list):
        errors.append("evidence_spans_not_list")
        spans = []
    checked_spans = []
    for index, span in enumerate(spans):
        if not isinstance(span, dict):
            errors.append(f"evidence_span_not_object:{index}")
            continue
        quote = str(span.get("quote", ""))
        start = span.get("start")
        end = span.get("end")
        if not quote:
            errors.append(f"empty_quote:{index}")
        elif quote not in source_text:
            errors.append(f"quote_not_in_source:{index}")
        if isinstance(start, int) and isinstance(end, int) and quote:
            if source_text[start:end] != quote:
                errors.append(f"span_offsets_mismatch:{index}")
        if isinstance(start, int) and isinstance(end, int):
            line_no, col_no = line_col_for_offset(source_text, start)
        else:
            line_no, col_no = -1, -1
        checked_spans.append({"quote": quote, "start": start, "end": end, "line_no": line_no, "column_no": col_no})
    normalized["evidence_spans"] = checked_spans
    supported_text = " ".join(span["quote"] for span in checked_spans if span.get("quote"))
    for field, value in normalized.items():
        if field in {"evidence_spans", "confidence"}:
            continue
        if isinstance(value, str) and value and value not in source_text and value not in supported_text:
            if field in {"company", "date", "product", "impact", "mitigation", "decision_no", "agency", "party", "unified_social_credit_code", "violation_facts", "penalty_basis", "penalty_result", "decision_date"}:
                errors.append(f"field_value_not_supported_by_source:{field}")
    return {"valid": not errors, "errors": errors, "normalized": normalized, "needs_review": bool(errors)}
