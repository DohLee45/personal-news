"""Google News RSS 수집기 — feedparser + asyncio.to_thread"""

import asyncio
import hashlib
import re
from datetime import datetime, timezone
from urllib.parse import quote

_HTML_TAG = re.compile(r'<[^>]*>')

import feedparser

from services.category_classifier import classify_category
from services.bias_analyzer import analyze as analyze_bias

GOOGLE_NEWS_URL = (
    "https://news.google.com/rss/search"
    "?q={kw}&hl=ko&gl=KR&ceid=KR:ko"
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
                "is_debate": bias.is_debate,
            }
        )

    return articles


async def fetch_google_news(keyword: str, max_items: int = 20) -> list[dict]:
    """Google News RSS에서 키워드 기사를 비동기로 수집한다.

    Args:
        keyword:   검색 키워드
        max_items: 최대 수집 건수 (기본 20)

    Returns:
        기사 딕셔너리 리스트
    """
    encoded_kw = quote(keyword)
    url = GOOGLE_NEWS_URL.format(kw=encoded_kw)
    return await asyncio.to_thread(_fetch_feed, url, max_items)
