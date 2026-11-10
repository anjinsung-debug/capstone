"""AI 리포트 API (FR-08, FR-09)"""

import datetime as dt
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ai_report.capacity import CapacityTable, capacity_table
from ai_report.models import ReinforcementReport, Report
from ai_report.report import (
    generate_capacity_report,
    generate_daily_report,
    generate_hosting_report,
    generate_reinforcement_report,
    generate_report,
)
from cim import graph
from cim.models import SubstationGraph
from simulation.daily import DailyRequest, graph_at, simulate_daily
from simulation.der import DerSummary, HostingCapacity
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


def _graph_at(substation_id: str, date: dt.date | None, hour: int | None):
    try:
        return graph_at(graph.get_substation(substation_id), date, hour)
    except ValueError as e:
        raise HTTPException(422, str(e)) from e


def _at_text(date: dt.date | None, hour: int | None) -> str:
    return f"{date} {hour}시" if date is not None and hour is not None else "최대 조건 (부하 최대 + 태양광 최대)"


class HostingReportRequest(BaseModel):
    """유스케이스 1 ⑤ AI 추천 요청: 화면이 이미 받아 둔 계산 결과를 그대로 보낸다 (다시 계산하지 않음)"""

    substation_id: str
    hosting: HostingCapacity  # POST .../simulations/hosting-capacity 응답
    der_before: DerSummary | None = None  # POST .../simulations/der-comparison 응답의 before·after (분산전원 전체 연결 전후)
    der_after: DerSummary | None = None


@router.post("/reports/hosting")
def create_hosting_report(
    body: HostingReportRequest, audience: Literal["expert", "plain"] = "expert", date: dt.date | None = None, hour: int | None = None
) -> Report:
    """태양광 연계 검토 AI 추천: 연계 가능 여부, 막는 원인, 선로 보강(필요 허용전류) 추천 (ai_report/report.py의 generate_hosting_report)"""
    g = _graph_at(body.substation_id, date, hour)
    der = (body.der_before, body.der_after) if body.der_before and body.der_after else None
    return generate_hosting_report(g, body.hosting, None, der, _at_text(date, hour), audience)


def _graph_for(substation_id: str, g: SubstationGraph | None) -> SubstationGraph:
    if g is not None and g.substation.id != substation_id:
        raise HTTPException(422, "주소의 변전소 id와 graph의 substation.id가 다릅니다")
    return g or graph.get_substation(substation_id)


@router.post("/reports/daily/{substation_id}")
def create_daily_report(substation_id: str, body: DailyRequest | None = None, audience: Literal["expert", "plain"] = "expert") -> Report:
    """고른 날 24시간 AI 운영 권고 (유스케이스 2 ⑥): 0~23시를 계산하고(simulation/daily.py) 시간대별 위험과 대비 조치를 쓴다.
    본문은 /simulations/daily와 같다 (date 없으면 2025-05-26, graph 없으면 DB의 지금 계통)"""
    body = body or DailyRequest()
    g = _graph_for(substation_id, body.graph)
    try:
        daily = simulate_daily(g, body.date)
    except ValueError as e:
        raise HTTPException(422, str(e)) from e
    return generate_daily_report(g, daily, audience)


MAX_REINFORCE_DATES = 4  # 날짜마다 24번 계산하므로 너무 많으면 느리다


class ReinforcementRequest(BaseModel):
    dates: list[dt.date]  # 점검할 날 (예: 여름·겨울 대표일), 1~MAX_REINFORCE_DATES개
    budget_lines: int = 2  # 올해 증강할 수 있는 선로 수
    graph: SubstationGraph | None = None  # 없으면 DB의 지금 계통


@router.post("/reports/reinforcement/{substation_id}")
def create_reinforcement_report(substation_id: str, body: ReinforcementRequest,
                                audience: Literal["expert", "plain"] = "expert") -> ReinforcementReport:
    """설비 보강 우선순위 (유스케이스 3): 고른 날들의 24시간 결과로 선로 순위를 매기고(코드) 증강 순서를 권고한다(AI)"""
    dates = list(dict.fromkeys(body.dates))
    if not 1 <= len(dates) <= MAX_REINFORCE_DATES:
        raise HTTPException(422, f"날짜는 1~{MAX_REINFORCE_DATES}개 보내야 합니다")
    if body.budget_lines < 1:
        raise HTTPException(422, "budget_lines는 1 이상이어야 합니다")
    g = _graph_for(substation_id, body.graph)
    try:
        dailies = [simulate_daily(g, d) for d in dates]
    except ValueError as e:
        raise HTTPException(422, str(e)) from e
    return generate_reinforcement_report(g, dailies, body.budget_lines, audience)


@router.post("/reports/capacity/{substation_id}")
def run_capacity(substation_id: str, date: dt.date | None = None, hour: int | None = None) -> CapacityTable:
    """추가 가능량: 접속점마다 신재생·부하를 몇 kW까지 더 붙일 수 있는지, 무엇이 막는지 (ai_report/capacity.py, 진성이 피드백 11/5).
    date·hour는 /simulations와 같다 (없으면 최대 조건). 계산만 하고 AI는 부르지 않는다 (접속점 수 × 2번 이분 탐색, 수 초)"""
    return capacity_table(_graph_at(substation_id, date, hour))


@router.post("/reports/capacity-ai/{substation_id}")
def create_capacity_report(substation_id: str, table: CapacityTable, audience: Literal["expert", "plain"] = "plain",
                           date: dt.date | None = None, hour: int | None = None) -> Report:
    """추가 가능량 표를 AI가 설명: 계통 전체 요약, 막는 요인, 늘리는 방법 (화면이 받아 둔 표를 그대로 보낸다)"""
    if table.substation_id != substation_id:
        raise HTTPException(422, "주소의 변전소 id와 표의 substation_id가 다릅니다")
    return generate_capacity_report(_graph_at(substation_id, date, hour), table, _at_text(date, hour), audience)
