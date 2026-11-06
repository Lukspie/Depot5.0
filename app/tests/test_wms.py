"""Core WMS: loading checks (IoT + manual), waves, dashboard, board, fleet, parcel detail."""

from datetime import date, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from conftest import MakeUser, login
from depotrack.core.clock import TZ
from depotrack.core.config import get_settings
from depotrack.models import Alert, Direction, Parcel, ParcelEvent, Trip
from depotrack.models.enums import AlertKind, ParcelStatus, UserRole
from depotrack.services import telematics
from depotrack.services.operating_day import run_seed

DAY = date(2026, 10, 23)
TOKEN = {"X-Service-Token": "test-service-token"}


def local(hh: int, mm: int, day: date = DAY) -> datetime:
    return datetime(day.year, day.month, day.day, hh, mm, tzinfo=TZ)


@pytest.fixture
def seeded(db: Session) -> None:
    run_seed(db, get_settings(), DAY)


@pytest.fixture
def at_time(monkeypatch: pytest.MonkeyPatch) -> Any:
    def set_time(t: datetime) -> None:
        monkeypatch.setattr(telematics, "sim_now", lambda: t)

    set_time(local(18, 0))
    return set_time


def trip(db: Session, code: str, kind: str, day: date = DAY) -> Trip:
    return db.execute(
        select(Trip)
        .join(Direction, Trip.direction_id == Direction.id)
        .where(Direction.code == code, Trip.kind == kind, Trip.operating_day == day)
    ).scalar_one()


def parcels_of(db: Session, code: str) -> list[Parcel]:
    return list(
        db.execute(
            select(Parcel)
            .join(Direction, Parcel.direction_id == Direction.id)
            .where(Direction.code == code)
            .order_by(Parcel.barcode)
        ).scalars()
    )


def send_trip(client: TestClient, trip_id: int, status: str, sim_time: datetime) -> None:
    body = {"simTime": sim_time.isoformat(), "trips": [{"tripId": trip_id, "status": status}]}
    assert client.post("/internal/events/trips", json=body, headers=TOKEN).status_code == 200


def send_scans(client: TestClient, scans: list[dict[str, Any]]) -> dict[str, Any]:
    resp = client.post("/internal/events/scans", json={"scans": scans}, headers=TOKEN)
    assert resp.status_code == 200, resp.text
    out: dict[str, Any] = resp.json()
    return out


def dock_scan(door: str, barcode: str | None, at: datetime | None = None) -> dict[str, Any]:
    return {
        "device": "DOCK-SCN-02",
        "doorCode": door,
        "at": (at or local(18, 0)).isoformat(),
        "barcode": barcode,
        "readOk": barcode is not None,
    }


# ------------------------------------------------------------------ plan details


@pytest.mark.usefixtures("seeded")
def test_senica_alternates_two_trucks_without_overlaps(client: TestClient, db: Session) -> None:
    for d in (DAY, DAY + timedelta(days=1), DAY + timedelta(days=2)):
        client.get(f"/internal/plan?day={d}", headers=TOKEN)
    plates = [trip(db, "SE", "outbound", DAY + timedelta(days=i)).vehicle_id for i in range(3)]
    assert plates[0] != plates[1] and plates[0] == plates[2]
    for i in range(3):
        d = DAY + timedelta(days=i)
        assert trip(db, "SE", "inbound", d).vehicle_id == trip(db, "SE", "outbound", d).vehicle_id

    # the truck leaving Košice on the morning of D+1 is in Senica around noon, so it cannot be the
    # one that drives back from Senica on the same day (arriving 16:45 of D+1)
    for i in range(2):
        d = DAY + timedelta(days=i)
        leaves = trip(db, "SE", "outbound", d)
        returns_same_day = trip(db, "SE", "inbound", d + timedelta(days=1))
        assert leaves.vehicle_id != returns_same_day.vehicle_id


