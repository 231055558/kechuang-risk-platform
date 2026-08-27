import json
import re
import hashlib
from pathlib import Path

from .announcement_classifier import classify_announcement_title
from .connectors.mcp_streamable_http import _expand_mcp_value
from .financial_pdf import extract_annual_report_sections, extract_financial_fields
from .financial_pdf_evidence import evidence_from_exception, evidence_from_fields, evidence_from_financial_issues, evidence_from_sections
from .ifind_pdf import extract_ifind_pdf
from .models import Evidence, RawDocument
from .text_classifier import classify_news_text
from .text_processing import (
    build_llm_prompt,
    detect_document_structure,
    event_segments,
    extract_text_events,
    locate_text_evidence,
    source_location_for_segment,
    split_paragraphs,
    text_signal_summary,
)


def _base(
    item: dict,
    doc: RawDocument,
    indicator: str,
    snippet: str,
    value=None,
    confidence=1.0,
    tags=None,
    needs_review=False,
    review_reason="",
):
    return Evidence(
        company=item.get("company", ""),
        indicator=indicator,
        source_id=doc.source_id,
        source_name=doc.source_name,
        publish_date=item.get("publish_date", ""),
        fetched_at=doc.fetched_at,
        url=item.get("url", ""),
        title=item.get("title", ""),
        snippet=snippet[:300],
        value=value,
        confidence=confidence,
        tags=tags or [],
        needs_review=needs_review,
        review_reason=review_reason,
        source_type=doc.source_type,
    )


def parse_exchange_inquiry(doc: RawDocument) -> list[Evidence]:
    evidence = []
    for item in doc.content:
        snippet = item.get("body", "")
        evidence.append(_base(item, doc, "交易所问询次数", snippet, value=1, tags=["inquiry"]))
    return evidence


def parse_financial_report(doc: RawDocument) -> list[Evidence]:
    evidence = []
    for item in doc.content:
        revenue = item.get("revenue")
        previous = item.get("previous_revenue")
        rd_expense = item.get("rd_expense")
        if revenue is not None and previous:
            growth = (revenue - previous) / previous * 100
            evidence.append(
                _base(
                    item,
                    doc,
                    "营业收入增长率",
                    f"本期营收={revenue}; 上期营收={previous}",
                    value=round(growth, 4),
                    tags=["financial"],
                )
            )
        if revenue:
            rd_intensity = rd_expense / revenue * 100
            evidence.append(
                _base(
                    item,
                    doc,
                    "研发投入强度",
                    f"研发费用={rd_expense}; 营业收入={revenue}",
                    value=round(rd_intensity, 4),
                    tags=["financial"],
                )
            )
    return evidence


def parse_news_event(doc: RawDocument) -> list[Evidence]:
    evidence = []
    for item in doc.content:
        if item.get("result_type") != "result_page":
            continue
        body = item.get("body") or item.get("text", "")
        if not item.get("full_text_available"):
            continue
        company = first_matched_target(item) or infer_company_from_text(body)
        if not company:
            continue
        item = {**item, "company": company}
        tags, confidence, _terms = classify_news_text(body)
        analysis = text_signal_summary(body)
        evidence.append(
            _base(
                item,
                doc,
                "叙事热度基本面背离度",
                body,
                value={
                    "dataset_type": "text_news",
                    "text": body,
                    "full_text_available": True,
                    "publisher": item.get("publisher", ""),
                    "source_url": item.get("url", ""),
                    "original_location": item.get("original_location", {"field": "body", "locator": "article_body"}),
                },
                confidence=max(0.7, confidence),
                tags=["text_news", "full_text", "authoritative_news", *tags],
                needs_review=analysis["consistency_score"] < 0.65,
                review_reason="权威媒体原文已抓取；仍需人工核验报道主体、事实属性和风险归因。",
            )
        )
        metadata = {
            "company": item.get("company", ""),
            "publish_date": item.get("publish_date", ""),
            "title": item.get("title", ""),
        }
        for event in extract_text_events(body, metadata):
            evidence.append(
                _base(
                    item,
                    doc,
                    "重大技术质量事件指数",
                    event["segment"],
                    value={
                        "base_score": 1,
                        "matched_terms": event["matched_terms"],
                        "dictionary_matches": event["dictionary_matches"],
                        "severity": event["severity"],
                        "severity_weight": event["severity_weight"],
                        "event_fingerprint": event["event_fingerprint"],
                        "source_location": event["source_location"],
                        "evidence_spans": event["evidence_spans"],
                        "llm_prompt": build_llm_prompt("technical_quality_event_extraction", event["segment"], metadata),
                    },
                    confidence=confidence,
                    tags=[*tags, "paragraph_segment", "event_fingerprint"],
                    needs_review=confidence < 0.7 or analysis["consistency_score"] < 0.6,
                    review_reason="技术质量事件由词典和段落定位生成，严重度与事件主体需要人工复核；LLM 仅允许在边界内抽取候选字段",
                )
            )

        for segment in event_segments(body) or [body]:
            if "narrative" not in tags:
                continue
            bias_score = round(
                min(
                    1.0,
                    0.2 * len(analysis["narrative_terms"])
                    + 0.3 * len(analysis["exaggeration_terms"])
                    + 0.18 * len(analysis["vague_commitment_terms"])
                    + (1 - analysis["consistency_score"]) * 0.3,
                ),
                4,
            )
            evidence.append(
                _base(
                    item,
                    doc,
                    "第三方与自身表述偏差",
                    segment,
                    value={
                        "bias_score": bias_score,
                        "consistency_score": analysis["consistency_score"],
                        "paragraph_count": len(analysis["paragraphs"]),
                        "dictionary_matches": analysis["dictionary_matches"],
                        "matched_terms": analysis["narrative_terms"],
                        "exaggeration_terms": analysis["exaggeration_terms"],
                        "vague_commitment_terms": analysis["vague_commitment_terms"],
                        "risk_mitigation_terms": analysis["risk_mitigation_terms"],
                        "source_location": source_location_for_segment(body, segment),
                        "evidence_spans": locate_text_evidence(
                            body,
                            [
                                *analysis["narrative_terms"],
                                *analysis["exaggeration_terms"],
                                *analysis["vague_commitment_terms"],
                                *analysis["risk_mitigation_terms"],
                            ],
                        ),
                        "llm_prompt": build_llm_prompt("bounded_text_classification", segment),
                    },
                    confidence=confidence,
                    tags=[*tags, "paragraph_segment"],
                    needs_review="exaggerated_statement" in tags or "vague_commitment" in tags or analysis["consistency_score"] < 0.7,
                    review_reason="夸张表述、模糊承诺和风险缓释表述按词典命中，需复核上下文是否构成实质偏差",
                )
            )
    return evidence


def parse_tech_evidence(doc: RawDocument) -> list[Evidence]:
    evidence = []
    for item in doc.content:
        if "trl" in item:
            evidence.append(
                _base(
                    item,
                    doc,
                    "工程化与商业转化率",
                    item.get("body", ""),
                    value={
                        "trl": item.get("trl"),
                        "milestone_due": item.get("milestone_due", False),
                        "milestone_completed_on_time": item.get("milestone_completed_on_time", False),
                    },
                    confidence=0.75,
                    tags=["tech_maturity"],
                )
            )
        if "key_tests" in item:
            evidence.append(
                _base(
                    item,
                    doc,
                    "工程化与商业转化率",
                    item.get("body", ""),
                    value={
                        "evidence_type": item.get("evidence_type"),
                        "key_tests": item.get("key_tests"),
                        "passed_tests": item.get("passed_tests"),
                    },
                    confidence=0.7,
                    tags=["independent_validation"],
                )
            )
    return evidence


def parse_sse_bulletin(doc: RawDocument) -> list[Evidence]:
    evidence = []
    rows = doc.content.get("result") or doc.content.get("dataJson") or []
    for item in rows:
        title = item.get("TITLE") or item.get("title") or ""
        security_name = item.get("SECURITY_NAME") or item.get("securityName") or ""
        security_code = item.get("SECURITY_CODE") or item.get("securityCode") or ""
        publish_date = item.get("SSEDATE") or item.get("sseDate") or item.get("date") or ""
        path = item.get("URL") or item.get("url") or ""
        url = f"https://static.sse.com.cn{path}" if path.startswith("/") else path
        classification = classify_announcement_title(title)
        indicator = "公司公告"
        value = {"count": 1, "announcement_classification": classification}
        tags = ["sse_bulletin", *classification["tags"]]
        if is_exchange_inquiry_notice(title):
            indicator = "交易所问询次数"
            value = 1
            tags.append("inquiry")
        evidence.append(
            Evidence(
                company=security_name or security_code,
                indicator=indicator,
                source_id=doc.source_id,
                source_name=doc.source_name,
                publish_date=publish_date,
                fetched_at=doc.fetched_at,
                url=url,
                title=title,
                snippet=f"{security_code} {security_name} {title}",
                value=value,
                confidence=0.95,
                tags=tags,
                source_type=doc.source_type,
            )
        )
    return evidence


def parse_sse_static_stock(doc: RawDocument) -> list[Evidence]:
    evidence = []
    for item in doc.content.get("records", []):
        title = item.get("bulletin_title", "")
        security_name = item.get("SECURITY_NAME", "")
        security_code = item.get("stock_code", "")
        publish_date = item.get("bulletin_date", "")
        path = item.get("bulletin_file_url", "")
        url = f"https://static.sse.com.cn{path}" if path.startswith("/") else path
        classification = classify_announcement_title(title)
        indicator = "公司公告"
        value = {"count": 1, "announcement_classification": classification}
        tags = ["sse_static_stock", item.get("bulletin_large_type", ""), *classification["tags"]]
        if is_exchange_inquiry_notice(title):
            indicator = "交易所问询次数"
            value = 1
            tags.append("inquiry")
        evidence.append(
            Evidence(
                company=security_name or security_code,
                indicator=indicator,
                source_id=doc.source_id,
                source_name=doc.source_name,
                publish_date=publish_date,
                fetched_at=doc.fetched_at,
                url=url,
                title=title,
                snippet=f"{security_code} {security_name} {title}",
                value=value,
                confidence=0.98,
                tags=[tag for tag in tags if tag],
                source_type=doc.source_type,
            )
        )
    return evidence


def parse_rss_news(doc: RawDocument) -> list[Evidence]:
    evidence = []
    params_company = ""
    for item in doc.content:
        title = item.get("title", "")
        description = item.get("description", "")
        article_text = item.get("article_text", "")
        text = article_text or f"{title} {description}"
        company = item.get("company", "") or params_company or infer_company_from_text(text)
        if not company:
            continue
        analysis = text_signal_summary(text)
        full_text = bool(item.get("full_text_available"))
        tags = ["rss_news", "text_news", "full_text" if full_text else "snippet_only"]
        if any(term in text for term in ["负面", "下滑", "处罚", "诉讼", "事故", "召回", "泄露", "停运"]) or analysis["technical_terms"]:
            tags.append("negative_news")
        evidence.append(
            Evidence(
                company=company,
                indicator="叙事热度基本面背离度",
                source_id=doc.source_id,
                source_name=doc.source_name,
                publish_date=item.get("publish_date", ""),
                fetched_at=doc.fetched_at,
                url=item.get("link", ""),
                title=title,
                snippet=(split_paragraphs(text)[0] if split_paragraphs(text) else text)[:300],
                value={
                    "bias_score": round(min(1.0, 0.2 * len(analysis["narrative_terms"]) + 0.35 * len(analysis["exaggeration_terms"]) + (1 - analysis["consistency_score"]) * 0.25), 4),
                    "consistency_score": analysis["consistency_score"],
                     "matched_terms": analysis["narrative_terms"],
                     "exaggeration_terms": analysis["exaggeration_terms"],
                     "full_text_available": full_text,
                     "publisher": item.get("publisher", ""),
                     "source_url": item.get("link", ""),
                     "original_location": item.get("original_location", {"field": "description", "locator": "rss_summary"}),
                 },
                confidence=max(0.55, min(0.95, 0.6 + 0.1 * len(analysis["narrative_terms"]))),
                tags=tags,
                needs_review=not full_text or analysis["consistency_score"] < 0.7 or bool(analysis["exaggeration_terms"]),
                review_reason="RSS 文本按段落和一致性复核",
                source_type=doc.source_type,
            )
        )
    return evidence


