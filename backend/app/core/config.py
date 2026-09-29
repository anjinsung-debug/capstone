from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT_DIR = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    """저장소 루트의 .env 값을 읽는다."""

    model_config = SettingsConfigDict(env_file=ROOT_DIR / ".env", extra="ignore")

    neo4j_uri: str = "bolt://localhost:7687"
    neo4j_user: str = "neo4j"
    neo4j_password: str = ""

    llm_api_key: str = ""
    llm_model: str = ""

    # 프론트엔드 개발 서버 (Vite 기본 포트)
    cors_origins: list[str] = ["http://localhost:5173"]


settings = Settings()