@pytest.mark.usefixtures("seeded")
def test_night_trucks_bring_parcels_for_the_east(client: TestClient, db: Session) -> None:
    ba_night = trip(db, "BA", "inbound")
    body = client.get(f"/internal/manifest?direction=MI&day={DAY}", headers=TOKEN).json()
    on_trucks = {p["arrivesWithTripId"] for p in body["parcels"]} - {None}
    assert ba_night.id in on_trucks  # Michalovce is fed by BA
    assert any(p["arrivesWithTripId"] is None for p in body["parcels"])  # collected in KE
    senica = client.get(f"/internal/manifest?direction=SE&day={DAY}", headers=TOKEN).json()
    assert {p["arrivesWithTripId"] for p in senica["parcels"]} - {None} <= {ba_night.id}


# ------------------------------------------------------------------ loading checks


@pytest.mark.usefixtures("seeded")
def test_iot_scans_load_check_direction_and_alert(
    client: TestClient, db: Session, fake_telematics: list[tuple[str, dict[str, object]]]
) -> None:
    ba_trip = trip(db, "BA", "outbound")
    send_trip(client, ba_trip.id, "loading", local(17, 10))
    ba, mi = parcels_of(db, "BA")[0], parcels_of(db, "MI")[0]

    result = send_scans(
        client,
        [
            dock_scan("LD-02", ba.barcode),
            dock_scan("LD-02", ba.barcode),  # camera saw it twice
            dock_scan("LD-02", mi.barcode),  # Michalovce parcel at the Bratislava door
            dock_scan("LD-02", None),  # label unreadable, item still counted
            dock_scan("LD-02", "SPS-UNKNOWN-1"),
            {
                "device": "X",
                "doorCode": "LD-99",
                "at": local(18, 0).isoformat(),
                "barcode": "x",
                "readOk": True,
            },
        ],
    )
    assert result["results"] == {"ok": 1, "duplicate": 1, "wrong_direction": 1, "unidentified": 2}
    assert result["skipped"] == 1

    db.expire_all()
    assert db.get(Parcel, ba.id).status == ParcelStatus.LOADED  # type: ignore[union-attr]
    assert db.get(Parcel, mi.id).status != ParcelStatus.LOADED  # type: ignore[union-attr]
    event = db.execute(
        select(ParcelEvent).where(ParcelEvent.parcel_id == ba.id, ParcelEvent.status == "loaded")
    ).scalar_one()
    assert event.source == "iot" and event.trip_id == ba_trip.id

    alert = db.execute(select(Alert).where(Alert.kind == AlertKind.WRONG_DIRECTION)).scalar_one()
    assert alert.severity == "critical" and mi.barcode in alert.message and "LD-02" in alert.message
    channels = [c for c, _ in fake_telematics]
    assert channels.count("devices") == 5 and "alerts" in channels


@pytest.mark.usefixtures("seeded")
def test_line_scanner_sorts_parcels_in_the_morning(client: TestClient, db: Session) -> None:
    mi = parcels_of(db, "MI")[0]
    scan = {
        "device": "LINE-SCN-01",
        "doorCode": None,
        "at": local(2, 0, DAY + timedelta(days=1)).isoformat(),
        "barcode": mi.barcode,
        "readOk": True,
    }
    assert send_scans(client, [scan])["results"] == {"sorted": 1}
    db.expire_all()
    assert db.get(Parcel, mi.id).status == ParcelStatus.SORTED  # type: ignore[union-attr]
    statuses = (
        db.execute(
            select(ParcelEvent.status)
            .where(ParcelEvent.parcel_id == mi.id)
            .order_by(ParcelEvent.at)
        )
        .scalars()
        .all()
    )
    assert statuses[-2:] == ["on_belt", "sorted"]


@pytest.mark.usefixtures("seeded")
def test_evening_wave_stages_regional_and_local_parcels_once(
    client: TestClient, db: Session
) -> None:
    some_trip = trip(db, "BA", "outbound")
    send_trip(client, some_trip.id, "loading", local(21, 0))
    assert db.execute(select(Parcel).where(Parcel.status == "staged")).first() is None
    send_trip(client, some_trip.id, "departed", local(22, 5))
    db.expire_all()
    staged = db.execute(select(Parcel).where(Parcel.status == "staged")).scalars().all()
    assert staged
    types = {db.get(Direction, p.direction_id).type for p in staged}  # type: ignore[union-attr]
    assert types <= {"transit", "local"}
    # BA parcels were not loaded but stay for the missing list, not staged
    assert all(p.status == "collected" for p in parcels_of(db, "BA"))
    # parcels still on a night truck are not staged either
    on_trucks = (
        db.execute(
            select(Parcel)
            .join(ParcelEvent)
            .where(ParcelEvent.trip_id.is_not(None), ParcelEvent.status == "collected")
        )
        .scalars()
        .all()
    )
    assert on_trucks and all(p.status == "collected" for p in on_trucks)
    send_trip(client, some_trip.id, "departed", local(22, 30))
    assert len(db.execute(select(Parcel).where(Parcel.status == "staged")).all()) == len(staged)