def infer_company_from_text(text: str) -> str:
    for marker in ["宇树科技股份有限公司", "宇树科技", "中微半导体设备（上海）股份有限公司", "中微公司"]:
        if marker in text:
            return "宇树科技股份有限公司" if "宇树" in marker else "中微半导体设备（上海）股份有限公司"
    return ""


def first_matched_target(item: dict) -> str:
    if item.get("company"):
        return str(item.get("company"))
    targets = item.get("matched_targets") or []
    if isinstance(targets, list) and targets:
        return str(targets[0])
    return ""


def parse_cninfo_announcements(doc: RawDocument) -> list[Evidence]:
    evidence = []
    rows = doc.content.get("announcements") or []
    for item in rows:
        title = strip_html(item.get("announcementTitle") or item.get("shortTitle") or "")
        security_name = strip_html(item.get("secName") or item.get("tileSecName") or item.get("target_company") or "")
        security_code = item.get("secCode") or ""
        adjunct_url = item.get("adjunctUrl") or ""
        url = f"http://static.cninfo.com.cn/{adjunct_url}" if adjunct_url else ""
        classification = classify_announcement_title(title)
        indicator = "公司公告"
        value = {"count": 1, "announcement_classification": classification, "raw": item}
        tags = ["cninfo_announcement", *classification["tags"]]
        if is_exchange_inquiry_notice(title):
            indicator = "交易所问询次数"
            value = 1
            tags.append("inquiry")
        evidence.append(
            Evidence(
                company=security_name or security_code,
                indicator=indicator,
                source_id=doc.source_id,
                source_name=doc.source_name,
                publish_date=timestamp_ms_to_date(item.get("announcementTime")),
                fetched_at=doc.fetched_at,
                url=url,
                title=title,
                snippet=f"{security_code} {security_name} {title}",
                value=value,
                confidence=0.95,
                tags=[tag for tag in tags if tag],
                source_type=doc.source_type,
            )
        )
    return evidence


def parse_investor_qa_text(doc: RawDocument) -> list[Evidence]:
    evidence = []
    for item in doc.content:
        text = item.get("text", "")
        if item.get("status") != "ok" or not text:
            continue
        company = infer_company_from_text(text)
        if not company:
            company = item.get("company", "")
        evidence.append(
            Evidence(
                company=company,
                indicator="叙事热度基本面背离度",
                source_id=doc.source_id,
                source_name=doc.source_name,
                publish_date="",
                fetched_at=doc.fetched_at,
                url=item.get("url", ""),
                title=item.get("title", "投资者互动问答"),
                snippet=text[:300],
                value=1,
                confidence=0.55,
                tags=["investor_qa", "text_investor_qa", "text_company_disclosure"],
                needs_review=True,
                review_reason="互动问答网页采集需确认页面是否包含目标企业问答列表及分页完整性",
                source_type=doc.source_type,
            )
        )
    return evidence


def parse_regulatory_text(doc: RawDocument) -> list[Evidence]:
    return parse_keyword_event_text(
        doc,
        indicator="监管处罚次数",
        tags=["regulatory_event"],
        keywords=["行政处罚", "监管措施", "监管警示", "纪律处分", "处罚决定", "责令改正", "立案"],
        review_reason="监管官网网页源需按企业名、发布日期、处罚对象进一步结构化确认",
    )


def parse_recall_text(doc: RawDocument) -> list[Evidence]:
    return parse_keyword_event_text(
        doc,
        indicator="重大技术质量事件指数",
        tags=["recall_notice", "quality_event", "negative_news"],
        keywords=["召回", "产品缺陷", "安全隐患", "停止使用", "停止销售", "故障", "失效"],
        review_reason="召回/质量网页检索只产生候选事件；需核验公告发布主体、产品型号、召回范围、时间和与企业的直接关系。",
    )


def parse_litigation_text(doc: RawDocument) -> list[Evidence]:
    return parse_keyword_event_text(
        doc,
        indicator="诉讼风险",
        tags=["litigation_event"],
        keywords=["诉讼", "仲裁", "裁判", "判决", "裁定", "执行", "开庭", "被执行"],
        review_reason="法院/诉讼网页源通常检索限制较多，需人工核验案件主体与金额口径",
    )


def parse_patent_text(doc: RawDocument) -> list[Evidence]:
    return parse_keyword_event_text(
        doc,
        indicator="技术先进性-专利产出效率",
        tags=["patent_data", "patent_legal_status"],
        keywords=["专利", "发明", "授权", "申请公布", "权利要求", "法律状态"],
        review_reason="公开专利网页源需进一步接入专利号、法律状态、权利要求全文等结构化字段",
    )


def parse_official_court_announcements(doc: RawDocument) -> list[Evidence]:
    evidence = []
    for row in doc.content.get("records", []):
        company = row.get("target_company", "")
        party = row.get("tosendPeople", "")
        if not company or not _matches_target(party, company, row.get("target_aliases", [])):
            continue
        title = " ".join(part for part in [row.get("court", ""), row.get("noticeType", ""), party] if part)
        evidence.append(
            Evidence(
                company=company,
                indicator="诉讼风险",
                source_id=doc.source_id,
                source_name=doc.source_name,
                publish_date=normalize_date(row.get("publishDate", "")),
                fetched_at=doc.fetched_at,
                url=row.get("url", ""),
                title=title,
                snippet=f"法院={row.get('court', '')}; 当事人={party}; 公告类型={row.get('noticeType', '')}",
                value={
                    "court": row.get("court", ""),
                    "party": party,
                    "notice_type": row.get("noticeType", ""),
                    "notice_source": row.get("noticeSource", ""),
                    "notice_uuid": row.get("uuid", ""),
                    "dedup_key": stable_hash(["court_announcement", row.get("uuid", ""), party]),
                    "source_location": {"record_uuid": row.get("uuid", "")},
                },
                confidence=0.9,
                tags=["official_court", "litigation_event", "court_announcement"],
                needs_review=True,
                review_reason="法院公告已匹配目标主体，但当事人身份、案由、金额和案件进展需查看原公告核验。",
                source_type=doc.source_type,
            )
        )
    return evidence


def parse_sse_regulatory_measures(doc: RawDocument) -> list[Evidence]:
    """Convert exact-stock SSE supervisory records into auditable evidence."""
    evidence = []
    for row in doc.content.get("records", []):
        if not isinstance(row, dict):
            continue
        company = str(row.get("target_company") or "").strip()
        stock_code = str(row.get("target_stock_code") or row.get("extSECURITY_CODE") or row.get("stockcode") or "").strip()
        if not company or not stock_code or stock_code != str(row.get("target_stock_code") or stock_code):
            continue
        title = str(row.get("docTitle") or row.get("title") or "").strip()
        date = normalize_date(row.get("createTime") or row.get("cmsOpDate") or "")
        url = str(row.get("official_url") or row.get("docURL") or "")
        kind = str(row.get("record_kind") or "")
        location = row.get("original_location") or {}
        if kind == "exchange_inquiry":
            event_id = str(row.get("docId") or stable_hash([stock_code, date, title]))
            evidence.append(
                Evidence(
                    company=company,
                    indicator="交易所问询次数",
                    source_id=doc.source_id,
                    source_name=doc.source_name,
                    publish_date=date,
                    fetched_at=doc.fetched_at,
                    url=url,
                    title=title,
                    snippet=f"{stock_code} {row.get('extGSJC') or ''} {row.get('extGGDL') or '监管问询'} {title}".strip(),
                    value={
                        "dataset_type": "exchange_inquiry_event",
                        "count": 1,
                        "event_type": "exchange_inquiry",
                        "official_record_id": event_id,
                        "event_fingerprint": f"sse_inquiry:{event_id}",
                        "authority": "上海证券交易所",
                        "subject_name": company,
                        "decision_date": date,
                        "event_title": title,
                        "inquiry_type": row.get("extGGDL") or "",
                        "involved_party": row.get("extTeacher") or "",
                        "source_url": url,
                        "original_location": location,
                        "record": row,
                    },
                    confidence=0.99,
                    tags=["official_exchange", "sse_regulatory", "inquiry", "exchange_inquiry_event"],
                    source_type=doc.source_type,
                )
            )
            continue

        event_type = _sse_regulatory_event_type(str(row.get("extWTFL") or ""), title)
        event_id = str(row.get("docId") or stable_hash([stock_code, date, event_type, title]))
        record = {
            "dataset_type": "regulatory_event",
            "official_record_id": event_id,
            "event_type": event_type,
            "subject_name": company,
            "authority": "上海证券交易所",
            "decision_date": date,
            "event_title": title,
            "regulatory_type": row.get("extWTFL") or row.get("extTYPE") or "",
            "involved_party": row.get("extTeacher") or "",
            "source_url": url,
            "original_location": location,
            "record": row,
        }
        evidence.append(
            Evidence(
                company=company,
                indicator="监管处罚次数",
                source_id=doc.source_id,
                source_name=doc.source_name,
                publish_date=date,
                fetched_at=doc.fetched_at,
                url=url,
                title=title,
                snippet=f"{stock_code} {row.get('extGSJC') or ''} {record['regulatory_type']} {title}".strip(),
                value={**record, "event_fingerprint": f"sse_regulatory:{event_id}"},
                confidence=0.99,
                tags=["official_exchange", "sse_regulatory", "regulatory_event", event_type],
                source_type=doc.source_type,
            )
        )
    return evidence


def _sse_regulatory_event_type(regulatory_type: str, title: str) -> str:
    text = f"{regulatory_type} {title}"
    if any(term in text for term in ("公开谴责", "通报批评", "纪律处分")):
        return "disciplinary_action"
    if "警示函" in text:
        return "warning_letter"
    return "regulatory_measure"


def parse_qichacha_records(doc: RawDocument) -> list[Evidence]:
    """Normalize licensed Qichacha records without assuming a specific endpoint schema."""
    evidence = []
    for item in doc.content.get("records", []) if isinstance(doc.content, dict) else []:
        if not isinstance(item, dict):
            continue
        record = item.get("record", {})
        if not isinstance(record, dict):
            continue
        dataset_type = str(item.get("dataset_type", "qichacha_record"))
        if dataset_type == "qcc_risk_scan":
            evidence.extend(_parse_qcc_risk_scan(item, doc, _qcc_result_data(record)))
            continue
        if dataset_type == "qcc_judgment_documents":
            evidence.extend(_parse_qcc_events(item, doc, record, "judgment_document"))
            continue
        if dataset_type == "qcc_kyc":
            evidence.extend(_parse_qcc_kyc(item, doc, _qcc_result_data(record)))
            continue
        indicator, tags = {
            "enterprise_profile": ("公司公告", ["qichacha", "enterprise_profile"]),
            "litigation_event": ("诉讼风险", ["qichacha", "litigation_event"]),
            "regulatory_event": ("监管处罚次数", ["qichacha", "regulatory_event"]),
            "related_entity": ("高管关联风险暴露度", ["qichacha", "related_entity"]),
            "executive_profile": ("高管关联风险暴露度", ["qichacha", "executive_profile"]),
        }.get(dataset_type, ("公司公告", ["qichacha", dataset_type]))
        amount = _qcc_number(record, "Amount", "amount", "CaseAmount", "case_amount", "Money")
        evidence.append(
            _base(
                item,
                doc,
                indicator,
                json.dumps(record, ensure_ascii=False)[:300],
                value={"dataset_type": dataset_type, "amount": amount, "record": record},
                confidence=0.9,
                tags=tags,
                needs_review=True,
                review_reason="企查查授权数据需复核套餐范围、主体匹配、事件去重和字段口径；企业工商信息只作为主体核验和基础证据，不直接推导风险等级。",
            )
        )
    return evidence


