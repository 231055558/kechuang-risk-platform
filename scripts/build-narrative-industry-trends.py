#!/usr/bin/env python3
"""Build raw annual narrative indicators and industry distributions for 94 firms."""

from __future__ import annotations

import importlib.util
import json
import logging
import math
import re
import statistics
import sys
from concurrent.futures import ProcessPoolExecutor
from datetime import datetime, timezone
from multiprocessing import get_context
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PRIVATE_ROOT = ROOT / "private/narrative-risk/industry-annual"
PYTHON_DEPS = ROOT / "private/narrative-risk/annual/python-deps"
if PYTHON_DEPS.exists():
    sys.path.insert(0, str(PYTHON_DEPS))

COMMON_PATH = ROOT / "scripts/build-narrative-annual-trends.py"
COMMON_SPEC = importlib.util.spec_from_file_location("narrative_annual_common", COMMON_PATH)
if COMMON_SPEC is None or COMMON_SPEC.loader is None:
    raise RuntimeError("无法加载叙事年报公共计算模块。")
common = importlib.util.module_from_spec(COMMON_SPEC)
COMMON_SPEC.loader.exec_module(common)

from pypdf import PdfReader

MANIFEST_PATH = ROOT / "config/narrative-risk-industry-annual-reports.json"
COMPANY_DATASET_PATH = ROOT / "src/data/industry/r01-r22-unified.json"
SNAPSHOT_PATH = ROOT / "src/data/industry/narrative-risk-industry-trends.json"
EXTRACTED_ROOT = PRIVATE_ROOT / "extracted-text"
DATA_VERSION = "narrative-industry-raw-2026-08-27-v1"
AS_OF_DATE = "2026-08-27"
YEARS = [2021, 2022, 2023, 2024, 2025]

logging.getLogger("pypdf").setLevel(logging.ERROR)

METRICS = [
    {
        "metricKey": "risk_context_ambiguity",
        "name": "信息模糊性",
        "formula": "业绩展望及风险提示中的模糊词次数÷该范围有效词数",
        "unit": "比例",
        "direction": "数值越高，风险叙述越模糊",
    },
    {
        "metricKey": "innovation_divergence",
        "name": "叙事夸大性",
        "formula": "创新文本密度加一取自然对数−当年发明专利申请数加一取自然对数",
        "unit": "对数差",
        "direction": "数值越高，多言寡行倾向越明显",
    },
    {
        "metricKey": "information_sufficiency",
        "name": "风险披露充分性",
        "formula": "经营情况讨论与分析及风险章节的有效词数÷10,000",
        "unit": "万有效词",
        "direction": "数值越高，风险披露信息容量越充分",
    },
]

INDUSTRY_GROUPS = [
    {
        "industryGroupId": "chip-design",
        "label": "芯片设计",
        "peerGroupIds": ["digital-chip", "analog-chip"],
    },
    {
        "industryGroupId": "pharma",
        "label": "创新药与化学制剂",
        "peerGroupIds": ["pharma"],
    },
    {
        "industryGroupId": "semiconductor-supply-chain",
        "label": "半导体设备与制造",
        "peerGroupIds": ["semiconductor-supplement"],
    },
]

for term in common.INNOVATION_TERMS:
    common.jieba.add_word(term)


def industry_group_id(peer_group_id: str) -> str:
    for group in INDUSTRY_GROUPS:
        if peer_group_id in group["peerGroupIds"]:
            return group["industryGroupId"]
    raise ValueError(f"未知行业组：{peer_group_id}")


def normalize_integer(value: str) -> int:
    return int(value.replace(",", "").replace("，", ""))


