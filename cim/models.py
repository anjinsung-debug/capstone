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
