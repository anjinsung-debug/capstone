"""AI 리포트 API (FR-08, FR-09)"""

from typing import Literal

from fastapi import APIRouter

from ai_report.models import Report
from ai_report.report import generate_report
from cim import graph
from simulation.models import SimulationResult

router = APIRouter()


@router.post("/reports")
def create_report(result: SimulationResult, audience: Literal["expert", "plain"] = "expert") -> Report:
    """시뮬레이션 결과와 해당 계통 정보로 진단·원인·솔루션 리포트 생성 (audience: expert=전문가용 설명, plain=쉬운 설명)"""
    return generate_report(graph.get_substation(result.substation_id), result, audience=audience)
