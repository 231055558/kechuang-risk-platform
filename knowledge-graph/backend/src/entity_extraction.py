from __future__ import annotations

import re
from typing import Iterable

from .models import EntityRecord, EntityRelation, Evidence
from .text_processing import dictionary_matches, split_paragraphs


COMPANY_NAME_PATTERN = re.compile(r"([\u4e00-\u9fffA-Za-z0-9（）()·\-]{4,40}?(?:股份有限公司|有限责任公司|集团有限公司|有限公司|公司))")
STOCK_CODE_PATTERN = re.compile(r"\b\d{6}\b")
CREDIT_CODE_PATTERN = re.compile(r"\b[0-9A-Z]{18}\b")
PERSON_TITLE_PATTERN = re.compile(r"(董事长|总经理|CEO|CFO|CTO|总裁|副总裁|董事|监事|核心技术人员)[:：]?\s*([\u4e00-\u9fff·]{2,12})")
PATENT_PATTERN = re.compile(r"(专利|发明专利|实用新型|申请号|公开号)[:：]?\s*([A-Z0-9]{6,})")
PAPER_PATTERN = re.compile(r"(doi|DOI|论文|文章)[:：]?\s*([^\s，。；;]+)")


def extract_entities_from_text(
    text: str,
    source_id: str,
    source_name: str,
    source_type: str = "",
    source_evidence_id: str = "",
) -> tuple[list[EntityRecord], list[EntityRelation]]:
    entities: list[EntityRecord] = []
    relations: list[EntityRelation] = []
    seen = set()
    paragraphs = split_paragraphs(text)
    match_map = dictionary_matches(text)

    for company in _unique(_find_company_candidates(text)):
        entities.append(
            EntityRecord(
                entity_type="company",
                canonical_name=company,
                source_id=source_id,
                source_name=source_name,
                source_type=source_type,
                source_evidence_id=str(source_evidence_id or ""),
                confidence=0.95,
            )
        )

    for code in _find_matches(STOCK_CODE_PATTERN, text):
        entities.append(
            EntityRecord(
                entity_type="stock_code",
                canonical_name=code,
                source_id=source_id,
                source_name=source_name,
                source_type=source_type,
                source_evidence_id=str(source_evidence_id or ""),
                identifier_type="stock_code",
                identifier_value=code,
                confidence=0.9,
            )
        )

    for credit_code in _find_matches(CREDIT_CODE_PATTERN, text):
        entities.append(
            EntityRecord(
                entity_type="credit_code",
                canonical_name=credit_code,
                source_id=source_id,
                source_name=source_name,
                source_type=source_type,
                source_evidence_id=str(source_evidence_id or ""),
                identifier_type="credit_code",
                identifier_value=credit_code,
                confidence=0.92,
            )
        )

    for match in PERSON_TITLE_PATTERN.finditer(text):
        title, name = match.groups()
        if not name:
            continue
        entities.append(
            EntityRecord(
                entity_type="person",
                canonical_name=name,
                source_id=source_id,
                source_name=source_name,
                source_type=source_type,
                source_evidence_id=str(source_evidence_id or ""),
                attributes={"title": title},
                confidence=0.78,
                needs_review=True,
                review_reason="person role extracted from text pattern",
            )
        )

    for match in PATENT_PATTERN.finditer(text):
        label, patent_no = match.groups()
        entities.append(
            EntityRecord(
                entity_type="patent",
                canonical_name=patent_no,
                source_id=source_id,
                source_name=source_name,
                source_type=source_type,
                source_evidence_id=str(source_evidence_id or ""),
                identifier_type="patent_number",
                identifier_value=patent_no,
                attributes={"label": label},
                confidence=0.82,
                needs_review=True,
            )
        )

    for match in PAPER_PATTERN.finditer(text):
        _, ref = match.groups()
        entities.append(
            EntityRecord(
                entity_type="paper_reference",
                canonical_name=ref,
                source_id=source_id,
                source_name=source_name,
                source_type=source_type,
                source_evidence_id=str(source_evidence_id or ""),
                confidence=0.7,
                needs_review=True,
            )
        )

    if match_map.get("regulator"):
        for name in match_map["regulator"]:
            entities.append(
                EntityRecord(
                    entity_type="regulator",
                    canonical_name=name,
                    source_id=source_id,
                    source_name=source_name,
                    source_type=source_type,
                    source_evidence_id=str(source_evidence_id or ""),
                    confidence=0.85,
                )
            )

    if match_map.get("sanction"):
        for name in match_map["sanction"]:
            entities.append(
                EntityRecord(
                    entity_type="sanction_entity",
                    canonical_name=name,
                    source_id=source_id,
                    source_name=source_name,
                    source_type=source_type,
                    source_evidence_id=str(source_evidence_id or ""),
                    confidence=0.85,
                )
            )

    company_names = [entity.canonical_name for entity in entities if entity.entity_type == "company"]
    for company in company_names[:1]:
        for pattern_name, entity_type in [("supplier", "supplier"), ("customer", "customer"), ("product", "product")]:
            for term in match_map.get(pattern_name, []):
                if term == company:
                    continue
                relation_type = {
                    "supplier": "mentions_supplier",
                    "customer": "mentions_customer",
                    "product": "mentions_product",
                }[pattern_name]
                relations.append(
                    EntityRelation(
                        subject_type="company",
                        subject_name=company,
                        relation_type=relation_type,
                        object_type=entity_type,
                        object_name=term,
                        source_id=source_id,
                        source_name=source_name,
                        source_type=source_type,
                        source_evidence_id=str(source_evidence_id or ""),
                        confidence=0.68,
                        needs_review=True,
                    )
                )

    for paragraph in paragraphs:
        if "专利" in paragraph and company_names:
            relations.append(
                EntityRelation(
                    subject_type="company",
                    subject_name=company_names[0],
                    relation_type="mentions_patent",
                    object_type="patent",
                    object_name=paragraph[:80],
                    source_id=source_id,
                    source_name=source_name,
                    source_type=source_type,
                    source_evidence_id=str(source_evidence_id or ""),
                    confidence=0.6,
                    needs_review=True,
                )
            )

    dedup_entities = []
    for entity in entities:
        key = (entity.entity_type, entity.canonical_name, entity.identifier_type, entity.identifier_value)
        if key in seen:
            continue
        seen.add(key)
        dedup_entities.append(entity)

    return dedup_entities, _dedupe_relations(relations)