def parse_tianyancha_records(doc: RawDocument) -> list[Evidence]:
    """Normalize licensed Tianyancha records without fabricating missing fields."""
    evidence = []
    for item in doc.content.get("records", []) if isinstance(doc.content, dict) else []:
        if not isinstance(item, dict) or not isinstance(item.get("record"), dict):
            continue
        record = item["record"]
        dataset_type = str(item.get("dataset_type", "tianyancha_record"))
        if dataset_type in {"tyc_regulatory_event", "tyc_historical_regulatory_event", "tyc_environmental_penalty", "tyc_tax_illegal", "tyc_serious_illegal", "tyc_business_abnormal"}:
            evidence.append(_tyc_event_evidence(item, doc, record, "监管处罚次数", dataset_type, ["tianyancha", "regulatory_event"]))
        elif dataset_type in {"tyc_litigation_event", "tyc_judgment_document", "tyc_enforcement", "tyc_dishonest", "tyc_consumption_restriction"}:
            evidence.append(_tyc_event_evidence(item, doc, record, "诉讼风险", dataset_type, ["tianyancha", "litigation_event"]))
        elif dataset_type in {"tyc_person_roles", "tyc_person_companies"}:
            evidence.append(_base(item, doc, "高管关联风险暴露度", json.dumps(record, ensure_ascii=False)[:300], value={"dataset_type": dataset_type, "person": item.get("person"), "record": record}, confidence=0.9, tags=["tianyancha", "executive_related", dataset_type], needs_review=True, review_reason="人员关联企业或任职记录仅用于建立关联范围；必须结合主体匹配和独立风险事件，不能仅凭关联关系判定风险。"))
        elif dataset_type in {"tyc_shareholder", "tyc_actual_controller", "tyc_annual_report", "tyc_change_record"}:
            evidence.append(_tyc_equity_evidence(item, doc, record, dataset_type))
        elif dataset_type == "tyc_executive_related":
            evidence.append(_base(item, doc, "高管关联风险暴露度", json.dumps(record, ensure_ascii=False)[:300], value={"dataset_type": "executive_related", "record": record}, confidence=0.9, tags=["tianyancha", "executive_related"], needs_review=True, review_reason="天眼查返回的人员或关联主体仅用于建立关联范围；没有处罚、诉讼、失信等交叉事件时不得据此判定为低风险。"))
        else:
            evidence.append(_base(item, doc, "公司公告", json.dumps(record, ensure_ascii=False)[:300], value={"dataset_type": dataset_type, "record": record}, confidence=0.9, tags=["tianyancha", dataset_type], needs_review=True, review_reason="天眼查授权数据已保留原始记录；须确认套餐范围、主体匹配和字段口径后才可作为特定风险指标的硬计分输入。"))
    return evidence


def parse_mcp_records(doc: RawDocument) -> list[Evidence]:
    """Normalize MCP rows into auditable evidence without inventing absent fields."""
    evidence: list[Evidence] = []
    records = doc.content.get("records", []) if isinstance(doc.content, dict) else []
    for item in records if isinstance(records, list) else []:
        if not isinstance(item, dict):
            continue
        record = item.get("record")
        if not isinstance(record, dict):
            record = {"text": str(record)}
        nested = _mcp_nested_records(record)
        for row in nested:
            child = dict(item)
            child["record"] = row
            # Let the row fields replace the generic connector placeholder.
            if len(nested) > 1:
                child["title"] = ""
                child["publish_date"] = ""
            evidence.extend(_mcp_row_evidence(doc, child, row))
    return evidence


def _mcp_nested_records(record: dict) -> list[dict]:
    """Expand legacy raw MCP wrappers saved before the connector was row-aware."""
    if not ("data" in record and ("code" in record or "msg" in record)):
        return [record]
    expanded = _expand_mcp_value(record)
    return expanded or [record]


def _mcp_row_evidence(doc: RawDocument, item: dict, record: dict) -> list[Evidence]:
    tool = str(item.get("tool") or "")
    dataset_type = str(item.get("dataset_type") or "ifind_mcp_record")
    company = str(item.get("company") or record.get("company") or record.get("company_name") or "")
    date = _mcp_value(record, "日期", "报告期", "公告日期", "发布日期", "date", "report_date", "publish_date")
    title = _mcp_value(record, "资讯标题", "公告标题", "标题", "title", "headline", "name") or tool or dataset_type
    url = _mcp_value(record, "url", "URL", "link", "source_url") or str(item.get("url") or "")
    base_item = {**item, "company": company, "publish_date": date, "title": title, "url": url}
    if tool == "search_news" and isinstance(item.get("_news_rows"), list):
        return _mcp_news_child_evidence(doc, base_item, item["_news_rows"], dataset_type, tool)
    raw_value = {"dataset_type": dataset_type, "tool": tool, "arguments": item.get("arguments", {}), "record": record}
    rows: list[Evidence] = []

    def add(indicator: str, value: dict | float | int | str, tags: list[str] | None = None, snippet: str = "") -> None:
        payload = value if isinstance(value, dict) else {"dataset_type": dataset_type, "value": value, "record": record}
        rows.append(_base(base_item, doc, indicator, snippet or structured_snippet(dataset_type, payload.get("record", payload) if isinstance(payload, dict) else record), value=payload, confidence=0.9, tags=["mcp", dataset_type, tool, *(tags or [])], needs_review=True, review_reason="iFinD MCP 行级证据已拆分，但仍需核对报告期、统计口径、主体匹配和接口返回范围。"))

    if tool in {"search_news", "search_notice"} or dataset_type in {"ifind_news", "ifind_notice"}:
        text = _mcp_value(record, "资讯内容", "公告片段内容", "正文", "内容", "text", "content", "body")
        if tool == "search_news" or dataset_type == "ifind_news":
            full_text = bool(record.get("full_text_available"))
            add(
                "叙事热度基本面背离度",
                {
                    "dataset_type": "text_news",
                    "title": title,
                    "publish_date": date,
                    "text": text,
                    "full_text_available": full_text,
                    "publisher": record.get("publisher", ""),
                    "source_url": record.get("source_url") or url,
                    "original_location": record.get("original_location", {"field": "record", "locator": "mcp_search_news"}),
                    "record": record,
                },
                ["text_news", "full_text" if full_text else "snippet_only"],
                text or title,
            )
        else:
            notice_indicator = "交易所问询次数" if re.search(r"问询|监管问询|审核问询", title + text) else "公司公告"
            add(notice_indicator, {"dataset_type": "regulatory_event" if notice_indicator != "公司公告" else "text_company_disclosure", "title": title, "publish_date": date, "text": text, "record": record}, ["notice"], text or title)
        return rows or [_mcp_raw_evidence(doc, base_item, raw_value)]

    if tool == "get_stock_financials" or "financial" in dataset_type:
        financial = _mcp_financial_fields(record)
        if financial.get("revenue_growth_rate") is not None:
            add("营业收入增长率", {"dataset_type": "financial_numeric", **financial, "record": record})
        if financial.get("rd_intensity") is not None:
            add("研发投入强度", {"dataset_type": "financial_numeric", **financial, "record": record})
        if financial:
            add("财务结构化数据", {"dataset_type": "financial_numeric", **financial, "record": record})
        return rows or [_mcp_raw_evidence(doc, base_item, raw_value)]

    if tool == "get_stock_shareholders" or "holder" in dataset_type or "shareholder" in dataset_type:
        equity = _mcp_equity_fields(record)
        if equity:
            add("股权稀释程度", {"dataset_type": "equity_structure", **equity, "record": record})
        return rows or [_mcp_raw_evidence(doc, base_item, raw_value)]

    if tool == "get_stock_events" or tool == "get_risk_indicators":
        text = json.dumps(record, ensure_ascii=False)
        if _mcp_number(record, "区间诉讼次数", "诉讼次数") is not None or "诉讼" in text:
            add("诉讼风险", {"dataset_type": "litigation_event", "count": _mcp_number(record, "区间诉讼次数", "诉讼次数"), "record": record})
        if _mcp_number(record, "区间违规处罚次数", "违规处罚次数", "处罚次数") is not None or re.search(r"处罚|处分|违规", text):
            add("监管处罚次数", {"dataset_type": "regulatory_event", "count": _mcp_number(record, "区间违规处罚次数", "处罚次数"), "record": record})
        return rows or [_mcp_raw_evidence(doc, base_item, raw_value)]

    if tool == "get_stock_performance":
        add("市场表现数据", {"dataset_type": "market_numeric", "record": record})
        return rows
    if tool == "get_edb_data":
        add("行业基准", {"dataset_type": "industry_benchmark", "record": record})
        return rows
    return [_mcp_raw_evidence(doc, base_item, raw_value)]


def _mcp_news_child_evidence(doc: RawDocument, base_item: dict, children: list[dict], dataset_type: str, tool: str) -> list[Evidence]:
    rows: list[Evidence] = []
    for child in children:
        title = _mcp_value(child, "title", "headline", "资讯标题") or base_item.get("title", "")
        date = _mcp_value(child, "publish_date", "date", "日期") or base_item.get("publish_date", "")
        if len(date) > 20:
            date = ""
        url = _mcp_value(child, "source_url", "url", "URL", "link") or base_item.get("url", "")
        text = _mcp_value(child, "body", "text", "content", "资讯内容")
        full_text = bool(child.get("full_text_available"))
        value = {
            "dataset_type": "text_news",
            "title": title,
            "publish_date": date,
            "text": text,
            "full_text_available": full_text,
            "publisher": child.get("publisher", ""),
            "source_url": url,
            "original_location": child.get("original_location", {"field": "record", "locator": "mcp_search_news"}),
            "record": child,
        }
        rows.append(_base({**base_item, "title": title, "publish_date": date, "url": url}, doc, "叙事热度基本面背离度", text or title, value=value, confidence=0.92 if full_text else 0.72, tags=["mcp", dataset_type, tool, "text_news", "full_text" if full_text else "snippet_only"], needs_review=not full_text, review_reason="新闻正文已从允许的公开原文页面补抓并保留定位。" if full_text else "同花顺仅返回摘要或链接，未获得完整公开正文。"))
    return rows


def _mcp_raw_evidence(doc: RawDocument, item: dict, value: dict) -> Evidence:
    return _base(item, doc, str(item.get("indicator") or _mcp_indicator_from_dataset(str(value.get("dataset_type", "")))), json.dumps(value.get("record", value), ensure_ascii=False)[:300], value=value, confidence=0.8, tags=["mcp", "raw_response", str(item.get("tool", ""))], needs_review=True, review_reason="未识别为可靠结构化行，保留原始返回供人工复核，不据此补齐字段。")


def _mcp_value(record: dict, *keys: str) -> str:
    for key in keys:
        value = record.get(key)
        if value not in (None, "", "\\t"):
            return str(value).strip()
    return ""


def _mcp_number(record: dict, *keys: str):
    text = _mcp_value(record, *keys)
    if not text:
        return None
    text = text.replace(",", "").replace("%", "")
    multiplier = 100000000 if "亿" in text else 10000 if "万" in text else 1
    try:
        return float(re.sub(r"[^0-9.\\-]", "", text)) * multiplier
    except ValueError:
        return None


def _mcp_financial_fields(record: dict) -> dict:
    revenue = _mcp_number(record, "营业收入（单位：元）", "营业收入", "revenue")
    growth = _mcp_number(record, "营业收入(同比增长率)（单位：%）", "营业收入同比增长率（单位：%）", "revenue_growth_rate", "growth_rate")
    rd = _mcp_number(record, "研发投入总额（单位：元）", "研发投入", "研发费用", "rd_expense")
    result = {"report_date": _mcp_value(record, "日期", "报告期", "date", "report_date"), "revenue": revenue, "rd_expense": rd, "revenue_growth_rate": growth}
    if result["revenue_growth_rate"] is None and revenue is not None:
        result["previous_revenue"] = _mcp_number(record, "上期营业收入", "previous_revenue")
        if result["previous_revenue"]:
            result["revenue_growth_rate"] = round((revenue - result["previous_revenue"]) / result["previous_revenue"] * 100, 4)
    if revenue and rd is not None:
        result["rd_intensity"] = round(rd / revenue * 100, 4)
    return {key: value for key, value in result.items() if value not in (None, "")}


def _mcp_equity_fields(record: dict) -> dict:
    controller = _mcp_value(record, "实际控制人", "actual_controller", "controller")
    ratio = _mcp_number(record, "实际控制人持股比例（单位：%）", "控股股东持股比例（单位：%）", "shareholding_ratio", "ratio")
    date = _mcp_value(record, "日期", "报告期", "公告日期", "report_date", "date")
    if not controller and ratio is None:
        return {}
    return {"subject_name": controller, "subject_role": "actual_controller" if controller else "controlling_shareholder", "shareholding_ratio": ratio, "report_date": date}


