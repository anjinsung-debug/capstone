from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.app.api import health
from backend.app.core import neo4j
from backend.app.core.config import settings


@asynccontextmanager
async def lifespan(app: FastAPI):
    neo4j.connect()
    yield
    neo4j.close()


app = FastAPI(title="배전계통 통합 분석 플랫폼 API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router, prefix="/api", tags=["health"])
