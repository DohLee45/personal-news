"""GET /api/news — 키워드 기반 뉴스 피드"""

import asyncio

from fastapi import APIRouter, Query

from services.news_fetcher import fetch_google_news

router = APIRouter()


@router.get("/news")
async def get_news(
    keywords: str = Query(default="뉴스", description="쉼표 구분 키워드"),
    max: int = Query(default=20, ge=1, le=50, description="최대 반환 건수"),
    when: str = Query(default="7d", description="수집 기간 (예: 1d, 7d, 20d)"),
) -> list[dict]:
    """키워드별 Google News RSS를 asyncio.gather로 동시 수집하고,
    중복(id 기준) 제거 후 최신순 정렬하여 반환한다."""
    kw_list = [kw.strip() for kw in keywords.split(",") if kw.strip()]
    if not kw_list:
        kw_list = ["뉴스"]

    results = await asyncio.gather(
        *[fetch_google_news(kw, max, when=when) for kw in kw_list],
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
    return articles[:max]
