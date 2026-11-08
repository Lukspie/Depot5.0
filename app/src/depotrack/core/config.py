"""Application settings, read from environment variables (see .env.example)."""

from datetime import date
from functools import lru_cache
from pathlib import Path

from pydantic import Field
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

    # key in the URL of the public ETA board (/board?key=…); empty = board disabled
    board_key: str = ""

    # demo mode (the same variable as telematics, ADR-053): the login page lists the demo
    # accounts (names and roles, never passwords); false in production
    sim_controls_enabled: bool = True

    # base of the customer tracking links in the simulated SMS (/track/<token>)
    public_base_url: str = "http://localhost:8000"
    # public tracking endpoint (ADR-042): requests per valid link, failed lookups per client IP
    track_token_rate_limit: str = "60/minute"
    track_miss_rate_limit: str = "10/minute"

    # cascade warning: night truck ETA + sorting buffer > transit departure
    cascade_buffer_min: int = 30
    # trained models (ml/artifacts, copied into the image; ADR-057)
    ml_artifacts_dir: str = "/app/ml/artifacts"
    # gate (ADR-061): below these the rules never decide alone, security does
    gate_min_vehicle_confidence: float = Field(default=0.5, ge=0, le=1)
    gate_min_plate_confidence: float = Field(default=0.8, ge=0, le=1)

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
