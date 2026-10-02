"""시뮬레이션 API (FR-03, FR-04)"""

from fastapi import APIRouter

from cim import graph
from simulation.models import SimulationResult
from simulation.simulate import simulate

router = APIRouter()


@router.post("/feeders/{feeder_id}/simulations")
def run_simulation(feeder_id: str) -> SimulationResult:
    """배전선로 계통을 읽어 조류 계산 실행"""
    return simulate(graph.get_feeder(feeder_id))
