"""Application settings, read from environment variables (see .env.example)."""

from datetime import date
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

    # shared secret for app <-> telematics REST (header X-Service-Token)
    service_token: str
    # HS256 secret for short-lived WebSocket tickets (verified by telematics)
    ws_ticket_secret: str
    ws_ticket_ttl_seconds: int = 60

    # cascade warning: night truck ETA + sorting buffer > transit departure
    cascade_buffer_min: int = 30

    # browser origins allowed to send state-changing requests (CSRF check, ADR-014)
    app_allowed_origins: str = "http://localhost:8000,http://localhost:5173"

    # sessions
    session_ttl_hours: int = 8
    session_cookie_name: str = "depotrack_session"
    # true only when served over HTTPS
    session_cookie_secure: bool = False
    login_rate_limit: str = "10/minute"

    # background jobs (disabled in tests)
    run_jobs: bool = True

    # seed (run on startup, idempotent)
    seed_admin_password: str | None = None
    seed_dispatcher_password: str | None = None
    seed_operator_password: str | None = None
    seed_security_password: str | None = None
    seed_courier_password: str | None = None
    seed_parcels_per_day: int = 1500
    seed_random_seed: int = 42
    # day of the simulated parcels; defaults to today
    seed_date: date | None = None

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

    @property
    def allowed_origins(self) -> set[str]:
        return {o.strip() for o in self.app_allowed_origins.split(",") if o.strip()}


@lru_cache
def get_settings() -> Settings:
    # required fields are filled from environment variables
    return Settings()
