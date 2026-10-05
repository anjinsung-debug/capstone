"""계통 데이터 형식. API 응답과 Neo4j 저장에 같은 형식을 쓴다.

해석 범위: 22.9kV 배전계통, 3상 평형(정상분 1상 등가), 한 시점 계산, 3상 단락만.
단선도·시뮬레이션은 변전소 단위로 다룬다 (변전소 하나 = 출구 차단기별 피더 여러 개).
단위: 전압 kV(선간)·pu, 전력 kW·kvar(3상 합계), 전류 A, 단락용량 MVA, 길이 km, 임피던스 Ω/km(정상분), 좌표 x·y는 단선도 좌표
"""

from typing import Literal

from pydantic import BaseModel, model_validator

BASE_KV = 22.9  # 계통 기준 전압 (선간, kV). 지원 범위가 22.9kV뿐이므로 고정

# source: 변전소 전원(CIM EnergySource), breaker: 변전소 출구 차단기(Breaker), bus: 접속점(ConnectivityNode),
# load: 부하(EnergyConsumer), pv: 태양광 분산전원(PhotoVoltaicUnit), wind: 풍력 분산전원(WindGeneratingUnit)
NodeType = Literal["source", "breaker", "bus", "load", "pv", "wind"]


class Substation(BaseModel):
    """변전소. 전원은 무한 모선 뒤의 등가 임피던스(단락용량, X/R)로 본다."""

    id: str
    name: str
    source_voltage_pu: float = 1.0  # 변전소 모선 전압 (전압 영향 계산 기준)
    short_circuit_mva: float | None = None  # 3상 단락용량 (없으면 고장전류를 계산하지 않음)
    x_r_ratio: float | None = None  # 전원 임피던스 X/R (없으면 OpenDSS 기본값)


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
    p_kw: float | None = None  # load: 소비 전력, pv·wind: 발전 출력 (3상 합계, 한 시점 값)
    q_kvar: float | None = None  # 없으면 0 (역률 1)

    @model_validator(mode="after")
    def _check_power(self):
        if self.type in ("load", "pv", "wind") and self.p_kw is None:
            raise ValueError(f"{self.type} 노드 {self.id}에는 p_kw가 필요합니다")
        return self


class Line(BaseModel):
    """두 노드를 잇는 3상 평형 선로. from_node_id가 전원 쪽, 평소 조류 방향은 from → to (역조류 판정 기준).
    선로 정전용량은 무시한다."""

    id: str
    substation_id: str
    feeder_id: str | None = None
    name: str
    kind: str | None = None  # 연결 특성. 양 끝 설비 종류로 서버가 자동 구분 (cim/graph.py의 classify_connection)
    from_node_id: str
    to_node_id: str
    length_km: float
    r_ohm_per_km: float  # 정상분 저항
    x_ohm_per_km: float  # 정상분 리액턴스
    rated_current_a: float | None = None  # 허용전류 (없으면 선로 과부하를 계산하지 않음)


class SubstationGraph(BaseModel):
    """변전소 하나의 전체 계통 (단선도 표시, 시뮬레이션 입력)"""

    substation: Substation
    feeders: list[Feeder]
    nodes: list[Node]
    lines: list[Line]

    @model_validator(mode="after")
    def _check_topology(self):
        if sum(n.type == "source" for n in self.nodes) != 1:
            raise ValueError("변전소 전원(source) 노드는 하나여야 합니다")
        for f in self.feeders:
            if sum(n.type == "breaker" and n.feeder_id == f.id for n in self.nodes) != 1:
                raise ValueError(f"피더 {f.id}에는 출구 차단기(breaker) 노드가 하나여야 합니다")
        node_ids = {n.id for n in self.nodes}
        for line in self.lines:
            if line.from_node_id not in node_ids or line.to_node_id not in node_ids:
                raise ValueError(f"선로 {line.id}의 양 끝 노드가 계통에 없습니다")
        return self


# 편집 스냅샷 저장 (제안서 4단계): 편집 중 추가한 노드·선로에는 프론트엔드가 UUID를 바로 할당하고,
# 편집을 마치면 변전소 계통 전체를 한 번에 보낸다. 선로의 kind는 보내지 않아도 서버가 채운다.
class SubstationSnapshot(BaseModel):
    nodes: list[Node]
    lines: list[Line]


class SnapshotSaved(BaseModel):
    graph: SubstationGraph  # 저장된 계통
    element_ids: dict[str, str]  # 노드·선로 UUID → Neo4j element id
