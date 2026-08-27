from .text_processing import (
    TECH_QUALITY_EVENT_TERMS,
    NARRATIVE_TERMS,
    bounded_text_classify,
    classify_news_text,
    dictionary_matches,
    event_segments,
    match_terms,
    merge_dictionary_hits,
    self_similarity_score,
    split_paragraphs,
    text_signal_summary,
    vector_recall,
)


def keyword_confidence(text: str, terms: list[str]) -> tuple[bool, float, list[str]]:
    matched = match_terms(text, terms)
    if not matched:
        return False, 0.0, []
    confidence = min(0.95, 0.38 + 0.14 * len(matched))
    return True, confidence, matched
