"""하루(24시간) 시뮬레이션: 고른 날짜의 시간대별 배율을 부하·태양광 출력에 곱해 시간마다 4대 시뮬레이션을 다시 돌린다.

화면 결과 기록 탭(frontend/src/components/HistoryChart.jsx)이 편집 기록마다 0~23시 곡선을 그릴 때 쓴다.
POST /api/substations/{id}/simulations/daily (backend/api/simulation.py)

- 배율: data/profile_2025.csv (date, hour, load, pv) = 원본 저장소의 2025년 1년치 가상 패턴 (data/NOTICE.md)
- 날짜: 2025-01-01부터 오늘까지 고를 수 있다. 배율 데이터는 2025년 것뿐이라 2026년 이후 날짜는
  2025년의 같은 시기(같은 월·일 ±3일 안)에서 요일이 같은 날의 배율을 쓴다 (평일·주말 부하 모양이 달라서). 어느 날 것을 썼는지 응답에 담는다
- 부하(load): p_kw·q_kvar × 부하 배율 (계통 데이터의 부하 값을 최대부하로 봄)
- 태양광(pv): p_kw × 태양광 배율 (계통 데이터의 태양광 값을 설비용량으로 봄). 밤(배율 0)에도 PV_MIN_MULT만큼은 남긴다
- 풍력은 시간대 패턴이 없어 그대로 둔다
- 계산 자체는 simulation/simulate.py의 simulate()를 그대로 24번 부른다 (판정·결과 형식이 한 시점 계산과 같다)

ponytail: 8760시간(1년) 전체를 한 번에 돌리는 건 원본 저장소 메모대로 웹 요청 안에서 하기엔 느리다. 하루씩만 계산한다
"""

import csv
import datetime as dt
from collections.abc import Callable
from functools import lru_cache
from pathlib import Path

from pydantic import BaseModel

from cim.models import SubstationGraph
from simulation.models import SimulationResult

PROFILE_PATH = Path(__file__).resolve().parents[1] / "data" / "profile_2025.csv"
PROFILE_YEAR = 2025
FIRST_DATE = dt.date(PROFILE_YEAR, 1, 1)  # 고를 수 있는 가장 이른 날
DEFAULT_DATE = dt.date(PROFILE_YEAR, 5, 26)  # 날짜를 안 주면: 2025년 평일 중 역조류가 가장 큰 날
PROFILE_NOTE = "가상 패턴 (data/profile_2025.csv, 실측 아님)"
# 태양광 배율의 최솟값. 밤에 배율이 0이면 OpenDSS 발전기 출력이 0 kW가 되어 고장 해석(단락전류)이 빈 값으로 나온다.
# 아주 작은 값(설비용량의 0.01%)을 남겨 계산이 되게 한다. 조류·단락용량에 주는 영향은 무시할 만하다
PV_MIN_MULT = 0.0001
WEEKDAY_KO = "월화수목금토일"


class DailyProfile(BaseModel):
    name: str  # 화면에 보일 이름 (예: "2026-10-26 (월)")
    note: str
    date: dt.date  # 고른 날
    source_date: dt.date  # 실제로 배율을 가져온 2025년 날 (2025년 안의 날이면 date와 같음)


class DailyRequest(BaseModel):
    """POST .../simulations/daily 본문 (없어도 됨)"""

    date: dt.date | None = None  # 고를 날 (없으면 DEFAULT_DATE)
    graph: SubstationGraph | None = None  # 계산할 계통 (없으면 DB의 지금 계통). 예전 기록을 다른 날짜로 다시 계산할 때 보냄


class DailyHour(BaseModel):
    hour: int  # 0~23
    load_mult: float
    pv_mult: float
    result: SimulationResult


class DailyResult(BaseModel):
    profile: DailyProfile
    hours: list[DailyHour]


