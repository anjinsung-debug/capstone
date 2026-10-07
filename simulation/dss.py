"""계통 → OpenDSS 스크립트 변환 (FR-03, 제안서 2단계 파서)

Neo4j에서 읽은 SubstationGraph를 OpenDSS가 이해하는 명령어 목록으로 바꾼다.
변환만 하고 실행은 simulate.py가 맡으므로, OpenDSS 없이도 생성된 스크립트를 확인할 수 있다.

해석 범위 (cim/models.py와 같음): 22.9kV, 3상 평형, 방사형, 한 시점, 3상 단락만. 모든 요소는 phases=3.

변환 대응:
    bus·breaker·switch 노드 → OpenDSS 버스 (차단기는 투입 상태로 보고, 피더별 송출 전력 측정 위치로 씀)
    source 노드      → New Circuit, bus_id의 버스에 연결 (basekv=BASE_KV, pu=source_voltage_pu)
                       조류 계산에서는 임피던스가 거의 0인 전원이라 변전소 모선 전압 = source_voltage_pu.
                       고장 해석 직전에만 fault_study_script로 MVAsc3=short_circuit_mva, X1R1=x_r_ratio를 넣는다
                       (값이 없으면 DEFAULT_SHORT_CIRCUIT_MVA, DEFAULT_X_R_RATIO)
    load 노드        → New Load, bus_id의 버스에 연결 (kW=p_kw, kvar=q_kvar, 한 시점 고정값)
    pv·wind 노드     → New Generator, bus_id의 버스에 연결 (kW=p_kw, kvar=q_kvar, 한 시점 고정 출력)
                       인버터 전원으로 보고 Xdp=1 (고장 해석에 쓰는 과도 리액턴스. 고장 전류 기여 ≈ 정격의 1.2배, 기본값 0.27은 동기발전기 기준)
    switch 노드 is_open=True → 이 노드에 닿은 Line을 enabled=no로 끊음 (끊긴 쪽 노드는 전압 0)
    Line kind=line   → New Line (R1=r_ohm_per_km, X1=x_ohm_per_km, length=length_km, units=km, 정전용량 0)
    Line kind=switch → New Line switch=yes (차단기·개폐기 연결)
    모든 Line        → normamps=rated_current_a (값이 없으면 DEFAULT_RATED_CURRENT_A)

OpenDSS 이름은 원래 id 대신 목록 순서로 짓는다 (id에 OpenDSS가 못 쓰는 문자가 있을 수 있음).
    노드 i → 버스 n{i}, 부하 Load.n{i}, 분산전원 Generator.n{i} / 선로 j → Line.l{j}

변환 전에 trace로 계통이 완성됐는지(check_complete), 방사형인지 검사하고, 선로의 실제 전원 쪽과 거리를 구한다.
저장된 from_node_id 방향은 편집 중 거꾸로 그려질 수 있으므로 역조류 판정·그래프에는 trace 결과를 쓴다.
"""

from dataclasses import dataclass

from cim.models import BASE_KV, ONE_TERMINAL_TYPES, Line, SubstationGraph



class SimulationError(ValueError):
    """계통을 계산할 수 없음 (미완성 계통, 루프, OpenDSS 명령 오류, 수렴 실패). 백엔드가 422와 메시지로 돌려준다."""


# ── 데이터에 없는 값의 기본값 ──
# 한전 CIM XML(data/korean_distribution_cim.xml)에는 변전소 단락용량·X/R과 선로 허용전류가 없다.
# 그대로 두면 4대 시뮬레이션 중 선로 과부하·단락 고장전류를 계산할 수 없으므로, 값이 없을 때(None)만 아래 가정값을 쓴다.
# 실제 값을 받으면 cim 쪽 데이터(Substation.short_circuit_mva·x_r_ratio, Line.rated_current_a)에 넣는다. 그 값이 우선이다.
# 가정값으로 계산한 고장전류·부하율은 실제 설비 기준이 아니므로 결과를 해석할 때 주의한다.
DEFAULT_SHORT_CIRCUIT_MVA = 300.0  # 변전소 22.9kV 모선 3상 단락용량 (약 7.6kA). 154/22.9kV 주변압기 2차측 수준의 가정값
DEFAULT_X_R_RATIO = 10.0  # 전원 임피던스 X/R. 변전소 근처 계통의 일반적인 가정값
DEFAULT_RATED_CURRENT_A = 400.0  # 선로·개폐기 허용전류. 22.9kV 간선 굵은 전선 수준의 가정값 (선종별 구분 없음)

CIRCUIT_NAME = "substation"
STIFF_MVA = 1e6  # 조류 계산용 전원 단락용량. 사실상 무한대라 변전소 모선 전압이 source_voltage_pu로 유지됨


def bus_names(graph: SubstationGraph) -> dict[str, str]:
    """노드 id → 그 노드의 전압을 읽을 OpenDSS 버스 이름. 단자 1개 설비는 붙은 접속점(bus_id)의 버스."""
    own = {n.id: f"n{i}" for i, n in enumerate(graph.nodes)}
    return {n.id: own[n.bus_id] if n.bus_id else own[n.id] for n in graph.nodes}


def line_names(graph: SubstationGraph) -> dict[str, str]:
    """선로 id → OpenDSS Line 이름"""
    return {line.id: f"l{j}" for j, line in enumerate(graph.lines)}


def rated_current(line: Line) -> float:
    return line.rated_current_a if line.rated_current_a is not None else DEFAULT_RATED_CURRENT_A


def open_line_ids(graph: SubstationGraph) -> set[str]:
    """열린 개폐기에 닿아 끊긴 선로 id"""
    open_switches = {n.id for n in graph.nodes if n.type == "switch" and n.is_open}
    return {line.id for line in graph.lines if {line.from_node_id, line.to_node_id} & open_switches}


