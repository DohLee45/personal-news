"""
routers/analysis.py — AI 기사 분석 엔드포인트 (STEP 8)

엔드포인트:
  POST /api/analysis        — 크롤링 + Agent A 분석
  GET  /api/related         — 1차 다른 논조 추천 (RSS 재수집, 무료)
  POST /api/recommend       — Agent C 정밀 추천 (수동)
"""

from __future__ import annotations

from fastapi import APIRouter, Query

from services.ai_writer import analyze_article, recommend_viewpoints
from services.bias_analyzer import analyze as analyze_bias
from services.crawler import crawl_article
from services.recommendation import get_related_articles

router = APIRouter()


# ── POST /api/analysis ────────────────────────────────────────────────────────

@router.post("/analysis")
async def post_analysis(body: dict) -> dict:
    """
    기사 본문 크롤링 + Agent A AI 분석을 수행한다.

    Request body:
        url      str   — 기사 URL (크롤링 대상)
        title    str   — 기사 제목
        source   str   — 언론사명
        category str   — 분류 카테고리
        summary  str   — RSS 요약 (크롤링 실패 시 대체 본문)

    Response:
        body_crawled  bool  — 크롤링 성공 여부
        ai_analysis   dict  — Agent A 결과 또는 ai_unavailable 딕셔너리
        updated_bias  dict  — 본문 재분석 후 갱신된 편향 정보
            {biasScore, biasTag, is_debate, viewpoint}
    """
    url      = str(body.get("url",      ""))
    title    = str(body.get("title",    ""))
    source   = str(body.get("source",   ""))
    category = str(body.get("category", "시사·사회"))
    summary  = str(body.get("summary",  ""))

    # ① 크롤링 (실패 시 '' 반환)
    article_body = await crawl_article(url)
    body_crawled = bool(article_body)

    # ② 본문 선택: 크롤링 본문 우선, 없으면 RSS summary
    text_for_analysis = article_body or summary

    # ③ 편향 재분석 (본문 포함)
    bias = analyze_bias(title, source, text_for_analysis, category)
    bias_meta: dict = {
        "bias_score":  bias.bias_score,
        "d_opinion":   bias.components.get("s_text",   0.0),
        "d_source":    bias.components.get("s_media",  0.0),
        "d_bimodal":   bias.components.get("s_quote",  0.0),
        "d_intensity": bias.components.get("s_struct", 0.0),
        "bias_type":   bias.bias_tag,
    }

    # ④ Agent A 호출
    ai_analysis = await analyze_article(
        url=url,
        title=title,
        source=source,
        body=text_for_analysis,
        bias_meta=bias_meta,
    )

    return {
        "body_crawled": body_crawled,
        "ai_analysis":  ai_analysis,
        "updated_bias": {
            "biasScore": bias.bias_score,
            "biasTag":   bias.bias_tag,
            "is_debate": bias.is_debate,
            "viewpoint": bias.viewpoint,
        },
    }


# ── GET /api/related ──────────────────────────────────────────────────────────

@router.get("/related")
async def get_related(
    title:       str  = Query(""),
    source:      str  = Query(""),
    exclude_url: str  = Query(""),
    is_debate:   bool = Query(True),
) -> dict:
    """
    기사 제목 키워드로 Google News RSS를 재수집하고
    반대 성향 언론사 기사(최대 5건)를 반환한다.

    Query params:
        title       str   — 원본 기사 제목 (키워드 추출 원본)
        source      str   — 원본 언론사명 (성향 판단용)
        exclude_url str   — 원본 기사 URL (결과에서 제외)
        is_debate   bool  — 논쟁형 여부 (False면 빈 배열 반환)

    Response:
        articles           list  — 추천 기사 목록 (article dict 형식)
        non_debate_message str   — 비논쟁형 안내 문구 (해당 없으면 '')
    """
    if not title:
        return {"articles": [], "non_debate_message": ""}

    return await get_related_articles(
        title=title,
        source=source,
        exclude_url=exclude_url,
        is_debate=is_debate,
    )


# ── POST /api/recommend ───────────────────────────────────────────────────────

@router.post("/recommend")
async def post_recommend(body: dict) -> dict:
    """
    Agent C — 'AI 정밀 분석' 버튼 클릭 시 호출.
    후보 기사 중 다른 시각 기사를 선별하고 추천 사유를 반환한다.

    Request body:
        article    dict   — 원본 기사 (title, source, link, biasScore 등)
        candidates list   — 추천 후보 기사 목록

    Response:
        recommendations   list  — [{index: int, reason: str}, ...]
        no_result_reason  str   — 추천 불가 사유 (없으면 '')
        또는 ai_unavailable dict (한도 초과)
    """
    article    = body.get("article",    {})
    candidates = body.get("candidates", [])

    if not isinstance(article, dict):
        article = {}
    if not isinstance(candidates, list):
        candidates = []

    return await recommend_viewpoints(article, candidates)
