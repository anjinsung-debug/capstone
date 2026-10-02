"""LLM 리포트 생성 (FR-08)"""

from ai_report.models import Report
from cim.models import FeederGraph
from simulation.models import SimulationResult


def generate_report(graph: FeederGraph, result: SimulationResult) -> Report:
    """계통 정보(노드·선로 이름, 종류, 연결)와 시뮬레이션 결과 수치를 프롬프트로 만들어
    비전문가도 이해할 수 있는 리포트를 LLM으로 생성한다."""
    raise NotImplementedError
