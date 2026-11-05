"""AI 리포트 형식 (FR-09: 진단 → 원인 → 솔루션)"""

from pydantic import BaseModel


class Report(BaseModel):
    substation_id: str
    diagnosis: str  # 1단계: 건강도 진단
    causes: list[str]  # 2단계: 물리적 원인 분석
    solutions: list[str]  # 3단계: 엔지니어링 솔루션 제안


class LineRank(BaseModel):
    """유스케이스 3: 여러 날 24시간 결과로 매긴 선로 순위 한 줄 (ai_report/report.py의 rank_lines)"""

    line_id: str
    name: str
    max_loading_pct: float  # 고른 날들 전체 시간 중 최대 부하율
    worst_date: str  # 최대 부하율이 나온 날 (YYYY-MM-DD)
    worst_hour: int
    hours_over: int  # 부하율 100% 초과 시간 수 (고른 날들 합)
    hours_watch: int  # 부하율 80% 이상 시간 수 (100% 초과 포함)
    rated_current_a: float | None  # 지금 허용전류 (없으면 시뮬레이션이 400 A 가정값으로 계산)
    required_rated_current_a: float  # 이 값 이상이면 고른 날들의 최대 부하율이 100% 이하 (지금 허용전류 × 최대 부하율 / 100)


class ReinforcementReport(BaseModel):
    ranking: list[LineRank]
    report: Report
