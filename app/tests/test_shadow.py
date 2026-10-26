"""Digital shadow (ADR-045): scene data for dispatchers and security, no personal data."""

from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from conftest import MakeUser, login
from depotrack.models.enums import UserRole
from test_wms import at_time, dock_scan, local, parcels_of, seeded, send_scans, send_trip, trip

__all__ = ["at_time", "seeded"]  # fixtures shared with test_wms

DAY = date(2026, 10, 23)


@pytest.fixture
def viewer(client: TestClient, make_user: MakeUser) -> TestClient:
    make_user("guard", UserRole.SECURITY)
    login(client, "guard")
    return client


@pytest.mark.usefixtures("seeded", "at_time")
def test_shadow_scene_for_security(viewer: TestClient, db: Session) -> None:
    ba_trip = trip(db, "BA", "outbound")
    send_trip(viewer, ba_trip.id, "loading", local(17, 10))
    ba, mi = parcels_of(db, "BA")[0], parcels_of(db, "MI")[0]
    send_scans(viewer, [dock_scan("LD-02", ba.barcode), dock_scan("LD-02", mi.barcode)])

    body = viewer.get("/api/shadow/BUD").json()
    assert body["depot"]["code"] == "BUD"
    assert body["kpis"]["parcelsLoaded"] == 1
    docks = {d["code"]: d for d in body["docks"]}
    assert len(docks) == 8 and docks["LD-02"]["defaultDirection"] == "BA"
    assert docks["LD-02"]["trip"]["load"]["loaded"] == 1
    assert docks["LD-02"]["trip"]["load"]["wrongDirection"] == 1
    assert len(body["staged"]) == 8
    assert any(a["kind"] == "wrong_direction" for a in body["alerts"])

    detail = viewer.get("/api/shadow/doors/LD-02").json()
    assert detail["missingCount"] == len(parcels_of(db, "BA")) - 1
    assert len(detail["missing"]) == min(30, detail["missingCount"])
    assert set(detail["missing"][0]) == {"barcode", "status", "weightKg"}  # no names, no addresses
    assert detail["wrongDirection"][0]["barcode"] == mi.barcode
    assert detail["wrongDirection"][0]["parcelDirection"] == "MI"
    assert viewer.get("/api/shadow/doors/SB-01").status_code == 404

    hub = viewer.get("/api/shadow/BAH").json()
    assert hub["kpis"] is None and hub["docks"] == []
    assert viewer.get("/api/shadow/XXX").status_code == 404


@pytest.mark.usefixtures("seeded", "at_time")
def test_shadow_locates_a_parcel(viewer: TestClient, db: Session) -> None:
    ba_trip = trip(db, "BA", "outbound")
    send_trip(viewer, ba_trip.id, "loading", local(17, 10))
    ba = parcels_of(db, "BA")[0]
    before = viewer.get(f"/api/shadow/parcels/{ba.barcode.lower()}").json()
    assert before["directionCode"] == "BA" and "recipientName" not in before

    send_scans(viewer, [dock_scan("LD-02", ba.barcode)])
    loaded = viewer.get(f"/api/shadow/parcels/{ba.barcode}").json()
    assert loaded["status"] == "loaded"
    assert loaded["place"] == {"kind": "door", "code": "LD-02"}
    assert (
        loaded["events"][-1]["status"] == "loaded" and loaded["events"][-1]["doorCode"] == "LD-02"
    )

    send_trip(viewer, ba_trip.id, "departed", local(21, 40))
    gone = viewer.get(f"/api/shadow/parcels/{ba.barcode}").json()
    assert gone["place"] == {"kind": "outside", "code": None}
    assert viewer.get("/api/shadow/parcels/DP000").status_code == 404


@pytest.mark.parametrize(
    ("role", "code"),
    [
        (UserRole.DISPATCHER, 200),
        (UserRole.SECURITY, 200),
        (UserRole.ADMIN, 200),
        (UserRole.OPERATOR, 403),
        (UserRole.COURIER, 403),
    ],
)
@pytest.mark.usefixtures("seeded", "at_time")
def test_shadow_role_matrix(
    client: TestClient, make_user: MakeUser, role: UserRole, code: int
) -> None:
    make_user("someone", role)
    login(client, "someone")
    assert client.get("/api/shadow/BUD").status_code == code
    assert client.get("/api/shadow/doors/LD-01").status_code == code


def test_shadow_needs_login(client: TestClient) -> None:
    assert client.get("/api/shadow/BUD").status_code == 401