def extract_entities_from_evidence(evidence: Evidence) -> tuple[list[EntityRecord], list[EntityRelation]]:
    text = "\n".join(filter(None, [evidence.title, evidence.snippet, str(evidence.value or "")]))
    entities, relations = extract_entities_from_text(text, evidence.source_id, evidence.source_name, evidence.source_type)
    if "ifind_pdf" in evidence.tags:
        pdf_entities, pdf_relations = extract_ifind_structured_entities(evidence)
        entities.extend(pdf_entities)
        relations.extend(pdf_relations)
    if "local_structured_dataset" in evidence.tags:
        structured_entities, structured_relations = extract_local_structured_entities(evidence)
        entities.extend(structured_entities)
        relations.extend(structured_relations)
    return _dedupe_entity_records(entities), _dedupe_relations(relations)


def extract_local_structured_entities(evidence: Evidence) -> tuple[list[EntityRecord], list[EntityRelation]]:
    payload = evidence.value if isinstance(evidence.value, dict) else {}
    record = payload.get("record", {}) if isinstance(payload.get("record"), dict) else {}
    dataset_type = payload.get("dataset_type", "")
    company = evidence.company or record.get("company") or record.get("company_name") or ""
    entities: list[EntityRecord] = []
    relations: list[EntityRelation] = []

    if company:
        entities.append(_structured_entity(evidence, "company", company, record, confidence=0.92))

    stock_code = record.get("stock_code") or record.get("ticker")
    if stock_code:
        entities.append(_structured_entity(evidence, "stock_code", str(stock_code), record, "stock_code", str(stock_code), confidence=0.9))
        relations.append(_structured_relation(evidence, "company", company, "has_stock_code", "stock_code", str(stock_code), record, confidence=0.9))

    credit_code = record.get("credit_code") or record.get("unified_social_credit_code")
    if credit_code:
        entities.append(_structured_entity(evidence, "credit_code", str(credit_code), record, "credit_code", str(credit_code), confidence=0.92))
        relations.append(_structured_relation(evidence, "company", company, "has_credit_code", "credit_code", str(credit_code), record, confidence=0.92))

    if dataset_type in {"supplier_customer", "supplier_import_dependency"}:
        counterparty = record.get("supplier_name") or record.get("counterparty_name") or record.get("name")
        role = str(record.get("supplier_role") or record.get("role") or "").lower()
        if counterparty:
            entity_type = "customer" if "customer" in role else "supplier"
            relation_type = "has_customer" if entity_type == "customer" else "has_supplier"
            entities.append(_structured_entity(evidence, entity_type, counterparty, record, confidence=0.82))
            relations.append(_structured_relation(evidence, "company", company, relation_type, entity_type, counterparty, record, confidence=0.82))

    if dataset_type == "business_segment":
        segment = record.get("segment_name") or record.get("product_name") or record.get("region")
        if segment:
            object_type = "region" if record.get("region") or record.get("country_or_region") else "business_segment"
            entities.append(_structured_entity(evidence, object_type, segment, record, confidence=0.78))
            relations.append(_structured_relation(evidence, "company", company, "has_business_segment", object_type, segment, record, confidence=0.78))

    if dataset_type == "patent_structured":
        patent_name = record.get("patent_number") or record.get("patent_name")
        if patent_name:
            entities.append(_structured_entity(evidence, "patent", patent_name, record, "patent_number", str(record.get("patent_number", "")), confidence=0.86))
            relations.append(_structured_relation(evidence, "company", company, "has_patent", "patent", patent_name, record, confidence=0.86))
        product = record.get("product_name")
        if product and patent_name:
            entities.append(_structured_entity(evidence, "product", product, record, confidence=0.8))
            relations.append(_structured_relation(evidence, "patent", patent_name, "maps_to_product", "product", product, record, confidence=0.72, needs_review=True))
        route = record.get("technology_route")
        if route and patent_name:
            entities.append(_structured_entity(evidence, "technology_route", route, record, confidence=0.78))
            relations.append(_structured_relation(evidence, "patent", patent_name, "supports_technology_route", "technology_route", route, record, confidence=0.72, needs_review=True))

    if dataset_type in {"executive_profile", "related_entity"}:
        person = record.get("person_name") or record.get("name")
        if person:
            entities.append(_structured_entity(evidence, "person", person, record, confidence=0.84, needs_review=True))
            relations.append(_structured_relation(evidence, "company", company, "has_person", "person", person, record, confidence=0.84, needs_review=True))
        related = record.get("related_entity_name") or record.get("affiliate_name") or record.get("company_affiliate")
        if related:
            entities.append(_structured_entity(evidence, "related_entity", related, record, confidence=0.78, needs_review=True))
            subject_type = "person" if person else "company"
            subject_name = person or company
            relations.append(_structured_relation(evidence, subject_type, subject_name, "related_to", "related_entity", related, record, confidence=0.74, needs_review=True))

    if dataset_type in {"peer_benchmark", "industry_percentile"}:
        metric = record.get("metric_name")
        if metric:
            entities.append(_structured_entity(evidence, "benchmark_metric", metric, record, confidence=0.82))
            relations.append(_structured_relation(evidence, "company", company, "benchmarked_by", "benchmark_metric", metric, record, confidence=0.78))

    if dataset_type == "sanction_export":
        matched = record.get("matched_name") or record.get("name")
        if matched:
            entities.append(_structured_entity(evidence, "sanction_entity", matched, record, confidence=0.86, needs_review=True))
            relations.append(_structured_relation(evidence, "company", company, "screening_match", "sanction_entity", matched, record, confidence=0.86, needs_review=True))

    if dataset_type == "controlled_component":
        component = record.get("component_name") or record.get("technology_name")
        if component:
            entities.append(_structured_entity(evidence, "controlled_component", component, record, confidence=0.8, needs_review=True))
            relations.append(_structured_relation(evidence, "company", company, "depends_on_controlled_component", "controlled_component", component, record, confidence=0.76, needs_review=True))

    return entities, relations