def invention_application_count(text: str) -> tuple[int | None, str | None]:
    table_patterns = [
        re.compile(
            r"本年新增.{0,180}?申请数[（(]?(?:个|件|项)?[）)]?.{0,180}?"
            r"发明专利\s*([\d,，]+)\s+[\d,，]+\s+[\d,，]+",
            re.S,
        ),
        re.compile(
            r"发明专利\s+([\d,，]+)\s+[\d,，]+\s+[\d,，]+\s+[\d,，]+"
        ),
    ]
    for pattern in table_patterns:
        match = pattern.search(text)
        if match:
            return normalize_integer(match.group(1)), "年报知识产权表本年新增申请数"

    sentence_patterns = [
        (
            re.compile(
                r"报告期内[^。；\n]{0,120}?(?:新增|共)?(?:申请|提交)[^。；\n]{0,50}?"
                r"发明专利(?:申请)?\s*([\d,，]+)\s*(?:项|件|个)"
            ),
            "年报报告期研发成果披露",
        ),
        (
            re.compile(r"申请发明专利\s*([\d,，]+)\s*(?:项|件|个)"),
            "年报发明专利申请披露",
        ),
        (
            re.compile(r"新增发明专利申请\s*([\d,，]+)\s*(?:项|件|个)"),
            "年报新增发明专利申请披露",
        ),
        (
            re.compile(
                r"提交(?:国内|大中华地区)?新申请专利\s*([\d,，]+)\s*(?:项|件|个)"
            ),
            "年报境内新申请专利披露",
        ),
    ]
    for pattern, basis in sentence_patterns:
        for match in pattern.finditer(text):
            prefix = text[max(0, match.start() - 18) : match.start()]
            if "累计" in prefix or "截至" in prefix:
                continue
            return normalize_integer(match.group(1)), basis
    return None, None


def observation(
    report: dict,
    metric_key: str,
    value: float | None,
    reason: str | None,
    details: dict | None = None,
) -> dict:
    return {
        "companyId": report["companyId"],
        "year": report["year"],
        "metricKey": metric_key,
        "value": round(value, 10) if value is not None else None,
        "status": "已计算" if value is not None else "缺失",
        "missingReason": reason,
        "documentId": f"industry-annual:{report['companyId']}:{report['year']}",
        "details": details or {},
    }


