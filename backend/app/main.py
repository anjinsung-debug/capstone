from contextlib import asynccontextmanager

from fastapi import FastAPI

from backend.app.api import grid, health, report, simulation
from backend.app.core import neo4j


@asynccontextmanager
async def lifespan(app: FastAPI):
    neo4j.connect()
    yield
    neo4j.close()


app = FastAPI(title="배전계통 통합 분석 플랫폼 API", lifespan=lifespan)

app.include_router(health.router, prefix="/api", tags=["health"])
app.include_router(grid.router, prefix="/api", tags=["grid"])
app.include_router(simulation.router, prefix="/api", tags=["simulation"])
app.include_router(report.router, prefix="/api", tags=["report"])
