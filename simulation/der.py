"""분산전원(태양광·풍력) 영향 분석 (10/26 중간 발표 요청)

1. 연결 전후 비교 (compare_der): 같은 계통을 분산전원 없이 한 번, 있게 한 번 계산해 핵심 숫자(DerSummary)를 나란히 준다
2. 연계 가능 최대치 (hosting_capacity): 접속점 하나에 태양광을 더 붙일 때 몇 kW까지 되는지, 무엇 때문에 막히는지,
   목표 용량(target_kw)을 붙이려면 어떤 선로 허용전류를 얼마로 늘려야 하는지

연계 기준 (10/26 회의: 역조류 자체는 정상. 선로 용량 안이고 차단기가 끊을 수 있으면 됨) + 전압 상한
    - 접속점 전압 ≤ VOLTAGE_MAX_PU (태양광은 전압을 올린다. 저전압은 태양광이 늘수록 나아지므로 보지 않음)
    - 선로 부하율 ≤ OVERLOAD_PCT
    - 출구 차단기가 고장전류를 끊을 수 있음 (FeederResult.breaker_interruptible)
계산은 simulation/simulate.py의 simulate()를 그대로 여러 번 부른다. 시각(date·hour)은 호출하는 쪽이 graph_at으로 맞춰 넘긴다
"""

from typing import Literal

from pydantic import BaseModel

from cim.models import Node, SubstationGraph
from simulation.dss import DEFAULT_BREAKER_INTERRUPT_KA, rated_current
from simulation.models import OVERLOAD_PCT, VOLTAGE_MAX_PU, SimulationResult
from simulation.simulate import simulate

DER_TYPES = ("pv", "wind")
MAX_SEARCH_KW = 20000.0  # 연계 가능 최대치를 찾는 상한 (kW). 22.9kV 배전선로 한 회선 운전용량(약 10 MW)의 두 배
SEARCH_STEP_KW = 10.0  # 최대치 정밀도 (kW)


class DerSummary(BaseModel):
    """한 번 계산한 결과의 핵심 숫자 (화면 요약, AI 리포트, 전후 비교에 같이 씀)"""

    der_kw: float  # 분산전원 출력 합 (지금 들어오고 있는 태양광·풍력)
    feeder_kw: float  # 피더 송출 전력 합. 음수면 변전소 쪽으로 역송
    loss_kw: float
    min_voltage_pu: float  # 통전된 접속점 중
    max_voltage_pu: float
    max_loading_pct: float
    reverse_flow_lines: int  # 역조류 선로 수
    max_fault_ka: float  # 3상 단락·1선 지락·2선 지락 중 가장 큰 값


class DerComparison(BaseModel):
    without_der: SimulationResult  # 분산전원을 모두 뺀 계통
    with_der: SimulationResult  # 지금 계통
    before: DerSummary
    after: DerSummary


class Violation(BaseModel):
    kind: Literal["overvoltage", "overload", "breaker"]
    element_id: str  # overvoltage: 접속점 노드 id, overload: 선로 id, breaker: 피더 id
    value: float  # overvoltage: pu, overload: %, breaker: kA
    limit: float  # 같은 단위의 기준값
    required_rated_current_a: float | None = None  # overload만: 이 선로 허용전류를 이 값 이상으로 늘리면 해소


class HostingCapacity(BaseModel):
    bus_id: str  # 태양광을 붙일 접속점
    max_kw: float  # 지금 계통에 더 붙일 수 있는 태양광 출력 (kW, SEARCH_STEP_KW 단위). 0이면 이미 위반이거나 조금도 못 붙임
    limited_by: list[Violation]  # max_kw를 넘기면 처음 생기는 위반 (= 무엇 때문에 막히는지). MAX_SEARCH_KW까지 괜찮으면 빈 목록
    target_kw: float | None = None
    target_violations: list[Violation] = []  # target_kw를 붙였을 때의 위반 (선로 보강 필요량 포함)


def _bus_ids(graph: SubstationGraph) -> set[str]:
    return {n.id for n in graph.nodes if n.type == "bus"}