def parse_report(report: dict) -> dict:
    document_id = f"industry-annual:{report['companyId']}:{report['year']}"
    base_document = {
        "documentId": document_id,
        "companyId": report["companyId"],
        "year": report["year"],
        "title": report["title"],
        "officialUrl": report.get("officialUrl"),
        "publicationDate": report.get("publicationDate"),
        "archiveStatus": report["archiveStatus"],
        "sha256": report.get("sha256"),
        "byteSize": report.get("byteSize"),
        "parseStatus": "未解析",
        "pageCount": None,
        "sectionCoverage": {},
    }
    if report["archiveStatus"] != "已归档":
        return {"document": base_document, "observations": []}

    pdf_path = PRIVATE_ROOT / "reports" / report["companyId"] / f"{report['year']}.pdf"
    try:
        reader = PdfReader(str(pdf_path))
        text = common.clean_pdf_text(
            "\n".join((page.extract_text() or "") for page in reader.pages)
        )
        text_dir = EXTRACTED_ROOT / report["companyId"]
        text_dir.mkdir(parents=True, exist_ok=True)
        (text_dir / f"{report['year']}.txt").write_text(text, encoding="utf-8")

        mdna, mdna_heading = common.main_section(
            text, ["管理层讨论与分析", "经营情况讨论与分析", "董事会报告"]
        )
        business, business_heading = common.main_section(
            text, ["公司业务概要", "公司业务概述"]
        )
        if not business and mdna:
            business, business_heading = common.numbered_subsection(
                mdna,
                [
                    "报告期内公司所从事的主要业务、经营模式、行业情况及研发情况说明",
                    "报告期内公司从事的主要业务",
                    "公司主要业务",
                    "主营业务分析",
                ],
            )
        risk, risk_heading = common.numbered_subsection(
            mdna or text,
            ["风险因素", "可能面对的风险", "公司面临的风险和应对措施", "主要风险"],
        )
        outlook, outlook_heading = common.numbered_subsection(
            mdna or text,
            [
                "公司关于公司未来发展的讨论与分析",
                "公司未来发展的展望",
                "未来发展展望",
                "经营计划",
                "发展战略",
            ],
        )

        disclosure_text = common.combine_non_overlapping(mdna, risk)
        ambiguity_text = common.combine_non_overlapping(outlook, risk)
        innovation_text = common.combine_non_overlapping(mdna, business)
        disclosure_words = common.tokenize(disclosure_text) if disclosure_text else []
        ambiguity_words = common.tokenize(ambiguity_text) if ambiguity_text else []
        innovation_words = common.tokenize(innovation_text) if innovation_text else []

        sufficient = len(disclosure_words) / 10000 if disclosure_words else None
        ambiguity_count = (
            sum(ambiguity_text.count(word) for word in common.UNCERTAINTY_WORDS)
            if ambiguity_words
            else None
        )
        ambiguity = (
            ambiguity_count / len(ambiguity_words)
            if ambiguity_count is not None and ambiguity_words
            else None
        )
        talk_hits = common.innovation_hits(innovation_text) if innovation_words else None
        talk = (
            talk_hits / len(innovation_words) * 1000
            if talk_hits is not None and innovation_words
            else None
        )
        patents, patent_basis = invention_application_count(text)
        divergence = (
            math.log1p(talk) - math.log1p(patents)
            if talk is not None and patents is not None
            else None
        )

        observations = [
            observation(
                report,
                "risk_context_ambiguity",
                ambiguity,
                None if ambiguity is not None else "未识别到业绩展望或风险提示章节",
                {
                    "uncertaintyOccurrenceCount": ambiguity_count,
                    "effectiveWordCount": len(ambiguity_words),
                },
            ),
            observation(
                report,
                "innovation_divergence",
                divergence,
                None
                if divergence is not None
                else "创新文本密度或当年发明专利申请数缺失",
                {
                    "innovationTalkDensity": round(talk, 10) if talk is not None else None,
                    "innovationOccurrenceCount": talk_hits,
                    "innovationEffectiveWordCount": len(innovation_words),
                    "annualInventionApplications": patents,
                    "patentBasis": patent_basis,
                },
            ),
            observation(
                report,
                "information_sufficiency",
                sufficient,
                None if sufficient is not None else "未识别到经营情况讨论与分析章节",
                {"effectiveWordCount": len(disclosure_words)},
            ),
        ]
        document = {
            **base_document,
            "parseStatus": "已解析" if mdna else "部分解析",
            "pageCount": len(reader.pages),
            "sectionCoverage": {
                "经营情况讨论与分析": bool(mdna),
                "公司业务概要": bool(business),
                "风险提示": bool(risk),
                "业绩展望": bool(outlook),
                "matchedHeadings": [
                    heading
                    for heading in [
                        mdna_heading,
                        business_heading,
                        risk_heading,
                        outlook_heading,
                    ]
                    if heading
                ],
            },
        }
        return {"document": document, "observations": observations}
    except Exception as error:
        return {
            "document": {**base_document, "parseStatus": "解析失败", "error": str(error)},
            "observations": [],
        }


def mean(values: list[float]) -> float:
    return sum(values) / len(values)


