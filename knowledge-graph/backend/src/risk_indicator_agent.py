"""Risk indicator processing, calculation and coverage on top of audited evidence.

The workbook-derived contract is data, not prompt text.  This module only
calculates a risk score when the required evidence fields are present; absent
industry benchmarks, numerator/denominator fields or text comparison samples
produce an explicit pending result rather than a fabricated score.
"""

from __future__ import annotations

import json
import math
import re
import sqlite3
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from .database import connect, init_db, insert_many_evidence, insert_score, load_indicator_requirements
from .models import Evidence, IndicatorScore
from .text_derived_evidence import derive_text_evidence
from .text_processing import normalize_text, self_similarity_score


CONTRACT_PATH = Path(__file__).resolve().parents[1] / "config" / "risk_indicator_contracts_20260813.json"

TAG_MAP = {
    "financial_numeric": {"financial_numeric", "financial_pdf", "financial_structured"},
    "market_numeric": {"market_numeric", "market_data", "ifind_stock"},
    "text_news": {"text_news", "news", "negative_news"},
    "text_investor_qa": {"text_investor_qa", "investor_qa"},
    "text_company_disclosure": {"text_company_disclosure", "company_disclosure_text", "company_announcement", "periodic_report"},
    "text_third_party": {"text_third_party", "text_news", "news", "web_text"},
    "dictionary_match": {"dictionary_match"},
    "embedding_vector": {"embedding_vector"},
    "business_segment": {"business_segment", "main_business", "主营构成"},
    "regulatory_event": {"regulatory_event", "regulatory", "penalty", "行政处罚"},
    "exchange_inquiry_event": {"exchange_inquiry_event", "inquiry", "问询"},
    "company_announcement": {"company_announcement", "cninfo_announcement", "sse_static_stock", "periodic_report"},
    "litigation_event": {"litigation_event", "litigation", "court", "裁判文书"},
    "supplier_data": {"supplier_data", "supplier", "供应商"},
    "country_region": {"country_region", "region", "country"},
    "sanction_list": {"sanction_list", "sanction", "screening_list", "export_control"},
    "controlled_component": {"controlled_component", "export_control"},
    "equity_structure": {"equity_structure", "shareholder", "股权"},
    "person_profile": {"person_profile", "person", "executive"},
    "related_entity": {"related_entity", "executive_related"},
    "negative_news": {"negative_news", "text_news", "news"},
    "personnel_change": {"personnel_change", "executive_change", "离职"},
    "patent_data": {"patent_data", "patent", "专利", "intellectual_property"},
}

EXAGGERATION_TERMS = ("国际领先", "世界首创", "全球领先", "行业第一", "颠覆性", "自主可控", "全面领先", "不可替代")
MILESTONE_DONE = ("完成", "通过验收", "量产", "客户验证", "投产", "正式上线", "完成交付")
MILESTONE_DELAY = ("延期", "推迟", "未完成", "取消", "终止")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _clamp(value: float) -> float:
    return round(max(0.0, min(1.0, float(value))), 6)


def _safe_json(text: str) -> Any:
    try:
        return json.loads(text) if text else None
    except json.JSONDecodeError:
        return text