def summarize(graph: SubstationGraph, r: SimulationResult) -> DerSummary:
    buses = _bus_ids(graph)
    volts = [n.voltage_pu for n in r.nodes if n.energized and n.node_id in buses]
    faults = [ka for n in r.nodes for ka in (n.fault_current_ka, n.ground_fault_current_ka, n.double_ground_fault_current_ka)
              if ka is not None]
    return DerSummary(
        der_kw=sum(n.p_kw or 0 for n in graph.nodes if n.type in DER_TYPES),
        feeder_kw=sum(f.p_kw for f in r.feeders),
        loss_kw=r.loss_kw,
        min_voltage_pu=min(volts, default=0.0),
        max_voltage_pu=max(volts, default=0.0),
        max_loading_pct=max((l.loading_pct for l in r.lines if l.loading_pct is not None), default=0.0),
        reverse_flow_lines=sum(l.reverse_flow for l in r.lines),
        max_fault_ka=max(faults, default=0.0),
    )


def compare_der(graph: SubstationGraph) -> DerComparison:
    """분산전원 연결 전(모두 뺌)·후(지금 계통) 비교. 출력 0이 아니라 노드를 빼야 고장 해석에도 기여가 빠진다"""
    without = graph.model_copy(update={"nodes": [n for n in graph.nodes if n.type not in DER_TYPES]})
    before, after = simulate(without), simulate(graph)
    return DerComparison(without_der=before, with_der=after,
                         before=summarize(without, before), after=summarize(graph, after))


def violations(graph: SubstationGraph, r: SimulationResult) -> list[Violation]:
    """연계 기준 위반 목록 (모듈 설명의 세 가지)"""
    buses = _bus_ids(graph)
    lines = {l.id: l for l in graph.lines}
    out = [Violation(kind="overvoltage", element_id=n.node_id, value=n.voltage_pu, limit=VOLTAGE_MAX_PU)
           for n in r.nodes if n.energized and n.node_id in buses and n.voltage_pu > VOLTAGE_MAX_PU]
    out += [Violation(kind="overload", element_id=l.line_id, value=l.loading_pct, limit=OVERLOAD_PCT,
                      required_rated_current_a=rated_current(lines[l.line_id]) * l.loading_pct / 100)
            for l in r.lines if l.loading_pct is not None and l.loading_pct > OVERLOAD_PCT]
    nodes = {n.node_id: n for n in r.nodes}
    for f in r.feeders:
        if f.breaker_interruptible is False:
            cb = next(n.id for n in graph.nodes if n.type == "breaker" and n.feeder_id == f.feeder_id)
            x = nodes[cb]
            out.append(Violation(kind="breaker", element_id=f.feeder_id, limit=DEFAULT_BREAKER_INTERRUPT_KA,
                                 value=max(x.fault_current_ka, x.ground_fault_current_ka, x.double_ground_fault_current_ka)))
    return out


def with_pv(graph: SubstationGraph, bus_id: str, kw: float) -> SubstationGraph:
    """접속점 bus_id에 태양광 kw를 하나 더 붙인 계통 (원래 계통은 그대로)"""
    bus = next(n for n in graph.nodes if n.id == bus_id)
    pv = Node(id=f"hosting-pv-{bus_id}", substation_id=bus.substation_id, feeder_id=bus.feeder_id,
              name="연계 검토 태양광", type="pv", x=bus.x, y=bus.y, p_kw=kw, bus_id=bus_id)
    return graph.model_copy(update={"nodes": [*graph.nodes, pv]})


