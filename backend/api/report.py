"""AI 리포트 API (FR-08, FR-09)"""

import datetime as dt
from typing import Literal

from fastapi import APIRouter, HTTPException

from ai_report.models import Report
from ai_report.report import generate_report
from cim import graph
from simulation.daily import graph_at
from simulation.models import SimulationResult

router = APIRouter()


@router.post("/reports")
def create_report(
    result: SimulationResult, audience: Literal["expert", "plain"] = "expert", date: dt.date | None = None, hour: int | None = None
) -> Report:
    """시뮬레이션 결과와 해당 계통 정보로 진단·원인·솔루션 리포트 생성 (audience: expert=전문가용 설명, plain=쉬운 설명)
    date·hour: 결과를 그 시각 배율로 계산했으면 같이 보낸다. 프롬프트의 부하·태양광 kW도 같은 시각 값으로 맞춘다"""
    try:
        g = graph_at(graph.get_substation(result.substation_id), date, hour)
    except ValueError as e:
        raise HTTPException(422, str(e)) from e
    return generate_report(g, result, audience=audience)
