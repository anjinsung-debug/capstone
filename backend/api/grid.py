"""계통 조회·편집 API (FR-02, FR-05, FR-06, FR-07)"""

from fastapi import APIRouter

from cim import graph
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

router = APIRouter()


@router.get("/feeders")
def list_feeders() -> list[Feeder]:
    """배전선로 목록"""
    return graph.list_feeders()


@router.get("/feeders/{feeder_id}")
def get_feeder(feeder_id: str) -> FeederGraph:
    """배전선로의 노드·선로 (단선도 표시용)"""
    return graph.get_feeder(feeder_id)


@router.put("/feeders/{feeder_id}")
def save_feeder(feeder_id: str, snapshot: FeederSnapshot) -> SnapshotSaved:
    """편집 스냅샷 전체 저장 (임시 id → 실제 id 대응표 포함)"""
    return graph.save_feeder(feeder_id, snapshot)


@router.post("/feeders/{feeder_id}/nodes")
def create_node(feeder_id: str, data: NodeCreate) -> Node:
    """노드 추가"""
    return graph.create_node(feeder_id, data)


@router.patch("/nodes/{node_id}")
def update_node(node_id: str, data: NodeUpdate) -> Node:
    """노드 수정 (위치 이동 포함)"""
    return graph.update_node(node_id, data)


@router.delete("/nodes/{node_id}", status_code=204)
def delete_node(node_id: str) -> None:
    """노드 삭제"""
    graph.delete_node(node_id)


@router.post("/feeders/{feeder_id}/lines")
def create_line(feeder_id: str, data: LineCreate) -> Line:
    """선로 추가"""
    return graph.create_line(feeder_id, data)


@router.patch("/lines/{line_id}")
def update_line(line_id: str, data: LineUpdate) -> Line:
    """선로 수정"""
    return graph.update_line(line_id, data)


@router.delete("/lines/{line_id}", status_code=204)
def delete_line(line_id: str) -> None:
    """선로 삭제"""
    graph.delete_line(line_id)