def _tyc_event_evidence(item: dict, doc: RawDocument, record: dict, indicator: str, dataset_type: str, tags: list[str]) -> Evidence:
    document_no = _tyc_field(record, "punishNo", "punishNumber", "decisionNo", "docNo", "caseNo", "caseCode", "案号", "决定书文号")
    agency = _tyc_field(record, "department", "departmentName", "agency", "punishDepartment", "putDepartment", "removeDepartment", "court", "execCourtName", "执行法院", "处罚机关")
    event_date = _tyc_field(record, "punishTime", "decisionDate", "publishTime", "judgmentDate", "judgeTime", "filingDate", "caseCreateTime", "putDate", "removeDate", "submitTime", "date", "处罚日期", "发布日期")
    title = _tyc_field(record, "title", "name", "caseReason", "punishReason", "putReason", "removeReason", "caseNo", "caseCode", "punishNo", "punishNumber", "案件名称")
    amount = _qcc_number(record, "amount", "money", "punishAmount", "punishAmt", "pecuniary", "caseAmount", "caseMoney", "executeMoney", "execMoney", "金额", "罚款金额")
    payload = dict(record)
    payload.update({"tyc_event_type": dataset_type, "event_key": f"{dataset_type}:{document_no or title}:{event_date}:{agency}", "document_no": document_no, "agency": agency})
    return _base({**item, "publish_date": event_date or item.get("publish_date", ""), "title": f"{dataset_type}: {title or document_no}", "url": item.get("url", "")}, doc, indicator, json.dumps(payload, ensure_ascii=False)[:300], value={"dataset_type": "litigation_event" if indicator == "诉讼风险" else "regulatory_event", "amount": amount, "record": payload}, confidence=0.9, tags=[*tags, "tyc_event"], needs_review=True, review_reason="天眼查事件必须以主体、文书号或案号、主管机关和日期去重并核验；无返回记录不代表不存在风险。")


def _tyc_equity_evidence(item: dict, doc: RawDocument, record: dict, dataset_type: str) -> Evidence:
    subject_role = "actual_controller" if dataset_type == "tyc_actual_controller" else "shareholder" if dataset_type == "tyc_shareholder" else ""
    subject_name = _tyc_field(record, "controllerName", "actualController", "shareholderName", "holderName", "name", "股东名称", "实际控制人")
    ratio = _tyc_field(record, "shareholdingRatio", "holdRatio", "ratio", "sharePercent", "持股比例")
    report_date = _tyc_field(record, "reportDate", "date", "changeDate", "annDate", "公告日期", "报告期")
    payload = dict(record)
    payload.update({"subject_role": subject_role, "subject_name": subject_name, "shareholding_ratio": ratio, "report_date": report_date})
    return _base({**item, "publish_date": report_date or item.get("publish_date", "")}, doc, "股权稀释程度", json.dumps(payload, ensure_ascii=False)[:300], value={"dataset_type": "equity_structure", "record": payload}, confidence=0.9, tags=["tianyancha", "equity_structure", dataset_type], needs_review=True, review_reason="股权稀释仅在同一实际控制人或控股股东、至少两个报告时点、且持股比例均可核验时计算；天眼查单期股权信息不能替代历史持股序列。")


def _tyc_field(record: dict, *keys: str) -> str:
    for key in keys:
        value = record.get(key)
        if value not in (None, ""):
            return str(value)
    return ""


def _qcc_result_data(record: dict) -> dict:
    """RiskControl and KYC responses wrap the actual sections in Result.Data."""
    data = record.get("Data") if isinstance(record, dict) else None
    return data if isinstance(data, dict) else record


def _parse_qcc_risk_scan(item: dict, doc: RawDocument, record: dict) -> list[Evidence]:
    evidence = []
    for event_type, indicator, tags in (
        ("Judgment", "诉讼风险", ["qichacha", "judgment_document"]),
        ("JudgmentDoc", "诉讼风险", ["qichacha", "judgment_document"]),
        ("ZhiXing", "诉讼风险", ["qichacha", "enforcement"]),
        ("ShiXin", "诉讼风险", ["qichacha", "dishonest"]),
        ("Sumptuary", "诉讼风险", ["qichacha", "consumption_restriction"]),
        ("Bankruptcy", "诉讼风险", ["qichacha", "bankruptcy"]),
        ("EnvPunishment", "监管处罚次数", ["qichacha", "environmental_penalty"]),
        ("AdministrativePenalty", "监管处罚次数", ["qichacha", "administrative_penalty"]),
        ("TaxIllegal", "监管处罚次数", ["qichacha", "tax_illegal"]),
        ("SeriousIllegal", "监管处罚次数", ["qichacha", "serious_illegal"]),
        ("Exception", "监管处罚次数", ["qichacha", "business_exception"]),
    ):
        for event in _qcc_named_records(record, event_type):
            evidence.append(_qcc_event_evidence(item, doc, indicator, event, event_type, tags))
    return evidence


def _parse_qcc_events(item: dict, doc: RawDocument, record: dict, event_type: str) -> list[Evidence]:
    rows = _qcc_list_records(record)
    return [
        _qcc_event_evidence(item, doc, "诉讼风险", event, event_type, ["qichacha", event_type])
        for event in rows
    ]


def _parse_qcc_kyc(item: dict, doc: RawDocument, record: dict) -> list[Evidence]:
    evidence = []
    for key, relation_type in (
        ("EmployeeList", "executive_profile"),
        ("PartnerList", "related_entity"),
        ("BeneficiaryList", "related_entity"),
        ("FinalBenefitList", "related_entity"),
        ("InvestList", "related_entity"),
    ):
        for row in _qcc_named_records(record, key):
            normalized = dict(row)
            normalized.setdefault("person_name", _qcc_field(row, "Name", "PersonName", "OperName"))
            normalized.setdefault("related_entity_name", _qcc_field(row, "CompanyName", "EntName", "Name"))
            normalized["qcc_relation_type"] = relation_type
            evidence.append(
                _base(
                    item,
                    doc,
                    "高管关联风险暴露度",
                    json.dumps(normalized, ensure_ascii=False)[:300],
                    value={"dataset_type": relation_type, "record": normalized},
                    confidence=0.9,
                    tags=["qichacha", relation_type],
                    needs_review=True,
                    review_reason="企查查 KYC 返回的人员和关联主体用于构建关联范围；未携带风险事件时不得据此得出低风险结论。",
                )
            )
    return evidence


def _qcc_named_records(payload: dict, name: str) -> list[dict]:
    found = []
    if not isinstance(payload, dict):
        return found
    for key, value in payload.items():
        if key == name:
            found.extend(_qcc_list_records(value))
        elif isinstance(value, dict):
            found.extend(_qcc_named_records(value, name))
        elif isinstance(value, list):
            for row in value:
                if isinstance(row, dict):
                    found.extend(_qcc_named_records(row, name))
    return found


def _qcc_list_records(value) -> list[dict]:
    if isinstance(value, list):
        return [row for row in value if isinstance(row, dict)]
    if not isinstance(value, dict):
        return []
    for key in ("DataList", "List", "Items", "Records", "Data"):
        rows = value.get(key)
        if isinstance(rows, list):
            return [row for row in rows if isinstance(row, dict)]
    return [value]


def _qcc_event_evidence(item: dict, doc: RawDocument, indicator: str, event: dict, event_type: str, tags: list[str]) -> Evidence:
    case_no = _qcc_field(event, "CaseNo", "DocNo", "CaseCode", "RegisterNo", "Id")
    title = _qcc_field(event, "Title", "Name", "CaseReason", "PunishReason", "CaseNo", "DocNo")
    publish_date = _qcc_field(event, "PublishDate", "Date", "JudgmentDate", "PunishDate", "RegisterDate", "FilingDate")
    amount = _qcc_number(event, "Amount", "CaseAmount", "Money", "ExecuteMoney", "PunishAmt", "EquityAmount")
    payload = dict(event)
    payload["qcc_event_type"] = event_type
    payload["event_key"] = f"{event_type}:{case_no or title}:{publish_date}"
    return _base(
        {**item, "publish_date": publish_date or item.get("publish_date", ""), "title": f"{event_type}: {title or case_no}", "url": item.get("url", "")},
        doc,
        indicator,
        json.dumps(payload, ensure_ascii=False)[:300],
        value={"dataset_type": "litigation_event" if indicator == "诉讼风险" else "regulatory_event", "amount": amount, "record": payload},
        confidence=0.9,
        tags=[*tags, "qcc_event"],
        needs_review=True,
        review_reason="企查查授权事件需以案号/文书号、主体、日期和机关去重并复核；无返回记录不代表不存在风险。",
    )


def _qcc_field(record: dict, *keys: str) -> str:
    for key in keys:
        value = record.get(key)
        if value not in (None, ""):
            return str(value)
    return ""


def _qcc_number(record: dict, *keys: str) -> float:
    for key in keys:
        value = record.get(key)
        if value in (None, ""):
            continue
        try:
            text = str(value).replace(",", "").replace("，", "").replace("元", "").replace("人民币", "").strip()
            multiplier = 10_000 if "万" in text else 1
            return float(text.replace("万元", "").replace("万", "").strip()) * multiplier
        except ValueError:
            continue
    return 0.0


def parse_bse_announcements(doc: RawDocument) -> list[Evidence]:
    evidence = []
    for row in doc.content.get("records", []):
        title = strip_html(row.get("disclosureTitle", "") + row.get("disclosurePostTitle", ""))
        company = row.get("target_company", "")
        if not company or not _matches_target(row.get("companyName", ""), company, row.get("target_aliases", [])):
            continue
        classification = classify_announcement_title(title)
        indicator = "公司公告"
        value = {"count": 1, "announcement_classification": classification, "raw": row}
        tags = ["bse_announcement", *classification["tags"]]
        if is_exchange_inquiry_notice(title):
            indicator = "交易所问询次数"
            value = {
                "count": 1,
                "event_type": "exchange_inquiry",
                "event_fingerprint": exchange_inquiry_fingerprint(str(row.get("companyCd") or row.get("stockCode") or ""), title, normalize_date(row.get("publishDate", ""))),
                "source_record": row,
            }
            tags.append("inquiry")
        evidence.append(
            Evidence(
                company=company,
                indicator=indicator,
                source_id=doc.source_id,
                source_name=doc.source_name,
                publish_date=normalize_date(row.get("publishDate", "")),
                fetched_at=doc.fetched_at,
                url=row.get("url", ""),
                title=title,
                snippet=f"{row.get('companyCd', '')} {row.get('companyName', '')} {title}",
                value=value,
                confidence=0.95,
                tags=[tag for tag in tags if tag],
                source_type=doc.source_type,
            )
        )
    return evidence


def exchange_inquiry_fingerprint(security_code: str, title: str, publish_date: str) -> str:
    """Group the inquiry notice and its same-day duplicate disclosure as one event."""
    round_marker = ""
    for marker in ("第四轮", "第三轮", "第二轮", "第一轮"):
        if marker in title:
            round_marker = marker
            break
    if not round_marker:
        round_marker = "single"
    return f"exchange_inquiry:{security_code}:{publish_date}:{round_marker}"


def parse_szse_announcements(doc: RawDocument) -> list[Evidence]:
    """Normalize SZSE API fields while retaining the source record for audit."""
    evidence = []
    for row in doc.content.get("records", []):
        title = strip_html(str(row.get("title") or row.get("announcementTitle") or row.get("disclosureTitle") or ""))
        company = row.get("target_company", "")
        disclosed_company = str(row.get("secName") or row.get("companyName") or row.get("company") or "")
        if not company or (disclosed_company and not _matches_target(disclosed_company, company, row.get("target_aliases", []))):
            continue
        classification = classify_announcement_title(title)
        indicator = "交易所问询次数" if is_exchange_inquiry_notice(title) else "公司公告"
        tags = ["szse_announcement", *classification["tags"]]
        value = 1 if indicator == "交易所问询次数" else {"count": 1, "announcement_classification": classification, "raw": row}
        if indicator == "交易所问询次数":
            tags.append("inquiry")
        evidence.append(
            Evidence(
                company=company,
                indicator=indicator,
                source_id=doc.source_id,
                source_name=doc.source_name,
                publish_date=normalize_date(row.get("publishTime") or row.get("publishDate") or row.get("announcementTime") or ""),
                fetched_at=doc.fetched_at,
                url=row.get("url", ""),
                title=title,
                snippet=f"{row.get('secCode') or row.get('companyCd') or ''} {disclosed_company} {title}".strip(),
                value=value,
                confidence=0.95,
                tags=[tag for tag in tags if tag],
                source_type=doc.source_type,
            )
        )
    return evidence


