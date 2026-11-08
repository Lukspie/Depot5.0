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
from depotrack.seed.depots import built_depots, inside
from depotrack.seed.generator import kosice_rajon
from depotrack.seed.geo import addresses
from depotrack.seed.reference import HUB_LAT, HUB_LON, HUB_NAME
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
    # door equipment (plan-doplnky 5c): 2 levelers, 3 telescopic conveyors, manual courier doors
    eq = {d["code"]: (d["doorDrive"], d["dockEquipment"]) for d in bud["doors"]}
    assert [eq[f"LD-0{i}"][1] for i in range(1, 9)] == ["dock_leveler"] * 2 + [
        "telescopic_conveyor"
    ] * 3 + ["none"] * 3
    assert {eq[f"SB-0{i}"] for i in range(1, 9)} == {("manual", "none")}
    assert eq["LD-06"] == ("electric", "none")
    hub = user.get("/api/layout?depot=BAH").json()
    assert [d["code"] for d in hub["doors"]] == [f"BA-R0{i}" for i in range(1, 7)]
    # the hub in Ivanka pri Dunaji from OSM (ADR-051, 064); the routing point stays
    assert hub["depot"]["name"] == HUB_NAME
    assert (hub["depot"]["lat"], hub["depot"]["lon"]) == (HUB_LAT, HUB_LON)
    assert hub["layout"] == built_depots()["BAH"].layout
    assert user.get("/api/layout?depot=XXX").status_code == 404


@pytest.mark.usefixtures("seeded")
@pytest.mark.parametrize("code", ["BUD", "BAH", "ZIL", "DS", "TN"])
def test_every_depot_layout_is_inside_its_site(user: TestClient, code: str) -> None:
    body = user.get(f"/api/layout?depot={code}").json()
    layout = body["layout"]
    site = [tuple(p) for p in layout["site"]]
    yard = layout["yard"]
    assert yard["truckStands"] or code == "DS"
    assert yard["vanParking"] and yard["lanes"]
    slots = yard["truckStands"] + yard["vanParking"] + yard["vanLoading"] + yard["carParking"]
    points = (
        [(d["x"], d["y"]) for d in body["doors"]]
        + [(s["x"], s["y"]) for s in slots]
        + [tuple(p) for lane in yard["lanes"] for p in lane]
        + [tuple(yard["gate"])]
    )
    assert all(inside(p, site) for p in points), code
    # every ramp on the real outline of the hall (OSM), not on its bounding box
    footprint = [tuple(p) for p in layout["footprint"]]
    for d in body["doors"]:
        if d["kind"] == "loading_dock":
            assert _to_outline((d["x"], d["y"]), footprint) < 0.6, (code, d["code"])
        if d["kind"] == "staging_bay":
            assert inside((d["x"], d["y"]), footprint), (code, d["code"])
    assert not inside(tuple(yard["gate"]), footprint)
    assert layout["source"]["hallWay"].startswith("w") and layout["source"]["assumed"]


def _to_outline(p: tuple[float, float], ring: list[tuple[float, float]]) -> float:
    best = float("inf")
    for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1], strict=True):
        dx, dy = x2 - x1, y2 - y1
        t = max(0.0, min(1.0, ((p[0] - x1) * dx + (p[1] - y1) * dy) / ((dx * dx + dy * dy) or 1)))
        best = min(best, ((p[0] - x1 - t * dx) ** 2 + (p[1] - y1 - t * dy) ** 2) ** 0.5)
    return best


@pytest.mark.usefixtures("seeded")
def test_zilina_from_osm_and_the_satellite_picture(user: TestClient) -> None:
    depots = {d["code"]: d for d in user.get("/api/depots").json()}
    assert depots["ZIL"]["name"] == "Žilina" and depots["ZIL"]["kind"] == "depot"
    zil = user.get("/api/layout?depot=ZIL").json()
    layout = zil["layout"]
    assert (
        layout["source"]["hallWay"] == "w321455829" and layout["source"]["siteWay"] == "w810621382"
    )
    hall = layout["hall"]
    # 127 x 33 m, long side ~73° counter-clockwise from east -> 107° clockwise:
    # +y faces west, +x the south end, -y the east
    assert (hall["width"], hall["depth"], hall["rotationDeg"]) == (127.5, 33.1, 107.0)
    ramps = [d for d in zil["doors"] if d["kind"] == "loading_dock"]
    bays = [d for d in zil["doors"] if d["kind"] == "staging_bay"]
    assert len(ramps) == 12 and all(d["y"] > 0 for d in ramps)  # west, towards the SNP street
    assert max(d["x"] for d in ramps) < 127.5 / 2 - 20  # offices at the south end
    assert len(bays) == 4 and all(d["x"] < -127.5 / 2 + 10 for d in bays)  # north end wall
    yard = layout["yard"]
    assert all(s["y"] < -33.1 / 2 for s in yard["truckStands"])  # trailers to the east
    # cars and vans in the south-west corner, the gate house just inside the gate from SNP
    assert all(v["x"] > 0 and v["y"] > 0 for v in yard["vanParking"] + yard["carParking"])
    assert yard["gate"][1] > 0 and "gatehouse" in yard
    assert user.get("/api/depots/ZIL/state").status_code == 200


