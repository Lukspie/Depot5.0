"""The login page before sign-in (phase 7d): network of depots from the data, service status and
demo accounts only in demo mode, never a password."""

from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient

from depotrack.core.config import get_settings
from depotrack.services import telematics
from test_wms import seeded

__all__ = ["seeded"]


@pytest.mark.usefixtures("seeded")
def test_login_info_is_public_and_from_the_data(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        telematics, "sim_now_or_none", lambda: datetime(2026, 10, 23, 18, tzinfo=UTC)
    )
    res = client.get("/api/public/login-info")  # no session
    assert res.status_code == 200, res.text
    body = res.json()
    assert [d["code"] for d in body["depots"]] == ["BUD", "BAH", "ZIL", "DS", "TN"]
    assert {d["code"]: d["label"] for d in body["depots"]}["BAH"] == "hub Bratislava"
    links = {(x["origin"], x["destination"], x["kind"]) for x in body["links"]}
    # the linehaul directions that end in another depot, the planned feeders of DS and TN
    assert links == {
        ("BUD", "BAH", "linehaul"),
        ("BUD", "ZIL", "linehaul"),
        ("BAH", "DS", "planned"),
        ("BAH", "TN", "planned"),
    }
    assert body["servicesOk"] is True and body["telemetryLive"] is True
    assert body["sessionHours"] == 8
    accounts = body["demoAccounts"]
    assert [(a["username"], a["role"]) for a in accounts][:4] == [
        ("admin", "admin"),
        ("dispecer", "dispatcher"),
        ("operator", "operator"),
        ("ochranka", "security"),
    ]
    assert {a["username"] for a in accounts if a["role"] == "courier"} == {
        "kurier01",
        "kurierba01",
        "kurierza01",
    }
    assert "password" not in res.text.lower() and "heslo" not in res.text.lower()


@pytest.mark.usefixtures("seeded")
def test_no_demo_accounts_in_production(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(get_settings(), "sim_controls_enabled", False)
    monkeypatch.setattr(telematics, "sim_now_or_none", lambda: None)
    body = client.get("/api/public/login-info").json()
    assert body["demoAccounts"] is None
    # telematics down: the services are not all running
    assert body["servicesOk"] is False and body["telemetryLive"] is False
