"""Depots and hubs (ADR-039): shadow/map layout, live state, plan geography, real addresses."""

from datetime import date
from itertools import pairwise

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from conftest import MakeUser, login
from depotrack.core.config import get_settings
from depotrack.models.enums import UserRole
from depotrack.seed.depots import SPECS, built_depots, inside
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
    spec = next(s for s in SPECS if s.code == code)
    assert len(yard["truckStands"]) == sum(s.count for s in spec.stands)
    assert len(yard["vanParking"]) == sum(s.count for s in spec.vans) and yard["lanes"]
    # no parking place on a lane (a 7 m band along every lane segment)
    for lane in yard["lanes"]:
        for a, b in pairwise(lane):
            x0, x1 = sorted((a[0], b[0]))
            y0, y1 = sorted((a[1], b[1]))
            for s in yard["truckStands"] + yard["vanParking"] + yard["carParking"]:
                assert not (x0 - 3.5 < s["x"] < x1 + 3.5 and y0 - 3.5 < s["y"] < y1 + 3.5), (
                    code,
                    s["code"],
                )
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
def test_the_za_truck_arrives_at_the_zilina_depot(user: TestClient, db: Session) -> None:
    """Phase 7c (ADR-065): the ZA linehaul ends in Žilina, so the depot shows it arriving."""
    from depotrack.models import Direction, Trip
    from depotrack.models.enums import TripKind, TripStatus

    za = db.execute(select(Direction).where(Direction.code == "ZA")).scalar_one()
    trip = (
        db.execute(select(Trip).where(Trip.direction_id == za.id, Trip.kind == TripKind.OUTBOUND))
        .scalars()
        .first()
    )
    assert trip is not None
    trip.status = TripStatus.DEPARTED
    db.commit()
    state = user.get("/api/depots/ZIL/state").json()
    states = {t["tripId"]: t["state"] for t in state["trucks"]}
    # the evening truck on its way, the night truck loading in Žilina for Budimír
    assert states[trip.id] == "arriving" and "loading_at_hub" in states.values()
    assert user.get("/api/depots/BUD/state").json()["trucks"] == []


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
    """A database from before the depot layouts (schematic layouts, Dunajská Streda and Trenčín
    missing) ends with the same depots and doors, every field, as a clean one. Žilina stays: its
    districts, vans and routes depend on it."""
    from sqlalchemy import delete, update

    from depotrack.models import Depot, Door, SeedMeta

    def snapshot() -> tuple[dict[str, object], dict[str, object]]:
        depots = {d.id: d.code for d in db.execute(select(Depot)).scalars()}
        return (
            {
                d.code: (d.name, d.kind, d.lat, d.lon, d.layout)
                for d in db.execute(select(Depot)).scalars()
            },
            {
                d.code: (
                    depots[d.depot_id],
                    d.kind,
                    d.position_x,
                    d.position_y,
                    d.door_drive,
                    d.dock_equipment,
                )
                for d in db.execute(select(Door)).scalars()
            },
        )

    settings = get_settings()
    run_seed(db, settings, DAY)
    clean = snapshot()
    new = [d.id for d in db.execute(select(Depot).where(Depot.code.in_(["DS", "TN"]))).scalars()]
    db.execute(delete(Door).where(Door.depot_id.in_(new)))
    db.execute(delete(Depot).where(Depot.id.in_(new)))
    db.execute(update(Depot).values(layout={"hall": {"width": 86, "depth": 40, "height": 10}}))
    db.execute(update(Door).values(position_x=0, position_y=0))
    db.execute(delete(SeedMeta).where(SeedMeta.key.like("depot-layouts:%")))
    db.commit()
    run_seed(db, settings, DAY)
    assert snapshot() == clean