@lru_cache(maxsize=1)
def read_year(path: Path = PROFILE_PATH) -> dict[dt.date, list[tuple[int, float, float]]]:
    """CSV를 {날짜: [(시각, 부하 배율, 태양광 배율) × 24]}로. #로 시작하는 줄은 설명이라 건너뛴다"""
    days: dict[dt.date, list[tuple[int, float, float]]] = {}
    with path.open(encoding="utf-8") as f:
        rows = csv.DictReader(ln for ln in f if ln.strip() and not ln.startswith("#"))
        for r in rows:
            days.setdefault(dt.date.fromisoformat(r["date"]), []).append((int(r["hour"]), float(r["load"]), float(r["pv"])))
    return days


def source_date(day: dt.date) -> dt.date:
    """배율을 가져올 2025년 날. 2025년이면 그대로, 아니면 같은 월·일 근처(±3일)에서 요일이 같은 날"""
    if day.year == PROFILE_YEAR:
        return day
    try:
        same = day.replace(year=PROFILE_YEAR)
    except ValueError:  # 2월 29일
        same = dt.date(PROFILE_YEAR, 2, 28)
    for shift in (0, 1, -1, 2, -2, 3, -3):
        cand = same + dt.timedelta(days=shift)
        if cand.year == PROFILE_YEAR and cand.weekday() == day.weekday():
            return cand
    return same


def check_date(day: dt.date, today: dt.date | None = None) -> None:
    """고를 수 있는 날인지 (2025-01-01 ~ 오늘). 아니면 ValueError (API에서 422)"""
    today = today or dt.date.today()
    if not FIRST_DATE <= day <= today:
        raise ValueError(f"날짜는 {FIRST_DATE}부터 오늘({today})까지 고를 수 있습니다: {day}")


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


def graph_at(graph: SubstationGraph, day: dt.date | None, hour: int | None) -> SubstationGraph:
    """한 시각의 계통: 그날 그 시각 배율을 부하·태양광에 곱한다 (편집 화면의 "지금 시각" 계산, POST .../simulations?date=&hour=).
    date·hour가 둘 다 없으면 계통 그대로 (최대 조건: 부하 = 최대부하, 태양광 = 설비용량). 하나만 있거나 고를 수 없는 날·시각이면 ValueError"""
    if day is None and hour is None:
        return graph
    if day is None or hour is None:
        raise ValueError("date와 hour는 함께 보내야 합니다 (둘 다 없으면 최대 조건으로 계산)")
    if not 0 <= hour <= 23:
        raise ValueError(f"hour는 0~23이어야 합니다: {hour}")
    check_date(day)
    h, load, pv = read_year()[source_date(day)][hour]
    assert h == hour
    return scaled_graph(graph, load, pv)


def simulate_daily(
    graph: SubstationGraph,
    day: dt.date | None = None,
    simulate_fn: Callable[[SubstationGraph], SimulationResult] | None = None,
) -> DailyResult:
    """고른 날의 24시간을 계산한다. day를 주지 않으면 DEFAULT_DATE.
    simulate_fn을 주지 않으면 OpenDSS(simulation/simulate.py)를 쓴다 (모의 백엔드는 근사 계산을 넘김).
    날짜가 범위 밖이면 ValueError, 한 시각이라도 계산이 안 되면 SimulationError가 그대로 올라간다"""
    day = day or DEFAULT_DATE
    check_date(day)
    if simulate_fn is None:
        from simulation.simulate import simulate as simulate_fn  # OpenDSS는 실제로 계산할 때만 불러온다
    src = source_date(day)
    hours = [
        DailyHour(hour=hour, load_mult=load, pv_mult=pv, result=simulate_fn(scaled_graph(graph, load, pv)))
        for hour, load, pv in read_year()[src]
    ]
    name = f"{day.isoformat()} ({WEEKDAY_KO[day.weekday()]})"
    return DailyResult(profile=DailyProfile(name=name, note=PROFILE_NOTE, date=day, source_date=src), hours=hours)
