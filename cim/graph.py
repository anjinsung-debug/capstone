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
from cim.topology import trace_feeders


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


class InvalidSnapshot(ValueError):
    """편집 스냅샷이 계통 규칙에 맞지 않음. API에서는 422로 돌려준다."""


NODE_PROPS = ("id", "substation_id", "feeder_id", "name", "type", "p_kw", "q_kvar", "is_open")
LINE_PROPS = ("id", "substation_id", "feeder_id", "name", "kind",
              "length_km", "r_ohm_per_km", "x_ohm_per_km", "rated_current_a")


def _prepare_snapshot(substation: Substation, snapshot: SubstationSnapshot) -> SubstationGraph:
    """스냅샷을 서버 기준으로 다듬고 검사한다: 소속 변전소 고정, kind·피더·선로 방향 채우기."""
    sid = substation.id
    nodes = {n.id: n.model_dump() for n in snapshot.nodes}
    lines = {l.id: l.model_dump() for l in snapshot.lines}
    if len(nodes) != len(snapshot.nodes) or len(lines) != len(snapshot.lines):
        raise InvalidSnapshot("노드 또는 선로 id가 중복되었습니다")
    if set(nodes) & set(lines):
        raise InvalidSnapshot("노드와 선로가 같은 id를 쓰고 있습니다")

    for n in nodes.values():
        n["substation_id"] = sid  # 주소의 변전소가 기준 (프론트가 보낸 값은 무시)
    for l in lines.values():
        l["substation_id"] = sid
        if l["from_node_id"] not in nodes or l["to_node_id"] not in nodes:
            raise InvalidSnapshot(f"선로 {l['name']}의 양 끝 노드가 스냅샷에 없습니다")
        # 연결 특성은 서버가 정한다 (위상 형성 논리)
        l["kind"] = classify_connection(Node(**nodes[l["from_node_id"]]), Node(**nodes[l["to_node_id"]]))

    sources = [n for n in nodes.values() if n["type"] == "source"]
    if len(sources) != 1:
        raise InvalidSnapshot(f"변전소 전원(source) 노드는 하나여야 합니다 (지금 {len(sources)}개)")
    if sources[0]["bus_id"] not in nodes:
        raise InvalidSnapshot("전원 노드의 bus_id가 스냅샷에 없는 노드를 가리킵니다")

    # 선로 방향(from=전원 쪽)과 피더 소속을 다시 계산 (차단기를 추가·삭제했을 수도 있으므로)
    feeders, _warnings = trace_feeders(sources[0], nodes, lines, sid)

    try:
        return SubstationGraph(
            substation=substation,
            feeders=feeders,
            nodes=[Node(**n) for n in nodes.values()],
            lines=[Line(**l) for l in lines.values()],
        )
    except ValueError as e:  # pydantic 검증 오류 (bus_id 대상, 피더별 차단기 수 등)
        raise InvalidSnapshot(str(e)) from e


