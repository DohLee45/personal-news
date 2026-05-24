"""
ai_writer.py — Agent A (분석관) & Agent C (관점 탐색기)

핵심 함수
─────────
call_openrouter(system, user, models, max_tokens=2000)
  - HTTP 429 → asyncio.sleep(3) + 다음 모델로 폴백
  - 전 모델 실패 → Exception 발생

analyze_article(url, title, source, body, bias_meta) → dict
  [Agent A — Personal NEWS 분석관]
  역할: 원문요약 + 편향판별설명 + 찬반분리 + 맥락보완 + 교차검증
  권한: ✅ 원문  ✅ 판별결과  ❌ 외부  ❌ 사용자정보  ❌ 사견
  호출: 기사 상세 진입 시 자동 (API 1~2회)
  캐시: get_article / set_article (6시간 TTL)

recommend_viewpoints(article, candidates) → dict
  [Agent C — Personal NEWS 관점 탐색기]
  역할: 같은 주제 다른 시각 기사 선별 + 추천 사유
  권한: ✅ 원본요약  ✅ 후보 제목·출처  ❌ 원문전문  ❌ 외부  ❌ 사견
  호출: 'AI 정밀 분석' 버튼 클릭 시 수동 (API 1회)
  캐시: get_recommend / set_recommend (6시간 TTL)

AI 3원칙 (모든 프롬프트 포함):
  ① 출처 명시  ② 사실 검증(신뢰도 ≥ 0.85)  ③ 사견 배제

한도 초과 응답:
  {"ai_unavailable": True, "message": "OpenRouter API 사용량이 다 하였습니다."}
"""

import asyncio
import json
import os
import re
from typing import Any

import httpx

from services.article_cache import (
    get_article,
    get_recommend,
    set_article,
    set_recommend,
)
from services.usage_tracker import MODELS, can_use_api, increment_usage

# ── 상수 ─────────────────────────────────────────────────────────────────────

OPENROUTER_URL: str = "https://openrouter.ai/api/v1/chat/completions"

AI_UNAVAILABLE: dict[str, Any] = {
    "ai_unavailable": True,
    "message": "OpenRouter API 사용량이 다 하였습니다.",
}

# 본문 토큰 절약을 위한 최대 문자 수 (약 1 000 토큰)
_BODY_LIMIT: int = 4_000

# ── Agent A 프롬프트 ──────────────────────────────────────────────────────────

_AGENT_A_SYSTEM: str = (
    "뉴스분석관. 원문사실만 사용. AI판단금지. "
    "찬반=원문인물발언만. 출처명시. JSON만응답."
)

# { } 중 format 변수: source, title, body, bias_score, d_opinion, d_source,
#                      d_bimodal, d_intensity, bias_type
# {{ }} 는 응답 JSON 예시에서 리터럴 중괄호
_AGENT_A_USER_TMPL: str = """\
[출처: {source}] [제목: {title}]
[원문: {body}]
[편향도: B={bias_score:.2f}, 관점편중도={d_opinion:.2f}, 언론사편중도={d_source:.2f}, \
이봉성={d_bimodal:.2f}, 편향강도={d_intensity:.2f}]
[유형: {bias_type}]

다음 JSON 형식으로만 응답하세요:
{{
  "summary": ["요약 문장1", "요약 문장2", "요약 문장3"],
  "bias_explanation": "편향 판별 설명 (원문 근거)",
  "pro_view": "찬성 측 주장 (원문 인물 발언 인용)",
  "con_view": "반대 측 주장 (원문 인물 발언 인용)",
  "neutral_view": "중립적 해석",
  "context_note": "맥락 보완 및 배경 정보",
  "ai_bias_score": 0.0,
  "cross_check": "교차검증 포인트 (독자가 확인해야 할 사항)"
}}"""

# ── Agent C 프롬프트 ──────────────────────────────────────────────────────────

_AGENT_C_SYSTEM: str = (
    "관점탐색기. 같은주제다른시각 선별. 사견금지. JSON만응답."
)

# format 변수: title, source, summary, bias_score, candidates_text
_AGENT_C_USER_TMPL: str = """\
[원본 제목: {title}] [출처: {source}] [요약: {summary}] [편향도: {bias_score:.2f}]

[후보 목록]
{candidates_text}

다음 JSON 형식으로만 응답하세요:
{{
  "recommendations": [
    {{"index": 0, "reason": "추천 이유"}}
  ],
  "no_result_reason": "추천 불가 사유 (해당 없으면 빈 문자열)"
}}"""


