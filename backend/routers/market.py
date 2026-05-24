"""GET /api/market — 주가·환율·원자재 시세 (5분 캐시, yfinance)"""

import asyncio
import time
from datetime import datetime, timezone
from typing import Optional

import yfinance as yf
from fastapi import APIRouter

router = APIRouter()

# ── 20개 종목 메타데이터 ──────────────────────────────────────────────────────
MARKET_ITEMS: list[dict] = [
    # [1P] 주요 지수
    {"ticker": "^KS11",    "name": "코스피"},
    {"ticker": "^KQ11",    "name": "코스닥"},
    {"ticker": "^IXIC",    "name": "나스닥"},
    {"ticker": "^GSPC",    "name": "S&P500"},
    {"ticker": "^DJI",     "name": "다우존스"},
    # [2P] 환율·원자재
    {"ticker": "USDKRW=X", "name": "원달러"},
    {"ticker": "JPYKRW=X", "name": "원엔"},
    {"ticker": "EURKRW=X", "name": "원유로"},
    {"ticker": "CL=F",     "name": "WTI유가"},
    {"ticker": "GC=F",     "name": "금"},
    # [3P] 국내 ETF
    {"ticker": "069500.KS","name": "KODEX200"},
    {"ticker": "122630.KS","name": "KODEX레버리지"},
    {"ticker": "133690.KS","name": "TIGER나스닥100"},
    {"ticker": "114800.KS","name": "KODEX인버스"},
    {"ticker": "091160.KS","name": "KODEX반도체"},
    # [4P] 해외 ETF·암호화폐
    {"ticker": "SPY",      "name": "SPY"},
    {"ticker": "QQQ",      "name": "QQQ"},
    {"ticker": "SOXX",     "name": "SOXX"},
    {"ticker": "BTC-USD",  "name": "비트코인"},
    {"ticker": "ETH-USD",  "name": "이더리움"},
]

_CACHE_TTL = 300  # 5분
_cache: dict = {"data": None, "updated_at": 0.0}


def _build_item(
    ticker: str,
    name: str,
    curr: Optional[float],
    prev: Optional[float],
) -> dict:
    """가격·변동 딕셔너리를 생성한다."""
    if curr is None or prev is None or prev == 0:
        return {
            "ticker": ticker,
            "name": name,
            "price": None,
            "change": None,
            "changePct": None,
            "direction": "flat",
        }
    change = curr - prev
    change_pct = (change / prev) * 100
    return {
        "ticker": ticker,
        "name": name,
        "price": round(curr, 2),
        "change": round(change, 2),
        "changePct": round(change_pct, 2),
        "direction": "up" if change >= 0 else "down",
    }


def _fetch_market_data() -> list[dict]:
    """yfinance 배치 다운로드로 20개 종목 시세를 조회한다. (동기 함수)"""
    tickers = [m["ticker"] for m in MARKET_ITEMS]
    try:
        raw = yf.download(
            tickers=tickers,
            period="5d",
            interval="1d",
            progress=False,
            auto_adjust=True,
        )
        close = raw.get("Close")
        if close is None:
            raise ValueError("Close column missing")
    except Exception:
        # yfinance 실패 시 전체 flat 반환
        return [_build_item(m["ticker"], m["name"], None, None) for m in MARKET_ITEMS]

    items: list[dict] = []
    for meta in MARKET_ITEMS:
        ticker = meta["ticker"]
        try:
            # MultiIndex(여러 종목) vs 단일 컬럼 모두 처리
            if hasattr(close, "columns"):
                series = close[ticker].dropna()
            else:
                series = close.dropna()

            if len(series) < 2:
                raise ValueError("insufficient rows")

            curr = float(series.iloc[-1])
            prev = float(series.iloc[-2])
            items.append(_build_item(ticker, meta["name"], curr, prev))
        except Exception:
            items.append(_build_item(ticker, meta["name"], None, None))

    return items


@router.get("/market")
async def get_market() -> dict:
    """20개 종목 시세를 5분 캐시와 함께 반환한다.
    yfinance는 동기 라이브러리이므로 asyncio.to_thread로 래핑한다."""
    now = time.monotonic()
    if _cache["data"] is None or now - _cache["updated_at"] > _CACHE_TTL:
        _cache["data"] = await asyncio.to_thread(_fetch_market_data)
        _cache["updated_at"] = now

    return {
        "items": _cache["data"],
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "notice": "시세는 약 20분 지연될 수 있습니다",
    }
