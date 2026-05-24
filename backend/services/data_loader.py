"""
data_loader.py — JSON 데이터 파일 중앙 로더

bias_analyzer, recommendation, category_classifier에서
각자 중복 정의하던 @lru_cache JSON 로더를 단일 모듈로 통합.

경로: backend/data/*.json
"""

import json
from functools import lru_cache
from pathlib import Path

_DATA = Path(__file__).parent.parent / "data"


@lru_cache(maxsize=1)
def load_media_bias() -> dict:
    """media_bias.json — 65개 언론사 편향 데이터."""
    return json.loads((_DATA / "media_bias.json").read_text(encoding="utf-8"))


@lru_cache(maxsize=1)
def load_debate_patterns() -> dict:
    """debate_patterns.json — vs_patterns, pro_con_pairs, policy/social 키워드 등."""
    return json.loads((_DATA / "debate_patterns.json").read_text(encoding="utf-8"))


@lru_cache(maxsize=1)
def load_known_stance() -> dict:
    """known_stance.json — 9개 이슈별 기관 입장 (pro/con/neutral)."""
    return json.loads((_DATA / "known_stance.json").read_text(encoding="utf-8"))


@lru_cache(maxsize=1)
def load_category_keywords() -> dict:
    """category_keywords.json — 5개 카테고리별 키워드 목록."""
    return json.loads((_DATA / "category_keywords.json").read_text(encoding="utf-8"))
