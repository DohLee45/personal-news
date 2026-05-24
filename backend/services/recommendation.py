"""
recommendation.py — 1차 다른 논조/시각 추천 (Agent C 전 단계, 무료)

핵심 함수:
  extract_search_keywords(title) → str
    기사 제목에서 검색 키워드 추출
    • 한국어 단어([가-힣]{2,}) 중 debate_patterns.json[general_nouns] 제외
    • 3글자+ 단어 우선, 없으면 2글자+ 단어
    • 최대 2개 공백 연결 반환

  get_related_articles(title, source, exclude_url) → dict
    Google News RSS 재수집 → 반대 성향 언론사 기사 필터링
    • 모든 기사에 동일 로직으로 추천
    • 2단계 fallback: 7d 결과 3건 미만 → 14d 재수집
    • 필터 기준:
        원본 conservative → progressive·neutral 추천
        원본 progressive  → conservative·neutral 추천
        원본 neutral      → conservative·progressive 양쪽
    • 동일 언론사 최대 2건, 전체 최대 5건
    • 원본 URL 제외

언론사 성향 조회: media_bias.json (bias 필드, conservative/progressive/neutral)
"""

from __future__ import annotations

import re

from services.data_loader import load_debate_patterns, load_media_bias
from services.news_fetcher import fetch_google_news

# ── 상수 ──────────────────────────────────────────────────────────────────────

_KOREAN_WORD = re.compile(r"[가-힣]{2,}")


def _general_nouns() -> set[str]:
    """debate_patterns.json["general_nouns"]를 set으로 반환 (lru_cache 적용됨)."""
    return set(load_debate_patterns().get("general_nouns", []))

# 반대 성향 매핑
_OPPOSITE: dict[str, list[str]] = {
    "conservative": ["progressive", "neutral"],
    "progressive":  ["conservative", "neutral"],
    "neutral":      ["conservative", "progressive"],
}


# ── 내부 헬퍼 ─────────────────────────────────────────────────────────────────

def _get_source_lean(source: str) -> str:
    """언론사명 → 성향 코드 (conservative / progressive / neutral)."""
    m = load_media_bias()
    if source in m:
        return m[source].get("bias", "neutral")
    # 부분 매칭 (예: "조선일보" ⊂ "조선일보 IT")
    for key, val in m.items():
        if key in source or source in key:
            return val.get("bias", "neutral")
    return "neutral"


# ── 공개 API ──────────────────────────────────────────────────────────────────

def extract_search_keywords(title: str) -> str:
    """
    기사 제목에서 검색 키워드를 추출한다.

    처리 순서:
      1) [가-힣]{2,} 패턴으로 한국어 단어 추출
      2) general_nouns 제외 (debate_patterns.json)
      3) 3글자 이상 단어 우선 선택 (고유명사 가능성 높음)
      4) 3글자 이상이 없으면 2글자 단어 사용
      5) 최대 2개를 공백으로 연결하여 반환

    Args:
        title: 기사 제목

    Returns:
        검색 키워드 문자열 (예: "의대 정원")
    """
    words = _KOREAN_WORD.findall(title)
    nouns = _general_nouns()
    filtered = [w for w in words if w not in nouns]

    long_words = [w for w in filtered if len(w) >= 3]
    if long_words:
        return " ".join(long_words[:2])

    if filtered:
        return " ".join(filtered[:2])

    # 한국어 단어 없음 → 제목 앞 20자 fallback
    return title[:20].strip()


async def get_related_articles(
    title: str,
    source: str,
    exclude_url: str,
) -> dict:
    """
    기사 제목 키워드로 Google News RSS를 재수집하고
    반대 성향 언론사 기사를 필터링하여 반환한다.

    모든 기사에 동일 로직으로 추천한다.
    2단계 fallback: 7d 결과 3건 미만 → 14d 재수집.

    필터 기준 (언론사 성향 기반):
      원본 conservative → progressive · neutral 추천
      원본 progressive  → conservative · neutral 추천
      원본 neutral      → conservative · progressive 양쪽

    제약:
      - 동일 언론사 최대 2건
      - 전체 최대 5건
      - exclude_url 기사 제외

    Args:
        title:       원본 기사 제목 (키워드 추출 원본)
        source:      원본 기사 언론사명
        exclude_url: 원본 기사 URL (결과에서 제외)

    Returns:
        {'articles': [...], 'non_debate_message': str}
    """
    keyword = extract_search_keywords(title)
    if not keyword:
        return {"articles": [], "non_debate_message": ""}

    # RSS 재수집 — 2단계 fallback (7d 결과 3건 미만 → 14d 확장)
    try:
        candidates = await fetch_google_news(keyword, max_items=30, when="7d")
        if len(candidates) < 3:
            candidates = await fetch_google_news(keyword, max_items=30, when="14d")
    except Exception:
        return {"articles": [], "non_debate_message": ""}

    # 원본 언론사 성향 파악
    origin_lean = _get_source_lean(source)
    opposite_leans = _OPPOSITE.get(origin_lean, ["conservative", "progressive"])

    results: list[dict] = []
    source_count: dict[str, int] = {}

    for article in candidates:
        # 원본 URL 제외
        if article.get("link", "") == exclude_url:
            continue

        article_source = article.get("source", "")
        # 원본 언론사 기사 제외 (동일 언론사 중복 방지를 위해)
        if article_source == source:
            continue

        # 언론사 성향 확인
        article_lean = _get_source_lean(article_source)
        if article_lean not in opposite_leans:
            continue

        # 동일 언론사 최대 2건
        cnt = source_count.get(article_source, 0)
        if cnt >= 2:
            continue

        results.append(article)
        source_count[article_source] = cnt + 1

        if len(results) >= 5:
            break

    return {"articles": results, "non_debate_message": ""}