def parse_official_announcement_text(doc: RawDocument) -> list[Evidence]:
    """Keep only first-party pages already matched against a configured company."""
    evidence = []
    for item in doc.content:
        if item.get("status") != "ok" or not first_matched_target(item):
            continue
        company = first_matched_target(item)
        title = item.get("title", "")
        text = item.get("text", "") or item.get("body", "")
        classification = classify_announcement_title(title)
        indicator = "交易所问询次数" if is_exchange_inquiry_notice(title) else "公司公告"
        value = 1 if indicator == "交易所问询次数" else {
            "count": 1,
            "announcement_classification": classification,
            "source_location": locate_text_evidence(text, [company]),
        }
        tags = ["official_announcement", *classification["tags"]]
        if indicator == "交易所问询次数":
            tags.append("inquiry")
        evidence.append(
            Evidence(
                company=company,
                indicator=indicator,
                source_id=doc.source_id,
                source_name=doc.source_name,
                publish_date="",
                fetched_at=doc.fetched_at,
                url=item.get("url", ""),
                title=title,
                snippet=build_keyword_snippet(text, [company]),
                value=value,
                confidence=0.75,
                tags=[tag for tag in tags if tag],
                needs_review=True,
                review_reason="深交所官方页面已匹配目标主体；公告发布日期和文档类型需以原页面或巨潮披露记录复核。",
                source_type=doc.source_type,
            )
        )
    return evidence


def parse_keyword_event_text(doc: RawDocument, indicator: str, tags: list[str], keywords: list[str], review_reason: str) -> list[Evidence]:
    evidence = []
    for item in doc.content:
        text = item.get("text", "")
        if item.get("status") != "ok" or not text or not item.get("company"):
            continue
        paragraphs = split_paragraphs(text)
        matched = [keyword for keyword in keywords if keyword in text]
        if not matched:
            continue
        company = first_matched_target(item) or infer_company_from_text(text)
        if not company:
            continue
        structure = detect_document_structure(text)
        first_location = locate_text_evidence(text, matched[:5])
        snippet = build_keyword_snippet(text, matched)
        regulatory = _normalize_regulatory_text(item, text, snippet)
        evidence.append(
            Evidence(
                company=company,
                indicator=indicator,
                source_id=doc.source_id,
                source_name=doc.source_name,
                publish_date="",
                fetched_at=doc.fetched_at,
                url=item.get("url", ""),
                title=item.get("title", ""),
                snippet=snippet,
                value={
                    "matched_terms": matched,
                    "source_status": item.get("status"),
                    "query": item.get("query", ""),
                    "search_url": item.get("search_url", ""),
                    "dedup_key": stable_hash([indicator, item.get("title", ""), snippet[:120]]),
                    "paragraph_count": len(paragraphs),
                    "segments": paragraphs[:3],
                    "document_structure": structure,
                    "source_locations": first_location,
                    "document_type": structure.get("document_type", ""),
                    "structure_confidence": structure.get("structure_confidence", 0),
                    "llm_prompt": build_llm_prompt(
                        "document_field_extraction" if structure.get("document_type") == "penalty_decision" else "bounded_text_classification",
                        text[:6000],
                        metadata={"allowed_labels": ["technical_quality_event", "regulatory_event", "litigation_event", "narrative", "risk_mitigation", "vague_commitment", "irrelevant"]},
                    ),
                    **({"dataset_type": "regulatory_event", "record": regulatory} if indicator == "监管处罚次数" and regulatory else {}),
                },
                confidence=0.5 + min(0.25, 0.05 * len(matched)),
                tags=["web_text", *tags, "paragraph_segment"],
                needs_review=True,
                review_reason=review_reason,
                source_type=doc.source_type,
            )
        )
    return evidence


def strip_html(text: str) -> str:
    return re.sub(r"<[^>]+>", "", text or "")


def is_exchange_inquiry_notice(title: str) -> bool:
    """Count the issuer/venue notice, not replies or intermediary explanations."""
    title = title or ""
    if not any(term in title for term in ("问询函", "关注函", "监管函")):
        return False
    excluded = ("回复", "说明", "会计师", "律师", "中介机构", "更新", "修订")
    return not any(term in title for term in excluded)


def timestamp_ms_to_date(value) -> str:
    if not value:
        return ""
    try:
        from datetime import datetime

        return datetime.fromtimestamp(int(value) / 1000).strftime("%Y-%m-%d")
    except Exception:
        return str(value)


def build_keyword_snippet(text: str, matched: list[str]) -> str:
    first = min((text.find(term) for term in matched if text.find(term) >= 0), default=0)
    return text[max(0, first - 120) : first + 180]


def parse_openalex_works(doc: RawDocument) -> list[Evidence]:
    evidence = []
    results = doc.content.get("results", []) if isinstance(doc.content, dict) else []
    configured_company = doc.content.get("_target_company", "") if isinstance(doc.content, dict) else ""
    aliases = doc.content.get("_target_aliases", []) if isinstance(doc.content, dict) else []
    identity_whitelist = doc.content.get("_paper_identity_whitelist", []) if isinstance(doc.content, dict) else []
    for work in results:
        title = work.get("display_name", "")
        authorships = work.get("authorships", [])
        institution_text = " ".join(
            inst.get("display_name", "")
            for author in authorships
            for inst in author.get("institutions", [])
        )
        text = f"{title} {institution_text}"
        inferred = infer_company_from_text(text)
        work_company = inferred or (configured_company if text_matches_company(text, [*aliases, *identity_whitelist]) else "")
        if not work_company:
            continue
        value = {
            "openalex_id": work.get("id"),
            "title": title,
            "publication_year": work.get("publication_year"),
            "cited_by_count": work.get("cited_by_count"),
            "doi": work.get("doi"),
            "institutions": institution_text,
        }
        evidence.append(
            Evidence(
                company=work_company,
                indicator="持续创新能力",
                source_id=doc.source_id,
                source_name=doc.source_name,
                publish_date=str(work.get("publication_year") or ""),
                fetched_at=doc.fetched_at,
                url=work.get("id", ""),
                title=title,
                snippet=f"{title}；引用次数:{work.get('cited_by_count')}",
                value=value,
                confidence=0.7,
                tags=["openalex", "paper_metadata", "citation_metric"],
                needs_review=True,
                review_reason="需核验论文是否与企业核心技术路线直接相关",
                source_type=doc.source_type,
            )
        )
    return evidence


def parse_paper_works(doc: RawDocument) -> list[Evidence]:
    evidence = []
    for item in normalize_paper_items(doc.content):
        title = item.get("title", "")
        text = " ".join([title, item.get("authors", ""), item.get("venue", "")])
        configured_company = doc.content.get("_target_company", "") if isinstance(doc.content, dict) else ""
        aliases = doc.content.get("_target_aliases", []) if isinstance(doc.content, dict) else []
        identity_whitelist = doc.content.get("_paper_identity_whitelist", []) if isinstance(doc.content, dict) else []
        company = infer_company_from_text(text) or (configured_company if text_matches_company(text, [*aliases, *identity_whitelist]) else "")
        if not company:
            continue
        evidence.append(
            Evidence(
                company=company,
                indicator="持续创新能力",
                source_id=doc.source_id,
                source_name=doc.source_name,
                publish_date=str(item.get("year") or ""),
                fetched_at=doc.fetched_at,
                url=item.get("url", ""),
                title=title,
                snippet=f"{title}；引用次数:{item.get('citation_count', '')}；DOI:{item.get('doi', '')}",
                value=item,
                confidence=0.7,
                tags=["paper_metadata", "citation_metric", item.get("source_format", "")],
                needs_review=True,
                review_reason="需核验论文作者机构、企业主体和核心技术路线的直接关联",
                source_type=doc.source_type,
            )
        )
    return evidence


def normalize_paper_items(content) -> list[dict]:
    if isinstance(content, dict) and "message" in content:
        items = content.get("message", {}).get("items", [])
        return [
            {
                "source_format": "crossref",
                "title": " ".join(item.get("title", [])) if isinstance(item.get("title"), list) else item.get("title", ""),
                "year": first_date_part(item.get("published-print") or item.get("published-online") or item.get("issued")),
                "doi": item.get("DOI", ""),
                "url": item.get("URL", ""),
                "venue": " ".join(item.get("container-title", [])) if isinstance(item.get("container-title"), list) else "",
                "authors": "; ".join(
                    " ".join(filter(None, [author.get("given", ""), author.get("family", "")]))
                    for author in item.get("author", [])
                ),
                "citation_count": item.get("is-referenced-by-count"),
                "raw": item,
            }
            for item in items
        ]
    if isinstance(content, dict) and "data" in content:
        return [
            {
                "source_format": "semantic_scholar",
                "title": item.get("title", ""),
                "year": item.get("year"),
                "doi": (item.get("externalIds") or {}).get("DOI", ""),
                "url": item.get("url", ""),
                "venue": (item.get("publicationVenue") or {}).get("name", ""),
                "authors": "; ".join(author.get("name", "") for author in item.get("authors", [])),
                "citation_count": item.get("citationCount"),
                "influential_citation_count": item.get("influentialCitationCount"),
                "raw": item,
            }
            for item in content.get("data", [])
        ]
    return []


def text_matches_company(text: str, aliases: list[str]) -> bool:
    compact = re.sub(r"\s+", "", text or "").lower()
    return any(alias and re.sub(r"\s+", "", str(alias)).lower() in compact for alias in aliases)


def first_date_part(value) -> str:
    parts = value.get("date-parts", []) if isinstance(value, dict) else []
    if parts and parts[0]:
        return str(parts[0][0])
    return ""


def parse_screening_list(doc: RawDocument) -> list[Evidence]:
    evidence = []
    matches = doc.content.get("matches", []) if isinstance(doc.content, dict) else []
    for match in matches:
        target = match.get("target", "")
        entry = match.get("entry", {})
        evidence.append(
            Evidence(
                company=target,
                indicator="出口管制与制裁暴露度",
                source_id=doc.source_id,
                source_name=doc.source_name,
                publish_date=entry.get("date", ""),
                fetched_at=doc.fetched_at,
                url=entry.get("url", ""),
                title=f"名单命中: {entry.get('name', target)}",
                snippet=json.dumps(entry, ensure_ascii=False)[:300],
                value=entry,
                confidence=0.9,
                tags=["screening_list", "sanction_list"],
                needs_review=True,
                review_reason="名单命中需人工核验实体是否同名误匹配",
                source_type=doc.source_type,
            )
        )
    if not matches and doc.content.get("successful_urls"):
        for target in doc.content.get("targets", []) if isinstance(doc.content, dict) else []:
            company = target.get("name", "") if isinstance(target, dict) else str(target)
            if not company:
                continue
            evidence.append(
                Evidence(
                    company=company,
                    indicator="出口管制与制裁暴露度",
                    source_id=doc.source_id,
                    source_name=doc.source_name,
                    publish_date="",
                    fetched_at=doc.fetched_at,
                    url="",
                    title="制裁/管制清单筛查无命中",
                    snippet="已对配置的公开筛查清单执行名称及别名检索，未返回可确认匹配。",
                    value={"screening_status": "no_match", "entry_count": len(doc.content.get("entries", [])), "successful_urls": doc.content.get("successful_urls", []), "errors": doc.content.get("errors", [])},
                    confidence=0.72,
                    tags=["screening_list", "sanction_list", "no_match"],
                    needs_review=True,
                    review_reason="无命中不代表不存在管制暴露；需结合主体别名、关联方、受管制组件和其他官方清单复核。",
                    source_type=doc.source_type,
                )
            )
    return evidence


