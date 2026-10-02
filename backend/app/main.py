from contextlib import asynccontextmanager

from fastapi import FastAPI

from backend.app.api import health
from backend.app.core import neo4j


@asynccontextmanager
async def lifespan(app: FastAPI):
    neo4j.connect()
    yield
    neo4j.close()


app = FastAPI(title="배전계통 통합 분석 플랫폼 API", lifespan=lifespan)

app.include_router(health.router, prefix="/api", tags=["health"])
