"""Neo4j 계통 조회·편집. Neo4j에 접근하는 코드는 이 파일에만 둔다.

Neo4j 구조 (속성은 cim/models.py와 같음):
    (:Feeder {id, name, base_kv})
    (:Node {id, feeder_id, name, type, x, y, p_kw, q_kvar})
    (:Node)-[:LINE {id, feeder_id, name, length_km, r_ohm_per_km, x_ohm_per_km}]->(:Node)

id는 서버가 uuid4로 발급한다 (FR-07).
"""

from cim.models import (
    Feeder,
    FeederGraph,
    Line,
    LineCreate,
    LineUpdate,
    Node,
    NodeCreate,
    NodeUpdate,
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