def parse_us_export_control_official(doc: RawDocument) -> list[Evidence]:
    """Turn only confirmed OFAC/BIS entity matches into company evidence.

    The CCL catalog is retained in the raw response for later product/BOM
    mapping; it is deliberately not treated as a company hit by itself.
    """
    evidence = []
    content = doc.content if isinstance(doc.content, dict) else {}
    for listing in content.get("lists", []):
        for match in listing.get("matches", []):
            entry = match.get("entry", {})
            company = match.get("target", "")
            match_quality = match.get("match_quality", "related_name_candidate")
            confirmed = match_quality == "exact_entity"
            evidence.append(
                Evidence(
                    company=company,
                    indicator="出口管制与制裁暴露度",
                    source_id=doc.source_id,
                    source_name=doc.source_name,
                    publish_date=entry.get("version_date", ""),
                    fetched_at=doc.fetched_at,
                    url=entry.get("source_url", ""),
                    title=f"美国官方清单{'精确命中' if confirmed else '关联主体候选'}: {entry.get('list_name', listing.get('list_name', ''))}",
                    snippet=json.dumps({key: entry.get(key) for key in ("name", "country_or_region", "program", "license_requirement", "license_review_policy", "federal_register_citation") if entry.get(key)}, ensure_ascii=False)[:500],
                    value={**entry, "target_name": company, "matched_alias": match.get("matched_alias", ""), "match_quality": match_quality, "screening_status": "match" if confirmed else "related_candidate"},
                    confidence=0.92 if confirmed else 0.68,
                    tags=["screening_list", "sanction_list", "official_us_source", "entity_match" if confirmed else "related_entity_candidate"],
                    needs_review=True,
                    review_reason="完整法定英文名与官方名单主体一致，仍需核验名单效力和适用交易。" if confirmed else "仅共享品牌词或名称片段；需通过工商股权、年报子公司清单确认关联关系，不计入企业本体清单命中。",
                    source_type=doc.source_type,
                )
            )
    if not evidence and content.get("lists"):
        target_list = content.get("targets", [])
        for target in target_list:
            company = target.get("name", "") if isinstance(target, dict) else str(target)
            if not company:
                continue
            evidence.append(
                Evidence(
                    company=company,
                    indicator="出口管制与制裁暴露度",
                    source_id=doc.source_id,
                    source_name=doc.source_name,
                    publish_date=content.get("ecfr_date", ""),
                    fetched_at=doc.fetched_at,
                    url="",
                    title="美国官方制裁/出口管制清单筛查无确认命中",
                    snippet="已执行 OFAC SDN/非SDN及 BIS EAR 第744部分公开清单筛查；无确认主体匹配。",
                    value={"screening_status": "no_match", "lists_checked": [item.get("list_name") for item in content.get("lists", [])], "ecfr_date": content.get("ecfr_date", ""), "errors": content.get("errors", [])},
                    confidence=0.76,
                    tags=["screening_list", "sanction_list", "official_us_source", "no_match"],
                    needs_review=True,
                    review_reason="无确认命中不等于不存在出口管制暴露；仍需结合产品、技术、供应商和受控组件资料复核。",
                    source_type=doc.source_type,
                )
            )
    return evidence


def _normalize_regulatory_text(item: dict, text: str, snippet: str) -> dict:
    """Extract only auditable regulatory fields from an official result page."""
    title = str(item.get("title") or "").strip()
    combined = f"{title} {text}"
    if "行政处罚" in combined:
        event_type = "administrative_penalty"
    elif "纪律处分" in combined or "公开谴责" in combined or "通报批评" in combined:
        event_type = "disciplinary_action"
    elif "警示函" in combined:
        event_type = "warning_letter"
    elif "监管措施" in combined or "监管警示" in combined or "监管函" in combined:
        event_type = "regulatory_measure"
    else:
        event_type = "unknown"

    def match(patterns: list[str]) -> str:
        for pattern in patterns:
            found = re.search(pattern, combined, re.I)
            if found:
                return next((group for group in found.groups() if group), "").strip(" ：:;；,，")
        return ""

    document_no = match([
        r"(?:决定书文号|处罚决定书文号|文号|编号|决定书)[：: ]*([A-Z0-9一二三四五六七八九十()（）\-/]{4,})",
        r"\b([A-Z]{1,8}[（(]?[0-9]{2,}[）)]?[-/][0-9]{2,})\b",
    ])
    decision_date = match([
        r"(?:处罚日期|决定日期|发布日期|作出日期|日期)[：: ]*((?:19|20)\d{2}[-/.年]\d{1,2}[-/.月]\d{1,2}日?)",
        r"((?:19|20)\d{2}[-/.]\d{1,2}[-/.]\d{1,2})",
    ])
    authority = match([
        r"(中国证券监督管理委员会|中国证监会|上海证券交易所|深圳证券交易所|北京证券交易所|国家市场监督管理总局|市场监督管理局|工业和信息化部|地方证监局)",
    ])
    subject = str(item.get("company") or "").strip()
    if not subject:
        subject = match([r"(?:处罚对象|当事人|被处罚人|被处罚单位)[：: ]*([^，,。；;\n]{4,80})"])
    record = {
        "dataset_type": "regulatory_event",
        "subject_name": subject,
        "event_type": event_type,
        "decision_number": document_no,
        "authority": authority,
        "decision_date": decision_date or str(item.get("publish_date") or ""),
        "event_title": title,
        "source_url": str(item.get("url") or ""),
        "original_location": {"url": str(item.get("url") or ""), "quote": snippet[:300]},
        "source_date": decision_date or str(item.get("publish_date") or ""),
    }
    return record if any(record.get(key) for key in ("subject_name", "decision_number", "authority", "decision_date")) else {}


def _matches_target(value: str, company: str, aliases: list[str]) -> bool:
    compact = re.sub(r"\s+", "", value or "")
    candidates = [company, *aliases]
    return any(name and re.sub(r"\s+", "", name) in compact for name in candidates)


def normalize_date(value) -> str:
    text = str(value or "")
    match = re.search(r"(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})", text)
    if not match:
        return text
    return f"{match.group(1)}-{int(match.group(2)):02d}-{int(match.group(3)):02d}"


def parse_ifind_pdf_directory(doc: RawDocument) -> list[Evidence]:
    evidence = []
    for item in doc.content:
        company = item.get("company", "")
        pdf_path = item.get("local_path", "")
        try:
            extracted = extract_ifind_pdf(Path(pdf_path))
        except Exception as exc:
            evidence.append(
                Evidence(
                    company=company,
                    indicator="公司公告",
                    source_id=doc.source_id,
                    source_name=doc.source_name,
                    publish_date="",
                    fetched_at=doc.fetched_at,
                    url=pdf_path,
                    title=f"{item.get('file_name', '')} PDF结构化抽取失败",
                    snippet=str(exc)[:300],
                    value={"error": str(exc), "pdf_info": item.get("pdf_info", {})},
                    confidence=0.0,
                    tags=["ifind_pdf", "pdf_extract_error"],
                    needs_review=True,
                    review_reason="同花顺 PDF 结构化抽取失败，需要检查依赖或 PDF 内容",
                    source_type=doc.source_type,
                )
            )
            continue
        for section in extracted.get("sections", []):
            evidence.append(
                Evidence(
                    company=company or extracted.get("company", ""),
                    indicator=section["indicator"],
                    source_id=doc.source_id,
                    source_name=doc.source_name,
                    publish_date="",
                    fetched_at=doc.fetched_at,
                    url=pdf_path,
                    title=f"{item.get('file_name', '')} {section['section_type']}",
                    snippet=section["snippet"][:300],
                    value=section["value"],
                    confidence=section["confidence"],
                    tags=section["tags"],
                    needs_review=section["needs_review"],
                    review_reason=section["review_reason"],
                    source_type=doc.source_type,
                )
            )
            evidence.extend(ifind_section_to_structured_evidence(doc, item, extracted, section))
        if extracted.get("missing_fields"):
            evidence.append(
                Evidence(
                    company=company or extracted.get("company", ""),
                    indicator="公司公告",
                    source_id=doc.source_id,
                    source_name=doc.source_name,
                    publish_date="",
                    fetched_at=doc.fetched_at,
                    url=pdf_path,
                    title=f"{item.get('file_name', '')} 同花顺PDF缺失字段",
                    snippet="；".join(f"{row['module']}:{row['field_name']}" for row in extracted["missing_fields"])[:300],
                    value=extracted["missing_fields"],
                    confidence=0.6,
                    tags=["ifind_pdf", "missing_field"],
                    needs_review=True,
                    review_reason="同花顺 PDF 未识别到部分关键模块，需要人工确认是否未披露或抽取失败",
                    source_type=doc.source_type,
                )
            )
    return evidence


def parse_cninfo_periodic_report_pdfs(doc: RawDocument) -> list[Evidence]:
    evidence = []
    for item in doc.content if isinstance(doc.content, list) else []:
        company = item.get("company", "")
        pdf_path = Path(item.get("local_path", ""))
        source_name = item.get("source", "") or doc.source_name
        publish_date = timestamp_ms_to_date(item.get("publish_date")) if item.get("publish_date") else ""
        if item.get("download_status") != "ok" or not pdf_path.exists():
            error = item.get("download_error") or "PDF未下载或本地文件不存在"
            evidence.extend(evidence_from_exception(company, pdf_path or Path(item.get("title", "unknown.pdf")), Exception(error), source_name, publish_date, doc.fetched_at))
            continue
        try:
            fields = extract_financial_fields(pdf_path, include_text_fallback=bool(item.get("include_text_fallback", False)))
            sections = extract_annual_report_sections(pdf_path)
            evidence.extend(evidence_from_fields(company, pdf_path, fields, source_name, publish_date, doc.fetched_at))
            evidence.extend(evidence_from_financial_issues(company, pdf_path, fields, source_name, publish_date, doc.fetched_at))
            evidence.extend(evidence_from_sections(company, pdf_path, sections, source_name, publish_date, doc.fetched_at))
        except Exception as exc:
            evidence.extend(evidence_from_exception(company, pdf_path, exc, source_name, publish_date, doc.fetched_at))
    return evidence


def ifind_section_to_structured_evidence(doc: RawDocument, item: dict, extracted: dict, section: dict) -> list[Evidence]:
    section_type = section.get("section_type") or (section.get("value") or {}).get("section_type")
    value = section.get("value") if isinstance(section.get("value"), dict) else {}
    company = item.get("company") or extracted.get("company", "")
    pdf_path = item.get("local_path", "")
    file_name = item.get("file_name", "")
    mappers = {
        "customer": ifind_customer_records,
        "supplier": ifind_supplier_records,
        "person": ifind_person_records,
        "patent": ifind_patent_records,
        "litigation": ifind_litigation_records,
        "regulatory": ifind_regulatory_records,
        "company_profile": ifind_company_profile_records,
        "shareholder": annual_shareholder_records,
        "validation": annual_validation_records,
        "validation": annual_validation_records,
    }
    mapper = mappers.get(section_type)
    if not mapper:
        return []
    rows = mapper(value, company, pdf_path)
    evidence = []
    page_no = value.get("page_no") or section.get("page_no")
    for index, row in enumerate(rows, 1):
        dataset_type = row.pop("_dataset_type")
        publish_date = row.get("publish_date") or row.get("announcement_date") or row.get("decision_date") or row.get("application_date") or ""
        source_row_id = stable_hash([pdf_path, section_type, page_no, index, row.get("dedup_key", ""), row.get("raw_row_text", "")])
        item_payload = {
            "dataset_type": dataset_type,
            "provider": "ifind_pdf",
            "source_file": pdf_path,
            "source_row_id": source_row_id,
            "missing_fields": structured_missing_fields(dataset_type, row),
            "record": row,
            "derived_from": section_type,
            "source_location": {"page_no": page_no, "table_row_index": index},
        }
        for indicator, tags in structured_targets(dataset_type, row):
            evidence.append(
                Evidence(
                    company=company,
                    indicator=indicator,
                    source_id=doc.source_id,
                    source_name=doc.source_name,
                    publish_date=publish_date,
                    fetched_at=doc.fetched_at,
                    url=pdf_path,
                    title=f"{file_name} {section_type} structured row {index}",
                    snippet=structured_snippet(dataset_type, row),
                    value=item_payload,
                    confidence=0.7 if not item_payload["missing_fields"] else 0.58,
                    tags=[*tags, "ifind_pdf_derived", section_type],
                    needs_review=True,
                    review_reason="iFinD PDF 表格行自动派生为结构化记录，字段边界、主体匹配和金额口径需要人工复核",
                    source_type=doc.source_type,
                )
            )
    return evidence


