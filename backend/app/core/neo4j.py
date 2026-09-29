from neo4j import Driver, GraphDatabase

from backend.app.core.config import settings

_driver: Driver | None = None


def connect() -> None:
    global _driver
    _driver = GraphDatabase.driver(
        settings.neo4j_uri, auth=(settings.neo4j_user, settings.neo4j_password)
    )


def close() -> None:
    global _driver
    if _driver is not None:
        _driver.close()
        _driver = None


def get_driver() -> Driver:
    if _driver is None:
        raise RuntimeError("Neo4j 드라이버가 초기화되지 않았습니다.")
    return _driver
