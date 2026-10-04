"""LLM 리포트 생성 (FR-08, 제안서 5단계)"""

from ai_report.models import Report
from cim.models import SubstationGraph
from simulation.models import SimulationResult


def generate_report(graph: SubstationGraph, result: SimulationResult) -> Report:
    """계통 정보(설비 이름·종류·연결)와 해석 수치(전압 pu, 선로 부하율, 고장전류, 역조류, 피더별 송출 전력)를
    구조화된 텍스트로 만들어 LLM에 넣고, 비전문가도 이해할 수 있는 3단계 리포트로 돌려받는다."""
    raise NotImplementedError
