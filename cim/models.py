"""계통 데이터 형식. API 응답과 Neo4j 저장에 같은 형식을 쓴다.

단선도·시뮬레이션은 변전소 단위로 다룬다 (변전소 하나 = 출구 차단기별 피더 여러 개).
단위: 전압 kV, 전력 kW·kvar, 전류 A, 단락용량 MVA, 길이 km, 임피던스 Ω/km, 좌표 x·y는 단선도 좌표
"""

from typing import Literal

from pydantic import BaseModel

# source: 변전소 전원(CIM EnergySource), breaker: 변전소 출구 차단기(Breaker), bus: 접속점(ConnectivityNode),
# load: 부하(EnergyConsumer), pv: 태양광 분산전원(PhotoVoltaicUnit), wind: 풍력 분산전원(WindGeneratingUnit)
NodeType = Literal["source", "breaker", "bus", "load", "pv", "wind"]


class Substation(BaseModel):
    """변전소"""

    id: str
    name: str
    base_kv: float
    short_circuit_mva: float | None = None  # 전원 단락용량 (고장전류 계산)


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
    p_kw: float | None = None  # load: 소비 전력, pv·wind: 발전 출력
    q_kvar: float | None = None


class Line(BaseModel):
    """두 노드를 잇는 연결. from_node_id → to_node_id"""

    id: str
    substation_id: str
    feeder_id: str | None = None
    name: str
    kind: str | None = None  # 연결 특성. 양 끝 설비 종류로 서버가 자동 구분 (cim/graph.py의 classify_connection)
    from_node_id: str
    to_node_id: str
    length_km: float
    r_ohm_per_km: float
    x_ohm_per_km: float
    rated_current_a: float | None = None  # 허용전류 (선로 과부하 계산)


class SubstationGraph(BaseModel):
    """변전소 하나의 전체 계통 (단선도 표시, 시뮬레이션 입력)"""

    substation: Substation
    feeders: list[Feeder]
    nodes: list[Node]
    lines: list[Line]


# 편집 스냅샷 저장 (제안서 4단계): 편집 중 추가한 노드·선로에는 프론트엔드가 UUID를 바로 할당하고,
# 편집을 마치면 변전소 계통 전체를 한 번에 보낸다. 선로의 kind는 보내지 않아도 서버가 채운다.
class SubstationSnapshot(BaseModel):
    nodes: list[Node]
    lines: list[Line]


class SnapshotSaved(BaseModel):
    graph: SubstationGraph  # 저장된 계통
    element_ids: dict[str, str]  # 노드·선로 UUID → Neo4j element id
