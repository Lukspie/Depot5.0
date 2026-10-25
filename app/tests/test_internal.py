"""Internal API for telematics: service token, trip plan, manifests, trip events, delay cascade."""

from collections import Counter
from datetime import date, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from depotrack.core.clock import TZ
from depotrack.core.config import get_settings
from depotrack.models import Alert, Direction, Parcel
from depotrack.models.enums import AlertSeverity, ParcelStatus
from depotrack.seed import run_seed

DAY = date(2026, 10, 23)
TOKEN = {"X-Service-Token": "test-service-token"}


@pytest.fixture
def seeded(db: Session) -> None:
    run_seed(db, get_settings(), DAY)


def plan(client: TestClient, day: date = DAY) -> list[dict[str, Any]]:
    resp = client.get(f"/internal/plan?day={day.isoformat()}", headers=TOKEN)
    assert resp.status_code == 200, resp.text
    trips: list[dict[str, Any]] = resp.json()["trips"]
    return trips


def find(trips: list[dict[str, Any]], code: str, kind: str) -> dict[str, Any]:
    return next(t for t in trips if t["directionCode"] == code and t["kind"] == kind)


def local(iso: str) -> str:
    return datetime.fromisoformat(iso).astimezone(TZ).strftime("%H:%M")


@pytest.mark.parametrize("headers", [{}, {"X-Service-Token": "wrong"}])
def test_internal_api_requires_service_token(client: TestClient, headers: dict[str, str]) -> None:
    assert client.get(f"/internal/plan?day={DAY}", headers=headers).status_code == 401
    assert client.post("/internal/events/trips", json={}, headers=headers).status_code == 401


def test_internal_is_not_served_by_spa_fallback(client: TestClient) -> None:
    assert client.get("/internal/nope", headers=TOKEN).status_code == 404


@pytest.mark.usefixtures("seeded")
def test_plan_has_full_daily_cycle(client: TestClient) -> None:
    trips = plan(client)
    kinds = Counter((t["directionType"], t["kind"]) for t in trips)
    assert kinds == {
        ("transit", "inbound"): 5,  # regional trucks return in the afternoon
        ("linehaul", "outbound"): 3,  # BB/BA/ZA leave in the evening
        ("linehaul", "inbound"): 3,  # night trucks for the east
        ("transit", "outbound"): 5,  # regional trucks leave in the morning
    }
    ba_out = find(trips, "BA", "outbound")
    assert local(ba_out["plannedDeparture"]) == "21:30"
    assert ba_out["doorCode"] == "LD-02"
    se_out = find(trips, "SE", "outbound")
    assert local(se_out["plannedDeparture"]) == "06:30"
    assert se_out["dependsOnLinehaul"] == ["BA"]
    assert datetime.fromisoformat(se_out["plannedDeparture"]).date() == DAY + timedelta(days=1)
    assert all(t["status"] == "planned" for t in trips)


@pytest.mark.usefixtures("seeded")
def test_plan_is_idempotent_and_new_day_gets_parcels(client: TestClient, db: Session) -> None:
    first = [t["id"] for t in plan(client)]
    assert [t["id"] for t in plan(client)] == first

    before = db.execute(select(Parcel)).all()
    next_day = plan(client, DAY + timedelta(days=1))
    assert len(next_day) == 16
    assert len(db.execute(select(Parcel)).all()) == len(before) + 200

    # linehaul trucks shuttle: tonight's arrival leaves tomorrow evening
    today_night = find(plan(client), "BA", "inbound")["vehiclePlate"]
    assert find(next_day, "BA", "outbound")["vehiclePlate"] == today_night


@pytest.mark.usefixtures("seeded")
def test_manifest_lists_only_loadable_parcels_of_direction_and_day(
    client: TestClient, db: Session
) -> None:
    ba = db.execute(select(Direction).where(Direction.code == "BA")).scalar_one()
    ba_parcels = db.execute(select(Parcel).where(Parcel.direction_id == ba.id)).scalars().all()
    assert ba_parcels

    url = f"/internal/manifest?direction=BA&day={DAY}"
    body = client.get(url, headers=TOKEN).json()
    assert {p["barcode"] for p in body["parcels"]} == {p.barcode for p in ba_parcels}

    ba_parcels[0].status = ParcelStatus.LOADED
    db.commit()
    assert len(client.get(url, headers=TOKEN).json()["parcels"]) == len(ba_parcels) - 1
    other_day = client.get(
        f"/internal/manifest?direction=BA&day={DAY - timedelta(days=1)}", headers=TOKEN
    )
    assert other_day.json()["parcels"] == []


