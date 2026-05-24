"""카테고리 분류기 — data/category_keywords.json 기반 키워드 매칭"""

from services.data_loader import load_category_keywords

DEFAULT_CATEGORY = "시사·사회"


def classify_category(title: str, source: str = "") -> str:
    """제목과 출처를 기반으로 카테고리를 분류한다.

    Args:
        title:  기사 제목
        source: 언론사명 (선택)

    Returns:
        카테고리 문자열. 매칭 없으면 '시사·사회' 반환.
    """
    keywords = load_category_keywords()
    text = title + " " + source

    scores: dict[str, int] = {}
    for category, kw_list in keywords.items():
        count = sum(1 for kw in kw_list if kw in text)
        if count > 0:
            scores[category] = count

    if not scores:
        return DEFAULT_CATEGORY

    return max(scores, key=lambda k: scores[k])