# ── 공개 API ──────────────────────────────────────────────────────────────────

async def call_openrouter(
    system: str,
    user: str,
    models: list[str],
    max_tokens: int = 2000,
) -> str:
    """
    OpenRouter API를 호출하고 모델 응답 텍스트를 반환한다.

    동작:
      - HTTP 429 수신 시 3초 대기 후 다음 모델로 폴백
      - 모든 모델 실패 시 Exception 발생
      - 성공 시 increment_usage() 호출

    Args:
        system:     시스템 프롬프트
        user:       유저 프롬프트
        models:     시도할 모델 목록 (순서대로 폴백)
        max_tokens: 최대 응답 토큰 수 (기본 2000)

    Returns:
        모델 응답 텍스트

    Raises:
        Exception: 모든 모델이 실패했을 때
    """
    api_key = os.getenv("OPENROUTER_API_KEY", "")
    headers: dict[str, str] = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://personal-news.onrender.com",
        "X-Title": "Personal NEWS",
    }
    messages: list[dict] = [
        {"role": "system", "content": system},
        {"role": "user",   "content": user},
    ]

    last_exc: Exception = Exception("모델 목록이 비어 있습니다.")

    async with httpx.AsyncClient(timeout=30) as client:
        for model in models:
            payload: dict[str, Any] = {
                "model":      model,
                "messages":   messages,
                "max_tokens": max_tokens,
            }
            try:
                resp = await client.post(
                    OPENROUTER_URL, headers=headers, json=payload
                )
                if resp.status_code == 429:
                    # 429 — 3초 대기 후 다음 모델로 폴백
                    await asyncio.sleep(3)
                    last_exc = Exception(f"429 Too Many Requests (model={model})")
                    continue
                resp.raise_for_status()
                content: str = resp.json()["choices"][0]["message"]["content"]
                increment_usage()
                return content
            except httpx.HTTPStatusError as e:
                last_exc = e
                continue
            except Exception as e:
                last_exc = e
                continue

    raise Exception(f"모든 모델 실패: {last_exc}") from last_exc


async def analyze_article(
    url: str,
    title: str,
    source: str,
    body: str,
    bias_meta: dict[str, Any],
) -> dict[str, Any]:
    """
    [Agent A — Personal NEWS 분석관]

    기사 원문을 바탕으로 요약·편향 설명·찬반·맥락·교차검증을 생성한다.

    Args:
        url:       기사 URL (캐시 키)
        title:     기사 제목
        source:    언론사명
        body:      크롤링된 본문 (없으면 summary)
        bias_meta: {
            bias_score  float  — 종합 편향도 (0~1)
            d_opinion   float  — 관점편중도
            d_source    float  — 언론사편중도
            d_bimodal   float  — 이봉성
            d_intensity float  — 편향강도
            bias_type   str    — 편향 유형 레이블 (e.g. "관점 포함 🟡")
        }

    Returns:
        성공: {summary, bias_explanation, pro_view, con_view,
               neutral_view, context_note, ai_bias_score, cross_check}
        한도초과: AI_UNAVAILABLE dict
    """
    # ① 캐시 히트
    cached = get_article(url)
    if cached:
        return cached

    # ② 한도 확인
    if not can_use_api():
        return dict(AI_UNAVAILABLE)

    # ③ 프롬프트 조합
    user_prompt = _AGENT_A_USER_TMPL.format(
        source=source,
        title=title,
        body=body[:_BODY_LIMIT],
        bias_score=float(bias_meta.get("bias_score",  0.0)),
        d_opinion= float(bias_meta.get("d_opinion",   0.0)),
        d_source=  float(bias_meta.get("d_source",    0.0)),
        d_bimodal= float(bias_meta.get("d_bimodal",   0.0)),
        d_intensity=float(bias_meta.get("d_intensity",0.0)),
        bias_type= str(bias_meta.get("bias_type", "미분류")),
    )

    # ④ OpenRouter 호출
    try:
        raw = await call_openrouter(
            system=_AGENT_A_SYSTEM,
            user=user_prompt,
            models=MODELS,
            max_tokens=2000,
        )
        result = _parse_json(raw)
    except Exception:
        return dict(AI_UNAVAILABLE)

    # ⑤ 필수 필드 보증
    result.setdefault("summary",          [])
    result.setdefault("bias_explanation", "")
    result.setdefault("pro_view",         "")
    result.setdefault("con_view",         "")
    result.setdefault("neutral_view",     "")
    result.setdefault("context_note",     "")
    result.setdefault("ai_bias_score",    0.0)
    result.setdefault("cross_check",      "")

    # ⑥ 캐시 저장
    set_article(url, result)
    return result


