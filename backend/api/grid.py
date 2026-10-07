"""계통 조회·편집 저장 API (FR-02, FR-05, FR-06, FR-07)"""

from fastapi import APIRouter, HTTPException

from cim import graph
from cim.models import SnapshotSaved, Substation, SubstationGraph, SubstationSnapshot

router = APIRouter()


@router.get("/substations")
def list_substations() -> list[Substation]:
    """변전소 목록"""
    return graph.list_substations()


@router.get("/substations/{substation_id}")
def get_substation(substation_id: str) -> SubstationGraph:
    """변전소의 피더·노드·선로 (단선도 표시용)"""
    return graph.get_substation(substation_id)


@router.put("/substations/{substation_id}")
def save_substation(substation_id: str, snapshot: SubstationSnapshot) -> SnapshotSaved:
    """편집 스냅샷 전체 저장 (UUID → Neo4j element id 대응표 포함). 없는 변전소 id면 새로 만든다."""
    if snapshot.substation.id != substation_id:
        raise HTTPException(422, "주소의 변전소 id와 스냅샷의 substation.id가 다릅니다")
    return graph.save_substation(substation_id, snapshot)