def ifind_customer_records(section_value: dict, company: str, pdf_path: str) -> list[dict]:
    records = []
    for row in section_items(section_value):
        bidder = first_field(row, "中标单位", "成交供应商", "供应商", "中选单位")
        purchaser = first_field(row, "招标/采购单位", "采购单位", "招标单位", "客户")
        explicit_customer = first_field(row, "客户")
        project = first_field(row, "项目名称", "公告标题", "标题")
        amount_10k = first_number_field(row, "中标金额(万元)", "成交金额(万元)", "销售金额(万元)", "预算金额(万元)")
        row_text = compact_row_text(row)
        if not project and not explicit_customer:
            continue
        if explicit_customer and "销售金额" in row_text:
            counterparty = explicit_customer
        else:
            if not bidder:
                continue
            if company and not fuzzy_contains(bidder, company) and "宇树" not in compact_text(bidder) and "Unitree" not in bidder:
                continue
            counterparty = purchaser
        record = {
            "_dataset_type": "supplier_customer",
            "company": company,
            "role": "customer",
            "counterparty_name": clean_cell(counterparty),
            "project_name": clean_cell(project),
            "winning_bidder": clean_cell(bidder),
            "publish_date": clean_cell(first_field(row, "发布日期", "报告期/发布日期", "公告日期")),
            "province_region": clean_cell(first_field(row, "省份地区", "项目所属地区", "项目所属地 区")),
            "amount": amount_10k * 10000 if amount_10k is not None else None,
            "amount_unit": "CNY",
            "amount_original": clean_cell(first_field(row, "中标金额(万元)", "成交金额(万元)", "销售金额(万元)", "预算金额(万元)")),
            "raw_row": row,
        }
        record["dedup_key"] = stable_hash(["ifind_customer", record.get("project_name"), record.get("counterparty_name"), record.get("publish_date")])
        records.append(record)
    return dedupe_records(records, ["dedup_key"])


def ifind_supplier_records(section_value: dict, company: str, pdf_path: str) -> list[dict]:
    records = []
    for row in section_items(section_value):
        supplier = first_field(row, "供应商", "供应商名称", "采购供应商", "供货方")
        purchase_amount_10k = first_number_field(row, "采购金额(万元)", "采购额(万元)", "采购金额", "交易金额(万元)")
        country = first_field(row, "国家", "国家/地区", "国家或地区", "地区")
        if not supplier:
            continue
        row_text = compact_row_text(row)
        # iFinD occasionally labels bid/customer tables as supplier pages. Require real supplier fields.
        if "中标单位" in row or "招标/采购单位" in row or "项目名称" in row:
            continue
        record = {
            "_dataset_type": "supplier_customer",
            "company": company,
            "role": "supplier",
            "counterparty_name": clean_cell(supplier),
            "purchase_amount": purchase_amount_10k * 10000 if purchase_amount_10k is not None else None,
            "amount": purchase_amount_10k * 10000 if purchase_amount_10k is not None else None,
            "amount_unit": "CNY",
            "country_or_region": clean_cell(country),
            "purchase_ratio": first_number_field(row, "采购占比", "采购占比(%)", "采购比例(%)"),
            "raw_row": row,
            "raw_row_text": row_text,
        }
        record["dedup_key"] = stable_hash(["ifind_supplier", record.get("counterparty_name"), record.get("country_or_region"), record.get("purchase_amount")])
        records.append(record)
    return dedupe_records(records, ["dedup_key"])


def ifind_person_records(section_value: dict, company: str, pdf_path: str) -> list[dict]:
    records = []
    for row in section_items(section_value):
        person_name = first_field(row, "姓名", "姓名姓名")
        position = first_field(row, "职务", "职职务务", "任职类型")
        if not person_name or not position:
            continue
        if "股东名称" in row and not position:
            continue
        record = {
            "_dataset_type": "executive_profile",
            "company": company,
            "person_name": normalize_person_name(person_name),
            "position": clean_cell(position),
            "gender": clean_cell(first_field(row, "性别")),
            "education": clean_cell(first_field(row, "学历", "学历 出")),
            "birth_year": clean_cell(first_field(row, "出生年份", "生年份", "col_4")),
            "appointment_date": clean_cell(first_field(row, "任职日期")),
            "term_end_date": clean_cell(first_field(row, "届满日期")),
            "announcement_date": clean_cell(first_field(row, "公告日期", "公告日期 持股")),
            "shareholding_ratio": first_number_field(row, "持股比例(%)", "比例(%)", "持持股股比比例例((%%))"),
            "final_beneficial_share_ratio": first_number_field(row, "最终受益股份(%)", "最终受益股 份(%)", "最最终终受受益益股股份份((%%))"),
            "raw_row": row,
        }
        record["dedup_key"] = stable_hash(["ifind_person", record.get("person_name"), record.get("position"), record.get("appointment_date")])
        records.append(record)
    return dedupe_records(records, ["person_name", "position", "appointment_date"])


def ifind_patent_records(section_value: dict, company: str, pdf_path: str) -> list[dict]:
    records = []
    for row in section_items(section_value):
        patent_name = first_field(row, "专利名称")
        patent_number = first_field(row, "申请公布号", "专利号", "申请号", "公开号")
        if not patent_name or not patent_number:
            continue
        if "案号" in row or "案由" in row or "当事人" in row or "中标单位" in row:
            continue
        record = {
            "_dataset_type": "patent_structured",
            "company": company,
            "patent_number": clean_cell(patent_number),
            "patent_name": clean_cell(patent_name),
            "patent_type": clean_cell(first_field(row, "专利类型")),
            "inventors": clean_cell(first_field(row, "发明人")),
            "agency": clean_cell(first_field(row, "代理机构")),
            "abstract": clean_cell(first_field(row, "摘要")),
            "legal_status": clean_cell(first_field(row, "法律状态", "状态")),
            "application_date": clean_cell(first_field(row, "申请公布日", "申请日期")),
            "raw_row": row,
        }
        record["dedup_key"] = stable_hash(["ifind_patent", record.get("patent_number"), record.get("patent_name")])
        records.append(record)
    return dedupe_records(records, ["patent_number", "patent_name"])


def ifind_litigation_records(section_value: dict, company: str, pdf_path: str) -> list[dict]:
    records = []
    for row in section_items(section_value):
        case_no = first_field(row, "案号", "案件编号")
        cause = first_field(row, "案由")
        parties = first_field(row, "当事人")
        if not (case_no or cause or parties):
            continue
        record = {
            "_dataset_type": "related_entity",
            "company": company,
            "person_name": company,
            "related_entity_name": clean_cell(parties) or company,
            "relation_type": "litigation_party",
            "case_no": clean_cell(case_no),
            "case_cause": clean_cell(cause),
            "hearing_time": clean_cell(first_field(row, "开庭时间")),
            "judgment_date": clean_cell(first_field(row, "裁判日期")),
            "raw_row": row,
        }
        record["dedup_key"] = stable_hash(["ifind_litigation", record.get("case_no"), record.get("case_cause"), record.get("related_entity_name")])
        records.append(record)
    return dedupe_records(records, ["dedup_key"])


def ifind_regulatory_records(section_value: dict, company: str, pdf_path: str) -> list[dict]:
    records = []
    for row in section_items(section_value):
        title = first_field(row, "标题", "处罚决定书文号", "文书名称")
        agency = first_field(row, "处罚机关", "监管机构", "机关")
        decision_date = first_field(row, "处罚日期", "决定日期", "发布日期")
        if not (title or agency):
            continue
        record = {
            "_dataset_type": "related_entity",
            "company": company,
            "person_name": company,
            "related_entity_name": clean_cell(agency) or company,
            "relation_type": "regulatory_event",
            "event_title": clean_cell(title),
            "decision_date": clean_cell(decision_date),
            "raw_row": row,
        }
        record["dedup_key"] = stable_hash(["ifind_regulatory", record.get("event_title"), record.get("related_entity_name"), record.get("decision_date")])
        records.append(record)
    return dedupe_records(records, ["dedup_key"])


def ifind_company_profile_records(section_value: dict, company: str, pdf_path: str) -> list[dict]:
    if not any(section_value.get(key) for key in ["credit_code", "legal_representative", "registered_capital", "established_date"]):
        return []
    record = {
        "_dataset_type": "company_profile",
        "company": company,
        "company_name": company,
        "credit_code": section_value.get("credit_code", ""),
        "legal_representative": section_value.get("legal_representative", ""),
        "registered_capital": section_value.get("registered_capital", ""),
        "established_date": section_value.get("established_date", ""),
        "operating_status": section_value.get("operating_status", ""),
        "registered_address": section_value.get("registered_address", ""),
        "industry": section_value.get("industry", ""),
    }
    record["dedup_key"] = stable_hash(["ifind_company_profile", company, record.get("credit_code")])
    return [record]


def section_items(section_value: dict) -> list[dict]:
    return [row for row in section_value.get("items", []) if isinstance(row, dict)]


def clean_cell(value) -> str:
    text = re.sub(r"\s+", "", str(value or "").replace("--", "").strip())
    return text


def compact_text(value) -> str:
    return re.sub(r"\s+", "", str(value or ""))


def compact_row_text(row: dict) -> str:
    return " ".join(f"{key}:{value}" for key, value in row.items() if value)


def first_field(row: dict, *names: str):
    for name in names:
        if name in row and str(row.get(name, "")).strip() not in {"", "--"}:
            return row.get(name)
    for wanted in names:
        wanted_compact = compact_text(wanted)
        for key, value in row.items():
            if wanted_compact and wanted_compact in compact_text(key) and str(value or "").strip() not in {"", "--"}:
                return value
    return ""


def first_number_field(row: dict, *names: str):
    value = first_field(row, *names)
    if value in ("", None):
        return None
    text = str(value).replace(",", "")
    match = re.search(r"-?\d+(?:\.\d+)?", text)
    return float(match.group(0)) if match else None


def normalize_person_name(value) -> str:
    return clean_cell(value)


def fuzzy_contains(text: str, target: str) -> bool:
    left = compact_text(text)
    right = compact_text(target)
    if not left or not right:
        return False
    if right in left or left in right:
        return True
    short = right.replace("股份有限公司", "").replace("有限公司", "").replace("杭州", "")
    return bool(short and short in left)


def stable_hash(parts: list) -> str:
    joined = "|".join(str(part or "") for part in parts)
    return hashlib.sha1(joined.encode("utf-8")).hexdigest()[:16]


def dedupe_records(records: list[dict], fields: list[str]) -> list[dict]:
    seen = set()
    out = []
    for record in records:
        key = tuple(record.get(field) for field in fields)
        if key in seen:
            continue
        seen.add(key)
        out.append(record)
    return out