@pytest.fixture
def operator(client: TestClient, make_user: MakeUser) -> TestClient:
    make_user("op", UserRole.OPERATOR)
    login(client, "op")
    return client


@pytest.mark.usefixtures("seeded", "at_time")
def test_manual_hand_scanner_at_the_door(operator: TestClient, db: Session) -> None:
    ba, za = parcels_of(db, "BA")[1], parcels_of(db, "ZA")[0]
    ok = operator.post("/api/loading/doors/LD-02/scan", json={"barcode": ba.barcode.lower()})
    assert ok.status_code == 200
    assert ok.json()["result"] == "ok" and ok.json()["message"] == "Naložené"
    wrong = operator.post("/api/loading/doors/LD-02/scan", json={"barcode": za.barcode}).json()
    assert wrong["result"] == "wrong_direction" and wrong["tripDirection"] == "BA"
    assert "ZLÝ SMER" in wrong["message"]

    event = db.execute(
        select(ParcelEvent).where(ParcelEvent.parcel_id == ba.id, ParcelEvent.status == "loaded")
    ).scalar_one()
    assert event.source == "manual" and event.user_id is not None

    view = operator.get("/api/loading/doors/LD-02").json()
    load = view["door"]["trip"]["load"]
    assert load["loaded"] == 1 and load["wrongDirection"] == 1 and load["counted"] == 2
    assert load["expected"] == len(parcels_of(db, "BA"))
    assert len(view["missing"]) == load["expected"] - 1
    assert [s["result"] for s in view["recent"]] == ["wrong_direction", "ok"]
    assert (
        operator.post("/api/loading/doors/LD-77/scan", json={"barcode": "x12"}).status_code == 404
    )


@pytest.mark.usefixtures("seeded", "at_time")
def test_manual_scan_without_truck_is_conflict(
    operator: TestClient, client: TestClient, db: Session
) -> None:
    ba = trip(db, "BA", "outbound")
    send_trip(client, ba.id, "departed", local(21, 40))
    resp = operator.post("/api/loading/doors/LD-02/scan", json={"barcode": "SPS123"})
    assert resp.status_code == 409


@pytest.mark.parametrize(
    ("role", "url", "expected"),
    [
        (UserRole.OPERATOR, "/api/loading/doors", 200),
        (UserRole.DISPATCHER, "/api/loading/doors", 403),
        (UserRole.ADMIN, "/api/loading/doors", 200),
        (UserRole.DISPATCHER, "/api/dashboard", 200),
        (UserRole.OPERATOR, "/api/dashboard", 403),
        (UserRole.SECURITY, "/api/fleet/vehicles", 403),
        (UserRole.DISPATCHER, "/api/fleet/vehicles", 200),
        (UserRole.COURIER, "/api/alerts", 403),
        (UserRole.DISPATCHER, "/api/admin/directions", 403),
        (UserRole.ADMIN, "/api/admin/directions", 200),
    ],
)
@pytest.mark.usefixtures("seeded", "at_time")
def test_wms_role_matrix(
    client: TestClient, make_user: MakeUser, role: UserRole, url: str, expected: int
) -> None:
    make_user("u", role)
    login(client, "u")
    assert client.get(url).status_code == expected


# ------------------------------------------------------------------ dispatcher


@pytest.fixture
def dispatcher(client: TestClient, make_user: MakeUser) -> TestClient:
    make_user("disp", UserRole.DISPATCHER)
    login(client, "disp")
    return client


