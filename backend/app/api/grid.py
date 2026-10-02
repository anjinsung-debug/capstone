"""계통 조회·편집 API (FR-02, FR-05, FR-06, FR-07)"""

from fastapi import APIRouter, HTTPException

router = APIRouter()


def not_implemented():
    raise HTTPException(status_code=501, detail="아직 구현되지 않았습니다.")


@router.get("/feeders")
def list_feeders():
    """배전선로 목록 조회"""
    not_implemented()


@router.get("/feeders/{feeder_id}")
def get_feeder(feeder_id: str):
    """배전선로의 노드·선로 조회 (단선도 표시용)"""
    not_implemented()


@router.post("/feeders/{feeder_id}/nodes")
def create_node(feeder_id: str, body: dict):
    """노드 추가. 서버가 UUID를 발급"""
    not_implemented()


@router.patch("/nodes/{node_id}")
def update_node(node_id: str, body: dict):
    """노드 수정 (위치 이동 포함)"""
    not_implemented()


@router.delete("/nodes/{node_id}")
def delete_node(node_id: str):
    """노드 삭제"""
    not_implemented()


@router.post("/feeders/{feeder_id}/lines")
def create_line(feeder_id: str, body: dict):
    """선로 추가. 서버가 UUID를 발급"""
    not_implemented()


@router.patch("/lines/{line_id}")
def update_line(line_id: str, body: dict):
    """선로 수정"""
    not_implemented()


@router.delete("/lines/{line_id}")
def delete_line(line_id: str):
    """선로 삭제"""
    not_implemented()
