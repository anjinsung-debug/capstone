from fastapi.testclient import TestClient

from backend.app.main import app


def test_health_returns_ok():
    with TestClient(app) as client:
        res = client.get("/api/health")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ok"
    assert "neo4j" in body
