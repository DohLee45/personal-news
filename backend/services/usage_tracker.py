"""
usage_tracker.py — OpenRouter 일일·분당 사용량 추적

제한값:
  DAILY_LIMIT = 90   건/일  (UTC 자정 초기화)
  RATE_LIMIT  = 20   건/분  (슬라이딩 윈도우)

모델 폴백 순서 (MODELS):
  1순위: deepseek/deepseek-v4-flash:free
  2순위: openai/gpt-oss-120b:free  (HTTP 429 수신 시 자동 전환)

상태는 프로세스 메모리에만 보관됨 — Render 재시작 시 초기화.
"""

import time
from datetime import datetime, timezone

# ── 상수 ─────────────────────────────────────────────────────────────────────

DAILY_LIMIT: int = 90
RATE_LIMIT: int  = 20   # 건/분

# 429 응답 시 순서대로 시도하는 모델 목록
MODELS: list[str] = [
    "deepseek/deepseek-v4-flash:free",
    "openai/gpt-oss-120b:free",
]

# ── 상태 변수 (모듈 레벨) ──────────────────────────────────────────────────────

_daily_count: int            = 0
_daily_date: str             = ""            # "YYYY-MM-DD" UTC 기준
_minute_timestamps: list[float] = []         # 슬라이딩 윈도우 (Unix 타임스탬프)


# ── 내부 헬퍼 ─────────────────────────────────────────────────────────────────

def _today_utc() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _reset_if_new_day() -> None:
    """UTC 자정이 지나면 일일 카운터를 0으로 초기화."""
    global _daily_count, _daily_date
    today = _today_utc()
    if _daily_date != today:
        _daily_count = 0
        _daily_date  = today


def _prune_minute_window() -> None:
    """60초 이상 지난 타임스탬프를 슬라이딩 윈도우에서 제거."""
    cutoff = time.time() - 60.0
    _minute_timestamps[:] = [t for t in _minute_timestamps if t > cutoff]


# ── 공개 API ──────────────────────────────────────────────────────────────────

def can_use_api() -> bool:
    """
    API 호출 가능 여부를 반환한다.

    Returns:
        True  — 일일 한도(90건)와 분당 한도(20건) 모두 여유 있음
        False — 둘 중 하나라도 초과
    """
    _reset_if_new_day()
    _prune_minute_window()
    return (
        _daily_count < DAILY_LIMIT
        and len(_minute_timestamps) < RATE_LIMIT
    )


def increment_usage() -> None:
    """
    API 호출 성공 직후 카운터를 1 증가시킨다.
    반드시 실제 OpenRouter 응답(2xx)을 확인한 뒤 호출할 것.
    """
    global _daily_count
    _reset_if_new_day()
    _daily_count += 1
    _minute_timestamps.append(time.time())


def get_usage_status() -> dict:
    """
    GET /api/usage 응답 형식으로 현재 사용량을 반환한다.

    Returns:
        {
            "used":      int,   # 오늘 사용한 건수
            "limit":     int,   # 일일 한도 (90)
            "remaining": int,   # 남은 건수
        }
    """
    _reset_if_new_day()
    return {
        "used":      _daily_count,
        "limit":     DAILY_LIMIT,
        "remaining": max(0, DAILY_LIMIT - _daily_count),
    }