def send_events(client: TestClient, updates: list[dict[str, Any]]) -> dict[str, Any]:
    body = {"simTime": datetime(2026, 10, 24, 0, 30, tzinfo=TZ).isoformat(), "trips": updates}
    resp = client.post("/internal/events/trips", json=body, headers=TOKEN)
    assert resp.status_code == 200, resp.text
    result: dict[str, Any] = resp.json()
    return result


def at(hh: int, mm: int) -> str:
    return datetime(2026, 10, 24, hh, mm, tzinfo=TZ).isoformat()


def open_alerts(db: Session) -> list[Alert]:
    db.expire_all()
    return list(db.execute(select(Alert).where(Alert.acknowledged_at.is_(None))).scalars())


@pytest.mark.usefixtures("seeded")
def test_trip_events_update_execution_state(client: TestClient) -> None:
    trips = plan(client)
    ba_out = find(trips, "BA", "outbound")
    result = send_events(
        client,
        [
            {"tripId": ba_out["id"], "status": "departed", "actualDeparture": at(21, 41)},
            {"tripId": 999999, "status": "en_route"},
        ],
    )
    assert result == {"updated": 1, "unknown": [999999], "alertsChanged": 0}
    updated = find(plan(client), "BA", "outbound")
    assert updated["status"] == "departed"
    assert local(updated["actualDeparture"]) == "21:41"


@pytest.mark.usefixtures("seeded")
def test_late_night_truck_raises_cascade_warning_then_resolves(
    client: TestClient, db: Session, fake_telematics: list[tuple[str, dict[str, object]]]
) -> None:
    trips = plan(client)
    ba_night = find(trips, "BA", "inbound")
    assert local(ba_night["plannedArrival"]) == "01:30"

    # BA feeds MI (06:00), TV (06:15), HE (06:00), SE (06:30); ETA 05:45 + 30 min = 06:15
    send_events(
        client, [{"tripId": ba_night["id"], "status": "en_route", "predictedArrival": at(5, 45)}]
    )
    alerts = open_alerts(db)
    assert sorted(a.message.split(" (")[0] for a in alerts) == [
        "Prechod Humenné",
        "Prechod Michalovce",
    ]
    assert all(a.severity == AlertSeverity.WARNING for a in alerts)
    assert len(fake_telematics) == 2 and fake_telematics[0][0] == "alerts"

    # worse prediction: same alerts are updated, not duplicated; arrival after departure = critical
    send_events(
        client, [{"tripId": ba_night["id"], "status": "en_route", "predictedArrival": at(6, 10)}]
    )
    alerts = open_alerts(db)
    assert len(alerts) == 4  # now also TV (06:15) and SE (06:30)
    critical = {a.message.split(" (")[0] for a in alerts if a.severity == AlertSeverity.CRITICAL}
    assert critical == {"Prechod Humenné", "Prechod Michalovce"}

    # the truck catches up: warnings are closed automatically
    send_events(
        client, [{"tripId": ba_night["id"], "status": "en_route", "predictedArrival": at(2, 0)}]
    )
    assert open_alerts(db) == []


@pytest.mark.usefixtures("seeded")
def test_departed_transit_is_not_warned(client: TestClient, db: Session) -> None:
    trips = plan(client)
    send_events(client, [{"tripId": find(trips, "MI", "outbound")["id"], "status": "departed"}])
    send_events(
        client,
        [
            {
                "tripId": find(trips, "BA", "inbound")["id"],
                "status": "en_route",
                "predictedArrival": at(5, 45),
            }
        ],
    )
    assert [a.message.split(" (")[0] for a in open_alerts(db)] == ["Prechod Humenné"]


def test_alert_endpoint_upserts_and_resolves(client: TestClient, db: Session) -> None:
    body = {
        "kind": "device_offline",
        "severity": "critical",
        "message": "Skener DOCK-SCN-03 je offline",
        "refType": "device",
        "refId": "DOCK-SCN-03",
    }
    first = client.post("/internal/alerts", json=body, headers=TOKEN).json()
    again = client.post("/internal/alerts", json=body, headers=TOKEN).json()
    assert first["id"] == again["id"]
    assert len(open_alerts(db)) == 1

    resolved = client.post("/internal/alerts", json={**body, "resolved": True}, headers=TOKEN)
    assert resolved.json()["acknowledgedAt"] is not None
    assert open_alerts(db) == []
