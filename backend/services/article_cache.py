"""
article_cache.py — 인메모리 기사·추천 캐시

키 전략:
  - 기사 분석 결과 : md5(url)
  - 추천 결과      : "recommend_" + md5(url)

TTL: CACHE_TTL = 21 600초 (6시간)
스토어는 프로세스 메모리 내 딕셔너리 — Render 재시작 시 초기화됨.
"""

import hashlib
import time
from typing import Any

CACHE_TTL: int = 21_600  # 6시간 (초)

# _store: { cache_key → (value, expires_at_unix) }
_store: dict[str, tuple[Any, float]] = {}


# ── 내부 헬퍼 ─────────────────────────────────────────────────────────────────

def _key(url: str) -> str:
    """URL → md5 hex digest (32자)."""
    return hashlib.md5(url.encode()).hexdigest()


def _recommend_key(url: str) -> str:
    """추천 결과 전용 키: 'recommend_' + md5(url)."""
    return f"recommend_{_key(url)}"


def _get(cache_key: str) -> Any | None:
    """공통 조회 — 만료된 항목은 자동 삭제 후 None 반환."""
    entry = _store.get(cache_key)
    if entry is None:
        return None
    value, expires_at = entry
    if time.time() < expires_at:
        return value
    # 만료
    _store.pop(cache_key, None)
    return None


def _set(cache_key: str, value: Any) -> None:
    """공통 저장 — 현재 시각 기준 CACHE_TTL 후 만료."""
    _store[cache_key] = (value, time.time() + CACHE_TTL)


# ── 기사 분석 결과 캐시 ────────────────────────────────────────────────────────

def get_article(url: str) -> dict | None:
    """저장된 기사 분석 결과 반환. 없거나 만료 시 None."""
    return _get(_key(url))


def set_article(url: str, data: dict) -> None:
    """기사 분석 결과 저장 (TTL=6h)."""
    _set(_key(url), data)


# ── 추천 결과 캐시 ────────────────────────────────────────────────────────────

def get_recommend(url: str) -> list | None:
    """저장된 추천 기사 목록 반환. 없거나 만료 시 None."""
    return _get(_recommend_key(url))


def set_recommend(url: str, data: list) -> None:
    """추천 기사 목록 저장 (TTL=6h)."""
    _set(_recommend_key(url), data)


# ── 유지보수 ──────────────────────────────────────────────────────────────────

def clear_expired() -> int:
    """만료된 항목을 일괄 삭제하고 삭제 건수를 반환."""
    now = time.time()
    expired_keys = [k for k, (_, exp) in _store.items() if now >= exp]
    for k in expired_keys:
        del _store[k]
    return len(expired_keys)


def cache_size() -> int:
    """현재 저장된 전체 항목 수 (만료 포함)."""
    return len(_store)
