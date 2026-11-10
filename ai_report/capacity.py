"""추가 가능량: 지금 계통에서 접속점마다 신재생(태양광)과 부하를 얼마나 더 붙일 수 있는지 (진성이 피드백 11/5, 10/26 차장님 요청). 담당: 최민준

- 신재생 추가 가능량: simulation/der.py의 hosting_capacity를 그대로 쓴다 (안진성)
    기준: 접속점 전압 ≤ 1.05 pu, 선로 부하율 ≤ 100%, 출구 차단기 차단 가능
- 부하 추가 가능량: 같은 방식(이분 탐색)으로 이 파일에서 계산한다
    기준: 접속점 전압 ≥ 0.95 pu, 선로 부하율 ≤ 100%, 출구 차단기 차단 가능 (부하는 전압을 내리고 선로 전류를 늘린다)
계산은 simulation/der.py의 simulate()를 여러 번 부른다. 시각(date·hour)은 호출하는 쪽이 graph_at으로 맞춰 넘긴다

ponytail: 부하 추가 계산은 계산 코드라 simulation/der.py(안진성)에 두는 게 자연스럽다. 진성이와 정하면 load_capacity를 그쪽으로 옮긴다.
  부하 역률은 0.95 고정 가정(LOAD_PF). 접속점마다 따로 계산하므로 여러 접속점에 동시에 붙일 때의 합은 아니다
"""

import math
from typing import Literal

from pydantic import BaseModel

from cim.models import Node, SubstationGraph
from simulation import der
from simulation.dss import DEFAULT_BREAKER_INTERRUPT_KA, rated_current
from simulation.models import OVERLOAD_PCT, VOLTAGE_MIN_PU, SimulationResult

LOAD_PF = 0.95  # 추가 부하 역률 가정 (무효전력 = 유효 × tan(acos(0.95)) ≈ 0.33배)
LOAD_Q_RATIO = math.tan(math.acos(LOAD_PF))
MAX_SEARCH_KW = der.MAX_SEARCH_KW  # 탐색 상한 (신재생과 같게 20 MW)
SEARCH_STEP_KW = der.SEARCH_STEP_KW


class Limit(BaseModel):
    """추가하면 처음 생기는 기준 위반 하나 (simulation/der.py의 Violation에 저전압을 더한 것)"""

    kind: Literal["overvoltage", "undervoltage", "overload", "breaker"]
    element_id: str  # 전압: 접속점 노드 id, overload: 선로 id, breaker: 피더 id
    value: float  # 전압 pu, 부하율 %, 고장전류 kA
    limit: float
    required_rated_current_a: float | None = None  # overload만: 이 선로 허용전류를 이 값 이상으로 늘리면 해소


class CapacityRow(BaseModel):
    bus_id: str
    name: str
    pv_max_kw: float  # 이 접속점에 더 붙일 수 있는 신재생(태양광) 출력. MAX_SEARCH_KW면 상한까지 괜찮음
    pv_limited_by: list[Limit]  # 그 이상 붙이면 막는 것 (빈 목록 = 상한까지 괜찮음)
    load_max_kw: float  # 이 접속점에 더 붙일 수 있는 부하
    load_limited_by: list[Limit]


class CapacityTable(BaseModel):
    substation_id: str
    rows: list[CapacityRow]  # 접속점마다 한 줄 (변전소 모선 제외)
    max_search_kw: float = MAX_SEARCH_KW


def with_load(graph: SubstationGraph, bus_id: str, kw: float) -> SubstationGraph:
    """접속점 bus_id에 부하 kw(역률 LOAD_PF)를 하나 더 붙인 계통 (원래 계통은 그대로)"""
    bus = next(n for n in graph.nodes if n.id == bus_id)
    load = Node(id=f"capacity-load-{bus_id}", substation_id=bus.substation_id, feeder_id=bus.feeder_id, name="추가 검토 부하",
                type="load", x=bus.x, y=bus.y, p_kw=kw, q_kvar=kw * LOAD_Q_RATIO, bus_id=bus_id)
    return graph.model_copy(update={"nodes": [*graph.nodes, load]})


def load_violations(graph: SubstationGraph, r: SimulationResult) -> list[Limit]:
    """부하 추가 기준 위반: 저전압, 선로 과부하, 차단기 차단 불가"""
    buses = {n.id for n in graph.nodes if n.type == "bus"}
    lines = {x.id: x for x in graph.lines}
    out = [Limit(kind="undervoltage", element_id=n.node_id, value=n.voltage_pu, limit=VOLTAGE_MIN_PU)
           for n in r.nodes if n.energized and n.node_id in buses and n.voltage_pu < VOLTAGE_MIN_PU]
    out += [Limit(kind="overload", element_id=x.line_id, value=x.loading_pct, limit=OVERLOAD_PCT,
                  required_rated_current_a=rated_current(lines[x.line_id]) * x.loading_pct / 100)
            for x in r.lines if x.loading_pct is not None and x.loading_pct > OVERLOAD_PCT and x.line_id in lines]
    nodes = {n.node_id: n for n in r.nodes}
    for f in r.feeders:
        if f.breaker_interruptible is False:
            cb = next((n.id for n in graph.nodes if n.type == "breaker" and n.feeder_id == f.feeder_id), None)
            x = nodes.get(cb)
            value = max((v for v in (x.fault_current_ka, x.ground_fault_current_ka, x.double_ground_fault_current_ka) if v is not None), default=0) if x else 0
            out.append(Limit(kind="breaker", element_id=f.feeder_id, value=value, limit=DEFAULT_BREAKER_INTERRUPT_KA))
    return out


