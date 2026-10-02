"""시뮬레이션 API (FR-03, FR-04)"""

from fastapi import APIRouter, HTTPException

router = APIRouter()


def not_implemented():
    raise HTTPException(status_code=501, detail="아직 구현되지 않았습니다.")


@router.post("/feeders/{feeder_id}/simulations")
def run_simulation(feeder_id: str):
    """배전선로에 대해 OpenDSS 조류 계산 실행"""
    not_implemented()


@router.get("/simulations/{simulation_id}")
def get_simulation(simulation_id: str):
    """시뮬레이션 결과 조회 (유효/무효 전력 등)"""
    not_implemented()
