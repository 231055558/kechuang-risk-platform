from .text_processing import deduplicate_evidence_events


def company_alias_map(companies: list[dict]) -> dict[str, str]:
    aliases = {}
    for company in companies:
        canonical = company["name"]
        aliases[canonical] = canonical
        for alias in company.get("aliases", []):
            aliases[alias] = canonical
        stock_code = company.get("stock_code")
        if stock_code:
            aliases[stock_code] = canonical
    return aliases


def normalize_company(name: str, aliases: dict[str, str]) -> str:
    if name in aliases:
        return aliases[name]
    for alias, canonical in aliases.items():
        if alias and alias in name:
            return canonical
    return name


def normalize_evidence(evidence, companies: list[dict]):
    aliases = company_alias_map(companies)
    for item in evidence:
        item.company = normalize_company(item.company, aliases)
    return deduplicate_evidence_events(evidence)