def _structured_entity(
    evidence: Evidence,
    entity_type: str,
    name: str,
    attributes: dict,
    identifier_type: str = "",
    identifier_value: str = "",
    confidence: float = 0.8,
    needs_review: bool = False,
) -> EntityRecord:
    return EntityRecord(
        entity_type=entity_type,
        canonical_name=str(name),
        source_id=evidence.source_id,
        source_name=evidence.source_name,
        source_type=evidence.source_type,
        identifier_type=identifier_type,
        identifier_value=identifier_value,
        attributes=attributes,
        confidence=confidence,
        needs_review=needs_review,
        review_reason="local structured source relation requires reviewer confirmation" if needs_review else "",
    )


def _structured_relation(
    evidence: Evidence,
    subject_type: str,
    subject_name: str,
    relation_type: str,
    object_type: str,
    object_name: str,
    attributes: dict,
    confidence: float = 0.8,
    needs_review: bool = False,
) -> EntityRelation:
    return EntityRelation(
        subject_type=subject_type,
        subject_name=str(subject_name),
        relation_type=relation_type,
        object_type=object_type,
        object_name=str(object_name),
        source_id=evidence.source_id,
        source_name=evidence.source_name,
        source_type=evidence.source_type,
        attributes=attributes,
        confidence=confidence,
        needs_review=needs_review,
        review_reason="local structured source relation requires reviewer confirmation" if needs_review else "",
    )


