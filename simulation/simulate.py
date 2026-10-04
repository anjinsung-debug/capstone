"""OpenDSS 4대 시뮬레이션 (FR-03, FR-04, 제안서 2·3단계)

전압 영향, 선로 과부하, 역조류, 단락용량 고장전류를 계산하고 피더별 송출 전력을 구한다.
OpenDSS 스크립트 변환은 simulation/dss.py의 to_dss_script가 맡는다.
"""

from cim.models import SubstationGraph
from simulation.dss import to_dss_script
from simulation.models import SimulationResult


def simulate(graph: SubstationGraph) -> SimulationResult:
    """변전소 계통을 OpenDSS 스크립트로 변환해 조류 계산·고장 해석을 실행하고 결과를 돌려준다."""
    script = to_dss_script(graph)  # noqa: F841 (구현 시 opendssdirect로 실행)
    raise NotImplementedError