@pytest.mark.usefixtures("seeded", "at_time")
def test_dashboard_overview(dispatcher: TestClient, db: Session) -> None:
    ba = parcels_of(db, "BA")[0]
    send_trip(dispatcher, trip(db, "BA", "outbound").id, "loading", local(17, 10))
    send_scans(dispatcher, [dock_scan("LD-02", ba.barcode), dock_scan("LD-02", None)])

    body = dispatcher.get("/api/dashboard").json()
    assert body["clock"]["operatingDay"] == "2026-10-23"
    assert body["clock"]["wave"] == "evening"
    k = body["kpis"]
    assert k["parcelsLoaded"] == 1 and k["unidentified"] == 1 and k["trucksOnSite"] == 1
    assert k["readRate"] == pytest.approx(0.5)  # 1 of 2 items had a readable label
    assert k["parcelsTotal"] == len(db.execute(select(Parcel)).all())
    assert len(body["directions"]) == 16
    ba_row = next(r for r in body["directions"] if r["code"] == "BA")
    assert ba_row["loaded"] == 1
    ba_trip = next(
        t for t in body["trips"] if t["directionCode"] == "BA" and t["kind"] == "outbound"
    )
    assert ba_trip["load"]["loaded"] == 1 and ba_trip["load"]["loadedKg"] == pytest.approx(
        ba.weight_kg
    )
    assert ba_trip["capacityKg"] == 24000


@pytest.mark.usefixtures("seeded", "at_time")
def test_alerts_can_be_acknowledged(dispatcher: TestClient, db: Session) -> None:
    mi = parcels_of(db, "MI")[0]
    send_trip(dispatcher, trip(db, "BA", "outbound").id, "loading", local(17, 10))
    send_scans(dispatcher, [dock_scan("LD-02", mi.barcode)])
    alerts = dispatcher.get("/api/alerts").json()["alerts"]
    assert len(alerts) == 1
    acked = dispatcher.post(f"/api/alerts/{alerts[0]['id']}/ack")
    assert acked.status_code == 200 and acked.json()["acknowledgedAt"] is not None
    assert dispatcher.get("/api/alerts").json()["alerts"] == []
    assert len(dispatcher.get("/api/alerts?all=true").json()["alerts"]) == 1


