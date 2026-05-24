"""GET /api/ranking — 인기 기사 랭킹 (1시간 캐시, 페이지네이션)"""

import asyncio
import math
import time

from fastapi import APIRouter, Query

from services.news_fetcher import fetch_google_news

router = APIRouter()

_RANKING_KEYWORDS = ["주요뉴스", "오늘뉴스", "이슈"]
_MAX_ARTICLES = 20
_CACHE_TTL = 3600  # 1시간

_cache: dict = {"data": None, "updated_at": 0.0}


async def _refresh_ranking() -> list[dict]:
    """주요 키워드 RSS를 병렬 수집 후 중복 제거, 최신순 정렬."""
    results = await asyncio.gather(
        *[fetch_google_news(kw, _MAX_ARTICLES, when="7d") for kw in _RANKING_KEYWORDS],
        return_exceptions=False,
    )
    seen: set[str] = set()
    articles: list[dict] = []
    for batch in results:
        for article in batch:
            if article["id"] not in seen:
                seen.add(article["id"])
                articles.append(article)

    articles.sort(key=lambda x: x.get("published", ""), reverse=True)
    return articles[:_MAX_ARTICLES]


@router.get("/ranking")
async def get_ranking(
    page: int = Query(default=1, ge=1, description="페이지 번호"),
    size: int = Query(default=10, ge=1, le=20, description="페이지당 건수"),
) -> dict:
    """인기 기사 Top20을 1시간 캐시와 함께 페이지네이션하여 반환한다."""
    now = time.monotonic()
    if _cache["data"] is None or now - _cache["updated_at"] > _CACHE_TTL:
        _cache["data"] = await _refresh_ranking()
        _cache["updated_at"] = now

    articles: list[dict] = _cache["data"]
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
