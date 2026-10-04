"""AI 리포트 형식 (FR-09: 진단 → 원인 → 솔루션)"""

from pydantic import BaseModel


class Report(BaseModel):
    substation_id: str
    diagnosis: str  # 1단계: 건강도 진단
    causes: list[str]  # 2단계: 물리적 원인 분석
    solutions: list[str]  # 3단계: 엔지니어링 솔루션 제안
