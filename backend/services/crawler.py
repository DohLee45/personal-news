"""
crawler.py — 기사 본문 크롤링 (httpx + BeautifulSoup)

동작:
  1) httpx GET (redirect 허용, timeout=10)
  2) <script> <style> <nav> <header> <footer> <aside> 등 노이즈 제거
  3) CONTENT_SELECTORS 순서로 본문 후보 탐색
  4) 모두 실패 시 <body> 전체 텍스트 사용
  5) 10자 미만 라인 제거 후 최대 5 000자 반환

실패 시 빈 문자열 반환 → 호출자가 RSS summary로 대체
"""

from __future__ import annotations

import base64
import re

import httpx
from bs4 import BeautifulSoup

# ── 상수 ──────────────────────────────────────────────────────────────────────

CRAWL_TIMEOUT: int   = 10       # 초
MAX_BODY_LEN:  int   = 5_000    # 반환 최대 문자 수
MIN_CONTENT_LEN: int = 200      # 유효 본문 최소 문자 수

_NOISE_TAGS: list[str] = [
    "script", "style", "nav", "header", "footer",
    "aside", "iframe", "noscript", "figure", "figcaption",
]

_CONTENT_SELECTORS: list[str] = [
    "article",
    "[class*='article-body']",
    "[class*='article_body']",
    "[class*='articleBody']",
    "[class*='news-body']",
    "[class*='news_body']",
    "[class*='newsBody']",
    "[id*='articleBody']",
    "[id*='article-body']",
    "[id*='newsBody']",
    "[class*='article-content']",
    "[class*='article_content']",
    "[class*='news-content']",
    "[class*='content-body']",
    "main",
]

_REQUEST_HEADERS: dict[str, str] = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8",
    "Accept": "text/html,application/xhtml+xml",
}


# ── 공개 유틸 ─────────────────────────────────────────────────────────────────

def decode_google_news_url(google_url: str) -> str:
    """Google News 리다이렉트 URL에서 실제 기사 URL 추출 시도.

    Google News RSS의 CBMi... URL은 protobuf 이중 인코딩 구조로,
    base64 디코딩 후 URL 패턴이 직접 포함된 구형 포맷에만 동작한다.
    현재(2025) 신형 포맷은 JavaScript 실행 없이 실제 URL 도달 불가.

    - 구형 포맷: base64 디코딩 → URL 직접 추출 성공
    - 신형 포맷: protobuf 내부에 AU_yq... 불투명 ID만 존재 → 원본 반환

    Args:
        google_url: Google News RSS 기사 URL

    Returns:
        실제 기사 URL (성공) 또는 원본 google_url (실패)
    """
    try:
        if '/articles/' not in google_url:
            return google_url

        article_id = google_url.split('/articles/')[-1].split('?')[0]
        padding = 4 - len(article_id) % 4
        if padding != 4:
            article_id += '=' * padding

        decoded = base64.urlsafe_b64decode(article_id)

        # 구형 포맷: 디코딩 바이트에 https:// URL이 직접 포함
        urls = re.findall(rb'https?://[^\s\x00-\x1f"\'<>\x80-\xff]+', decoded)
        if urls:
            actual_url = urls[-1].decode('utf-8', errors='ignore')
            if 'news.google.com' not in actual_url:
                return actual_url

        return google_url
    except Exception:
        return google_url


def extract_summary(body: str, max_sentences: int = 5) -> str:
    """크롤링 본문에서 앞 max_sentences 문장을 추출하여 요약으로 반환.

    AI를 사용하지 않는 규칙 기반 추출. API 0회 소모.

    Args:
        body:          크롤링된 본문 텍스트
        max_sentences: 최대 추출 문장 수 (기본 5)

    Returns:
        요약 문자열 또는 '' (본문 없음/짧음)
    """
    if not body or len(body.strip()) < 20:
        return ""

    text = body.strip()

    # 바이라인 제거 (기자명·출처 표기)
    text = re.sub(r'^[\[【(].*?[\]】)]\s*', '', text)
    text = re.sub(r'^.*?(기자|특파원|통신원)\s*=\s*', '', text)

    # 문장 분리 (마침표/다 + 공백 기준)
    sentences = re.split(r'(?<=[.다])\s+', text)

    # 10자 미만 문장 제거
    sentences = [s.strip() for s in sentences if len(s.strip()) >= 10]

    if not sentences:
        return ""

    return ' '.join(sentences[:max_sentences])


# ── 내부 유틸 ─────────────────────────────────────────────────────────────────

def _clean(text: str) -> str:
    """빈 줄·10자 미만 라인 제거, 정제된 텍스트 반환."""
    lines: list[str] = []
    for line in text.split("\n"):
        line = line.strip()
        if len(line) >= 10:
            lines.append(line)
    return "\n".join(lines)


# ── 공개 API ──────────────────────────────────────────────────────────────────

async def crawl_article(url: str) -> str:
    """
    기사 URL을 크롤링하여 본문 텍스트를 반환한다.

    크롤링 실패 또는 본문 미탐지 시 빈 문자열 반환.
    호출자(routers/analysis.py)는 '' 반환 시 RSS summary를 대체 사용한다.

    Args:
        url: 기사 URL

    Returns:
        정제된 본문 텍스트 (최대 5 000자) 또는 '' (실패 시)
    """
    # Google News 리다이렉트 URL이면 실제 URL로 변환 시도
    actual_url = decode_google_news_url(url)

    try:
        async with httpx.AsyncClient(
            timeout=CRAWL_TIMEOUT,
            follow_redirects=True,
            headers=_REQUEST_HEADERS,
        ) as client:
            resp = await client.get(actual_url)
            resp.raise_for_status()

        soup = BeautifulSoup(resp.text, "lxml")

        # ① 노이즈 태그 제거
        for tag in soup(_NOISE_TAGS):
            tag.decompose()

        # ② 본문 셀렉터 순서 탐색
        body_text: str = ""
        for selector in _CONTENT_SELECTORS:
            elem = soup.select_one(selector)
            if elem:
                candidate = _clean(elem.get_text(separator="\n"))
                if len(candidate) >= MIN_CONTENT_LEN:
                    body_text = candidate
                    break

        # ③ 셀렉터 모두 실패 → <body> 전체 폴백
        if not body_text:
            body_elem = soup.find("body")
            if body_elem:
                body_text = _clean(body_elem.get_text(separator="\n"))

        return body_text[:MAX_BODY_LEN]

    except Exception:
        return ""