@pytest.mark.usefixtures("seeded", "at_time")
def test_public_board_needs_the_key(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(get_settings(), "board_key", "tabula-123")
    assert client.get("/api/board?key=zly").status_code == 403
    body = client.get("/api/board?key=tabula-123").json()
    assert len(body["arrivals"]) == 8 and len(body["departures"]) == 8
    assert body["devices"] == {
        "online": 2,
        "degraded": 1,
        "offline": 1,
        "readRate": None,
        "lineStatus": "online",
    }
    monkeypatch.setattr(get_settings(), "board_key", "")
    assert client.get("/api/board?key=").status_code == 403  # disabled without a key


@pytest.mark.usefixtures("seeded", "at_time")
def test_fleet_vehicle_cargo_and_parcel_timeline(dispatcher: TestClient, db: Session) -> None:
    vehicles = dispatcher.get("/api/fleet/vehicles").json()
    assert len(vehicles) == 20
    ba_trip = trip(db, "BA", "outbound")
    send_trip(dispatcher, ba_trip.id, "loading", local(17, 10))
    loaded = parcels_of(db, "BA")[:3]
    send_scans(dispatcher, [dock_scan("LD-02", p.barcode) for p in loaded])

    plate = next(v["plate"] for v in vehicles if v["trip"] and v["trip"]["id"] == ba_trip.id)
    detail = dispatcher.get(f"/api/fleet/vehicles/{plate}").json()
    assert detail["parcelsCount"] == 3
    assert detail["parcelsKg"] == pytest.approx(round(sum(p.weight_kg for p in loaded), 1))
    assert detail["trip"]["status"] == "loading"

    night = trip(db, "BA", "inbound")
    night_plate = next(v["plate"] for v in vehicles if v["trip"] and v["trip"]["id"] == night.id)
    assert dispatcher.get(f"/api/fleet/vehicles/{night_plate}").json()["parcelsCount"] >= 110

    found = dispatcher.get(f"/api/parcels?q={loaded[0].barcode}").json()
    assert found[0]["id"] == loaded[0].id
    timeline = dispatcher.get(f"/api/parcels/{loaded[0].id}").json()
    assert [e["status"] for e in timeline["events"]] == ["collected", "loaded"]
    assert timeline["events"][1]["doorCode"] == "LD-02"
    assert timeline["events"][1]["vehiclePlate"] == plate
    assert timeline["scans"][0]["result"] == "ok"
    assert dispatcher.get("/api/parcels/999999").status_code == 404


def test_admin_edits_direction_times(client: TestClient, make_user: MakeUser, db: Session) -> None:
    run_seed(db, get_settings().model_copy(update={"seed_parcels_per_day": 5}), DAY)
    make_user("adm", UserRole.ADMIN)
    login(client, "adm")
    rows = client.get("/api/admin/directions").json()
    se = next(r for r in rows if r["code"] == "SE")
    assert se["doorCode"] == "LD-08" and se["plannedDeparture"] == "06:30:00"
    resp = client.patch(f"/api/admin/directions/{se['id']}", json={"plannedDeparture": "06:45:00"})
    assert resp.status_code == 200 and resp.json()["plannedDeparture"] == "06:45:00"
    assert resp.json()["cutoffTime"] == "06:00:00"  # untouched


@pytest.mark.usefixtures("seeded")
def test_day_reset_undoes_execution_for_a_replay(client: TestClient, db: Session) -> None:
    ba_trip = trip(db, "BA", "outbound")
    send_trip(client, ba_trip.id, "loading", local(17, 10))
    ba, mi = parcels_of(db, "BA")[0], parcels_of(db, "MI")[0]
    send_scans(client, [dock_scan("LD-02", ba.barcode), dock_scan("LD-02", mi.barcode)])
    send_trip(client, ba_trip.id, "departed", local(22, 5))  # also stages regional parcels

    resp = client.post(f"/internal/days/{DAY}/reset", headers=TOKEN)
    assert resp.status_code == 200
    assert resp.json()["scans"] == 2 and resp.json()["alerts"] == 1
    db.expire_all()
    assert {p.status for p in db.execute(select(Parcel)).scalars()} == {ParcelStatus.COLLECTED}
    assert {t.status for t in db.execute(select(Trip)).scalars()} == {"planned"}
    assert db.execute(select(Alert)).first() is None
    # the evening wave can be closed again in the replay
    send_trip(client, ba_trip.id, "departed", local(22, 5))
    assert db.execute(select(Parcel).where(Parcel.status == "staged")).first() is not None


def test_clean_reset_drops_maintenance_and_closes_old_alerts(
    client: TestClient, db: Session, make_user: MakeUser
) -> None:
    """Clean reset (ADR-053): on top of the day reset, the day's maintenance orders go and the open
    alerts of older days are closed by the system (kept for the audit)."""
    from depotrack.models import MaintenanceOrder
    from depotrack.models.enums import AlertSeverity

    start = local(15, 0)
    user = make_user("disp", UserRole.DISPATCHER)
    old = Alert(
        kind=AlertKind.CASCADE_DELAY,
        severity=AlertSeverity.WARNING,
        message="old",
        ref_type="cascade",
        ref_id="1:2",
        created_at=start - timedelta(days=3),
    )
    today = Alert(
        kind=AlertKind.OTHER,
        severity=AlertSeverity.INFO,
        message="today",
        created_at=start + timedelta(hours=2),
    )
    db.add_all([old, today])
    db.add(
        MaintenanceOrder(
            device_code="DOCK-SCN-02",
            minutes=20,
            until=start + timedelta(hours=1, minutes=20),
            created_by=user.id,
            created_at=start + timedelta(hours=1),
        )
    )
    db.commit()

    plain = client.post(f"/internal/days/{DAY}/reset", headers=TOKEN).json()
    assert plain["alerts"] == 1 and plain["maintenanceOrders"] == 0 and plain["alertsClosed"] == 0
    db.expire_all()
    assert db.execute(select(MaintenanceOrder)).first() is not None

    clean = client.post(f"/internal/days/{DAY}/reset?clean=true", headers=TOKEN).json()
    assert clean["maintenanceOrders"] == 1 and clean["alertsClosed"] == 1
    db.expire_all()
    assert db.execute(select(MaintenanceOrder)).first() is None
    kept = db.execute(select(Alert)).scalars().one()
    assert kept.message == "old" and kept.acknowledged_at == start and kept.acknowledged_by is None
