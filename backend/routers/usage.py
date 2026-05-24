"""GET /api/usage — OpenRouter 일일 사용량 조회"""

from fastapi import APIRouter

from services.usage_tracker import get_usage_status

router = APIRouter()


@router.get("/usage")
async def get_usage() -> dict:
    """
    현재 OpenRouter API 일일 사용량을 반환한다.

    Response:
        {
            "used":      int,   # 오늘 호출한 건수
            "limit":     int,   # 일일 한도 (90)
            "remaining": int,   # 남은 건수
        }
    """
    return get_usage_status()