def _write_snapshot(tx, g: SubstationGraph) -> dict[str, str]:
    """계통 전체를 덮어쓴다. 스냅샷에 없는 기존 노드·선로·피더는 지운다. UUID → element id 대응표를 돌려준다."""
    sid = g.substation.id
    node_ids = [n.id for n in g.nodes]

    # 다른 변전소의 노드 id를 가져다 쓰면 그 노드를 빼앗게 되므로 막는다
    clash = tx.run(
        "MATCH (n:Node) WHERE n.id IN $ids AND n.substation_id <> $sid RETURN n.id AS id LIMIT 5",
        ids=node_ids, sid=sid,
    ).data()
    if clash:
        raise InvalidSnapshot(f"다른 변전소에 이미 있는 노드 id입니다: {[r['id'] for r in clash]}")

    # 1) 피더: 새로 계산한 것으로 교체
    tx.run("""
        MATCH (s:Substation {id: $sid})
        OPTIONAL MATCH (s)-[:HAS_FEEDER]->(old:Feeder) WHERE NOT old.id IN $keep
        DETACH DELETE old""", sid=sid, keep=[f.id for f in g.feeders])
    tx.run("""
        MATCH (s:Substation {id: $sid})
        UNWIND $rows AS p
        MERGE (f:Feeder {id: p.id}) SET f = p
        MERGE (s)-[:HAS_FEEDER]->(f)""", sid=sid, rows=[f.model_dump() for f in g.feeders])

    # 2) 선로·설비 연결은 전부 지우고 새로 만든다 (방향·양 끝이 바뀌었을 수 있음)
    tx.run("MATCH ()-[l:LINE {substation_id: $sid}]->() DELETE l", sid=sid)
    tx.run("MATCH (:Node {substation_id: $sid})-[c:CONNECTED_TO]->() DELETE c", sid=sid)

    # 3) 스냅샷에서 빠진 노드는 좌표 노드와 함께 삭제
    tx.run("""
        MATCH (n:Node {substation_id: $sid}) WHERE NOT n.id IN $keep
        OPTIONAL MATCH (n)-[:HAS_DIAGRAM]->(d:DiagramObject)
        DETACH DELETE n, d""", sid=sid, keep=node_ids)

    # 4) 노드 추가·수정 (SET n = p: 보낸 값으로 속성을 통째로 바꾼다. null이면 그 속성은 지워짐)
    tx.run("""
        UNWIND $rows AS row
        MERGE (n:Node {id: row.p.id}) SET n = row.p
        MERGE (n)-[:HAS_DIAGRAM]->(d:DiagramObject)
        SET d.x = row.x, d.y = row.y""",
        rows=[{"p": {k: getattr(n, k) for k in NODE_PROPS}, "x": n.x, "y": n.y} for n in g.nodes])

    # 5) 설비 → 접속점 연결, 선로
    tx.run("""
        UNWIND $rows AS row
        MATCH (n:Node {id: row.id}), (b:Node {id: row.bus_id})
        CREATE (n)-[:CONNECTED_TO]->(b)""",
        rows=[{"id": n.id, "bus_id": n.bus_id} for n in g.nodes if n.bus_id])
    tx.run("""
        UNWIND $rows AS row
        MATCH (a:Node {id: row.from_id}), (b:Node {id: row.to_id})
        CREATE (a)-[l:LINE]->(b) SET l = row.p""",
        rows=[{"p": {k: getattr(l, k) for k in LINE_PROPS}, "from_id": l.from_node_id, "to_id": l.to_node_id}
              for l in g.lines])

    # 6) 가비지 컬렉션: 어느 노드에도 안 붙은 좌표 노드
    tx.run("MATCH (d:DiagramObject) WHERE NOT ()-[:HAS_DIAGRAM]->(d) DELETE d")

    # 7) UUID → Neo4j element id
    rows = tx.run("""
        MATCH (n:Node {substation_id: $sid}) RETURN n.id AS id, elementId(n) AS eid
        UNION ALL
        MATCH ()-[l:LINE {substation_id: $sid}]->() RETURN l.id AS id, elementId(l) AS eid""",
        sid=sid).data()
    return {r["id"]: r["eid"] for r in rows}


def save_substation(substation_id: str, snapshot: SubstationSnapshot) -> SnapshotSaved:
    """편집 스냅샷을 하나의 트랜잭션으로 저장한다 (제안서 4단계, FR-06·FR-07).

    - 스냅샷 = 변전소 계통 전체. 노드·선로를 UUID(id) 기준으로 추가·수정하고, 좌표는 DiagramObject에 저장
    - 스냅샷에 없는 기존 노드·선로·피더와, 연결이 끊긴 DiagramObject는 삭제 (가비지 컬렉션)
    - 서버가 채우는 값: substation_id(주소 기준), 선로 kind(classify_connection),
      선로 방향(from=전원 쪽)과 feeder_id(차단기마다 피더, topology.trace_feeders)
    - 검사에 실패하면 아무것도 쓰지 않고 InvalidSnapshot
    - 저장된 노드·선로의 UUID → Neo4j element id 대응표를 돌려줌
    """
    with db.get_driver().session() as session:
        sub = session.execute_read(
            lambda tx: tx.run("MATCH (s:Substation {id: $sid}) RETURN s{.*} AS s", sid=substation_id).single()
        )
        if sub is None:
            raise SubstationNotFound(f"변전소 {substation_id}가 없습니다")
        g = _prepare_snapshot(Substation(**sub["s"]), snapshot)
        element_ids = session.execute_write(_write_snapshot, g)
    return SnapshotSaved(graph=g, element_ids=element_ids)


def classify_connection(from_node: Node, to_node: Node) -> LineKind:
    """두 노드의 설비 종류(type)로 연결 특성을 정한다 (위상 형성 논리). 차단기·개폐기에 닿으면 switch, 그 외는 line."""
    return "switch" if {"breaker", "switch"} & {from_node.type, to_node.type} else "line"
