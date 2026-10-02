"""Neo4j 연결. 접속 정보는 .env의 NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD"""

import os

from neo4j import Driver, GraphDatabase

_driver: Driver | None = None


def connect() -> None:
    global _driver
    _driver = GraphDatabase.driver(
        os.environ["NEO4J_URI"],
        auth=(os.environ["NEO4J_USER"], os.environ["NEO4J_PASSWORD"]),
    )


def close() -> None:
    global _driver
    if _driver is not None:
        _driver.close()
        _driver = None


def get_driver() -> Driver:
    if _driver is None:
        raise RuntimeError("Neo4j에 연결되지 않았습니다.")
    return _driver
