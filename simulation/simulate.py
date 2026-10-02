"""OpenDSS 조류 계산 (FR-03, FR-04)"""

from cim.models import FeederGraph
from simulation.models import SimulationResult


def simulate(graph: FeederGraph) -> SimulationResult:
    """계통을 OpenDSS 스크립트로 변환해 조류 계산을 실행하고 결과를 돌려준다."""
    raise NotImplementedError