@pytest.mark.usefixtures("seeded")
def test_dunajska_streda_small_depot_without_an_osm_plot(user: TestClient) -> None:
    ds = user.get("/api/layout?depot=DS").json()
    assert ds["depot"]["name"] == "Dunajská Streda"
    # the building at Malé Dvorníky 610; OSM has only a shared industrial zone around it
    assert ds["layout"]["source"]["hallWay"] == "w388660269"
    assert ds["layout"]["source"]["siteWay"] is None
    assert "yard outline" in ds["layout"]["source"]["assumed"]
    kinds = [d["kind"] for d in ds["doors"]]
    assert kinds.count("loading_dock") == 1 and kinds.count("staging_bay") == 6
    vans = ds["layout"]["yard"]["vanParking"]
    assert len(vans) == 6 and sum(v["y"] > 0 for v in vans) == 3  # along both long sides
    assert ds["layout"]["yard"]["gate"][0] > 0  # from the south-west end


@pytest.mark.usefixtures("seeded")
def test_trencin_from_osm(user: TestClient) -> None:
    tn = user.get("/api/layout?depot=TN").json()
    assert tn["depot"]["name"] == "Trenčín" and tn["depot"]["kind"] == "depot"
    assert tn["layout"]["source"]["hallWay"] == "w1195263485"
    ramps = [d for d in tn["doors"] if d["kind"] == "loading_dock"]
    # ramps on one long side, none at the office end (+x), the trailers beyond them
    assert len(ramps) == 6 and all(d["y"] < 0 for d in ramps)
    assert max(d["x"] for d in ramps) < tn["layout"]["hall"]["width"] / 2 - 28
    assert all(s["y"] < 0 for s in tn["layout"]["yard"]["truckStands"])


@pytest.mark.usefixtures("seeded")
def test_budimir_keeps_its_routing_point_the_hall_comes_from_osm(user: TestClient) -> None:
    bud = user.get("/api/layout?depot=BUD").json()
    # the simulator drives from this point: it must not move (determinism, step 3 golden test)
    assert (bud["depot"]["lat"], bud["depot"]["lon"]) == (48.79256, 21.3071)
    assert bud["layout"]["source"]["hallWay"] == "w650270157"
    assert bud["layout"]["hall"]["width"] == 120.6 and bud["layout"]["origin"] != [
        48.79256,
        21.3071,
    ]
    # the routing point lies inside the real hall (28 m from its centre)
    assert abs(bud["layout"]["origin"][0] - 48.79256) < 0.0005


def test_existing_database_ends_like_a_clean_one(db: Session, client: TestClient) -> None:
    """A database from before phase 7c (old schematic layouts, no Žilina) gets the same layouts."""
    from sqlalchemy import delete, update

    from depotrack.models import Depot, Door, SeedMeta

    settings = get_settings()
    run_seed(db, settings, DAY)
    clean = {d.code: (d.lat, d.lon, d.layout) for d in db.execute(select(Depot)).scalars()}
    clean_doors = {
        d.code: (d.position_x, d.position_y, d.depot_id) for d in db.execute(select(Door)).scalars()
    }
    zil = db.execute(select(Depot).where(Depot.code == "ZIL")).scalar_one()
    db.execute(delete(Door).where(Door.depot_id == zil.id))
    db.delete(zil)
    db.execute(update(Depot).values(layout={"hall": {"width": 86, "depth": 40, "height": 10}}))
    db.execute(update(Door).values(position_x=0, position_y=0))
    db.execute(delete(SeedMeta).where(SeedMeta.key.like("depot-layouts:%")))
    db.commit()
    run_seed(db, settings, DAY)
    again = {d.code: (d.lat, d.lon, d.layout) for d in db.execute(select(Depot)).scalars()}
    assert again["BUD"] == clean["BUD"] and again["BAH"] == clean["BAH"]
    assert again["ZIL"][2] == clean["ZIL"][2]
    doors = {d.code: (d.position_x, d.position_y) for d in db.execute(select(Door)).scalars()}
    assert doors == {k: v[:2] for k, v in clean_doors.items()}


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
    assert dest["BA"] == [pytest.approx(HUB_LAT), pytest.approx(HUB_LON)]  # the hub, not the city


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
