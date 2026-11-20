"""AI 챗봇 API (11/20): 화면 오른쪽 아래 "질문하기". 지금 계통·계산 결과·플랫폼 기능을 묻고 답을 받는다 (ai_report/chat.py)"""

import datetime as dt

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ai_report.chat import MAX_TURNS, ChatMessage, ChatReply, chat
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


@router.post("/chat")
def ask_chat(req: ChatRequest) -> ChatReply:
    """질문 하나에 답한다. 대화 앞부분(최근 몇 개)을 같이 보내면 이어서 묻을 수 있다"""
    g = None
    if req.substation_id:
        try:
            g = graph_at(graph.get_substation(req.substation_id), req.date, req.hour)
        except ValueError as e:
            raise HTTPException(422, str(e)) from e
    result = req.result if req.result and g and req.result.substation_id == g.substation.id else None
    at = f"{req.date} {req.hour}시" if req.date and req.hour is not None else None
    return chat(req.messages, g, result, at)
