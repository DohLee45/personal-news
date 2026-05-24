"""
routers/analysis.py — 기사 분석 엔드포인트 (STEP 8)

엔드포인트:
  POST /api/analysis        — 크롤링 + bias 재계산 + 요약 추출 (API 0회)
  POST /api/deep-analysis   — Agent A AI 정밀 분석 (API 1회, 수동)
  GET  /api/related         — 1차 다른 논조 추천 (RSS 재수집, 무료)
  POST /api/recommend       — Agent C 정밀 추천 (수동, 유지)
"""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, Query

from services.ai_writer import analyze_article, recommend_viewpoints
from services.bias_analyzer import analyze as analyze_bias
from services.crawler import crawl_article, extract_summary
from services.recommendation import get_related_articles

router = APIRouter()


# ── POST /api/analysis ────────────────────────────────────────────────────────

@router.post("/analysis")
async def post_analysis(body: dict) -> dict:
    """
    기사 본문 크롤링 + bias 재계산 + 요약 추출.
    ※ 에이전트 A 호출 없음 — API 0회 소모.

    Request body:
        url      str   — 기사 URL (크롤링 대상)
        title    str   — 기사 제목
        source   str   — 언론사명
        category str   — 분류 카테고리
        summary  str   — RSS 요약 (크롤링 실패 시 대체 본문)

    Response:
        summary      str   — 본문 앞 5문장 추출 요약 (AI 아님)
        body         str   — 크롤링 본문 (최대 3000자)
        updated_bias dict  — 본문 재분석 후 갱신된 편향 정보
            {biasScore, biasTag, viewpoint}
    """
    url      = str(body.get("url",      ""))
    title    = str(body.get("title",    ""))
    source   = str(body.get("source",   ""))
    category = str(body.get("category", "사회"))
    summary  = str(body.get("summary",  ""))

    # ① 크롤링 (실패 시 '' 반환)
    article_body = await crawl_article(url)

    # ② 본문 선택: 크롤링 본문 우선, 없으면 RSS summary
    text_for_analysis = article_body or summary

    # ③ 편향 재분석 (본문 포함)
    bias = analyze_bias(title, source, text_for_analysis, category)

    # ④ 본문 요약 추출 (AI 아님, 앞 5문장)
    # 크롤링 성공: 본문에서 추출 / 실패: RSS summary 폴백 (Google News URL은 크롤링 불가)
    summary_text = extract_summary(article_body) if article_body else summary

    return {
        "summary": summary_text,
        "body":    article_body[:3000] if article_body else "",
        "updated_bias": {
            "biasScore": bias.bias_score,
            "biasTag":   bias.bias_tag,
            "viewpoint": bias.viewpoint,
        },
    }


# ── POST /api/deep-analysis ───────────────────────────────────────────────────

@router.post("/deep-analysis")
async def post_deep_analysis(body: dict) -> dict:
    """
    AI 정밀 분석 — 버튼 클릭 시에만 호출. API 1회 소모.
    Agent A: 편향 판별 설명 + 찬반 입장 + 중도 시각 + 맥락 정보 + AI 편향도 + 교차검증.

    Request body:
        url      str   — 기사 URL (캐시 키)
        title    str   — 기사 제목
        source   str   — 언론사명
        category str   — 분류 카테고리
        summary  str   — RSS 요약 (크롤링 실패 시 대체 본문)

    Response:
        성공:    {bias_explanation, pro_view, con_view, neutral_view,
                  context_note, ai_bias_score, cross_check, recommendations}
        한도초과: {ai_unavailable: true, message: str}
    """
    url      = str(body.get("url",      ""))
    title    = str(body.get("title",    ""))
    source   = str(body.get("source",   ""))
    category = str(body.get("category", "사회"))
    summary  = str(body.get("summary",  ""))

    # ① 크롤링 (재수집)
    article_body = await crawl_article(url)
    text_for_analysis = article_body or summary

    # ② 편향 재분석 (bias_meta 구성)
    bias = analyze_bias(title, source, text_for_analysis, category)
    bias_meta: dict = {
        "bias_score":  bias.bias_score,
        "d_opinion":   bias.components.get("s_text",   0.0),
        "d_source":    bias.components.get("s_media",  0.0),
        "d_bimodal":   bias.components.get("s_quote",  0.0),
        "d_intensity": bias.components.get("s_struct", 0.0),
        "bias_type":   bias.bias_tag,
    }

    # ③ 에이전트 A + 논거 기반 추천 병렬 실행
    result, related = await asyncio.gather(
        analyze_article(
            url=url,
            title=title,
            source=source,
            body=text_for_analysis,
            bias_meta=bias_meta,
        ),
        get_related_articles(title=title, source=source, exclude_url=url),
    )

    # ④ AI 한도 초과 시 그대로 반환
    if result.get("ai_unavailable"):
        return result

    # ⑤ ai_bias_score float 보증 (-1 = 미제공)
    try:
        result["ai_bias_score"] = float(result.get("ai_bias_score", -1))
    except (TypeError, ValueError):
        result["ai_bias_score"] = -1.0

    # ⑥ 논거 기반 추천 기사 첨부
    result["recommendations"] = related.get("articles", [])

    return result


# ── GET /api/related ──────────────────────────────────────────────────────────

@router.get("/related")
async def get_related(
    title:       str = Query(""),
    source:      str = Query(""),
    exclude_url: str = Query(""),
) -> dict:
    """
    기사 제목 키워드로 Google News RSS를 재수집하고
    반대 성향 언론사 기사(최대 5건)를 반환한다.

    Query params:
        title       str   — 원본 기사 제목 (키워드 추출 원본)
        source      str   — 원본 언론사명 (성향 판단용)
        exclude_url str   — 원본 기사 URL (결과에서 제외)

    Response:
        articles           list  — 추천 기사 목록 (article dict 형식)
        non_debate_message str   — 하위 호환용 필드
    """
    if not title:
        return {"articles": [], "non_debate_message": ""}

    return await get_related_articles(
        title=title,
        source=source,
        exclude_url=exclude_url,
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
