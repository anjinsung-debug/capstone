"""Neo4j 계통 조회·저장. 연결은 cim/db.py의 get_driver()를 쓴다.

Neo4j 구조 (속성은 cim/models.py와 같음):
    (:Substation {id, name, source_voltage_pu, short_circuit_mva, x_r_ratio})
    (:Substation)-[:HAS_FEEDER]->(:Feeder {id, substation_id, name})
    (:Node {id, substation_id, feeder_id, name, type, p_kw, q_kvar, is_open})
    (:Node)-[:CONNECTED_TO]->(:Node {type: 'bus'})   source·load·pv·wind가 붙은 접속점 (Node.bus_id, CIM Terminal)
    (:Node)-[:LINE {id, substation_id, feeder_id, name, kind, length_km, r_ohm_per_km, x_ohm_per_km, rated_current_a}]->(:Node)
    (:Node)-[:HAS_DIAGRAM]->(:DiagramObject {x, y})   좌표 메타데이터 노드 (설비 속성과 분리, 제안서)

API의 Node.x, y는 조회할 때 DiagramObject에서 읽고, 저장할 때 DiagramObject에 쓴다.
"""

from cim import db
from cim.models import Feeder, Line, LineKind, Node, SnapshotSaved, Substation, SubstationGraph, SubstationSnapshot


class SubstationNotFound(LookupError):
    """없는 변전소 id. API에서는 404로 돌려준다."""


def list_substations() -> list[Substation]:
    """적재된 변전소 목록 (웹 첫 화면의 변전소 선택용). 이름순."""
    with db.get_driver().session() as session:
        rows = session.execute_read(
            lambda tx: tx.run("MATCH (s:Substation) RETURN s{.*} AS s ORDER BY s.name").data()
        )
    return [Substation(**r["s"]) for r in rows]


def _read_substation(tx, sid: str) -> dict | None:
    sub = tx.run("MATCH (s:Substation {id: $sid}) RETURN s{.*} AS s", sid=sid).single()
    if sub is None:
        return None

    feeders = tx.run(
        "MATCH (:Substation {id: $sid})-[:HAS_FEEDER]->(f:Feeder) RETURN f{.*} AS f ORDER BY f.name",
        sid=sid,
    ).data()

    # 설비 속성 + 좌표(DiagramObject) + 붙은 접속점(CONNECTED_TO → bus_id)을 한 번에
    nodes = tx.run(
        """
        MATCH (n:Node {substation_id: $sid})
        OPTIONAL MATCH (n)-[:HAS_DIAGRAM]->(d:DiagramObject)
        OPTIONAL MATCH (n)-[:CONNECTED_TO]->(b:Node {type: 'bus'})
        RETURN n{.*} AS n, d.x AS x, d.y AS y, b.id AS bus_id
        """,
        sid=sid,
    ).data()

    # 선로 방향(from=전원 쪽)은 관계 방향 그대로
    lines = tx.run(
        """
        MATCH (a:Node)-[l:LINE {substation_id: $sid}]->(b:Node)
        RETURN l{.*} AS l, a.id AS from_id, b.id AS to_id
        """,
        sid=sid,
    ).data()

    return {"substation": sub["s"], "feeders": feeders, "nodes": nodes, "lines": lines}


def get_substation(substation_id: str) -> SubstationGraph:
    """변전소의 피더·노드·선로를 읽어 SubstationGraph로 돌려준다 (좌표는 DiagramObject에서).
    단선도 화면(GET /api/grid)과 시뮬레이션 입력(simulation/dss.py)이 같이 쓴다."""
    with db.get_driver().session() as session:
        raw = session.execute_read(_read_substation, substation_id)
    if raw is None:
        raise SubstationNotFound(f"변전소 {substation_id}가 없습니다")

    nodes = []
    for r in raw["nodes"]:
        props = dict(r["n"])
        if props.get("type") != "switch":
            props.pop("is_open", None)  # 모델 규칙상 의미 있는 건 switch뿐
        nodes.append(Node(**props, x=r["x"] or 0.0, y=r["y"] or 0.0, bus_id=r["bus_id"]))

    lines = [Line(**r["l"], from_node_id=r["from_id"], to_node_id=r["to_id"]) for r in raw["lines"]]

    # SubstationGraph가 위상 규칙(전원 1개, 피더별 차단기 1개, bus_id 대상 등)을 다시 검사한다
    return SubstationGraph(
        substation=Substation(**raw["substation"]),
        feeders=[Feeder(**r["f"]) for r in raw["feeders"]],
        nodes=nodes,
        lines=lines,
    )


def save_substation(substation_id: str, snapshot: SubstationSnapshot) -> SnapshotSaved:
    """편집 스냅샷을 하나의 트랜잭션으로 저장한다 (제안서 4단계).

    - 노드·선로를 UUID(id) 기준으로 추가·수정하고, 좌표는 DiagramObject에 저장
    - 선로의 kind는 classify_connection으로 채움
    - 스냅샷에 없는 기존 노드·선로와 연결이 끊긴 DiagramObject는 삭제 (가비지 컬렉션)
    - 저장된 노드·선로의 UUID → Neo4j element id 대응표를 돌려줌
    """
    raise NotImplementedError


def classify_connection(from_node: Node, to_node: Node) -> LineKind:
    """두 노드의 설비 종류(type)로 연결 특성을 정한다 (위상 형성 논리). 차단기·개폐기에 닿으면 switch, 그 외는 line."""
    return "switch" if {"breaker", "switch"} & {from_node.type, to_node.type} else "line"
