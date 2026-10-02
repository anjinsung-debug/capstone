from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT_DIR = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    """저장소 루트의 .env 값을 읽는다."""

    model_config = SettingsConfigDict(env_file=ROOT_DIR / ".env", extra="ignore")

    neo4j_uri: str = "bolt://localhost:7687"
    neo4j_user: str = "neo4j"
    neo4j_password: str = ""


settings = Settings()
