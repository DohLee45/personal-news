"""
recommendation.py — 1차 다른 논조 추천 (Agent C 전 단계, 무료)

핵심 함수:
  extract_search_keywords(title) → str
    기사 제목에서 검색 키워드 추출
    • 한국어 단어([가-힣]{2,}) 중 GENERAL_NOUNS 제외
    • 3글자+ 단어 우선, 없으면 2글자+ 단어
    • 최대 2개 공백 연결 반환

  get_related_articles(title, source, exclude_url, is_debate) → dict
    Google News RSS 재수집 → 반대 성향 언론사 기사 필터링
    • 비논쟁형: {'articles': [], 'non_debate_message': '사실 보도 기사로...'}
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
from functools import lru_cache
from pathlib import Path
import json

from services.news_fetcher import fetch_google_news

# ── 상수 ──────────────────────────────────────────────────────────────────────

_DATA_DIR = Path(__file__).parent.parent / "data"
_KOREAN_WORD = re.compile(r"[가-힣]{2,}")

# 뉴스 제목에서 제거할 일반명사 95개
GENERAL_NOUNS: frozenset[str] = frozenset({
    # 시간 표현
    "오늘", "내일", "어제", "올해", "내년", "작년", "지난해",
    "이달", "지난달", "현재", "최근", "당시", "오후", "오전",
    "이날", "당일", "이번", "향후", "이후", "이전", "다음",
    # 수량·범위
    "이상", "이하", "미만", "초과", "이내", "가량", "여명",
    "일부", "전체", "대부분", "모든", "주요",
    # 동작·상태 명사 (기사 빈출어)
    "문제", "상황", "결과", "영향", "사실", "내용", "방안",
    "가능성", "이유", "원인", "방법", "과정", "기준", "수준",
    "변화", "진행", "발생", "확인", "분석", "검토", "논의",
    "결정", "발표", "공개", "예정", "계획", "추진", "시작",
    "완료", "종료", "중단", "재개", "강화", "완화", "확대",
    "축소", "증가", "감소", "상승", "하락", "유지", "개선",
    # 관계·지시
    "관련", "해당", "이것", "그것", "저것",
    # 장소 일반명사
    "지역", "전국", "해외", "국내", "세계", "현장", "장소",
    # 인물 일반명사
    "관계자", "전문가", "담당자", "당국",
    # 뉴스 표현
    "보도", "발언", "주장", "입장", "의견", "제안", "요구",
    "반응", "비판", "지적", "우려", "강조", "촉구", "호소",
    "요청", "거부", "반발", "지지", "반대", "찬성", "논란",
    "사건", "사태", "사안", "이슈", "쟁점", "상태", "경우",
    "방식", "제도", "정도", "기간", "시기", "규모", "형태",
    "등록", "신청", "대응", "조치", "수습",
})

# 반대 성향 매핑
_OPPOSITE: dict[str, list[str]] = {
    "conservative": ["progressive", "neutral"],
    "progressive":  ["conservative", "neutral"],
    "neutral":      ["conservative", "progressive"],
}


# ── 내부 헬퍼 ─────────────────────────────────────────────────────────────────

@lru_cache(maxsize=1)
def _media() -> dict:
    with open(_DATA_DIR / "media_bias.json", encoding="utf-8") as f:
        return json.load(f)


def _get_source_lean(source: str) -> str:
    """언론사명 → 성향 코드 (conservative / progressive / neutral)."""
    m = _media()
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
      2) GENERAL_NOUNS 제외
      3) 3글자 이상 단어 우선 선택 (고유명사 가능성 높음)
      4) 3글자 이상이 없으면 2글자 단어 사용
      5) 최대 2개를 공백으로 연결하여 반환

    Args:
        title: 기사 제목

    Returns:
        검색 키워드 문자열 (예: "의대 정원")
    """
    words = _KOREAN_WORD.findall(title)
    filtered = [w for w in words if w not in GENERAL_NOUNS]

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
    is_debate: bool,
) -> dict:
    """
    기사 제목 키워드로 Google News RSS를 재수집하고
    반대 성향 언론사 기사를 필터링하여 반환한다.

    비논쟁형(is_debate=False) 기사는 추천 대상이 아님:
      → {'articles': [], 'non_debate_message': '사실 보도 기사로...'}

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
        is_debate:   논쟁형 여부

    Returns:
        {'articles': [...], 'non_debate_message': str}
    """
    # 비논쟁형 → 추천 불가
    if not is_debate:
        return {
            "articles": [],
            "non_debate_message": "사실 보도 기사로, 다른 논조 추천 대상이 아닙니다.",
        }

    keyword = extract_search_keywords(title)
    if not keyword:
        return {"articles": [], "non_debate_message": ""}

    # RSS 재수집 (최대 30건)
    try:
        candidates = await fetch_google_news(keyword, max_items=30)
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
