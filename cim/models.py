"""계통 데이터 형식. API 응답과 Neo4j 저장에 같은 형식을 쓴다.

해석 범위: 22.9kV 배전계통, 3상 평형(정상분 1상 등가), 방사형 계통(열린 개폐기로 끊은 뒤 기준), 한 시점 계산, 3상 단락만.
Neo4j에는 내부 이름(Node, LINE)을 쓰고 CIM 클래스는 아래 주석으로 대응한다.
단선도·시뮬레이션은 변전소 단위로 다룬다 (변전소 하나 = 출구 차단기별 피더 여러 개).
단위: 전압 kV(선간)·pu, 전력 kW·kvar(3상 합계), 전류 A, 단락용량 MVA, 길이 km, 임피던스 Ω/km(정상분), 좌표 x·y는 단선도 좌표
"""

from typing import Literal

from pydantic import BaseModel, model_validator

BASE_KV = 22.9  # 계통 기준 전압 (선간, kV). 지원 범위가 22.9kV뿐이므로 고정

# source: 변전소 전원(CIM EnergySource), breaker: 변전소 출구 차단기(Breaker), switch: 선로 중간 개폐기(LoadBreakSwitch),
# bus: 접속점(ConnectivityNode), load: 부하(EnergyConsumer), pv: 태양광 분산전원(PhotoVoltaicUnit), wind: 풍력 분산전원(WindGeneratingUnit)
NodeType = Literal["source", "breaker", "switch", "bus", "load", "pv", "wind"]
ONE_TERMINAL_TYPES = ("source", "load", "pv", "wind")  # bus_id로 접속점에 붙는 설비. 나머지(breaker·switch·bus)는 Line으로 연결

# switch: 차단기(breaker)나 개폐기(switch)에 닿은 연결 (OpenDSS Line switch=yes), line: 그 외 선로 (CIM ACLineSegment)
LineKind = Literal["line", "switch"]


class Substation(BaseModel):
    """변전소. 전원은 무한 모선 뒤의 등가 임피던스(단락용량, X/R)로 본다."""

    id: str
    name: str
    source_voltage_pu: float = 1.0  # 변전소 모선 전압 (전압 영향 계산 기준)
    short_circuit_mva: float | None = None  # 3상 단락용량 (없으면 시뮬레이션이 가정값 사용, simulation/dss.py의 DEFAULT_*)
    x_r_ratio: float | None = None  # 전원 임피던스 X/R (없으면 시뮬레이션이 가정값 사용)


class Feeder(BaseModel):
    """배전선로. 변전소 출구 차단기(type=breaker 노드) 하나에서 시작한다."""

    id: str
    substation_id: str
    name: str


class Node(BaseModel):
    id: str  # 편집 중 프론트엔드가 할당한 UUID, 적재 시에는 load.py가 발급
    substation_id: str
    feeder_id: str | None = None  # 변전소 전원(source)처럼 특정 피더에 속하지 않으면 None
    name: str
    type: NodeType
    x: float  # Neo4j에는 별도 좌표 메타데이터 노드(DiagramObject)로 저장
    y: float
    p_kw: float | None = None  # load: 소비 전력, pv·wind: 발전 출력 (3상 합계, 한 시점 값). 시뮬레이션에는 필수
    q_kvar: float | None = None  # 없으면 0 (역률 1)
    is_open: bool = False  # switch(개폐기)만: True면 열림 → 이 노드에 닿은 연결을 끊고 계산 (CIM Switch.open)
    # 단자 1개 설비(source·load·pv·wind)가 붙은 접속점(type=bus 노드)의 id (CIM Terminal.ConnectivityNode).
    # 이 설비들은 선로(Line)로 잇지 않고 bus_id로만 연결한다. Neo4j에서는 (:Node)-[:CONNECTED_TO]->(:Node {type:'bus'})
    # 편집 중에는 비어 있어도 저장할 수 있고, 시뮬레이션에는 필수
    bus_id: str | None = None

    @model_validator(mode="after")
    def _check_fields(self):
        if self.is_open and self.type != "switch":
            raise ValueError(f"노드 {self.id}: 열림(is_open)은 개폐기(switch) 노드에만 쓸 수 있습니다")
        if self.bus_id is not None and self.type not in ONE_TERMINAL_TYPES:
            raise ValueError(f"노드 {self.id}: bus_id는 {'/'.join(ONE_TERMINAL_TYPES)} 노드에만 쓸 수 있습니다")
        return self


class Line(BaseModel):
    """두 노드를 잇는 3상 평형 선로. from_node_id가 전원 쪽, 평소 조류 방향은 from → to (역조류 판정 기준).
    선로 정전용량은 무시한다."""

    id: str
    substation_id: str
    feeder_id: str | None = None
    name: str
    kind: LineKind | None = None  # 연결 특성. 양 끝 설비 종류로 서버가 자동 구분 (cim/graph.py의 classify_connection)
    from_node_id: str
    to_node_id: str
    length_km: float
    r_ohm_per_km: float  # 정상분 저항
    x_ohm_per_km: float  # 정상분 리액턴스
    rated_current_a: float | None = None  # 허용전류 (없으면 시뮬레이션이 가정값 사용)


class SubstationGraph(BaseModel):
    """변전소 하나의 전체 계통 (단선도 표시, 시뮬레이션 입력)

    여기서는 데이터가 깨지지 않았는지만 검사한다 (선로 양 끝, bus_id 대상, 단자 1개 설비 연결 방식).
    빈 계통이나 만들다 만 계통도 저장·조회할 수 있도록, 계산에 필요한 완성 조건
    (전원 노드 1개, 피더마다 차단기 1개, 부하·분산전원의 p_kw·bus_id)은 시뮬레이션 직전에
    simulation/dss.py의 check_complete가 검사한다.
    """

    substation: Substation
    feeders: list[Feeder]
    nodes: list[Node]
    lines: list[Line]

    @model_validator(mode="after")
    def _check_topology(self):
        types = {n.id: n.type for n in self.nodes}
        for n in self.nodes:
            if n.bus_id is not None and types.get(n.bus_id) != "bus":
                raise ValueError(f"노드 {n.id}의 bus_id {n.bus_id}가 접속점(bus) 노드가 아닙니다")
        for line in self.lines:
            if line.from_node_id not in types or line.to_node_id not in types:
                raise ValueError(f"선로 {line.id}의 양 끝 노드가 계통에 없습니다")
            if {types[line.from_node_id], types[line.to_node_id]} & set(ONE_TERMINAL_TYPES):
                raise ValueError(f"선로 {line.id}: {'/'.join(ONE_TERMINAL_TYPES)} 노드는 선로가 아니라 bus_id로 연결합니다")
        return self


# 편집 스냅샷 저장 (제안서 4단계): 변전소·피더·노드·선로 전체를 한 번에 보낸다 (형식은 SubstationGraph와 같음).
# 편집 중 새로 만든 변전소·피더·노드·선로에는 프론트엔드가 crypto.randomUUID()로 id를 바로 할당한다.
# 서버에 없는 변전소 id면 새로 만들고, 있으면 고친다. 그래서 빈 계통에서 하나씩 추가해 가며 저장할 수 있다.
# 선로의 kind는 보내지 않아도 서버가 채운다.
class SubstationSnapshot(SubstationGraph):
    pass


class SnapshotSaved(BaseModel):
    graph: SubstationGraph  # 저장된 계통
    element_ids: dict[str, str]  # 노드·선로 UUID → Neo4j element id
