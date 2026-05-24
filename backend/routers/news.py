"""GET /api/news — 카테고리 RSS 피드 + 키워드 검색"""

import asyncio

from fastapi import APIRouter, Query

from services.news_fetcher import fetch_category_news, fetch_google_news

router = APIRouter()


@router.get("/news")
async def get_news(
    keywords: str = Query(default="", description="검색 키워드 (비어있으면 카테고리 RSS 피드)"),
    max: int = Query(default=20, ge=1, le=50, description="최대 반환 건수"),
    when: str = Query(default="7d", description="검색 시 수집 기간 (예: 1d, 7d, 20d)"),
) -> list[dict]:
    """뉴스 피드 반환.

    - keywords 없음: 6개 카테고리 Google News RSS에서 병렬 수집 (카테고리 자동 확정)
    - keywords 있음: 키워드별 Google News 검색 (검색어 입력 시, category='미분류')
    """
    if keywords.strip():
        # 검색 모드: 키워드별 RSS 수집 후 중복 제거·최신순 정렬
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

    # 피드 모드: 6개 카테고리 RSS 병렬 수집 (카테고리 확정)
    return await fetch_category_news(max_items=max)
