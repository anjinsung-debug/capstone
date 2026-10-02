from fastapi import APIRouter

router = APIRouter()


@router.get("/health")
def health():
    """서버 상태 확인"""
    return {"status": "ok"}
