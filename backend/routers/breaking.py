"""GET /api/breaking — 속보 헤드라인 (페이지네이션)"""

import math

from fastapi import APIRouter, Query

from services.news_fetcher import fetch_google_news

router = APIRouter()

_BREAKING_KEYWORD = "속보"
_MAX_ARTICLES = 20


@router.get("/breaking")
async def get_breaking(
    page: int = Query(default=1, ge=1, description="페이지 번호"),
    size: int = Query(default=10, ge=1, le=20, description="페이지당 건수"),
) -> dict:
    """'속보' 키워드 RSS 20건 수집 후 페이지네이션하여 반환한다."""
    articles = await fetch_google_news(_BREAKING_KEYWORD, max_items=_MAX_ARTICLES)
    total = len(articles)
    total_pages = max(1, math.ceil(total / size))
    start = (page - 1) * size
    end = start + size

    return {
        "articles": articles[start:end],
        "total": total,
        "page": page,
        "totalPages": total_pages,
    }
