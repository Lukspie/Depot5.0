"""Application settings, read from environment variables (see .env.example)."""

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy import URL


class Settings(BaseSettings):
    model_config = SettingsConfigDict(extra="ignore")

    log_level: str = "info"

    wms_db_host: str = "db-wms"
    wms_db_port: int = 5432
    wms_db_name: str
    wms_db_user: str
    wms_db_password: str

    # app -> telematics (inside the docker network)
    telematics_internal_url: str = "http://telematics:8080"
    # browser -> telematics (frontend calls telematics directly)
    telematics_public_url: str = "http://localhost:8080"

    # built frontend (copied in by the multi-stage Dockerfile)
    static_dir: Path = Path("/app/static")

    @property
    def wms_database_url(self) -> URL:
        return URL.create(
            "postgresql+psycopg",
            username=self.wms_db_user,
            password=self.wms_db_password,
            host=self.wms_db_host,
            port=self.wms_db_port,
            database=self.wms_db_name,
        )


@lru_cache
def get_settings() -> Settings:
    # required fields are filled from environment variables
    return Settings()
