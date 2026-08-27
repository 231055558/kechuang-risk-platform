REPORT_KEYWORDS = [
    "年度报告",
    "年报",
    "半年度报告",
    "半年报",
    "第一季度报告",
    "第三季度报告",
    "季度报告",
]

PERIODIC_REPORT_EXCLUDE_KEYWORDS = [
    "摘要",
    "提示性公告",
    "审计报告",
    "募集资金",
    "社会责任",
    "环境、社会及治理",
    "ESG",
]

ANNOUNCEMENT_TYPE_KEYWORDS = [
    ("exchange_inquiry", ["问询函", "问询", "关注函", "监管函"]),
    ("personnel_change", ["辞职", "离职", "聘任", "选举", "董事会换届", "监事会换届", "高级管理人员", "核心技术人员"]),
    ("equity_change", ["权益变动", "减持", "增持", "股权转让", "股份变动", "实际控制人", "控股股东"]),
    ("litigation", ["诉讼", "仲裁", "判决", "裁定", "执行", "被执行"]),
    ("regulatory_penalty", ["处罚", "行政监管措施", "纪律处分", "监管警示", "立案"]),
    ("financing", ["融资", "可转换公司债券", "定向增发", "非公开发行", "配股", "授信", "借款"]),
    ("periodic_report", REPORT_KEYWORDS),
]


def is_periodic_report(title: str, include_summary: bool = False) -> bool:
    if not any(keyword in title for keyword in REPORT_KEYWORDS):
        return False
    if include_summary:
        return True
    return not any(keyword in title for keyword in PERIODIC_REPORT_EXCLUDE_KEYWORDS)


def periodic_report_type(title: str) -> str:
    if "年度报告" in title or "年报" in title:
        return "annual_report"
    if "半年度报告" in title or "半年报" in title:
        return "semi_annual_report"
    if "第一季度" in title:
        return "q1_report"
    if "第三季度" in title:
        return "q3_report"
    return "quarterly_report"


def classify_announcement_title(title: str) -> dict:
    tags = ["company_announcement"]
    announcement_types = []
    for type_code, keywords in ANNOUNCEMENT_TYPE_KEYWORDS:
        if any(keyword in title for keyword in keywords):
            announcement_types.append(type_code)
            tags.append(type_code)

    if "periodic_report" in announcement_types:
        report_type = periodic_report_type(title)
        tags.append(report_type)
    else:
        report_type = ""

    primary_type = announcement_types[0] if announcement_types else "general_announcement"
    return {
        "primary_type": primary_type,
        "announcement_types": announcement_types,
        "report_type": report_type,
        "is_periodic_report": "periodic_report" in announcement_types,
        "tags": tags,
    }
