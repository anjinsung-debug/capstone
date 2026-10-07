"""OpenDSS 4대 시뮬레이션 (FR-03, FR-04, 제안서 2·3단계)

전압 영향, 선로 과부하, 역조류, 단락용량 고장전류를 계산하고 피더별 송출 전력을 구한다.
OpenDSS 스크립트 변환은 simulation/dss.py의 to_dss_script가 맡는다.

계산 순서: 방사형 검사·실제 조류 방향(dss.py의 trace) → 조류 계산(Solve) → 전압·선로 조류·손실·피더 송출 전력 읽기
          → 고장 해석(dss.py의 fault_study_script) → 각 지점 3상 단락 전류 읽기
단락용량·X/R·허용전류가 데이터에 없으면 dss.py의 DEFAULT_* 가정값으로 계산한다.
3상 평형이므로 상별 값 중 1상 값만 쓴다.
루프, OpenDSS 명령 오류, 수렴 실패는 SimulationError로 알린다 (백엔드가 422로 응답).
"""

import threading

import opendssdirect as dss

from cim.models import SubstationGraph
from simulation.dss import (
    DEFAULT_SHORT_CIRCUIT_MVA,
    SimulationError,
    bus_names,
    fault_study_script,
    line_names,
    rated_current,
    to_dss_script,
    trace,
)
from simulation.models import FeederResult, LineResult, NodeResult, SimulationResult

# ponytail: OpenDSS 엔진은 프로세스에 하나라 동시 요청을 한 줄로 세운다. 느려지면 요청별 프로세스로 분리
_lock = threading.Lock()


def _bus_value(bus: str, read) -> float:
    """버스의 1상 값. 열린 개폐기로 끊겨 OpenDSS에 없는 버스는 0"""
    if dss.Circuit.SetActiveBus(bus) < 0:
        return 0.0
    values = read()
    return values[0] if len(values) else 0.0


def _node_result(node_id: str, energized: bool, bus: str, voltages: dict, fault_ka: dict) -> NodeResult:
    """정전 구간(전원에서 닿지 않는 노드)은 OpenDSS 값과 상관없이 전압 0, 고장전류 None"""
    if not energized:
        return NodeResult(node_id=node_id, energized=False, voltage_pu=0.0)
    return NodeResult(node_id=node_id, voltage_pu=voltages[bus], fault_current_ka=fault_ka[bus])


def _run(commands: list[str]) -> None:
    for cmd in commands:
        try:
            dss.Text.Command(cmd)
        except dss.DSSException as e:
            raise SimulationError(f"OpenDSS 계산 오류 ({cmd}): {e}") from e


def simulate(graph: SubstationGraph) -> SimulationResult:
    """변전소 계통을 OpenDSS 스크립트로 변환해 조류 계산·고장 해석을 실행하고 결과를 돌려준다."""
    traced = trace(graph)
    reversed_ids = traced.reversed_line_ids
    buses = bus_names(graph)
    lines = line_names(graph)
    with _lock:
        _run(to_dss_script(graph) + ["Solve"])
        converged = dss.Solution.Converged()
        if not converged:
            raise SimulationError("조류 계산이 수렴하지 않았습니다. 부하·발전 출력이나 선로 임피던스 값이 지나치게 크지 않은지 확인해 주세요")

        voltages = {bus: _bus_value(bus, dss.Bus.puVmagAngle) for bus in set(buses.values())}
        line_results, line_p = [], {}
        for line in graph.lines:
            dss.Circuit.SetActiveElement(f"Line.{lines[line.id]}")
            if dss.CktElement.Enabled():
                powers = dss.CktElement.Powers()  # 1번 단자(from) 쪽 [P1, Q1, P2, Q2, P3, Q3, 2번 단자...]
                p, q = sum(powers[0:6:2]), sum(powers[1:6:2])
                amps = dss.CktElement.CurrentsMagAng()[0]
            else:
                p = q = amps = 0.0
            line_p[line.id] = (p, q)
            line_results.append(LineResult(
                line_id=line.id,
                p_kw=p,
                q_kvar=q,
                loading_pct=amps / rated_current(line) * 100,
                reverse_flow=(p > 0) if line.id in reversed_ids else (p < 0),  # 실제 전원 쪽에서 멀어지는 방향이 정상
            ))
        loss_kw = dss.Circuit.Losses()[0] / 1000  # W → kW

        _run(fault_study_script(graph))
        # Bus.Isc: 모든 상을 묶은 단락(3상 단락) 전류 [실수, 허수, ...] (A). 정전 구간 버스는 None
        fault_ka = {bus: abs(complex(*dss.Bus.Isc()[:2])) / 1000 if dss.Circuit.SetActiveBus(bus) >= 0 else None
                    for bus in voltages}

    # 피더 송출 전력 = 출구 차단기에서 아래쪽(from=차단기)으로 나가는 선로의 조류 합
    breakers = {n.id: n.feeder_id for n in graph.nodes if n.type == "breaker"}
    feeders = []
    for f in graph.feeders:
        out = [line_p[l.id] for l in graph.lines if breakers.get(l.from_node_id) == f.id]
        feeders.append(FeederResult(feeder_id=f.id, p_kw=sum(p for p, _ in out), q_kvar=sum(q for _, q in out)))

    return SimulationResult(
        substation_id=graph.substation.id,
        converged=converged,
        loss_kw=loss_kw,
        feeders=feeders,
        nodes=[_node_result(n.id, (n.bus_id or n.id) in traced.distance_km, buses[n.id], voltages, fault_ka)
               for n in graph.nodes],
        lines=line_results,
    )


