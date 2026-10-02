from fastapi import FastAPI
from fastapi.responses import JSONResponse

from backend.app.api import grid, health, report, simulation

app = FastAPI(title="배전계통 통합 분석 플랫폼 API")


@app.exception_handler(NotImplementedError)
async def not_implemented(request, exc):
    return JSONResponse(status_code=501, content={"detail": "아직 구현되지 않았습니다."})


app.include_router(health.router, prefix="/api", tags=["health"])
app.include_router(grid.router, prefix="/api", tags=["grid"])
app.include_router(simulation.router, prefix="/api", tags=["simulation"])
app.include_router(report.router, prefix="/api", tags=["report"])
