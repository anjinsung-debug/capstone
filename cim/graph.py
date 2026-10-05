"""Neo4j 계통 조회·저장. 연결은 cim/db.py의 get_driver()를 쓴다.

Neo4j 구조 (속성은 cim/models.py와 같음):
    (:Substation {id, name, source_voltage_pu, short_circuit_mva, x_r_ratio})
    (:Substation)-[:HAS_FEEDER]->(:Feeder {id, substation_id, name})
    (:Node {id, substation_id, feeder_id, name, type, p_kw, q_kvar})
    (:Node)-[:LINE {id, substation_id, feeder_id, name, kind, length_km, r_ohm_per_km, x_ohm_per_km, rated_current_a}]->(:Node)
    (:Node)-[:HAS_DIAGRAM]->(:DiagramObject {x, y})   좌표 메타데이터 노드 (설비 속성과 분리, 제안서)

API의 Node.x, y는 조회할 때 DiagramObject에서 읽고, 저장할 때 DiagramObject에 쓴다.
"""

from cim.models import Node, SnapshotSaved, Substation, SubstationGraph, SubstationSnapshot


def list_substations() -> list[Substation]:
    raise NotImplementedError


def get_substation(substation_id: str) -> SubstationGraph:
    """변전소의 피더·노드·선로를 위상 탐색 쿼리로 읽는다 (좌표는 DiagramObject에서)."""
    raise NotImplementedError


def save_substation(substation_id: str, snapshot: SubstationSnapshot) -> SnapshotSaved:
    """편집 스냅샷을 하나의 트랜잭션으로 저장한다 (제안서 4단계).

    - 노드·선로를 UUID(id) 기준으로 추가·수정하고, 좌표는 DiagramObject에 저장
    - 선로의 kind는 classify_connection으로 채움
    - 스냅샷에 없는 기존 노드·선로와 연결이 끊긴 DiagramObject는 삭제 (가비지 컬렉션)
    - 저장된 노드·선로의 UUID → Neo4j element id 대응표를 돌려줌
    """
    raise NotImplementedError


def classify_connection(from_node: Node, to_node: Node) -> str:
    """두 노드의 설비 종류(type)로 연결 특성을 정한다 (위상 형성 논리, 규칙은 회의에서 확정)."""
    raise NotImplementedError
