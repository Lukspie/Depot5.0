"""Dispatching of design system v2 (phase 7d, maketa-dispecing): the same page for a
transshipment depot (Budimír) and a delivery depot (Žilina), from the data."""

from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from conftest import MakeUser, login
from depotrack.models import Alert, Direction, Trip
from depotrack.models.enums import AlertKind, AlertSeverity, TripKind, UserRole
from test_wms import DAY, at_time, local, seeded

__all__ = ["at_time", "seeded"]


@pytest.fixture
def disp(client: TestClient, make_user: MakeUser) -> TestClient:
    make_user("disp-v2", UserRole.DISPATCHER)
    assert login(client, "disp-v2") == 200
    return client


@pytest.mark.usefixtures("seeded")
def test_transshipment_depot(disp: TestClient, db: Session, at_time) -> None:  # type: ignore[no-untyped-def]
    at_time(local(2, 25, DAY + timedelta(days=1)))
    # a cascade alert: the night BB truck predicted late for the morning Stará Ľubovňa transit
    night = (
        db.execute(
            select(Trip)
            .join(Direction, Trip.direction_id == Direction.id)
            .where(Direction.code == "BB", Trip.kind == TripKind.INBOUND)
        )
        .scalars()
        .first()
    )
    transit = (
        db.execute(
            select(Trip)
            .join(Direction, Trip.direction_id == Direction.id)
            .where(Direction.code == "SL", Trip.kind == TripKind.OUTBOUND)
        )
        .scalars()
        .first()
    )
    assert night and transit and transit.planned_departure
    night.predicted_arrival = transit.planned_departure - timedelta(minutes=9)
    night.predicted_by = "ml"
    db.add(
        Alert(
            kind=AlertKind.CASCADE_DELAY,
            severity=AlertSeverity.CRITICAL,
            message="kaskáda",
            ref_type="cascade",
            ref_id=f"{transit.id}:{night.id}",
            created_at=local(23, 51),
        )
    )
    db.commit()  # fmt: skip

    body = disp.get("/api/dispatch").json()
    assert body["depot"] == {
        "code": "BUD",
        "name": "Budimír",
        "label": "prekládkové depo",
        "mode": "transship",
    }
    assert [k["key"] for k in body["kpis"]] == ["parcels", "loaded", "trucks", "read", "alerts"]
    n_points = len(body["kpis"][0]["spark"])
    assert n_points >= 22 and all(
        len(k["spark"]) == n_points for k in body["kpis"]
    )  # 15:00 → 02:25
    assert body["kpis"][2]["unit"] == "/ 8 brán"
    # trips in their groups, transit departures with the loading time and the cascade risk
    groups = {g["key"]: g for g in body["groups"]}
    assert set(groups) == {"lh-out", "tr-out", "tr-in", "lh-in"}
    rows = {r["key"]: r for r in body["trips"]}
    sl = rows[f"trip-{transit.id}"]
    assert sl["group"] == "tr-out" and sl["loadingFrom"] is not None
    assert sl["risk"]["label"] == "Kaskáda" and sl["etaBy"] == "cascade" and sl["deltaMin"] == 21
    # the alert as a card: one sentence, facts, the action
    card = next(a for a in body["alerts"] if a["kind"] == "cascade_delay")
    assert card["title"] == "Prechod Stará Ľubovňa odíde o ~21 min neskôr"
    assert card["facts"][1] == "triedenie 30 min" and card["source"] == "ML predikcia"
    assert card["action"]["kind"] == "scenario"
    # parcels per direction: the courier districts in one bar, waves on the timeline
    assert body["directions"][0]["name"].endswith("– kuriéri")
    assert body["legend"] == ["Naložené", "Odstavené", "Čaká"]
    names = [s["name"] for s in body["timeline"]]
    assert names[:2] == ["Večerná vlna", "Nočná vlna"] and "Ranné odchody" in names
    night_wave = body["timeline"][1]
    assert night_wave["state"] == "prebieha · 28 %"


@pytest.mark.usefixtures("seeded")
def test_delivery_depot_has_no_waves_or_sorting(disp: TestClient, at_time) -> None:  # type: ignore[no-untyped-def]
    at_time(local(6, 45, DAY + timedelta(days=1)))
    body = disp.get("/api/dispatch?depot=ZIL").json()
    assert body["depot"]["mode"] == "delivery"
    # KPIs that mean something in a depot without sorting
    assert [k["key"] for k in body["kpis"]] == ["arrived", "out", "delivered", "couriers", "alerts"]
    assert body["kpis"][0]["label"] == "Balíky z kamióna"
    assert body["legend"] == ["Doručené", "Na doručenie", "V sklade"]
    names = [s["name"] for s in body["timeline"]]
    assert not any("vlna" in n for n in names)
    assert "Nakládka kuriérov" in names and "Rozvoz" in names
    couriers = [r for r in body["trips"] if r["group"] == "couriers"]
    assert couriers and all(r["plate"].startswith("ZA-3") for r in couriers)
    assert all(r["statusLabel"] == "Nakladá sa" for r in couriers)  # after 06:30, before leaving
    assert {d["name"].split(" – ")[0] for d in body["directions"]} == {"Žilina"}


@pytest.mark.usefixtures("seeded", "at_time")
def test_dispatch_only_for_dispatchers(client: TestClient, make_user: MakeUser) -> None:
    make_user("guard-x", UserRole.SECURITY)
    assert login(client, "guard-x") == 200
    assert client.get("/api/dispatch").status_code == 403