def load_capacity(graph: SubstationGraph, bus_id: str) -> tuple[float, list[Limit]]:
    """접속점 bus_id에 부하를 몇 kW까지 더 붙일 수 있는지 (der.hosting_capacity와 같은 이분 탐색). 반환: (최대 kW, 막는 것)
    ponytail: 부하를 늘릴수록 전압은 내려가고 위쪽 선로 전류는 늘어난다고 보고 이분 탐색한다 (역조류 구간은 줄었다가 다시 늘 수 있음)"""

    def check(kw: float) -> list[Limit]:
        g = with_load(graph, bus_id, kw) if kw > 0 else graph
        return load_violations(g, der.simulate(g))

    first = check(0.0)
    if first:
        return 0.0, first
    if not check(MAX_SEARCH_KW):
        return MAX_SEARCH_KW, []
    ok, bad = 0, int(MAX_SEARCH_KW / SEARCH_STEP_KW)
    while bad - ok > 1:
        mid = (ok + bad) // 2
        ok, bad = (mid, bad) if not check(mid * SEARCH_STEP_KW) else (ok, mid)
    return ok * SEARCH_STEP_KW, check(bad * SEARCH_STEP_KW)


class LoadCapacity(BaseModel):
    """접속점 하나의 부하 증설 검토 (속성 칸 "부하 증설 검토", 태양광의 der.HostingCapacity와 같은 모양)"""

    bus_id: str
    max_kw: float  # 이 접속점에 더 늘릴 수 있는 부하 (kW). MAX_SEARCH_KW면 상한까지 괜찮음
    limited_by: list[Limit]  # max_kw를 넘기면 처음 생기는 위반
    target_kw: float | None = None
    target_violations: list[Limit] = []  # target_kw만큼 늘렸을 때의 위반 (선로 보강 필요량 포함)


def load_check(graph: SubstationGraph, bus_id: str, target_kw: float | None = None) -> LoadCapacity:
    """접속점 bus_id 하나에 부하를 몇 kW까지 늘릴 수 있는지 + 목표 kW를 늘렸을 때의 위반 (11/10, 태양광 연계 검토와 같은 기능).
    없는 접속점이거나 target_kw가 음수면 ValueError (API에서 422)"""
    if bus_id not in {n.id for n in graph.nodes if n.type == "bus"}:
        raise ValueError(f"접속점(bus) 노드가 아닙니다: {bus_id}")
    if target_kw is not None and target_kw < 0:
        raise ValueError(f"target_kw는 0 이상이어야 합니다: {target_kw}")
    max_kw, limited = load_capacity(graph, bus_id)
    target = []
    if target_kw:
        g = with_load(graph, bus_id, target_kw)
        target = load_violations(g, der.simulate(g))
    return LoadCapacity(bus_id=bus_id, max_kw=max_kw, limited_by=limited, target_kw=target_kw, target_violations=target)


def capacity_table(graph: SubstationGraph) -> CapacityTable:
    """접속점마다 신재생·부하 추가 가능량. 변전소 모선(전원이 바로 붙은 접속점)은 빼고 배전선로 쪽 접속점만"""
    source_buses = {n.bus_id for n in graph.nodes if n.type == "source"}
    rows = []
    for bus in (n for n in graph.nodes if n.type == "bus" and n.id not in source_buses):
        h = der.hosting_capacity(graph, bus.id)
        load_kw, load_lim = load_capacity(graph, bus.id)
        rows.append(CapacityRow(bus_id=bus.id, name=bus.name, pv_max_kw=h.max_kw,
                                pv_limited_by=[Limit.model_validate(v.model_dump()) for v in h.limited_by],
                                load_max_kw=load_kw, load_limited_by=load_lim))
    return CapacityTable(substation_id=graph.substation.id, rows=rows)


if __name__ == "__main__":
    # 자체 점검: python -m ai_report.capacity (data/의 한전 CIM XML로 실행, Neo4j 불필요)
    from pathlib import Path

    from cim.load import read_raw, to_substation_graphs

    g = to_substation_graphs(read_raw(Path(__file__).parent.parent / "data/korean_distribution_cim.xml"))[0]
    end = next(n.id for n in g.nodes if n.type == "bus" and "말단" in n.name)
    c = load_check(g, end, target_kw=MAX_SEARCH_KW)
    assert 0 < c.max_kw < MAX_SEARCH_KW and c.limited_by  # 말단은 상한 전에 막힌다
    assert c.target_violations  # 상한만큼 늘리면 위반이 있다
    assert not load_check(g, end, target_kw=c.max_kw).target_violations  # 최대치만큼은 괜찮다
    try:
        load_check(g, "없는-id")
        raise AssertionError("없는 접속점은 ValueError여야 합니다")
    except ValueError:
        pass
    print(f"ok: 말단 부하 증설 최대 {c.max_kw:,.0f} kW, 막는 것 {[x.kind for x in c.limited_by]}")
