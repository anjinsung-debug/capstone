from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import JSONResponse

from backend.api import grid, health, report, simulation
from cim import db
from cim.graph import InvalidSnapshot, SubstationNotFound
from simulation.simulate import SimulationError


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.connect()
    yield
    db.close()


app = FastAPI(title="배전계통 통합 분석 플랫폼 API", lifespan=lifespan)


@app.exception_handler(NotImplementedError)
async def not_implemented(request, exc):
    return JSONResponse(status_code=501, content={"detail": "아직 구현되지 않았습니다."})


@app.exception_handler(SubstationNotFound)
async def substation_not_found(request, exc):
    return JSONResponse(status_code=404, content={"detail": str(exc)})


@app.exception_handler(InvalidSnapshot)
async def invalid_snapshot(request, exc):
    return JSONResponse(status_code=422, content={"detail": str(exc)})


@app.exception_handler(SimulationError)
async def simulation_failed(request, exc):
    return JSONResponse(status_code=422, content={"detail": str(exc)})


app.include_router(health.router, prefix="/api", tags=["health"])
app.include_router(grid.router, prefix="/api", tags=["grid"])
app.include_router(simulation.router, prefix="/api", tags=["simulation"])
app.include_router(report.router, prefix="/api", tags=["report"])