def _number(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        match = re.search(r"-?\d+(?:\.\d+)?", value.replace(",", ""))
        return float(match.group()) if match else None
    return None


def _parse_date(value: str) -> datetime | None:
    """Parse an evidence date without silently treating an unknown date as now."""
    match = re.match(r"(\d{4})-(\d{1,2})-(\d{1,2})", value or "")
    if not match:
        return None
    try:
        return datetime(int(match.group(1)), int(match.group(2)), int(match.group(3)), tzinfo=timezone.utc)
    except ValueError:
        return None


def load_contracts(path: Path = CONTRACT_PATH) -> dict[str, Any]:
    return json.loads(Path(path).read_text(encoding="utf-8-sig"))


def _row_to_evidence(row: sqlite3.Row) -> Evidence:
    return Evidence(
        company=row["company"], indicator=row["indicator"], source_id=row["source_key"],
        source_name=row["source_name"], publish_date=row["publish_date"], fetched_at=row["fetched_at"],
        url=row["url"], title=row["title"], snippet=row["snippet"], value=_safe_json(row["value_json"]),
        confidence=float(row["confidence"]), tags=_safe_json(row["tags_json"]) or [],
        needs_review=bool(row["needs_review"]), review_reason=row["review_reason"], source_type=row["source_type"],
    )


class RiskIndicatorAgent:
    def __init__(self, db_path: Path, contracts_path: Path = CONTRACT_PATH):
        self.db_path = Path(db_path)
        self.contracts_path = Path(contracts_path)
        self.contracts = load_contracts(self.contracts_path)

    def run(self, *, run_id: str, company: str = "", derive_text: bool = True) -> dict[str, Any]:
        conn = connect(self.db_path)
        try:
            init_db(conn)
            load_indicator_requirements(conn, self.contracts_path)
            companies = self._companies(conn, company)
            summary = {"run_id": run_id, "companies": [], "contract_version": self.contracts["version"]}
            for company_row in companies:
                evidence = self._evidence(conn, company_row["id"])
                derived_count = 0
                if derive_text:
                    derived = self._map_derived_evidence(derive_text_evidence(evidence))
                    if derived:
                        derived_count = insert_many_evidence(conn, derived, run_id=run_id)
                        conn.commit()
                        evidence = self._evidence(conn, company_row["id"])
                result = self._process_company(conn, company_row, evidence, run_id)
                result["derived_evidence_inserted"] = derived_count
                summary["companies"].append(result)
            conn.commit()
            return summary
        finally:
            conn.close()

    def _companies(self, conn, company: str):
        if not company:
            return conn.execute("SELECT * FROM companies ORDER BY name").fetchall()
        exact = conn.execute("SELECT * FROM companies WHERE name = ?", (company,)).fetchone()
        if exact:
            return [exact]
        rows = conn.execute("SELECT * FROM companies WHERE name LIKE '%' || ? || '%' ORDER BY LENGTH(name)", (company,)).fetchall()
        if len(rows) == 1:
            return rows
        if not rows:
            raise ValueError(f"company not found: {company}")
        raise ValueError(f"company is ambiguous: {company}; use full name")

    def _evidence(self, conn, company_id: int) -> list[Evidence]:
        rows = conn.execute(
            """
            SELECT e.*, c.name AS company, i.name AS indicator, s.source_key, s.name AS source_name, s.source_type
            FROM evidence e
            JOIN companies c ON c.id=e.company_id
            JOIN indicators i ON i.id=e.indicator_id
            JOIN sources s ON s.id=e.source_id
            WHERE e.company_id=?
            ORDER BY e.publish_date, e.id
            """, (company_id,)
        ).fetchall()
        return [_row_to_evidence(row) for row in rows]

    def _map_derived_evidence(self, evidence: list[Evidence]) -> list[Evidence]:
        alias_map = {alias: item["indicator"] for item in self.contracts["indicators"] for alias in item.get("aliases", [])}
        mapped = []
        for item in evidence:
            target = alias_map.get(item.indicator)
            if not target:
                continue
            item.indicator = target
            mapped.append(item)
        return mapped

    def _process_company(self, conn, company, evidence: list[Evidence], run_id: str) -> dict[str, Any]:
        scores = []
        coverage = []
        for contract in self.contracts["indicators"]:
            matched = self._matched(contract, evidence)
            source_status, detail = self._coverage(contract, matched, evidence)
            score = self._calculate(contract, matched, evidence, source_status)
            calculation_status = self._calculation_status(score, source_status)
            detail.update({
                "indicator": contract["indicator"],
                "source_coverage_status": source_status,
                "calculation_status": calculation_status,
                "calculation_reason": score.reason,
            })
            coverage.append(detail)
            score.company = company["name"]
            insert_score(conn, score, run_id)
            scores.append(score)
        report_path = self._write_coverage_report(company["name"], run_id, coverage, scores)
        return {
            "company": company["name"], "score_count": len(scores),
            "scored_count": sum(score.score is not None for score in scores),
            "coverage": self._coverage_summary(coverage), "coverage_report": str(report_path),
        }

    def _matched(self, contract, evidence):
        aliases = set(contract.get("aliases", [])) | {contract["indicator"]}
        return [item for item in evidence if item.indicator in aliases]

    def _coverage(self, contract, matched, evidence):
        """Coverage measures source availability only, never formula readiness."""
        requirements = contract.get("required_data_types", [])
        seen = {tag for item in evidence for tag in item.tags}
        available = []
        missing = []
        for requirement in requirements:
            tags = TAG_MAP.get(requirement, {requirement})
            if seen.intersection(tags):
                available.append(requirement)
            else:
                missing.append(requirement)
        direct = len(matched)
        if requirements and not missing and direct:
            status = "covered"
        elif available or direct:
            status = "partial"
        else:
            status = "missing"
        review_count = sum(1 for item in matched if item.needs_review or item.confidence < 0.6)
        return status, {"required_data_types": requirements, "available_data_types": available, "missing_data_types": missing, "matched_evidence_count": direct, "review_evidence_count": review_count}

    def _calculation_status(self, score: IndicatorScore, source_status: str) -> str:
        if score.score is not None:
            return "review_required" if score.needs_review else "calculated"
        if "同业基准" in score.reason or "IPC" in score.reason:
            return "pending_benchmark"
        if source_status == "missing":
            return "pending_source"
        return "pending_fields"

    def _calculate(self, contract, matched, evidence, coverage_status):
        method = contract["method"]
        raw, score, reason, calculation = self._method_result(method, contract, matched, evidence)
        needs_review = bool(contract.get("review_required")) or coverage_status != "covered"
        if score is None:
            level = "待补数"
            needs_review = True
        else:
            if calculation.get("sequential_period_proxy"):
                needs_review = True
            level = "高风险" if score >= 0.7 else "中风险" if score >= 0.4 else "低风险"
        calculation.update({"method": method, "source_coverage_status": coverage_status, "contract_version": self.contracts["version"], "entity_type": contract["entity_type"], "relation": contract["relation"]})
        return IndicatorScore("", contract["indicator"], raw, score, level, len(matched), needs_review, reason, calculation=calculation, is_red_flag=bool(contract.get("is_red_flag")))

    def _method_result(self, method, contract, matched, evidence):
        if method == "event_count":
            events, excluded = self._current_window_events(contract, matched)
            if not events:
                return None, None, "当前统计窗口内没有可确认日期的有效事件；不以全量历史材料代替当期事件数", {"window": self._event_window_label(contract), "excluded_undated_or_non_event": excluded}
            return len(events), _clamp(len(events) / float(contract["threshold"])), "按当前统计窗口内去重后的可追溯事件数量与合同阈值归一化", {"event_count": len(events), "threshold": contract["threshold"], "window": self._event_window_label(contract), "deduplicated": True, "excluded_undated_or_non_event": excluded}
        if method == "severity_events":
            events, excluded = self._current_window_events(contract, matched)
            if not events:
                return None, None, "最近三年内没有可确认日期的重大技术或知识产权事件；不以历史材料代替三年事件指数", {"window": self._event_window_label(contract), "excluded_undated_or_non_event": excluded}
            values = []
            red_flag = False
            for item in events:
                payload = item.value if isinstance(item.value, dict) else {}
                weight = _number(payload.get("severity_weight")) or _number(payload.get("weight")) or 1.0
                values.append(weight)
                text = f"{item.title} {item.snippet}"
                if any(term in text for term in ("强制召回", "伤亡", "核心系统失控", "重大数据泄露", "核心专利无效")):
                    red_flag = True
            total = sum(values)
            return total, 1.0 if red_flag else _clamp(total / float(contract["threshold"])), "红旗事件直接触发；其他事件按最近三年去重后的严重度权重归一化", {"severity_total": total, "red_flag": red_flag, "threshold": contract["threshold"], "window": self._event_window_label(contract), "deduplicated": True, "excluded_undated_or_non_event": excluded}
        if method == "narrative_consistency":
            docs = [self._text(item) for item in evidence if "text_company_disclosure" in item.tags and self._text(item)]
            if len(docs) < 2:
                return None, None, "至少需要两期公司披露文本，当前无法计算跨期一致性", {"document_count": len(docs)}
            similarity = self_similarity_score(docs[-4:])
            return similarity, _clamp(1 - similarity), "风险分=1-跨期文本自相似度", {"document_count": len(docs[-4:]), "consistency_score": similarity}
        if method == "statement_gap":
            company_docs = [self._text(item) for item in evidence if "text_company_disclosure" in item.tags]
            third_docs = [self._text(item) for item in evidence if set(item.tags).intersection(TAG_MAP["text_third_party"])]
            company_text, third_text = "\n".join(company_docs), "\n".join(third_docs)
            if not company_text or not third_text:
                return None, None, "需要公司披露与第三方文本两个样本池，当前样本不足", {"company_docs": len(company_docs), "third_docs": len(third_docs)}
            a, b = self._term_density(company_text), self._term_density(third_text)
            gap = abs(a - b)
            return gap, _clamp(gap / float(contract["threshold"])), "风险分=夸张性词密度绝对差/合同阈值", {"company_density": a, "third_party_density": b, "threshold": contract["threshold"]}
        if method == "milestone_completion":
            text = "\n".join(self._text(item) for item in matched)
            done = sum(text.count(term) for term in MILESTONE_DONE)
            delayed = sum(text.count(term) for term in MILESTONE_DELAY)
            if not (done or delayed):
                return None, None, "未抽取到明确完成、延期或取消里程碑", {"completed_mentions": done, "delay_mentions": delayed}
            completion = done / (done + delayed)
            return completion, _clamp(1 - completion), "风险分=1-文本可识别里程碑兑现率；需结合项目权重复核", {"completed_mentions": done, "delay_mentions": delayed}
        if method == "narrative_divergence":
            periods = defaultdict(lambda: {"news": 0, "qa": 0, "revenue_growth": None})
            for item in evidence:
                period = self._quarter(item.publish_date)
                if not period:
                    continue
                if "text_news" in item.tags:
                    periods[period]["news"] += 1
                if "text_investor_qa" in item.tags:
                    periods[period]["qa"] += 1
                if item.indicator in {"营业收入增长率"}:
                    value = _number(item.value)
                    if value is not None:
                        periods[period]["revenue_growth"] = value / 100 if abs(value) > 1 else value
            usable = [(key, value) for key, value in sorted(periods.items()) if value["revenue_growth"] is not None]
            if len(usable) < 2:
                return None, None, "至少需要两个季度的叙事文本计数和营业收入同比数据", {"usable_quarters": len(usable)}
            previous, current = usable[-2], usable[-1]
            dtq_prev = math.log(previous[1]["news"] + previous[1]["qa"] + 1)
            dtq_now = math.log(current[1]["news"] + current[1]["qa"] + 1)
            divergence = (dtq_now - dtq_prev) - current[1]["revenue_growth"]
            return divergence, _clamp(max(0, divergence) / float(contract["threshold"])), "风险分=正向叙事增速与营收同比背离/合同阈值", {"period": current[0], "dtq_growth": dtq_now - dtq_prev, "revenue_growth": current[1]["revenue_growth"], "threshold": contract["threshold"]}
        if method == "patent_quality":
            citations, families = 0.0, 0.0
            for item in matched:
                payload = item.value if isinstance(item.value, dict) else {}
                citations += _number(payload.get("forward_citations")) or _number(payload.get("citation_count")) or 0.0
                families += _number(payload.get("family_count")) or (1.0 if "patent" in item.tags else 0.0)
            if families <= 0:
                return None, None, "缺少有效专利族与去自引前向被引字段", {"families": families, "citations": citations}
            quality = citations / families
            return quality, None, "已计算专利质量原始值；仍需IPC小类×申请年份同业基准后才能映射风险分", {"quality_index": quality, "families": families, "citations": citations}
        if method == "rd_intensity":
            fields = self._financial_fields(matched)
            revenue, rd_expense = fields.get("revenue"), fields.get("rd_expense")
            if not revenue or rd_expense is None:
                return None, None, "缺少同口径本期研发费用和营业收入字段", {"available_fields": sorted(fields)}
            intensity = rd_expense / revenue
            return intensity, _clamp((float(contract["threshold"]) - intensity) / float(contract["threshold"])), "风险分按研发投入强度低于合同阈值的程度映射；近三年趋势仍需后续时间序列复核", {"rd_expense": rd_expense, "revenue": revenue, "rd_intensity": intensity, "threshold": contract["threshold"]}
        if method == "cash_debt":
            fields = self._financial_fields(matched)
            cash = (fields.get("cash_and_equivalents") or 0.0) + (fields.get("trading_financial_assets") or 0.0)
            short_debt = (fields.get("short_term_borrowing") or 0.0) + (fields.get("current_portion_noncurrent_liabilities") or 0.0)
            operating_cash_flow = fields.get("operating_cash_flow")
            if cash <= 0 or short_debt <= 0 or operating_cash_flow is None:
                return None, None, "缺少货币资金/交易性金融资产、短期借款/一年内到期负债或经营现金流字段", {"available_fields": sorted(fields)}
            cash_debt_ratio = cash / short_debt
            cashflow_coverage = operating_cash_flow / short_debt
            risk = _clamp(max(0.0, 1 - min(cash_debt_ratio, 1.0), 1 - min(max(cashflow_coverage, 0.0), 1.0)))
            return {"cash_short_debt_ratio": cash_debt_ratio, "operating_cashflow_coverage": cashflow_coverage}, risk, "采用现金短债比与经营现金流覆盖率的较弱项映射；近8季度趋势仍待补齐", {"cash": cash, "short_debt": short_debt, "operating_cash_flow": operating_cash_flow, "cash_short_debt_ratio": cash_debt_ratio, "operating_cashflow_coverage": cashflow_coverage}
        if method == "revenue_growth":
            fields = self._financial_fields(matched)
            current, prior = fields.get("revenue"), fields.get("revenue_prior")
            explicit_growth = fields.get("revenue_growth")
            if explicit_growth is None:
                explicit_growth = self._latest_numeric(matched)
            series = self._financial_field_series(matched, "revenue")
            if explicit_growth is not None:
                growth = explicit_growth / 100 if abs(explicit_growth) > 1 else explicit_growth
            elif current is not None and prior not in (None, 0):
                growth = (current - prior) / prior
            elif len(series) >= 2 and series[-2][1] != 0:
                # This is a sequential-period growth proxy, not an annual YoY
                # rate. It remains reviewable until comparable-year period tags
                # are emitted by the upstream financial extractor.
                prior, current = series[-2][1], series[-1][1]
                growth = (current - prior) / prior
            else:
                return None, None, "缺少本期及上年同期营收，或经字段校验的营收同比", {"available_fields": sorted(fields)}
            return growth, _clamp(-growth / 0.20), "负增长按20%风险带映射；若使用相邻披露期营收，需人工确认其与上年同期可比；同业分位接入后可替换为正式IRAWC映射", {"growth": growth, "current_revenue": current, "prior_revenue": prior, "explicit_growth": explicit_growth, "revenue_series_dates": [date for date, _ in series[-2:]], "sequential_period_proxy": explicit_growth is None and fields.get("revenue_prior") is None, "risk_band": 0.20}
        if method == "ratio":
            ratio_result = self._contract_ratio(contract, matched)
            if ratio_result is not None:
                raw, components = ratio_result
                return raw, _clamp(raw / float(contract["threshold"])), "按合同字段分子/分母计算的比率，并以合同阈值作过渡映射", components | {"threshold": contract["threshold"]}
            return None, None, "缺少经字段校验的分子/分母或结构化比率原始值", {"available_fields": sorted(self._financial_fields(matched))}
        if method in {"inverse_ratio", "control_stability", "litigation", "sanctions"}:
            value = self._latest_numeric(matched)
            if value is None:
                return None, None, "缺少经字段校验的分子/分母或结构化原始值", {"matched_evidence_count": len(matched)}
            threshold = float(contract["threshold"])
            if method in {"inverse_ratio", "rd_intensity", "cash_debt", "control_stability"}:
                risk = _clamp((threshold - value) / max(threshold, 1e-9))
            elif method == "litigation":
                risk = _clamp(value / threshold)
            else:
                risk = _clamp(value / threshold)
            return value, risk, "按合同阈值对已验证结构化原始值归一化；同业分位接入后可替换为正式IRAWC映射", {"raw_value": value, "threshold": threshold}
        return None, None, f"未实现的计算方法：{method}", {}

    def _latest_numeric(self, evidence):
        candidates = []
        for item in evidence:
            # Imported workbook observations retain their row payload in a
            # dictionary; only their explicitly labelled direct_value can be
            # treated as a scalar indicator input.  This avoids mistaking an
            # arbitrary number in a source record for a scoreable metric.
            value = _number(item.value)
            if value is None and isinstance(item.value, dict):
                value = _number(item.value.get("direct_value"))
            if value is not None and item.confidence >= 0.6:
                candidates.append((item.publish_date or item.fetched_at, value))
        return sorted(candidates)[-1][1] if candidates else None

    def _event_window_label(self, contract) -> str:
        frequency = contract.get("update_frequency", "")
        if "季度" in frequency:
            return "最近自然季度"
        if "三年" in contract.get("calculation_rule", ""):
            return "最近三年"
        return "最近365天"

    def _event_window_start(self, contract, dated: list[tuple[datetime, Evidence]]) -> datetime:
        latest = max(date for date, _ in dated)
        if "季度" in contract.get("update_frequency", ""):
            month = ((latest.month - 1) // 3) * 3 + 1
            return latest.replace(month=month, day=1, hour=0, minute=0, second=0, microsecond=0)
        if "三年" in contract.get("calculation_rule", ""):
            return latest - timedelta(days=365 * 3)
        return latest - timedelta(days=365)

    def _is_event_evidence(self, contract, item: Evidence) -> bool:
        if item.confidence < 0.6:
            return False
        required = set(contract.get("required_data_types", []))
        if contract["indicator"] == "高管关联风险暴露度":
            event_tags = TAG_MAP["regulatory_event"] | TAG_MAP["litigation_event"] | TAG_MAP["negative_news"]
            return bool(set(item.tags).intersection(event_tags))
        return bool(set(item.tags).intersection(set().union(*(TAG_MAP.get(tag, {tag}) for tag in required))))

    def _event_fingerprint(self, item: Evidence) -> str:
        payload = item.value if isinstance(item.value, dict) else {}
        for key in ("event_id", "case_number", "document_number", "decision_number", "公告编号"):
            if payload.get(key):
                return f"{key}:{payload[key]}"
        text = normalize_text(" ".join((item.url, item.title, item.snippet)))
        return text[:500] or f"untitled:{item.publish_date}:{item.source_id}"

    def _current_window_events(self, contract, matched: list[Evidence]) -> tuple[list[Evidence], int]:
        dated = [(date, item) for item in matched if self._is_event_evidence(contract, item) for date in [_parse_date(item.publish_date)] if date]
        excluded = len(matched) - len(dated)
        if not dated:
            return [], excluded
        start = self._event_window_start(contract, dated)
        fingerprints = set()
        result = []
        for date, item in sorted(dated, key=lambda pair: pair[0], reverse=True):
            if date < start:
                continue
            fingerprint = self._event_fingerprint(item)
            if fingerprint in fingerprints:
                continue
            fingerprints.add(fingerprint)
            result.append(item)
        return result, excluded

    def _walk_fields(self, value: Any):
        if isinstance(value, dict):
            if value.get("standard_field") or value.get("field"):
                yield value
            for child in value.values():
                yield from self._walk_fields(child)
        elif isinstance(value, list):
            for child in value:
                yield from self._walk_fields(child)

    def _financial_fields(self, evidence: list[Evidence]) -> dict[str, float]:
        """Return the latest reliable standardized financial field per code.

        Only values identified by the upstream standardizer are used.  Raw PDF
        text and apparent table-page artefacts are deliberately ignored.
        """
        candidates: dict[str, list[tuple[str, int, float]]] = defaultdict(list)
        valid_statement_types = {"key_financial_data", "income_statement", "balance_sheet", "cash_flow_statement"}
        for item in evidence:
            if item.confidence < 0.6 or not set(item.tags).intersection(TAG_MAP["financial_numeric"]):
                continue
            for field in self._walk_fields(item.value):
                code = field.get("standard_field") or field.get("field")
                value = _number(field.get("normalized_value"))
                if not code or value is None:
                    continue
                statement_type = field.get("statement_type", "")
                source = field.get("source", "")
                # Key financial tables are robust. Other statement tables must
                # contain an actual financial number, rather than a note number.
                if statement_type and statement_type not in valid_statement_types and abs(value) < 1_000:
                    continue
                if source == "table" and abs(value) < 1_000 and statement_type != "key_financial_data":
                    continue
                period_weight = 2 if field.get("period") == "current_period" else 1
                candidates[code].append((item.publish_date or item.fetched_at, period_weight, float(value)))
        result = {}
        for code, values in candidates.items():
            latest_date = max(date for date, _, _ in values)
            latest = [item for item in values if item[0] == latest_date]
            # Prefer explicitly current-period values and the most frequently
            # repeated number (the PDF extractor often records text+table views).
            highest_period = max(period for _, period, _ in latest)
            pool = [value for _, period, value in latest if period == highest_period]
            result[code] = Counter(pool).most_common(1)[0][0]
        return result

    def _financial_field_series(self, evidence: list[Evidence], code: str) -> list[tuple[str, float]]:
        """Return one reliable standardized field value per disclosure date."""
        by_date: dict[str, list[tuple[int, float]]] = defaultdict(list)
        for item in evidence:
            if item.confidence < 0.6 or not set(item.tags).intersection(TAG_MAP["financial_numeric"]):
                continue
            for field in self._walk_fields(item.value):
                if (field.get("standard_field") or field.get("field")) != code:
                    continue
                value = _number(field.get("normalized_value"))
                statement_type = field.get("statement_type", "")
                if value is None or (statement_type and statement_type not in {"key_financial_data", "income_statement", "balance_sheet", "cash_flow_statement"} and abs(value) < 1_000):
                    continue
                date = item.publish_date or item.fetched_at
                by_date[date].append((2 if field.get("period") == "current_period" else 1, float(value)))
        series = []
        for date, values in by_date.items():
            highest_period = max(weight for weight, _ in values)
            pool = [value for weight, value in values if weight == highest_period]
            series.append((date, Counter(pool).most_common(1)[0][0]))
        return sorted(series)

    def _contract_ratio(self, contract, matched: list[Evidence]):
        fields = self._financial_fields(matched)
        indicator = contract["indicator"]
        if indicator == "无形资产减值风险":
            numerator, denominator = fields.get("intangible_assets"), fields.get("total_assets")
            if numerator is not None and denominator and denominator > 0:
                return numerator / denominator, {"numerator": numerator, "denominator": denominator, "numerator_field": "intangible_assets", "denominator_field": "total_assets"}
            return None
        # The remaining ratio indicators depend on upstream business, supplier
        # or personnel facts. A scalar evidence value is accepted only when it
        # is attached to that exact contract indicator, not to a PDF blob.
        value = self._latest_numeric(matched)
        if value is not None:
            return value / 100 if abs(value) > 1 else value, {"raw_ratio_input": value, "source": "direct_indicator_value"}
        return None

    def _text(self, item):
        values = [item.title, item.snippet]
        if isinstance(item.value, dict):
            values.extend(str(item.value.get(key, "")) for key in ("text", "segment", "normalized_segment"))
        return "\n".join(value for value in values if value)

    def _term_density(self, text):
        normalized = normalize_text(text)
        if not normalized:
            return 0.0
        return sum(normalized.count(term) for term in EXAGGERATION_TERMS) / len(normalized)

    def _quarter(self, date_text):
        match = re.match(r"(\d{4})-(\d{2})", date_text or "")
        if not match:
            return ""
        return f"{match.group(1)}Q{(int(match.group(2)) - 1) // 3 + 1}"

    def _coverage_summary(self, coverage):
        source_counts = Counter(item["source_coverage_status"] for item in coverage)
        calculation_counts = Counter(item["calculation_status"] for item in coverage)
        total = len(coverage)
        return {
            "total": total,
            "source": dict(source_counts),
            "calculation": dict(calculation_counts),
            "source_coverage_rate": round(source_counts["covered"] / total, 4) if total else 0.0,
            "formula_calculation_rate": round((calculation_counts["calculated"] + calculation_counts["review_required"]) / total, 4) if total else 0.0,
        }

    def _write_coverage_report(self, company, run_id, coverage, scores):
        base_dir = self.db_path.parent / "reports"
        base_dir.mkdir(parents=True, exist_ok=True)
        score_map = {score.indicator: score for score in scores}
        summary = self._coverage_summary(coverage)
        source = summary["source"]
        calculation = summary["calculation"]
        lines = [
            f"# {company} 风险指标覆盖与计算状态", "", f"- 运行 ID：`{run_id}`", f"- 合同版本：`{self.contracts['version']}`", f"- 指标总数：{summary['total']}",
            "", "## 数据源覆盖率", "", f"- 完整覆盖：{source.get('covered', 0)}", f"- 部分覆盖：{source.get('partial', 0)}", f"- 数据源缺失：{source.get('missing', 0)}", f"- 数据源完整覆盖率：{summary['source_coverage_rate']:.1%}",
            "", "## 公式可计算率", "", f"- 已计算：{calculation.get('calculated', 0)}", f"- 已计算、待人工复核：{calculation.get('review_required', 0)}", f"- 待补字段：{calculation.get('pending_fields', 0)}", f"- 待补数据源：{calculation.get('pending_source', 0)}", f"- 待行业基准：{calculation.get('pending_benchmark', 0)}", f"- 公式可计算率（含待复核）：{summary['formula_calculation_rate']:.1%}",
            "", "说明：数据源已覆盖不等同于可以计算风险分；只有公式字段齐全或明确需要人工复核的结果才计入公式可计算率。", "", "| 风险域 | 指标 | 数据源覆盖 | 计算状态 | 原始值 | 风险分 | 缺失数据类型 |", "|---|---|---|---|---|---|---|"]
        contracts = {item["indicator"]: item for item in self.contracts["indicators"]}
        for item in coverage:
            score = score_map[item["indicator"]]
            contract = contracts[item["indicator"]]
            raw = json.dumps(score.value, ensure_ascii=False) if isinstance(score.value, (dict, list)) else str(score.value if score.value is not None else "—")
            lines.append(f"| {contract['risk_category']} | {item['indicator']} | {item['source_coverage_status']} | {item['calculation_status']} | {raw[:80]} | {score.score if score.score is not None else '待补数'} | {', '.join(item['missing_data_types']) or '—'} |")
        path = base_dir / f"{run_id}_{self._safe_filename(company)}_coverage.md"
        path.write_text("\n".join(lines) + "\n", encoding="utf-8")
        return path

    def _safe_filename(self, value):
        return re.sub(r"[\\/:*?\"<>|]", "_", value)[:60]


def run_risk_indicator_agent(db_path: Path, run_id: str, company: str = "", derive_text: bool = True) -> dict[str, Any]:
    return RiskIndicatorAgent(db_path).run(run_id=run_id, company=company, derive_text=derive_text)
