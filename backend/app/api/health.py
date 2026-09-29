from fastapi import APIRouter
from neo4j.exceptions import Neo4jError, ServiceUnavailable

from backend.app.core.neo4j import get_driver

router = APIRouter()


@router.get("/health")
def health() -> dict:
    """서버와 Neo4j 연결 상태를 확인한다."""
    try:
        get_driver().verify_connectivity()
        neo4j_status = "connected"
    except (ServiceUnavailable, Neo4jError, RuntimeError) as e:
        neo4j_status = f"unavailable: {type(e).__name__}"
    return {"status": "ok", "neo4j": neo4j_status}
