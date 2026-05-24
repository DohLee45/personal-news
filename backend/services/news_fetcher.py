"""Google News RSS 수집기 — feedparser + asyncio.to_thread"""

import asyncio
import hashlib
import re
import time
from datetime import datetime, timezone
from urllib.parse import quote

_HTML_TAG = re.compile(r'<[^>]*>')

import feedparser

from services.bias_analyzer import analyze as analyze_bias

# ── 메인 피드 캐시 (5분 TTL) ────────────────────────────────────────────────
_feed_cache: dict = {}   # {cache_key: {"data": [...], "expires": float}}
_FEED_CACHE_TTL = 300    # 5분

# ── 카테고리 피드 캐시 (5분 TTL) ────────────────────────────────────────────
_cat_cache: dict = {}    # {"data": [...], "expires": float}

GOOGLE_NEWS_URL = (
    "https://news.google.com/rss/search"
    "?q={kw}+when:{when}&hl=ko&gl=KR&ceid=KR:ko"
)

# ── 카테고리별 Google News 토픽 RSS ────────────────────────────────────────
CATEGORY_RSS = {
    "정치":   "https://news.google.com/rss/search?q=%EC%A0%95%EC%B9%98&hl=ko&gl=KR&ceid=KR:ko",
    "경제":   "https://news.google.com/rss/topics/CAAqIQgKIhtDQkFTRGdvSUwyMHZNRGx6TVdZU0FtdHZLQUFQAQ?hl=ko&gl=KR&ceid=KR:ko",
    "사회":   "https://news.google.com/rss/search?q=%EC%82%AC%ED%9A%8C&hl=ko&gl=KR&ceid=KR:ko",
    "과학기술": "https://news.google.com/rss/topics/CAAqIQgKIhtDQkFTRGdvSUwyMHZNRGRqTVhZU0FtdHZLQUFQAQ?hl=ko&gl=KR&ceid=KR:ko",
    "스포츠": "https://news.google.com/rss/topics/CAAqIQgKIhtDQkFTRGdvSUwyMHZNRFp1ZEdvU0FtdHZLQUFQAQ?hl=ko&gl=KR&ceid=KR:ko",
    "연예":   "https://news.google.com/rss/topics/CAAqIQgKIhtDQkFTRGdvSUwyMHZNREpxYW5RU0FtdHZLQUFQAQ?hl=ko&gl=KR&ceid=KR:ko",
}


def _parse_source(entry: feedparser.util.FeedParserDict) -> str:
    """feedparser 엔트리에서 언론사명을 추출한다."""
    src = getattr(entry, "source", None)
    if src is None:
        return ""
    if isinstance(src, dict):
        return src.get("title", "")
    return getattr(src, "title", "")


def _parse_published(entry: feedparser.util.FeedParserDict) -> str:
    """published_parsed → ISO-8601 문자열 변환."""
    parsed = getattr(entry, "published_parsed", None)
    if parsed:
        try:
            return datetime(*parsed[:6], tzinfo=timezone.utc).isoformat()
        except Exception:
            pass
    return getattr(entry, "published", "")


def _fetch_feed(url: str, max_items: int) -> list[dict]:
    """feedparser로 RSS를 파싱하여 기사 목록을 반환한다. (동기 함수)

    category는 호출자(fetch_category_news)가 확정한다.
    키워드 검색(fetch_google_news) 경우에는 "미분류"로 설정.
    """
    feed = feedparser.parse(url)
    articles: list[dict] = []

    for entry in feed.entries[:max_items]:
        link: str = getattr(entry, "link", "")
        title: str = getattr(entry, "title", "").strip()
        source: str = _parse_source(entry)
        published: str = _parse_published(entry)
        raw_summary: str = getattr(entry, "summary", "")
        summary: str = _HTML_TAG.sub('', raw_summary).replace('&nbsp;', ' ').strip()
        article_id: str = hashlib.md5(link.encode()).hexdigest()

        # 카테고리는 호출자가 설정 (기본값 "미분류")
        category: str = "미분류"

        # STEP 2: bias_analyzer 연동
        bias = analyze_bias(title, source, summary, category)

        articles.append(
            {
                "id":        article_id,
                "title":     title,
                "link":      link,
                "source":    source,
                "published": published,
                "summary":   summary,
                "category":  category,
                "biasTag":   bias.bias_tag,
                "biasScore": bias.bias_score,
                "viewpoint": bias.viewpoint,
            }
        )

    return articles


async def fetch_category_news(max_items: int = 20) -> list[dict]:
    """6개 카테고리 RSS를 병렬 수집하여 카테고리 자동 확정.

    각 카테고리 URL에서 최대 max_items건씩 수집하고,
    카테고리 필드를 RSS 출처 기준으로 확정한 뒤 중복(title) 제거하여 반환한다.

    캐시 전략: 5분 인메모리 캐시.
    """
    now = time.time()
    if _cat_cache.get("expires", 0) > now:
        return _cat_cache["data"]

    async def _fetch_one(category: str, url: str) -> list[dict]:
        articles = await asyncio.to_thread(_fetch_feed, url, max_items)
        for a in articles:
            a["category"] = category  # RSS 출처로 카테고리 확정
        return articles

    tasks = [_fetch_one(cat, url) for cat, url in CATEGORY_RSS.items()]
    results = await asyncio.gather(*tasks)

    all_articles: list[dict] = []
    seen_titles: set[str] = set()
    for articles in results:
        for a in articles:
            if a["title"] not in seen_titles:
                seen_titles.add(a["title"])
                all_articles.append(a)

    _cat_cache["data"] = all_articles
    _cat_cache["expires"] = now + _FEED_CACHE_TTL
    return all_articles


async def fetch_google_news(keyword: str, max_items: int = 20, when: str = "30d") -> list[dict]:
    """Google News RSS에서 키워드 기사를 비동기로 수집한다.

    키워드 검색 및 추천(recommendation.py)에서 사용.
    카테고리는 "미분류"로 설정된다.

    캐시 전략: keyword:when 조합으로 5분 인메모리 캐시.

    Args:
        keyword:   검색 키워드
        max_items: 최대 수집 건수 (기본 20)
        when:      수집 기간 (기본 "30d")

    Returns:
        기사 딕셔너리 리스트 (category="미분류")
    """
    cache_key = f"{keyword}:{when}"
    now = time.time()

    # 캐시 히트
    if cache_key in _feed_cache and _feed_cache[cache_key]["expires"] > now:
        return _feed_cache[cache_key]["data"]

    # 캐시 미스 → RSS 수집
    encoded_kw = quote(keyword)
    url = GOOGLE_NEWS_URL.format(kw=encoded_kw, when=when)
    result = await asyncio.to_thread(_fetch_feed, url, max_items)

    _feed_cache[cache_key] = {"data": result, "expires": now + _FEED_CACHE_TTL}
    return result
