"""계통 데이터 형식. API 응답과 Neo4j 저장에 같은 형식을 쓴다.

단위: 전압 kV, 전력 kW·kvar, 길이 km, 임피던스 Ω/km, 좌표 x·y는 단선도 좌표
"""

from typing import Literal

from pydantic import BaseModel

# source: 변전소 전원(CIM EnergySource), bus: 접속점(ConnectivityNode), load: 부하(EnergyConsumer)
NodeType = Literal["source", "bus", "load"]


class Feeder(BaseModel):
    """배전선로"""

    id: str
    name: str
    base_kv: float


class Node(BaseModel):
    id: str
    feeder_id: str
    name: str
    type: NodeType
    x: float
    y: float
    p_kw: float | None = None  # load만
    q_kvar: float | None = None  # load만


class Line(BaseModel):
    """선로. from_node_id → to_node_id"""

    id: str
    feeder_id: str
    name: str
    from_node_id: str
    to_node_id: str
    length_km: float
    r_ohm_per_km: float
    x_ohm_per_km: float


class FeederGraph(BaseModel):
    """배전선로 하나의 전체 계통 (단선도 표시, 시뮬레이션 입력)"""

    feeder: Feeder
    nodes: list[Node]
    lines: list[Line]


# 생성 요청: id, feeder_id는 서버가 채운다
class NodeCreate(BaseModel):
    name: str
    type: NodeType
    x: float
    y: float
    p_kw: float | None = None
    q_kvar: float | None = None


class NodeUpdate(BaseModel):
    name: str | None = None
    x: float | None = None
    y: float | None = None
    p_kw: float | None = None
    q_kvar: float | None = None


class LineCreate(BaseModel):
    name: str
    from_node_id: str
    to_node_id: str
    length_km: float
    r_ohm_per_km: float
    x_ohm_per_km: float


class LineUpdate(BaseModel):
    name: str | None = None
    length_km: float | None = None
    r_ohm_per_km: float | None = None
    x_ohm_per_km: float | None = None


# 편집 스냅샷 저장 (4단계): 편집이 끝난 계통 전체를 한 번에 저장한다.
# 새로 추가된 노드·선로는 프론트엔드가 만든 임시 id를 쓰고, 선로의 from/to_node_id도 임시 id를 가리킬 수 있다.
class SnapshotNode(NodeCreate):
    id: str  # 기존 노드는 실제 id, 새 노드는 임시 id


class SnapshotLine(LineCreate):
    id: str  # 기존 선로는 실제 id, 새 선로는 임시 id


class FeederSnapshot(BaseModel):
    nodes: list[SnapshotNode]
    lines: list[SnapshotLine]


class SnapshotSaved(BaseModel):
    graph: FeederGraph  # 저장된 계통 (모두 실제 id)
    id_map: dict[str, str]  # 임시 id → 서버가 발급한 실제 id
