"""Personal NEWS — FastAPI 진입점

프로덕션: React 빌드 결과물(backend/static)을 단독 서빙
개발:     Vite dev server(port 5173)와 분리 실행
"""

from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from routers import analysis, breaking, market, news, ranking, usage

load_dotenv()

BASE_DIR = Path(__file__).parent
STATIC_DIR = BASE_DIR / "static"


# ── FastAPI 앱 ────────────────────────────────────────────────────────────────
app = FastAPI(
    title="Personal NEWS API",
    version="1.0.0",
)

# ── API 라우터 등록 (static mount보다 반드시 먼저) ─────────────────────────────
app.include_router(news.router,     prefix="/api", tags=["news"])
app.include_router(breaking.router, prefix="/api", tags=["breaking"])
app.include_router(ranking.router,  prefix="/api", tags=["ranking"])
app.include_router(market.router,   prefix="/api", tags=["market"])
app.include_router(usage.router,    prefix="/api", tags=["usage"])
app.include_router(analysis.router, prefix="/api", tags=["analysis"])


@app.get("/api/health", tags=["health"])
async def health() -> dict:
    """UptimeRobot 헬스체크 엔드포인트."""
    return {
        "status": "ok",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


# ── React SPA 서빙 (프로덕션) ─────────────────────────────────────────────────
# API 라우터가 모두 등록된 뒤에 마운트해야 /api/* 경로가 static에 가로채이지 않는다.
if STATIC_DIR.exists():
    _index = STATIC_DIR / "index.html"

    # /assets 정적 파일
    _assets_dir = STATIC_DIR / "assets"
    if _assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=_assets_dir), name="assets")

    # SPA 라우팅: /api/* 이외 모든 경로 → index.html
    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str) -> FileResponse:  # noqa: ARG001
        return FileResponse(_index)
