"""Neo4j 계통 조회·저장. 연결은 cim/db.py의 get_driver()를 쓴다.

Neo4j 구조 (속성은 cim/models.py와 같음):
    (:Substation {id, name, source_voltage_pu, short_circuit_mva, x_r_ratio})
    (:Substation)-[:HAS_FEEDER]->(:Feeder {id, substation_id, name})
    (:Node {id, substation_id, feeder_id, name, type, p_kw, q_kvar, is_open})
    (:Node)-[:LINE {id, substation_id, feeder_id, name, kind, length_km, r_ohm_per_km, x_ohm_per_km, rated_current_a}]->(:Node)
    (:Node)-[:HAS_DIAGRAM]->(:DiagramObject {x, y})   좌표 메타데이터 노드 (설비 속성과 분리, 제안서)

API의 Node.x, y는 조회할 때 DiagramObject에서 읽고, 저장할 때 DiagramObject에 쓴다.
"""

from cim.models import LineKind, Node, SnapshotSaved, Substation, SubstationGraph, SubstationSnapshot


def list_substations() -> list[Substation]:
    # 구현 참고 (안진성): MATCH (s:Substation) RETURN s ORDER BY s.name → [Substation(**dict(s)) ...]
    # 웹에서 새로 만든 빈 변전소(노드 없음)도 목록에 나와야 한다
    raise NotImplementedError


def get_substation(substation_id: str) -> SubstationGraph:
    """변전소의 피더·노드·선로를 위상 탐색 쿼리로 읽는다 (좌표는 DiagramObject에서)."""
    # 구현 참고 (안진성): 아래 쿼리로 Neo4j에서 읽어 SubstationGraph를 만들면 시뮬레이션까지 동작함을 확인했다.
    # (python -m cim.load로 적재한 데이터 → XML을 바로 변환한 결과와 모든 노드 전압 일치)
    #
    #   MATCH (s:Substation {id: $id}) RETURN s
    #   MATCH (:Substation {id: $id})-[:HAS_FEEDER]->(f:Feeder) RETURN f
    #   MATCH (n:Node {substation_id: $id})-[:HAS_DIAGRAM]->(d:DiagramObject)
    #   OPTIONAL MATCH (n)-[:CONNECTED_TO]->(b:Node)
    #   RETURN n, d.x AS x, d.y AS y, b.id AS bus_id
    #   MATCH (a:Node {substation_id: $id})-[l:LINE]->(b:Node) RETURN l, a.id AS from_node_id, b.id AS to_node_id
    #
    # - bus_id는 노드 속성이 아니라 CONNECTED_TO 관계로 저장되어 있으므로 반드시 위처럼 읽어 채운다.
    #   빠지면 조회는 되지만 시뮬레이션이 "연결된 접속점(bus_id)이 없습니다"로 422를 낸다
    # - Node: dict(n) | {"x": x, "y": y, "bus_id": bus_id}, Line: dict(l) | {"from_node_id": ..., "to_node_id": ...}
    # - 변전소가 없으면 404를 낼 수 있도록 처리 (예: LookupError → backend에서 404)
    raise NotImplementedError


def save_substation(substation_id: str, snapshot: SubstationSnapshot) -> SnapshotSaved:
    """편집 스냅샷을 하나의 트랜잭션으로 저장한다 (제안서 4단계).

    - 노드·선로를 UUID(id) 기준으로 추가·수정하고, 좌표는 DiagramObject에 저장
    - 선로의 kind는 classify_connection으로 채움
    - 스냅샷에 없는 기존 노드·선로와 연결이 끊긴 DiagramObject는 삭제 (가비지 컬렉션)
    - 저장된 노드·선로의 UUID → Neo4j element id 대응표를 돌려줌
    """
    # 구현 참고 (안진성): 빈 계통부터 웹에서 하나씩 만들 수 있도록 스냅샷 형식을 넓혔다 (커밋 529ef42).
    # - snapshot에 substation, feeders도 들어온다 (형식은 SubstationGraph와 같음, id는 프론트엔드가 만든 UUID)
    # - 없는 변전소 id면 새로 만든다. 변전소·피더·노드·선로 모두 id 기준 MERGE (없으면 생성, 있으면 수정)
    # - 미완성 계통도 그대로 저장한다: 노드가 하나도 없거나, 전원이 없거나, bus_id·p_kw가 빈 노드가 있어도 됨.
    #   완성 여부는 시뮬레이션 직전에 simulation/dss.py의 check_complete가 검사한다
    # - 저장 방식은 cim/load.py의 _write_graph와 같다: Substation SET s += props, (:Substation)-[:HAS_FEEDER]->(:Feeder),
    #   좌표는 (:Node)-[:HAS_DIAGRAM]->(:DiagramObject {x, y}), bus_id는 (:Node)-[:CONNECTED_TO]->(:Node {type:'bus'}),
    #   선로는 (:Node)-[:LINE]->(:Node). bus_id가 바뀌거나 비면 기존 CONNECTED_TO를 지운다
    # - 선로 kind가 비어 오면 classify_connection으로 채운다
    # - 삭제: 이 변전소의 기존 피더·노드·선로 중 스냅샷에 없는 id는 DETACH DELETE, 노드가 지워지면 그 DiagramObject도 삭제
    # - 한 트랜잭션(session.execute_write)으로 처리해 중간에 실패하면 아무것도 바뀌지 않게 한다
    # - 반환: SnapshotSaved(graph=저장된 계통(get_substation으로 다시 읽어도 됨), element_ids={UUID: elementId(n)})
    raise NotImplementedError


def classify_connection(from_node: Node, to_node: Node) -> LineKind:
    """두 노드의 설비 종류(type)로 연결 특성을 정한다 (위상 형성 논리). 차단기·개폐기에 닿으면 switch, 그 외는 line."""
    return "switch" if {"breaker", "switch"} & {from_node.type, to_node.type} else "line"