if __name__ == "__main__":
    # 자체 점검: python -m simulation.simulate (data/의 한전 CIM XML로 실행, Neo4j 불필요)
    from pathlib import Path

    from cim.load import read_raw, to_substation_graphs

    g = to_substation_graphs(read_raw(Path(__file__).parent.parent / "data/korean_distribution_cim.xml"))[0]
    r = simulate(g)
    source = next(n for n in g.nodes if n.type == "source")
    at_source = next(n for n in r.nodes if n.node_id == source.id)
    assert r.converged
    assert abs(at_source.voltage_pu - g.substation.source_voltage_pu) < 1e-3  # 변전소 모선 전압 유지
    load_kw = sum(n.p_kw for n in g.nodes if n.type == "load") - sum(n.p_kw for n in g.nodes if n.type in ("pv", "wind"))
    assert abs(r.feeders[0].p_kw - (load_kw + r.loss_kw)) < 1  # 송출 = 부하 - 분산전원 + 손실
    assert all(x.loading_pct is not None for x in r.lines)  # 허용전류 기본값으로 과부하 계산
    theory_ka = DEFAULT_SHORT_CIRCUIT_MVA / (3**0.5 * 22.9)  # 전원만의 3상 단락 전류. 분산전원 기여만큼 조금 더 커야 함
    assert theory_ka < at_source.fault_current_ka < theory_ka * 1.15

    # 선로를 거꾸로 저장해도 역조류 판정은 같아야 함 (p_kw 부호만 반대)
    flipped = g.model_copy(deep=True)
    for line in flipped.lines:
        line.from_node_id, line.to_node_id = line.to_node_id, line.from_node_id
    r_flipped = simulate(flipped)
    assert [x.reverse_flow for x in r_flipped.lines] == [x.reverse_flow for x in r.lines]
    assert any(x.reverse_flow for x in r.lines)  # 이 계통에는 태양광 때문에 역조류 구간이 있음

    # 말단 두 곳을 잇는 선로를 더하면 루프
    looped = g.model_copy(deep=True)
    ends = [n.id for n in g.nodes if n.type == "bus"][-2:]
    looped.lines.append(g.lines[0].model_copy(update={"id": "loop", "from_node_id": ends[0], "to_node_id": ends[1]}))
    try:
        simulate(looped)
        raise AssertionError("루프를 잡지 못함")
    except SimulationError as e:
        assert "방사형" in str(e)

    # 잘못된 값(NaN)은 OpenDSS 오류 대신 SimulationError
    broken = g.model_copy(deep=True)
    next(n for n in broken.nodes if n.type == "load").p_kw = float("nan")
    try:
        simulate(broken)
        raise AssertionError("잘못된 값을 잡지 못함")
    except SimulationError:
        pass

    assert all(x.energized for x in r.nodes)

    # 개폐기를 열면 그 아래는 정전 (energized=False), 위쪽은 그대로
    opened = g.model_copy(deep=True)
    branch = next(n for n in opened.nodes if n.name == "CN_BranchPoint1")
    line = next(x for x in opened.lines if x.from_node_id == branch.id)
    sw = branch.model_copy(update={"id": "sw", "name": "SW", "type": "switch", "is_open": True})
    opened.nodes.append(sw)
    opened.lines.append(line.model_copy(update={"id": "sw-line", "to_node_id": "sw", "kind": "switch"}))
    line.from_node_id = "sw"
    r_opened = {x.node_id: x for x in simulate(opened).nodes}
    cut = line.to_node_id
    assert not r_opened[cut].energized and r_opened[cut].voltage_pu == 0 and r_opened[cut].fault_current_ka is None
    assert r_opened[branch.id].energized and r_opened[branch.id].voltage_pu > 0.9

    print(f"OK: 수렴, 송출 {r.feeders[0].p_kw:.0f} kW, 손실 {r.loss_kw:.1f} kW, 모선 고장전류 {at_source.fault_current_ka:.2f} kA")