STRUCTURED_DATASET_MAP = {
    "equity_structure": [
        ("股权稀释程度", ["local_structured_dataset", "equity_structure", "shareholder"]),
    ],
    "test_result": [
        ("工程化与商业转化率", ["local_structured_dataset", "test_result", "third_party_test"]),
    ],
    "regulatory_event": [
        ("监管处罚次数", ["local_structured_dataset", "regulatory_event"]),
    ],
    "supplier_customer": [
        ("供应链进口依赖度", ["local_structured_dataset", "supplier_data", "customer_acceptance", "country_region", "supply_chain"]),
        ("工程化与商业转化率", ["local_structured_dataset", "customer_acceptance", "commercialization_event"]),
    ],
    "supplier_import_dependency": [
        ("供应链进口依赖度", ["local_structured_dataset", "supplier_import_dependency", "supplier_data", "country_region", "supply_chain"]),
    ],
    "business_segment": [
        ("海外业务收入占比", ["local_structured_dataset", "business_segment", "country_region"]),
        ("概念股标签关联度", ["local_structured_dataset", "business_segment"]),
    ],
    "patent_structured": [
        ("技术先进性-专利产出效率", ["local_structured_dataset", "patent_data", "patent_legal_status"]),
    ],
    "executive_profile": [
        ("高管关联风险暴露度", ["local_structured_dataset", "person_profile", "related_entity"]),
        ("高管稳定性", ["local_structured_dataset", "person_profile", "personnel_change"]),
    ],
    "related_entity": [
        ("高管关联风险暴露度", ["local_structured_dataset", "related_entity", "litigation_event", "regulatory_event"]),
    ],
    "peer_benchmark": [
        ("持续创新能力", ["local_structured_dataset", "peer_benchmark", "technology_update_event"]),
    ],
    "industry_percentile": [
        ("持续创新能力", ["local_structured_dataset", "peer_benchmark"]),
    ],
    "sanction_export": [
        ("出口管制与制裁暴露度", ["local_structured_dataset", "sanction_list"]),
    ],
    "controlled_component": [
        ("出口管制与制裁暴露度", ["local_structured_dataset", "controlled_component", "supply_chain"]),
    ],
    "bom_sbom": [
    ],
    "license_data": [
    ],
    "third_party_test": [
    ],
    "test_result": [
    ],
}


def parse_local_structured_dataset(doc: RawDocument) -> list[Evidence]:
    evidence = []
    for item in doc.content if isinstance(doc.content, list) else []:
        record = item.get("record", {}) if isinstance(item, dict) else {}
        if not isinstance(record, dict):
            continue
        dataset_type = item.get("dataset_type") or record.get("dataset_type") or "unknown"
        validation_errors = item.get("validation_errors", [])
        if validation_errors:
            continue
        targets = structured_targets(dataset_type, record)
        for indicator, tags in targets:
            missing = structured_missing_fields(dataset_type, record)
            confidence = 0.82 if item.get("provider") else 0.72
            evidence.append(
                Evidence(
                    company=item.get("company") or record.get("company") or record.get("company_name") or "",
                    indicator=indicator,
                    source_id=doc.source_id,
                    source_name=doc.source_name,
                    publish_date=item.get("publish_date", ""),
                    fetched_at=doc.fetched_at,
                    url=item.get("url", "") or item.get("source_file", ""),
                    title=item.get("title", "") or f"{dataset_type} structured record",
                    snippet=structured_snippet(dataset_type, record),
                    value={
                        "dataset_type": dataset_type,
                        "provider": item.get("provider", ""),
                        "source_file": item.get("source_file", ""),
                        "source_row_id": item.get("source_row_id", ""),
                        "missing_fields": missing,
                        "record": record,
                    },
                    confidence=confidence if not missing else min(confidence, 0.65),
                    tags=[tag for tag in tags if tag],
                    needs_review=item.get("review_required", True) or bool(missing),
                    review_reason=structured_review_reason(dataset_type, missing),
                    source_type=doc.source_type,
                )
            )
    return evidence


def structured_targets(dataset_type: str, record: dict) -> list[tuple[str, list[str]]]:
    override = record.get("indicator")
    if override:
        return [(override, ["local_structured_dataset", dataset_type])]
    targets = STRUCTURED_DATASET_MAP.get(dataset_type, [("公司公告", ["local_structured_dataset", dataset_type])])
    role = str(record.get("role") or record.get("data_role") or "").lower()
    if dataset_type == "supplier_customer":
        if "supplier" in role:
            return [targets[0]]
        if "customer" in role:
            return [targets[1]]
    return targets


def structured_missing_fields(dataset_type: str, record: dict) -> list[str]:
    required = {
        "supplier_customer": ["counterparty_name", "role"],
        "supplier_import_dependency": ["report_period", "supplier_name", "supplier_country", "supplier_role", "purchase_amount", "purchase_amount_unit", "import_status", "supplier_scope"],
        "business_segment": ["segment_name", "revenue"],
        "patent_structured": ["patent_number", "patent_name"],
        "executive_profile": ["person_name", "position"],
        "related_entity": ["person_name", "related_entity_name"],
        "peer_benchmark": ["metric_name", "company_value", "percentile"],
        "industry_percentile": ["metric_name", "percentile"],
        "sanction_export": ["list_name", "matched_name"],
        "controlled_component": ["component_name", "country_or_region"],
        "bom_sbom": ["component_name", "supplier_name", "evidence_url", "original_location"],
        "license_data": ["technology_or_component", "licensor", "evidence_url", "original_location"],
        "third_party_test": ["test_organization", "report_number", "test_standard", "evidence_url", "original_location"],
        "test_result": ["report_number", "test_item", "result_status", "evidence_url", "original_location"],
        "equity_structure": ["subject_name", "subject_role", "report_date", "shareholding_ratio", "ownership_type", "evidence_url", "original_location"],
        "regulatory_event": ["subject_name", "event_type", "decision_number", "authority", "decision_date", "evidence_url", "original_location"],
    }.get(dataset_type, [])
    return [field for field in required if not record.get(field)]


def annual_shareholder_records(section_value: dict, company: str, pdf_path: str) -> list[dict]:
    """Normalize shareholder tables without guessing who the controller is."""
    records = []
    for row in section_items(section_value):
        name = first_field(row, "股东名称", "股东", "名称", "实际控制人", "控股股东")
        role = ""
        if any(term in json.dumps(row, ensure_ascii=False) for term in ("实际控制人", "实控人")):
            role = "actual_controller"
        elif any(term in json.dumps(row, ensure_ascii=False) for term in ("控股股东", "第一大股东")):
            role = "controlling_shareholder"
        else:
            role = "shareholder"
        ratio = first_number_field(row, "持股比例(%)", "持股比例", "股权比例(%)", "股份比例(%)", "持股比")
        if not name and ratio is None:
            continue
        records.append({
            "_dataset_type": "equity_structure",
            "subject_name": name,
            "subject_role": role,
            "report_date": first_field(row, "报告期", "报告期末", "截止日期", "公告日期"),
            "shareholding_ratio": ratio,
            "ownership_type": "unknown",
            "evidence_url": pdf_path,
            "original_location": json.dumps({"page_no": section_value.get("page_no"), "table_index": section_value.get("table_index"), "row": row.get("_row_index")}, ensure_ascii=False),
            "raw_row": row,
        })
    return records


def annual_validation_records(section_value: dict, company: str, pdf_path: str) -> list[dict]:
    """Map annual-report validation rows as candidates; missing audit fields stay missing."""
    records = []
    for row in section_items(section_value):
        text = json.dumps(row, ensure_ascii=False)
        if not any(term in text for term in ("测试", "检测", "认证", "验证", "验收")):
            continue
        records.append({
            "_dataset_type": "test_result",
            "report_number": first_field(row, "报告编号", "报告号", "检测报告编号", "测试报告编号"),
            "product_name": first_field(row, "产品名称", "产品", "项目名称", "技术名称"),
            "test_item": first_field(row, "测试项目", "检测项目", "验证项目", "项目"),
            "test_standard": first_field(row, "测试标准", "检测标准", "标准"),
            "test_condition": first_field(row, "测试条件", "工况", "条件"),
            "result_status": first_field(row, "结果", "测试结果", "检测结果", "结论", "状态"),
            "test_date": first_field(row, "测试日期", "检测日期", "验证日期", "日期"),
            "test_organization": first_field(row, "测试机构", "检测机构", "认证机构", "机构"),
            "evidence_url": pdf_path,
            "original_location": json.dumps({"page_no": section_value.get("page_no"), "table_index": section_value.get("table_index"), "row": row.get("_row_index")}, ensure_ascii=False),
            "raw_row": row,
        })
    return records


def annual_validation_records(section_value: dict, company: str, pdf_path: str) -> list[dict]:
    """Map annual-report validation rows as candidates; missing audit fields stay missing."""
    records = []
    for row in section_items(section_value):
        text = json.dumps(row, ensure_ascii=False)
        if not any(term in text for term in ("测试", "检测", "认证", "验证", "验收")):
            continue
        records.append({
            "_dataset_type": "test_result",
            "report_number": first_field(row, "报告编号", "报告号", "检测报告编号", "测试报告编号"),
            "product_name": first_field(row, "产品名称", "产品", "项目名称", "技术名称"),
            "test_item": first_field(row, "测试项目", "检测项目", "验证项目", "项目"),
            "test_standard": first_field(row, "测试标准", "检测标准", "标准"),
            "test_condition": first_field(row, "测试条件", "工况", "条件"),
            "result_status": first_field(row, "结果", "测试结果", "检测结果", "结论", "状态"),
            "test_date": first_field(row, "测试日期", "检测日期", "验证日期", "日期"),
            "test_organization": first_field(row, "测试机构", "检测机构", "认证机构", "机构"),
            "evidence_url": pdf_path,
            "original_location": json.dumps({"page_no": section_value.get("page_no"), "table_index": section_value.get("table_index"), "row": row.get("_row_index")}, ensure_ascii=False),
            "raw_row": row,
        })
    return records


def structured_snippet(dataset_type: str, record: dict) -> str:
    preferred = [
        "company",
        "company_name",
        "counterparty_name",
        "person_name",
        "related_entity_name",
        "patent_number",
        "patent_name",
        "product_name",
        "technology_route",
        "metric_name",
        "percentile",
        "revenue",
        "amount",
        "country_or_region",
        "list_name",
        "matched_name",
    ]
    compact = {key: record.get(key) for key in preferred if record.get(key) not in (None, "")}
    if not compact:
        compact = {key: value for key, value in list(record.items())[:12]}
    return f"{dataset_type}: " + json.dumps(compact, ensure_ascii=False)[:260]


def structured_review_reason(dataset_type: str, missing: list[str]) -> str:
    reason = "结构化授权数据导入后仍需确认来源授权、主体匹配和统计口径"
    if missing:
        reason += "；缺失字段：" + "、".join(missing)
    if dataset_type in {"supplier_customer", "supplier_import_dependency", "patent_structured", "executive_profile", "related_entity", "peer_benchmark", "industry_percentile"}:
        reason += "；该类数据是当前核心缺口，进入人工复核后再作为硬计分输入"
    return reason


PARSERS = {
    "exchange_inquiry": parse_exchange_inquiry,
    "financial_report": parse_financial_report,
    "news_event": parse_news_event,
    "tech_evidence": parse_tech_evidence,
    "sse_bulletin": parse_sse_bulletin,
    "sse_regulatory_measures": parse_sse_regulatory_measures,
    "sse_static_stock": parse_sse_static_stock,
    "cninfo_announcements": parse_cninfo_announcements,
    "cninfo_periodic_report_pdfs": parse_cninfo_periodic_report_pdfs,
    "rss_news": parse_rss_news,
    "investor_qa_text": parse_investor_qa_text,
    "regulatory_text": parse_regulatory_text,
    "recall_text": parse_recall_text,
    "litigation_text": parse_litigation_text,
    "patent_text": parse_patent_text,
    "official_court_announcements": parse_official_court_announcements,
    "qichacha_records": parse_qichacha_records,
    "tianyancha_records": parse_tianyancha_records,
    "mcp_records": parse_mcp_records,
    "bse_announcements": parse_bse_announcements,
    "szse_announcements": parse_szse_announcements,
    "official_announcement_text": parse_official_announcement_text,
    "openalex_works": parse_openalex_works,
    "paper_works": parse_paper_works,
    "screening_list": parse_screening_list,
    "us_export_control_official": parse_us_export_control_official,
    "ifind_pdf_directory": parse_ifind_pdf_directory,
    "local_structured_dataset": parse_local_structured_dataset,
}


def _mcp_indicator_from_dataset(dataset_type: str) -> str:
    dataset_type = dataset_type.lower()
    if "news" in dataset_type or "headline" in dataset_type:
        return "叙事热度基本面背离度"
    if "announcement" in dataset_type or "bulletin" in dataset_type:
        return "公司公告"
    if "financial" in dataset_type or "income" in dataset_type:
        return "营收增长率"
    if "risk" in dataset_type or "regulatory" in dataset_type:
        return "监管处罚次数"
    if "person" in dataset_type or "executive" in dataset_type or "holder" in dataset_type:
        return "高管关联风险暴露度"
    if "patent" in dataset_type:
        return "技术先进性-专利产出效率"
    return "公司公告"