def check_complete(graph: SubstationGraph) -> None:
    """계산에 필요한 값이 다 있는지 검사한다. 편집 중인 계통은 이것이 빠져도 저장되므로 시뮬레이션 직전에 확인한다."""
    names = {n.id: n.name for n in graph.nodes}
    problems = []
    sources = sum(n.type == "source" for n in graph.nodes)
    if sources != 1:
        problems.append(f"변전소 전원(source) 노드가 {sources}개입니다 (1개 필요)")
    for f in graph.feeders:
        breakers = sum(n.type == "breaker" and n.feeder_id == f.id for n in graph.nodes)
        if breakers != 1:
            problems.append(f"피더 {f.name}의 출구 차단기(breaker)가 {breakers}개입니다 (1개 필요)")
    for n in graph.nodes:
        if n.type in ("load", "pv", "wind") and n.p_kw is None:
            problems.append(f"{names[n.id]}: 출력(p_kw)이 없습니다")
        if n.type in ONE_TERMINAL_TYPES and n.bus_id is None:
            problems.append(f"{names[n.id]}: 연결된 접속점(bus_id)이 없습니다")
    if problems:
        raise SimulationError("계통이 완성되지 않아 계산할 수 없습니다: " + "; ".join(problems))


@dataclass
class Trace:
    distance_km: dict[str, float]  # 전원에서 닿는 노드 id → 선로를 따라 잰 거리. 없는 노드는 정전 구간
    reversed_line_ids: set[str]  # 저장된 from_node_id가 실제로는 전원 반대쪽인 선로


def trace(graph: SubstationGraph) -> Trace:
    """전원 버스에서 닫힌 선로를 방향 없이 따라간다. 이미 지난 노드를 다른 선로로 다시 만나면 루프라 SimulationError.
    완성되지 않은 계통(check_complete 실패)도 SimulationError."""
    check_complete(graph)
    source = next(n for n in graph.nodes if n.type == "source")
    names = {n.id: n.name for n in graph.nodes}
    disabled = open_line_ids(graph)
    adjacent: dict[str, list] = {}
    for line in graph.lines:
        if line.id not in disabled:
            adjacent.setdefault(line.from_node_id, []).append(line)
            adjacent.setdefault(line.to_node_id, []).append(line)

    dist, used, reversed_ids = {source.bus_id: 0.0}, set(), set()
    queue = [source.bus_id]
    for node_id in queue:
        for line in adjacent.get(node_id, []):
            if line.id in used:
                continue
            used.add(line.id)
            other = line.to_node_id if line.from_node_id == node_id else line.from_node_id
            if other in dist:
                raise SimulationError(
                    f"방사형이 아닙니다: 선로 {line.name}({names[line.from_node_id]} - {names[line.to_node_id]})에서 루프가 생깁니다. "
                    "루프 중 한 곳의 개폐기를 열어 주세요")
            if line.to_node_id == node_id:
                reversed_ids.add(line.id)
            dist[other] = dist[node_id] + line.length_km
            queue.append(other)
    return Trace(dist, reversed_ids)


def to_dss_script(graph: SubstationGraph) -> list[str]:
    """계통을 OpenDSS 명령어 목록으로 변환한다. 마지막 Solve는 simulate.py가 실행한다."""
    buses = bus_names(graph)
    source = next(n for n in graph.nodes if n.type == "source")

    script = [
        "Clear",
        f"New Circuit.{CIRCUIT_NAME} phases=3 basekv={BASE_KV} pu={graph.substation.source_voltage_pu}"
        f" bus1={buses[source.id]} MVAsc3={STIFF_MVA} MVAsc1={STIFF_MVA}",
    ]

    disabled = open_line_ids(graph)
    for line, name in zip(graph.lines, line_names(graph).values()):
        cmd = f"New Line.{name} phases=3 bus1={buses[line.from_node_id]} bus2={buses[line.to_node_id]}"
        if line.kind == "switch":
            cmd += " switch=yes"
        else:
            cmd += (f" R1={line.r_ohm_per_km} X1={line.x_ohm_per_km} C1=0 C0=0"
                    f" length={line.length_km} units=km")
        cmd += f" normamps={rated_current(line)}"
        if line.id in disabled:
            cmd += " enabled=no"
        script.append(cmd)

    # vminpu: 기본값(부하 0.95, 발전기 0.9) 아래로 내려가면 OpenDSS가 정전력 대신 정임피던스로 바꿔 계산해
    # 전압 강하를 작게 보므로 낮춘다
    for i, n in enumerate(graph.nodes):
        power = f"phases=3 bus1={buses[n.id]} kV={BASE_KV} kW={n.p_kw} kvar={n.q_kvar or 0} model=1 vminpu=0.7"
        if n.type == "load":
            script.append(f"New Load.n{i} {power}")
        elif n.type in ("pv", "wind"):
            script.append(f"New Generator.n{i} {power} Xdp=1")

    script += [f"Set VoltageBases=[{BASE_KV}]", "CalcVoltageBases"]
    return script


def fault_study_script(graph: SubstationGraph) -> list[str]:
    """조류 계산 뒤 전원에 단락용량·X/R을 넣고 3상 단락 고장 해석을 실행하는 명령어 (값이 없으면 기본값)"""
    sub = graph.substation
    mva = sub.short_circuit_mva if sub.short_circuit_mva is not None else DEFAULT_SHORT_CIRCUIT_MVA
    x_r = sub.x_r_ratio if sub.x_r_ratio is not None else DEFAULT_X_R_RATIO
    return [f"Edit Vsource.source MVAsc3={mva} MVAsc1={mva} X1R1={x_r} X0R0={x_r}", "Solve mode=faultstudy"]
