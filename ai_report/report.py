"""LLM 리포트 생성 (FR-08)"""

from ai_report.models import Report
from simulation.models import SimulationResult


def generate_report(result: SimulationResult) -> Report:
    """시뮬레이션 결과 수치를 프롬프트로 만들어 LLM으로 리포트를 생성한다."""
    raise NotImplementedError
