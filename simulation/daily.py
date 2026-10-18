"""하루(24시간) 시뮬레이션: 대표일의 시간대별 배율을 부하·태양광 출력에 곱해 시간마다 4대 시뮬레이션을 다시 돌린다.

화면 결과 기록 탭(frontend/src/components/HistoryChart.jsx)이 편집 기록마다 0~23시 곡선을 그릴 때 쓴다.
POST /api/substations/{id}/simulations/daily (backend/api/simulation.py)

- 배율: data/daily_profile.csv (hour, load, pv). 원본 저장소의 1년치 가상 패턴에서 대표일 하루를 뽑은 것 (data/NOTICE.md)
- 부하(load): p_kw·q_kvar × 부하 배율 (계통 데이터의 부하 값을 최대부하로 봄)
- 태양광(pv): p_kw × 태양광 배율 (계통 데이터의 태양광 값을 설비용량으로 봄). 밤(배율 0)에도 PV_MIN_MULT만큼은 남긴다
- 풍력은 시간대 패턴이 없어 그대로 둔다
- 계산 자체는 simulation/simulate.py의 simulate()를 그대로 24번 부른다 (판정·결과 형식이 한 시점 계산과 같다)

ponytail: 대표일은 하나(봄철 평일)만 쓴다. 여름 피크일 등을 고르려면 CSV에 날 열을 추가하고 주소에 날 선택을 받는다.
  8760시간(1년) 전체는 원본 저장소 메모대로 웹 요청 안에서 돌리기엔 느리다
"""

from collections.abc import Callable
from pathlib import Path

from pydantic import BaseModel

from cim.models import SubstationGraph
from simulation.models import SimulationResult

PROFILE_PATH = Path(__file__).resolve().parents[1] / "data" / "daily_profile.csv"
PROFILE_NAME = "봄철 평일 (2025-05-26)"
PROFILE_NOTE = "가상 패턴 (data/daily_profile.csv, 실측 아님)"
# 태양광 배율의 최솟값. 밤에 배율이 0이면 OpenDSS 발전기 출력이 0 kW가 되어 고장 해석(단락전류)이 빈 값으로 나온다.
# 아주 작은 값(설비용량의 0.01%)을 남겨 계산이 되게 한다. 조류·단락용량에 주는 영향은 무시할 만하다
PV_MIN_MULT = 0.0001


class DailyProfile(BaseModel):
    name: str
    note: str


class DailyHour(BaseModel):
    hour: int  # 0~23
    load_mult: float
    pv_mult: float
    result: SimulationResult


class DailyResult(BaseModel):
    profile: DailyProfile
    hours: list[DailyHour]


def read_profile(path: Path = PROFILE_PATH) -> list[tuple[int, float, float]]:
    """CSV를 (시각, 부하 배율, 태양광 배율) 목록으로. #로 시작하는 줄은 설명이라 건너뛴다"""
    rows = [ln for ln in path.read_text(encoding="utf-8").splitlines() if ln.strip() and not ln.startswith("#")]
    out = []
    for row in rows[1:]:  # 첫 줄은 머리글 hour,load,pv
        hour, load, pv = row.split(",")
        out.append((int(hour), float(load), float(pv)))
    return out


def scaled_graph(graph: SubstationGraph, load_mult: float, pv_mult: float) -> SubstationGraph:
    """부하·태양광 출력에 배율을 곱한 새 계통 (원래 계통은 그대로)"""
    nodes = []
    for n in graph.nodes:
        if n.type == "load" and n.p_kw is not None:
            n = n.model_copy(update={"p_kw": n.p_kw * load_mult, "q_kvar": (n.q_kvar or 0) * load_mult})
        elif n.type == "pv" and n.p_kw is not None:
            n = n.model_copy(update={"p_kw": n.p_kw * max(pv_mult, PV_MIN_MULT)})
        nodes.append(n)
    return graph.model_copy(update={"nodes": nodes})


def simulate_daily(graph: SubstationGraph, simulate_fn: Callable[[SubstationGraph], SimulationResult] | None = None) -> DailyResult:
    """대표일 24시간을 계산한다. simulate_fn을 주지 않으면 OpenDSS(simulation/simulate.py)를 쓴다 (모의 백엔드는 근사 계산을 넘김).
    한 시각이라도 계산이 안 되면 SimulationError가 그대로 올라가 422가 된다"""
    if simulate_fn is None:
        from simulation.simulate import simulate as simulate_fn  # OpenDSS는 실제로 계산할 때만 불러온다
    hours = [
        DailyHour(hour=hour, load_mult=load, pv_mult=pv, result=simulate_fn(scaled_graph(graph, load, pv)))
        for hour, load, pv in read_profile()
    ]
    return DailyResult(profile=DailyProfile(name=PROFILE_NAME, note=PROFILE_NOTE), hours=hours)
