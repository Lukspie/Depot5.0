"""WMS actions from the digital shadow (ADR-048): move a trip to another door, maintenance."""

from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from conftest import MakeUser, login
from depotrack.models import MaintenanceOrder, Trip
from depotrack.models.enums import UserRole
from depotrack.services import telematics
from test_wms import TOKEN, at_time, local, seeded, send_trip, trip

__all__ = ["at_time", "seeded"]  # fixtures shared with test_wms


@pytest.fixture
def calls(monkeypatch: pytest.MonkeyPatch) -> list[tuple[str, Any]]:
    """Record the calls to telematics instead of sending them."""
    sent: list[tuple[str, Any]] = []

    def reload_plan() -> bool:
        sent.append(("reload", None))
        return True

    def start_maintenance(code: str, minutes: int) -> dict[str, Any] | None:
        sent.append(("maintenance", (code, minutes)))
        return {"code": code, "status": "maintenance"}

    monkeypatch.setattr(telematics, "reload_plan", reload_plan)
    monkeypatch.setattr(telematics, "start_maintenance", start_maintenance)
    return sent


@pytest.fixture
def dispatcher(client: TestClient, make_user: MakeUser) -> TestClient:
    make_user("disp", UserRole.DISPATCHER)
    login(client, "disp")
    return client


@pytest.mark.usefixtures("seeded", "at_time")
def test_move_trip_to_a_free_door(
    dispatcher: TestClient, db: Session, calls: list[tuple[str, Any]]
) -> None:
    ba = trip(db, "BA", "outbound")
    resp = dispatcher.patch(f"/api/trips/{ba.id}/door", json={"doorCode": "LD-08"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["doorCode"] == "LD-08"
    assert calls == [("reload", None)]
    db.expire_all()
    shadow = dispatcher.get("/api/shadow/BUD").json()
    docks = {d["code"]: d for d in shadow["docks"]}
    assert docks["LD-08"]["trip"]["directionCode"] == "BA"
    # a day restart puts the truck back to its default door (ADR-048)
    reset = dispatcher.post(f"/internal/days/{ba.operating_day}/reset", headers=TOKEN)
    assert reset.status_code == 200
    db.expire_all()
    back = dispatcher.get("/api/shadow/BUD").json()
    assert {d["code"]: d for d in back["docks"]}["LD-02"]["trip"]["directionCode"] == "BA"
    assert (
        dispatcher.patch(f"/api/trips/{ba.id}/door", json={"doorCode": "LD-08"}).status_code == 200
    )
    calls.clear()
    # the same door again: nothing to do, telematics not bothered
    assert (
        dispatcher.patch(f"/api/trips/{ba.id}/door", json={"doorCode": "LD-08"}).status_code == 200
    )
    assert calls == []


@pytest.mark.usefixtures("seeded", "at_time")
def test_move_trip_conflicts_and_validation(
    dispatcher: TestClient, db: Session, calls: list[tuple[str, Any]]
) -> None:
    ba = trip(db, "BA", "outbound")
    taken = dispatcher.patch(f"/api/trips/{ba.id}/door", json={"doorCode": "LD-01"})
    assert taken.status_code == 409
    assert "Banská Bystrica" in taken.json()["detail"]
    assert (
        dispatcher.patch(f"/api/trips/{ba.id}/door", json={"doorCode": "SB-01"}).status_code == 422
    )
    assert (
        dispatcher.patch(f"/api/trips/{ba.id}/door", json={"doorCode": "BA-R01"}).status_code == 422
    )
    assert dispatcher.patch("/api/trips/999999/door", json={"doorCode": "LD-08"}).status_code == 404
    night = trip(db, "BA", "inbound")
    assert (
        dispatcher.patch(f"/api/trips/{night.id}/door", json={"doorCode": "LD-08"}).status_code
        == 409
    )
    send_trip(dispatcher, ba.id, "loading", local(17, 30))
    loading = dispatcher.patch(f"/api/trips/{ba.id}/door", json={"doorCode": "LD-08"})
    assert loading.status_code == 409
    assert calls == []
    db.expire_all()
    still = db.get(Trip, ba.id)
    assert still is not None and still.door_id is not None


@pytest.mark.usefixtures("seeded", "at_time")
def test_maintenance_order(
    dispatcher: TestClient, db: Session, calls: list[tuple[str, Any]]
) -> None:
    resp = dispatcher.post(
        "/api/devices/DOCK-SCN-02/maintenance", json={"minutes": 30, "note": "čistenie optiky"}
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["deviceCode"] == "DOCK-SCN-02" and body["minutes"] == 30
    assert calls == [("maintenance", ("DOCK-SCN-02", 30))]
    order = db.execute(select(MaintenanceOrder)).scalar_one()
    assert (order.until - order.created_at).total_seconds() == 30 * 60
    assert dispatcher.get("/api/maintenance").json()[0]["note"] == "čistenie optiky"
    assert dispatcher.post("/api/devices/NOPE-1/maintenance", json={}).status_code == 404
    assert (
        dispatcher.post("/api/devices/DOCK-SCN-01/maintenance", json={"minutes": 1}).status_code
        == 422
    )


@pytest.mark.usefixtures("seeded", "at_time")
def test_maintenance_when_telematics_is_down(
    dispatcher: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(telematics, "devices", lambda: [])
    assert dispatcher.post("/api/devices/DOCK-SCN-02/maintenance", json={}).status_code == 503


@pytest.mark.parametrize(
    ("role", "act", "read"),
    [
        (UserRole.DISPATCHER, True, True),
        (UserRole.ADMIN, True, True),
        (UserRole.SECURITY, False, True),
        (UserRole.OPERATOR, False, False),
        (UserRole.COURIER, False, False),
    ],
)
@pytest.mark.usefixtures("seeded", "at_time", "calls")
def test_action_role_matrix(
    client: TestClient, db: Session, make_user: MakeUser, role: UserRole, act: bool, read: bool
) -> None:
    make_user("someone", role)
    login(client, "someone")
    ba = trip(db, "BA", "outbound")
    moved = client.patch(f"/api/trips/{ba.id}/door", json={"doorCode": "LD-08"}).status_code
    assert moved == (200 if act else 403)
    service = client.post("/api/devices/DOCK-SCN-01/maintenance", json={}).status_code
    assert service == (201 if act else 403)
    assert client.get("/api/maintenance").status_code == (200 if read else 403)
