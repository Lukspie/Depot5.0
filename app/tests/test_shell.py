"""The application shell (phase 7d): wave, alerts, gate queue and board link per role."""

from datetime import date, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from conftest import MakeUser, login
from depotrack.core.clock import TZ
from depotrack.core.config import get_settings
from depotrack.models.enums import UserRole
from depotrack.services import telematics
from depotrack.services.operating_day import run_seed

DAY = date(2026, 10, 23)


@pytest.fixture
def seeded(db: Session) -> None:
    run_seed(db, get_settings(), DAY)


def at(monkeypatch: pytest.MonkeyPatch, hh: int, mm: int) -> None:
    t = datetime(2026, 10, 24 if hh < 15 else 23, hh, mm, tzinfo=TZ)
    monkeypatch.setattr(telematics, "sim_now", lambda: t)


@pytest.mark.usefixtures("seeded")
def test_shell_shows_each_role_only_its_parts(
    client: TestClient, make_user: MakeUser, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(get_settings(), "board_key", "tabula-test")
    at(monkeypatch, 2, 25)
    assert client.get("/api/shell").status_code == 401
    expected = {
        UserRole.DISPATCHER: (True, False, True),
        UserRole.SECURITY: (True, True, False),
        UserRole.OPERATOR: (False, False, False),
        UserRole.COURIER: (False, False, False),
        UserRole.ADMIN: (True, True, True),
    }
    for role, (alerts, gate, board) in expected.items():
        make_user(f"u-{role}", role)
        assert login(client, f"u-{role}") == 200
        res = client.get("/api/shell")
        assert res.status_code == 200, res.text
        body = res.json()
        night = {"code": "night", "name": "Nočná vlna", "start": "01:00", "end": "06:00"}
        assert body["wave"] == night
        assert (body["openAlerts"] is not None) is alerts, role
        assert (body["gateQueue"] is not None) is gate, role
        assert (body["boardUrl"] == "/board?key=tabula-test") is board, role
        client.post("/api/auth/logout")
    # outside the waves there is none
    at(monkeypatch, 13, 0)
    assert login(client, "u-admin") == 200
    assert client.get("/api/shell").json()["wave"] is None
