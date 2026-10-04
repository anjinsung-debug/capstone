"""Neo4j 계통 조회·편집. 연결은 cim/db.py의 get_driver()를 쓴다.

Neo4j 구조 (속성은 cim/models.py와 같음):
    (:Feeder {id, name, base_kv})
    (:Node {id, feeder_id, name, type, x, y, p_kw, q_kvar})
    (:Node)-[:LINE {id, feeder_id, name, length_km, r_ohm_per_km, x_ohm_per_km}]->(:Node)

id는 서버가 uuid4로 발급한다 (FR-07).
"""

from cim.models import (
    Feeder,
    FeederGraph,
    FeederSnapshot,
    Line,
    LineCreate,
    LineUpdate,
    Node,
    NodeCreate,
    NodeUpdate,
    SnapshotSaved,
)


def list_feeders() -> list[Feeder]:
    raise NotImplementedError


def get_feeder(feeder_id: str) -> FeederGraph:
    raise NotImplementedError


def create_node(feeder_id: str, data: NodeCreate) -> Node:
    raise NotImplementedError


def update_node(node_id: str, data: NodeUpdate) -> Node:
    raise NotImplementedError


def delete_node(node_id: str) -> None:
    raise NotImplementedError


def create_line(feeder_id: str, data: LineCreate) -> Line:
    raise NotImplementedError


def update_line(line_id: str, data: LineUpdate) -> Line:
    raise NotImplementedError


def delete_line(line_id: str) -> None:
    raise NotImplementedError


def save_feeder(feeder_id: str, snapshot: FeederSnapshot) -> SnapshotSaved:
    """편집 스냅샷을 하나의 트랜잭션으로 저장한다 (4단계).

    - DB에 없는 id는 새 노드·선로로 보고 uuid4를 발급해 id_map에 기록
    - 선로의 from/to_node_id에 쓰인 임시 id도 발급한 실제 id로 바꿈
    - 스냅샷에 없는 기존 노드·선로는 삭제 (가비지 컬렉션)
    """
    raise NotImplementedError
