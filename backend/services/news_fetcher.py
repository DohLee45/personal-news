"""Google News RSS 수집기 — feedparser + asyncio.to_thread"""

import asyncio
import hashlib
import re
import time
from datetime import datetime, timezone
from urllib.parse import quote

_HTML_TAG = re.compile(r'<[^>]*>')

import feedparser

from services.category_classifier import classify_category
from services.bias_analyzer import analyze as analyze_bias

# ── 메인 피드 캐시 (5분 TTL) ────────────────────────────────────────────────
_feed_cache: dict = {}   # {cache_key: {"data": [...], "expires": float}}
_FEED_CACHE_TTL = 300    # 5분

GOOGLE_NEWS_URL = (
    "https://news.google.com/rss/search"
    "?q={kw}+when:{when}&hl=ko&gl=KR&ceid=KR:ko"
)


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
    """feedparser로 RSS를 파싱하여 기사 목록을 반환한다. (동기 함수)"""
    feed = feedparser.parse(url)
    articles: list[dict] = []

    for entry in feed.entries[:max_items]:
        link: str = getattr(entry, "link", "")
        title: str = getattr(entry, "title", "").strip()
        source: str = _parse_source(entry)
        published: str = _parse_published(entry)
        raw_summary: str = getattr(entry, "summary", "")
        summary: str = _HTML_TAG.sub('', raw_summary).replace('&nbsp;', ' ').strip()
        category: str = classify_category(title, source)
        article_id: str = hashlib.md5(link.encode()).hexdigest()

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


async def fetch_google_news(keyword: str, max_items: int = 20, when: str = "30d") -> list[dict]:
    """Google News RSS에서 키워드 기사를 비동기로 수집한다.

    캐시 전략: keyword:when 조합으로 5분 인메모리 캐시.
    캐시 히트 시 RSS·bias 계산 없이 즉시 반환한다.

    Args:
        keyword:   검색 키워드
        max_items: 최대 수집 건수 (기본 20)
        when:      수집 기간 (기본 "7d" — Google News when: 파라미터)
                   예) "1d" (1일), "7d" (7일), "20d" (20일)

    Returns:
        기사 딕셔너리 리스트
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
