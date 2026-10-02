"""AI 리포트 형식 (FR-09: 진단 → 원인 → 솔루션)"""

from pydantic import BaseModel


class Report(BaseModel):
    feeder_id: str
    diagnosis: str  # 1단계: 건강도 진단
    causes: list[str]  # 2단계: 원인 분석
    solutions: list[str]  # 3단계: 솔루션 제안