def hosting_capacity(graph: SubstationGraph, bus_id: str, target_kw: float | None = None) -> HostingCapacity:
    """접속점 bus_id에 태양광을 몇 kW까지 더 붙일 수 있는지 이분 탐색으로 찾는다.
    없는 접속점이거나 target_kw가 음수면 ValueError (API에서 422)

    ponytail: 붙일수록 위반이 늘어난다고 보고 이분 탐색 (전압은 계속 오르고, 부하율은 줄었다가 역조류로 다시 오름).
      지금 계통이 이미 위반이면 0으로 끝낸다. 위반이 생겼다 사라지는 계통이 나오면 SEARCH_STEP_KW 간격 전수 탐색으로 바꾼다"""
    if bus_id not in _bus_ids(graph):
        raise ValueError(f"접속점(bus) 노드가 아닙니다: {bus_id}")
    if target_kw is not None and target_kw < 0:
        raise ValueError(f"target_kw는 0 이상이어야 합니다: {target_kw}")

    def check(kw: float) -> list[Violation]:
        g = with_pv(graph, bus_id, kw) if kw > 0 else graph
        return violations(g, simulate(g))

    first = check(0.0)
    if first:
        max_kw, limited = 0.0, first
    elif not check(MAX_SEARCH_KW):
        max_kw, limited = MAX_SEARCH_KW, []
    else:
        ok, bad = 0, int(MAX_SEARCH_KW / SEARCH_STEP_KW)  # 단위: SEARCH_STEP_KW
        while bad - ok > 1:
            mid = (ok + bad) // 2
            ok, bad = (mid, bad) if not check(mid * SEARCH_STEP_KW) else (ok, mid)
        max_kw, limited = ok * SEARCH_STEP_KW, check(bad * SEARCH_STEP_KW)
    return HostingCapacity(bus_id=bus_id, max_kw=max_kw, limited_by=limited, target_kw=target_kw,
                           target_violations=check(target_kw) if target_kw is not None else [])


if __name__ == "__main__":
    # 자체 점검: python -m simulation.der (data/의 한전 CIM XML로 실행, Neo4j 불필요)
    import time
    from pathlib import Path

    from cim.load import read_raw, to_substation_graphs

    g = to_substation_graphs(read_raw(Path(__file__).parent.parent / "data/korean_distribution_cim.xml"))[0]

    c = compare_der(g)
    assert c.before.der_kw == 0 and c.before.reverse_flow_lines == 0  # 분산전원이 없으면 역조류도 없음
    assert c.after.der_kw == sum(n.p_kw for n in g.nodes if n.type in DER_TYPES)
    assert c.after.reverse_flow_lines > 0 and c.after.feeder_kw < c.before.feeder_kw  # 태양광이 송출을 줄이고 역조류를 만듦
    assert c.after.max_voltage_pu > c.before.max_voltage_pu  # 태양광은 전압을 올림
    assert c.after.max_fault_ka > c.before.max_fault_ka  # 태양광도 고장전류에 기여

    end = next(n.id for n in g.nodes if n.name == "CN_좌우말단_PV2")
    t = time.perf_counter()
    h = hosting_capacity(g, end, target_kw=20000)
    took = time.perf_counter() - t
    assert 0 < h.max_kw < MAX_SEARCH_KW and h.limited_by
    assert not violations(with_pv(g, end, h.max_kw), simulate(with_pv(g, end, h.max_kw)))  # 최대치에서는 괜찮고
    assert violations(with_pv(g, end, h.max_kw + SEARCH_STEP_KW), simulate(with_pv(g, end, h.max_kw + SEARCH_STEP_KW)))  # 넘으면 위반
    assert h.target_violations
    for v in h.target_violations:  # 목표 용량에서 과부하 선로는 지금 허용전류보다 큰 값을 요구
        if v.kind == "overload":
            assert v.required_rated_current_a > rated_current(next(l for l in g.lines if l.id == v.element_id))
    try:
        hosting_capacity(g, g.lines[0].id)
        raise AssertionError("접속점이 아닌 id를 잡지 못함")
    except ValueError:
        pass

    names = {n.id: n.name for n in g.nodes} | {l.id: l.name for l in g.lines} | {f.id: f.name for f in g.feeders}
    print(f"OK: 분산전원 {c.after.der_kw:.0f} kW 연결 전→후 송출 {c.before.feeder_kw:.0f}→{c.after.feeder_kw:.0f} kW, "
          f"최고 전압 {c.before.max_voltage_pu:.3f}→{c.after.max_voltage_pu:.3f} pu, 역조류 선로 {c.after.reverse_flow_lines}개")
    print(f"OK: {names[end]} 연계 가능 {h.max_kw:.0f} kW ({took:.1f}초), 막는 것: "
          + ", ".join(f"{v.kind} {names.get(v.element_id, v.element_id)} {v.value:.3f}/{v.limit}" for v in h.limited_by))
    print("    20000 kW 붙이려면: " + ", ".join(
        f"{v.kind} {names.get(v.element_id, v.element_id)}" + (f" 허용전류 {v.required_rated_current_a:.0f} A 이상" if v.required_rated_current_a else "")
        for v in h.target_violations))
