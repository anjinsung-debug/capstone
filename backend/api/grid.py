"""계통 조회·편집 저장 API (FR-02, FR-05, FR-06, FR-07)"""

from urllib.parse import quote

from fastapi import APIRouter, HTTPException, Response

from cim import graph
from cim.export import ExportError, to_cim_xml
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


@router.get("/substations/{substation_id}/cim")
def export_cim(substation_id: str) -> Response:
    """마지막으로 저장된 계통을 CIM16 RDF/XML 파일로 내려받기 (cim/export.py). 내보낼 수 없는 계통이면 422와 이유"""
    g = graph.get_substation(substation_id)
    try:
        xml = to_cim_xml(g)
    except ExportError as e:
        raise HTTPException(422, str(e)) from e
    filename = quote(f"{g.substation.name}_cim.xml")
    return Response(xml, media_type="application/rdf+xml",
                    headers={"Content-Disposition": f"attachment; filename*=UTF-8''{filename}"})