def extract_ifind_structured_entities(evidence: Evidence) -> tuple[list[EntityRecord], list[EntityRelation]]:
    payload = evidence.value if isinstance(evidence.value, dict) else {}
    section_type = payload.get("section_type", "")
    entities: list[EntityRecord] = []
    relations: list[EntityRelation] = []
    company = evidence.company
    if company:
        entities.append(
            EntityRecord(
                entity_type="company",
                canonical_name=company,
                source_id=evidence.source_id,
                source_name=evidence.source_name,
                source_type=evidence.source_type,
                confidence=0.95,
            )
        )

    credit_code = payload.get("credit_code")
    if credit_code:
        entities.append(
            EntityRecord(
                entity_type="credit_code",
                canonical_name=credit_code,
                source_id=evidence.source_id,
                source_name=evidence.source_name,
                source_type=evidence.source_type,
                identifier_type="credit_code",
                identifier_value=credit_code,
                confidence=0.95,
            )
        )
        relations.append(
            EntityRelation(
                subject_type="company",
                subject_name=company,
                relation_type="has_credit_code",
                object_type="credit_code",
                object_name=credit_code,
                source_id=evidence.source_id,
                source_name=evidence.source_name,
                source_type=evidence.source_type,
                confidence=0.95,
            )
        )

    item_type = {
        "person": "person",
        "supplier": "supplier",
        "customer": "customer",
        "patent": "patent",
    }.get(section_type)
    relation_type = {
        "person": "has_person",
        "supplier": "has_supplier",
        "customer": "has_customer",
        "patent": "has_patent",
    }.get(section_type)
    if item_type and relation_type:
        for row in payload.get("items", [])[:100]:
            name = best_name_from_row(row)
            if not name:
                continue
            entities.append(
                EntityRecord(
                    entity_type=item_type,
                    canonical_name=name,
                    source_id=evidence.source_id,
                    source_name=evidence.source_name,
                    source_type=evidence.source_type,
                    attributes=row,
                    confidence=0.78,
                    needs_review=True,
                    review_reason=f"iFinD PDF {section_type} structured item needs verification",
                )
            )
            relations.append(
                EntityRelation(
                    subject_type="company",
                    subject_name=company,
                    relation_type=relation_type,
                    object_type=item_type,
                    object_name=name,
                    source_id=evidence.source_id,
                    source_name=evidence.source_name,
                    source_type=evidence.source_type,
                    attributes=row,
                    confidence=0.78,
                    needs_review=True,
                    review_reason=f"iFinD PDF {section_type} relation needs verification",
                )
            )
    return entities, relations


def best_name_from_row(row: dict) -> str:
    preferred_keys = ["名称", "姓名", "供应商名称", "客户名称", "专利名称", "patent_name", "name", "company_name"]
    for key in preferred_keys:
        value = row.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    for value in row.values():
        if isinstance(value, str) and 2 <= len(value.strip()) <= 80:
            return value.strip()
    return ""


def _find_company_candidates(text: str) -> list[str]:
    candidates = [match.group(1) for match in COMPANY_NAME_PATTERN.finditer(text)]
    if not candidates and text:
        for marker in ["股份有限公司", "有限责任公司", "公司"]:
            if marker in text:
                prefix = text[: text.find(marker) + len(marker)]
                candidates.append(prefix[-40:])
    return candidates


def _find_matches(pattern: re.Pattern, text: str) -> list[str]:
    return [match.group(0) if len(match.groups()) == 0 else match.group(1) if len(match.groups()) == 1 else match.group(2) for match in pattern.finditer(text)]


def _unique(values: Iterable[str]) -> list[str]:
    seen = set()
    result = []
    for value in values:
        if value in seen:
            continue
        seen.add(value)
        result.append(value)
    return result


def _dedupe_relations(relations: list[EntityRelation]) -> list[EntityRelation]:
    seen = set()
    result = []
    for relation in relations:
        key = (relation.subject_type, relation.subject_name, relation.relation_type, relation.object_type, relation.object_name)
        if key in seen:
            continue
        seen.add(key)
        result.append(relation)
    return result


def _dedupe_entity_records(entities: list[EntityRecord]) -> list[EntityRecord]:
    seen = set()
    result = []
    for entity in entities:
        key = (entity.entity_type, entity.canonical_name, entity.identifier_type, entity.identifier_value)
        if key in seen:
            continue
        seen.add(key)
        result.append(entity)
    return result
