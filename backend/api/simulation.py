"""시뮬레이션 API (FR-03, FR-04)"""

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

from cim import graph
from simulation.daily import DailyRequest, DailyResult, simulate_daily
from simulation.models import SimulationResult
from simulation.plot import plot_result
from simulation.simulate import simulate

router = APIRouter()


@router.post("/substations/{substation_id}/simulations")
def run_simulation(substation_id: str) -> SimulationResult:
    """변전소 계통을 읽어 4대 시뮬레이션 실행"""
    return simulate(graph.get_substation(substation_id))


@router.post("/substations/{substation_id}/simulations/daily")
def run_daily_simulation(substation_id: str, body: DailyRequest | None = None) -> DailyResult:
    """고른 날 하루(0~23시) 시뮬레이션: 그날의 시간대별 배율(data/profile_2025.csv)을 부하·태양광에 곱해 24번 계산 (simulation/daily.py)

    본문은 없어도 된다. date: 고를 날 (없으면 2025-05-26), graph: 계산할 계통 (없으면 DB에 저장된 지금 계통).
    graph는 화면 결과 기록의 예전 편집 시점 계통을 다른 날짜로 다시 계산할 때 보낸다"""
    body = body or DailyRequest()
    if body.graph is not None and body.graph.substation.id != substation_id:
        raise HTTPException(422, "주소의 변전소 id와 graph의 substation.id가 다릅니다")
    g = body.graph or graph.get_substation(substation_id)
    try:
        return simulate_daily(g, body.date)
    except ValueError as e:  # 고를 수 없는 날짜
        raise HTTPException(422, str(e)) from e


@router.post(
    "/plots",
    response_class=Response,
    responses={200: {"content": {"image/png": {}}}},
)
def create_plot(result: SimulationResult) -> Response:
    """시뮬레이션 결과 그래프 (PNG)"""
    png = plot_result(graph.get_substation(result.substation_id), result)
    return Response(content=png, media_type="image/png")
