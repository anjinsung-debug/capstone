"""AI 챗봇 API (11/20): 화면 오른쪽 아래 "질문하기". 지금 계통·계산 결과·플랫폼 기능을 묻고 답을 받는다 (ai_report/chat.py)

질문마다 모델에 주는 자료: 내 변전소 전체(같은 시각 판정), 지금 변전소 구성·계산 결과, 그날 24시간 결과,
화면에서 이미 계산한 여유 용량 표·보강 우선순위 (extras)"""

import datetime as dt

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

import simulation.simulate as sim
from ai_report.chat import MAX_SUBSTATIONS, MAX_TURNS, ChatMessage, ChatReply, chat, daily_section, extra_sections, substations_section
from cim import graph
from simulation.daily import graph_at
from simulation.models import SimulationResult

router = APIRouter()


class ChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(min_length=1, max_length=MAX_TURNS * 4)  # 마지막이 이번 질문
    substation_id: str | None = None  # 지금 고른 변전소 (첫 화면이면 없음)
    result: SimulationResult | None = None  # 지금 화면의 계산 결과
    date: dt.date | None = None  # 결과를 계산한 날짜·시 (프롬프트의 부하·태양광 kW를 같은 시각 값으로 맞춘다)
    hour: int | None = None
    extras: dict | None = None  # 화면에서 이미 계산한 결과 { capacity: { table, at, stale }, reinforce: { ranking, dates } }


def _now() -> tuple[dt.date, int]:
    now = dt.datetime.now()
    return now.date(), now.hour


@router.post("/chat")
def ask_chat(req: ChatRequest) -> ChatReply:
    """질문 하나에 답한다. 대화 앞부분(최근 몇 개)을 같이 보내면 이어서 묻을 수 있다"""
    day, hour = (req.date, req.hour) if req.date and req.hour is not None else _now()
    at = f"{day} {hour}시"
    base = g = None
    if req.substation_id:
        try:
            base = graph.get_substation(req.substation_id)
            g = graph_at(base, day, hour)
        except ValueError as e:
            raise HTTPException(422, str(e)) from e
    result = req.result if req.result and g and req.result.substation_id == g.substation.id else None

    # 내 변전소 전체: 같은 시각으로 하나씩 계산해 판정을 붙인다 (지금 보는 변전소는 화면 결과를 그대로 씀)
    entries = []
    for i, sub in enumerate(graph.list_substations()):
        if g is not None and sub.id == g.substation.id:
            entries.append((sub, g, result, None if result else "계산 결과 없음"))
            continue
        if i >= MAX_SUBSTATIONS:
            entries.append((sub, None, None, "변전소가 많아 이름만 보냄"))
            continue
        try:
            sg = graph_at(graph.get_substation(sub.id), day, hour)
        except Exception as e:
            entries.append((sub, None, None, f"불러오지 못함 ({e})"))
            continue
        try:
            entries.append((sub, sg, sim.simulate(sg), None))
        except Exception as e:  # 계통 미완성 등. 이유만 적고 계속
            entries.append((sub, sg, None, str(e)[:120]))
    more = substations_section(entries, req.substation_id, at)
    if base is not None:
        more += ["", *daily_section(base, day, sim.simulate), "", *extra_sections(g, req.extras)]
    return chat(req.messages, g, result, at, more)
