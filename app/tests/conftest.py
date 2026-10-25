"""Test fixtures. Tests run against a dedicated database `depotrack_test` inside the db-wms
container, recreated from scratch with Alembic at the start of every test session.

Run: docker compose run --rm app pytest
"""

import os

# must happen before any depotrack import reads the settings
_MAIN_DB = os.environ.get("WMS_DB_NAME", "postgres")
os.environ["WMS_DB_NAME"] = os.environ.get("WMS_TEST_DB_NAME", "depotrack_test")
os.environ["RUN_JOBS"] = "false"
os.environ["LOGIN_RATE_LIMIT"] = "1000/minute"
os.environ["SERVICE_TOKEN"] = "test-service-token"
os.environ["WS_TICKET_SECRET"] = "test-ws-secret-0123456789abcdef0123456789"
os.environ["SEED_PARCELS_PER_DAY"] = "200"
for _role in ("ADMIN", "DISPATCHER", "OPERATOR", "SECURITY", "COURIER"):
    os.environ[f"SEED_{_role}_PASSWORD"] = f"{_role.lower()}-test-heslo"

from collections.abc import Callable, Iterator  # noqa: E402
from datetime import UTC, datetime  # noqa: E402
from pathlib import Path  # noqa: E402

import pytest  # noqa: E402
from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine, text  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from depotrack.core.config import get_settings  # noqa: E402
from depotrack.core.db import get_engine, get_session_factory  # noqa: E402
from depotrack.core.ratelimit import limiter  # noqa: E402
from depotrack.core.security import hash_password  # noqa: E402
from depotrack.main import create_app  # noqa: E402
from depotrack.models import Base, User  # noqa: E402
from depotrack.models.enums import UserRole  # noqa: E402
from depotrack.services import telematics  # noqa: E402

APP_DIR = Path(__file__).resolve().parents[1]
TEST_PASSWORD = "spravne-heslo-123"


def alembic_config() -> Config:
    cfg = Config(str(APP_DIR / "alembic.ini"))
    cfg.attributes["configure_logger"] = False
    return cfg


@pytest.fixture(scope="session", autouse=True)
def test_database() -> Iterator[None]:
    settings = get_settings()
    admin_url = settings.wms_database_url.set(database=_MAIN_DB)
    admin_engine = create_engine(admin_url, isolation_level="AUTOCOMMIT")
    with admin_engine.connect() as conn:
        conn.execute(text(f'DROP DATABASE IF EXISTS "{settings.wms_db_name}" WITH (FORCE)'))
        conn.execute(text(f'CREATE DATABASE "{settings.wms_db_name}"'))
    admin_engine.dispose()

    command.upgrade(alembic_config(), "head")
    yield
    get_engine().dispose()


@pytest.fixture(autouse=True)
def clean_tables() -> Iterator[None]:
    yield
    tables = ", ".join(f'"{t.name}"' for t in Base.metadata.sorted_tables)
    with get_engine().begin() as conn:
        conn.execute(text(f"TRUNCATE {tables} RESTART IDENTITY CASCADE"))
    limiter.reset()


FAKE_DEVICES: list[dict[str, object]] = [
    {"code": "DOCK-SCN-01", "kind": "dock_scanner", "status": "online", "readRate": 0.95},
    {"code": "DOCK-SCN-02", "kind": "dock_scanner", "status": "degraded", "readRate": 0.89},
    {"code": "LINE-SCN-01", "kind": "line_scanner", "status": "online", "readRate": None},
    {"code": "GATE-CAM-01", "kind": "gate_camera", "status": "offline", "readRate": None},
]


@pytest.fixture(autouse=True)
def fake_telematics(monkeypatch: pytest.MonkeyPatch) -> list[tuple[str, dict[str, object]]]:
    """No network calls to telematics in tests: record broadcasts, fixed simulated time."""
    sent: list[tuple[str, dict[str, object]]] = []

    def broadcast_many(ch: str, type_: str, events: list[dict[str, object]]) -> None:
        sent.extend((ch, ev) for ev in events)

    monkeypatch.setattr(telematics, "broadcast_many", broadcast_many)
    monkeypatch.setattr(telematics, "devices", lambda: FAKE_DEVICES)
    monkeypatch.setattr(telematics, "sim_now", lambda: datetime(2026, 10, 23, 13, 0, tzinfo=UTC))
    return sent


@pytest.fixture
def db() -> Iterator[Session]:
    with get_session_factory()() as session:
        yield session


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app())


MakeUser = Callable[..., User]


@pytest.fixture
def make_user(db: Session) -> MakeUser:
    def _make(
        username: str,
        role: UserRole = UserRole.DISPATCHER,
        password: str = TEST_PASSWORD,
        active: bool = True,
    ) -> User:
        user = User(
            username=username,
            full_name=f"Test {username}",
            role=role,
            password_hash=hash_password(password),
            active=active,
        )
        db.add(user)
        db.commit()
        return user

    return _make


def login(client: TestClient, username: str, password: str = TEST_PASSWORD) -> int:
    return client.post(
        "/api/auth/login", json={"username": username, "password": password}
    ).status_code
