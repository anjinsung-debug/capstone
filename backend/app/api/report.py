"""AI 리포트 API (FR-08, FR-09)"""

from fastapi import APIRouter, HTTPException

router = APIRouter()


def not_implemented():
    raise HTTPException(status_code=501, detail="아직 구현되지 않았습니다.")


@router.post("/simulations/{simulation_id}/report")
def create_report(simulation_id: str):
    """시뮬레이션 결과로 진단·원인·솔루션 리포트 생성"""
    not_implemented()
