"""Depots and hubs (ADR-039): shadow/map layout, live state, plan geography, real addresses."""

from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from conftest import MakeUser, login
from depotrack.core.config import get_settings
from depotrack.models import Direction, Parcel
from depotrack.models.enums import DirectionType, UserRole
from depotrack.seed.generator import kosice_rajon
from depotrack.seed.geo import addresses
from depotrack.services.operating_day import run_seed

DAY = date(2026, 10, 23)
TOKEN = {"X-Service-Token": "test-service-token"}


@pytest.fixture
def seeded(db: Session) -> None:
    run_seed(db, get_settings(), DAY)


@pytest.fixture
def user(client: TestClient, make_user: MakeUser) -> TestClient:
    make_user("disp", UserRole.DISPATCHER)
    login(client, "disp")
    return client


@pytest.mark.usefixtures("seeded")
def test_depots_budimir_and_bratislava_hub(user: TestClient) -> None:
    depots = {d["code"]: d for d in user.get("/api/depots").json()}
    assert depots["BUD"]["kind"] == "depot" and depots["BUD"]["name"] == "Budimír"
    assert depots["BAH"]["kind"] == "hub"
    assert 48.7 < depots["BUD"]["lat"] < 48.9 and 21.2 < depots["BUD"]["lon"] < 21.4


@pytest.mark.usefixtures("seeded")
def test_layout_drives_the_shadow_and_the_map(user: TestClient) -> None:
    bud = user.get("/api/layout?depot=BUD").json()
    assert bud["layout"]["hall"]["width"] > 0 and len(bud["layout"]["belt"]) >= 2
    kinds = [d["kind"] for d in bud["doors"]]
    assert kinds.count("loading_dock") == 8 and kinds.count("staging_bay") == 8
    ld2 = next(d for d in bud["doors"] if d["code"] == "LD-02")
    assert ld2["directionCode"] == "BA"
    hub = user.get("/api/layout?depot=BAH").json()
    assert [d["code"] for d in hub["doors"]] == [f"BA-R0{i}" for i in range(1, 7)]
    assert user.get("/api/layout?depot=XXX").status_code == 404


@pytest.mark.usefixtures("seeded")
def test_depot_state_shows_trucks_at_doors(user: TestClient, db: Session) -> None:
    plan = user.get(f"/internal/plan?day={DAY}", headers=TOKEN).json()
    ba = next(t for t in plan["trips"] if t["directionCode"] == "BA" and t["kind"] == "outbound")
    body = {
        "simTime": "2026-10-23T16:00:00+00:00",
        "trips": [{"tripId": ba["id"], "status": "loading"}],
    }
    user.post("/internal/events/trips", json=body, headers=TOKEN)
    state = user.get("/api/depots/BUD/state").json()
    assert state["occupied"] == [
        {
            "doorCode": "LD-02",
            "plate": ba["vehiclePlate"],
            "tripId": ba["id"],
            "tripKind": "outbound",
            "status": "loading",
            "directionCode": "BA",
            "directionType": "linehaul",
        }
    ]
    assert len(state["staged"]) == 8

    body = {
        "simTime": "2026-10-23T22:00:00+00:00",
        "trips": [{"tripId": ba["id"], "status": "departed"}],
    }
    user.post("/internal/events/trips", json=body, headers=TOKEN)
    hub = user.get("/api/depots/BAH/state").json()
    assert {"plate": ba["vehiclePlate"], "state": "arriving"}.items() <= next(
        t for t in hub["trucks"] if t["tripId"] == ba["id"]
    ).items()


@pytest.mark.usefixtures("seeded")
def test_plan_tells_telematics_where_trucks_drive(client: TestClient) -> None:
    plan = client.get(f"/internal/plan?day={DAY}", headers=TOKEN).json()
    assert plan["depot"]["code"] == "BUD"
    dest = plan["destinations"]
    assert set(dest) == {"BB", "BA", "ZA", "MI", "TV", "HE", "SL", "SE"}
    assert dest["BA"] == [pytest.approx(48.1645), pytest.approx(17.1795)]  # the hub, not the city


@pytest.mark.skipif(not addresses(), reason="address file not built")
@pytest.mark.usefixtures("seeded")
def test_parcels_use_real_osm_addresses(db: Session) -> None:
    known = {(a[0], a[1]) for town in addresses().values() for a in town}
    parcels = db.execute(select(Parcel, Direction).join(Direction)).all()
    assert parcels
    for p, d in parcels:
        street_number = p.address.split(",")[0]
        street, number = street_number.rsplit(" ", 1)
        assert (street, number) in known, p.address
        if d.type == DirectionType.LOCAL:
            assert d.code == kosice_rajon(p.lat, p.lon)
