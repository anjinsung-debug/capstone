from fastapi import APIRouter
from neo4j.exceptions import Neo4jError, ServiceUnavailable

from cim import db

router = APIRouter()


@router.get("/health")
def health():
    """서버와 Neo4j 연결 상태 확인"""
    try:
        db.get_driver().verify_connectivity()
        neo4j = "connected"
    except (ServiceUnavailable, Neo4jError, RuntimeError):
        neo4j = "unavailable"
    return {"status": "ok", "neo4j": neo4j}
