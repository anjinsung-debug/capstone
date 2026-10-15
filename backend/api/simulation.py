"""시뮬레이션 API (FR-03, FR-04)"""

from fastapi import APIRouter
from fastapi.responses import Response

from cim import graph
from simulation.daily import DailyResult, simulate_daily
from simulation.models import SimulationResult
from simulation.plot import plot_result
from simulation.simulate import simulate

router = APIRouter()


@router.post("/substations/{substation_id}/simulations")
def run_simulation(substation_id: str) -> SimulationResult:
    """변전소 계통을 읽어 4대 시뮬레이션 실행"""
    return simulate(graph.get_substation(substation_id))


@router.post("/substations/{substation_id}/simulations/daily")
def run_daily_simulation(substation_id: str) -> DailyResult:
    """대표일 하루(0~23시) 시뮬레이션: 시간대별 배율(data/daily_profile.csv)을 부하·태양광에 곱해 24번 계산 (simulation/daily.py)"""
    return simulate_daily(graph.get_substation(substation_id))


@router.post(
    "/plots",
    response_class=Response,
    responses={200: {"content": {"image/png": {}}}},
)
def create_plot(result: SimulationResult) -> Response:
    """시뮬레이션 결과 그래프 (PNG)"""
    png = plot_result(graph.get_substation(result.substation_id), result)
    return Response(content=png, media_type="image/png")