def main() -> None:
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    company_dataset = json.loads(COMPANY_DATASET_PATH.read_text(encoding="utf-8"))
    company_lookup = {item["id"]: item for item in company_dataset["companies"]}

    archived_reports = [
        report for report in manifest["reports"] if report["archiveStatus"] == "已归档"
    ]
    with ProcessPoolExecutor(max_workers=4, mp_context=get_context("fork")) as executor:
        parsed_results = list(executor.map(parse_report, archived_reports, chunksize=2))

    parsed_by_key = {
        (item["document"]["companyId"], item["document"]["year"]): item
        for item in parsed_results
    }
    documents = []
    observations = []
    for report in manifest["reports"]:
        parsed = parsed_by_key.get((report["companyId"], report["year"]))
        if parsed:
            documents.append(parsed["document"])
            observations.extend(parsed["observations"])
        else:
            documents.append(
                {
                    "documentId": f"industry-annual:{report['companyId']}:{report['year']}",
                    "companyId": report["companyId"],
                    "year": report["year"],
                    "title": report["title"],
                    "officialUrl": report.get("officialUrl"),
                    "publicationDate": report.get("publicationDate"),
                    "archiveStatus": report["archiveStatus"],
                    "parseStatus": "未解析",
                    "sha256": report.get("sha256"),
                    "byteSize": report.get("byteSize"),
                    "pageCount": None,
                    "sectionCoverage": {},
                }
            )

    companies = []
    for company in company_dataset["companies"]:
        group_id = industry_group_id(company["peerGroupId"])
        included_years = sorted(
            {
                item["year"]
                for item in documents
                if item["companyId"] == company["id"] and item["parseStatus"] in {"已解析", "部分解析"}
            }
        )
        companies.append(
            {
                "companyId": company["id"],
                "companyName": company["shortName"],
                "stockCode": company["stockCode"],
                "peerGroupId": company["peerGroupId"],
                "industryGroupId": group_id,
                "includedYears": included_years,
            }
        )

    company_group = {item["companyId"]: item["industryGroupId"] for item in companies}
    industry_statistics = []
    for group in INDUSTRY_GROUPS:
        group_id = group["industryGroupId"]
        for metric in METRICS:
            metric_key = metric["metricKey"]
            all_values = [
                item["value"]
                for item in observations
                if item["metricKey"] == metric_key
                and item["value"] is not None
                and company_group[item["companyId"]] == group_id
            ]
            domain_minimum = min(all_values) if all_values else None
            domain_maximum = max(all_values) if all_values else None
            for year in YEARS:
                values = [
                    item["value"]
                    for item in observations
                    if item["metricKey"] == metric_key
                    and item["year"] == year
                    and item["value"] is not None
                    and company_group[item["companyId"]] == group_id
                ]
                industry_statistics.append(
                    {
                        "industryGroupId": group_id,
                        "year": year,
                        "metricKey": metric_key,
                        "sampleSize": len(values),
                        "mean": round(mean(values), 10) if values else None,
                        "minimum": round(min(values), 10) if values else None,
                        "maximum": round(max(values), 10) if values else None,
                        "standardDeviation": round(statistics.pstdev(values), 10)
                        if len(values) > 1
                        else None,
                        "domainMinimum": round(domain_minimum, 10)
                        if domain_minimum is not None
                        else None,
                        "domainMaximum": round(domain_maximum, 10)
                        if domain_maximum is not None
                        else None,
                    }
                )

    snapshot = {
        "schemaVersion": "KCR-NARRATIVE-RISK-2026.08-v1",
        "dataVersion": DATA_VERSION,
        "asOfDate": AS_OF_DATE,
        "sourceMode": "snapshot",
        "companies": companies,
        "industryGroups": INDUSTRY_GROUPS,
        "methodology": METRICS,
        "documents": documents,
        "observations": observations,
        "industryStatistics": industry_statistics,
        "audit": {
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "targetCompanyCount": len(companies),
            "targetCompanyYearCount": len(manifest["reports"]),
            "archivedReportCount": sum(
                item["archiveStatus"] == "已归档" for item in documents
            ),
            "parsedReportCount": sum(item["parseStatus"] == "已解析" for item in documents),
            "partialReportCount": sum(
                item["parseStatus"] == "部分解析" for item in documents
            ),
            "failedReportCount": sum(item["parseStatus"] == "解析失败" for item in documents),
            "calculatedObservationCount": sum(
                item["value"] is not None for item in observations
            ),
            "missingObservationCount": sum(item["value"] is None for item in observations),
            "patentObservationCount": sum(
                item["metricKey"] == "innovation_divergence" and item["value"] is not None
                for item in observations
            ),
            "publicPayloadContainsFullText": False,
            "publicPayloadContainsPrivatePath": False,
        },
    }
    SNAPSHOT_PATH.parent.mkdir(parents=True, exist_ok=True)
    SNAPSHOT_PATH.write_text(
        json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(snapshot["audit"], ensure_ascii=False))


if __name__ == "__main__":
    main()