async def recommend_viewpoints(
    article: dict[str, Any],
    candidates: list[dict[str, Any]],
) -> dict[str, Any]:
    """
    [Agent C — Personal NEWS 관점 탐색기]

    후보 기사 목록에서 원본 기사와 다른 시각을 가진 기사를 선별하고
    추천 사유를 반환한다.

    Args:
        article:    원본 기사 dict (title, source, link, biasScore 또는 bias_score,
                    summary, ai_analysis 포함 가능)
        candidates: 추천 후보 기사 목록 [{title, source, ...}, ...]
                    ※ 원문 전문은 포함하지 않음 (Agent C 권한 외)

    Returns:
        성공: {recommendations: [{index: int, reason: str}, ...],
               no_result_reason: str}
        한도초과: AI_UNAVAILABLE dict
    """
    url = str(article.get("link", ""))

    # ① 캐시 히트
    cached = get_recommend(url)
    if cached is not None:
        return {"recommendations": cached, "no_result_reason": ""}

    # ② 한도 확인
    if not can_use_api():
        return dict(AI_UNAVAILABLE)

    # ③ 요약 텍스트 결정 (Agent A 결과 우선, 없으면 summary 필드)
    summary_text: str = str(article.get("summary", ""))
    ai_analysis = article.get("ai_analysis")
    if isinstance(ai_analysis, dict):
        ai_summary = ai_analysis.get("summary", [])
        if ai_summary:
            summary_text = " ".join(str(s) for s in ai_summary[:2])

    # ④ 후보 목록 포매팅 (출처·제목만 노출 — 원문 전문 제외)
    if candidates:
        lines = [
            f"{i}. [{c.get('source', '')}] {c.get('title', '')}"
            for i, c in enumerate(candidates)
        ]
        candidates_text = "\n".join(lines)
    else:
        candidates_text = "(후보 없음)"

    # biasScore(카멜) 또는 bias_score(스네이크) 모두 허용
    bias_score = float(
        article.get("biasScore", article.get("bias_score", 0.0))
    )

    user_prompt = _AGENT_C_USER_TMPL.format(
        title=          str(article.get("title",  "")),
        source=         str(article.get("source", "")),
        summary=        summary_text[:500],
        bias_score=     bias_score,
        candidates_text=candidates_text,
    )

    # ⑤ OpenRouter 호출
    try:
        raw = await call_openrouter(
            system=_AGENT_C_SYSTEM,
            user=user_prompt,
            models=MODELS,
            max_tokens=1000,
        )
        result = _parse_json(raw)
    except Exception:
        return dict(AI_UNAVAILABLE)

    # ⑥ 필수 필드 보증
    result.setdefault("recommendations",  [])
    result.setdefault("no_result_reason", "")

    # ⑦ 추천 목록만 캐시 (리스트 형태)
    set_recommend(url, result["recommendations"])
    return result


# ── 내부 유틸 ─────────────────────────────────────────────────────────────────

def _parse_json(raw: str) -> dict[str, Any]:
    """
    LLM 응답에서 JSON을 추출·파싱한다.

    처리 순서:
      1) 마크다운 코드블록(```json ... ```) 제거
      2) 첫 번째 '{' ~ 마지막 '}' 범위 추출 (앞뒤 텍스트 무시)
      3) json.loads()
    """
    text = raw.strip()

    # 마크다운 코드블록 제거
    fence = re.match(r"^```(?:json)?\s*\n?(.*?)```$", text, re.DOTALL)
    if fence:
        text = fence.group(1).strip()

    # 첫 { ~ 마지막 } 사이 추출 (모델이 앞뒤에 설명을 붙이는 경우 대비)
    start = text.find("{")
    end   = text.rfind("}")
    if start != -1 and end != -1 and end > start:
        text = text[start : end + 1]

    return json.loads(text)
