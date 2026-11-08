"""Phase 4: courier routes, tracking token lifecycle, privacy of the public view, rate limit,
courier screen and the admin list of simulated SMS."""

import hashlib
import math
import re
from collections import Counter
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, date, datetime, time, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session
from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware

from depotrack.core.clock import TZ
from depotrack.core.config import get_settings
from depotrack.main import create_app
from depotrack.models import (
    CourierRoute,
    CustomerNotification,
    Depot,
    Direction,
    Parcel,
    RouteStop,
    TrackingToken,
)
from depotrack.models.enums import DirectionType, ParcelStatus, UserRole
from depotrack.seed.generator import kosice_rajon
from depotrack.seed.geo import addresses
from depotrack.services import telematics
from depotrack.services.operating_day import reset_operating_day, run_seed
from depotrack.services.routing import Stop, delivery_profile, nearest_neighbour_tour, plan_tour

DAY = date(2026, 10, 23)
DELIVERY = DAY + timedelta(days=1)
TOKEN = {"X-Service-Token": "test-service-token"}
VAN_POS = {"lat": 48.7301, "lon": 21.2588, "heading": 90, "moving": True}

SetTime = Callable[[str], datetime]


@pytest.fixture
def seeded(db: Session) -> None:
    run_seed(db, get_settings(), DAY)


@pytest.fixture
def at(monkeypatch: pytest.MonkeyPatch) -> SetTime:
    """Set the simulated clock to HH:MM local on the delivery day."""

    def _set(hhmm: str) -> datetime:
        h, m = (int(x) for x in hhmm.split(":"))
        now = datetime(DELIVERY.year, DELIVERY.month, DELIVERY.day, h, m, tzinfo=TZ)
        monkeypatch.setattr(telematics, "sim_now", lambda: now)
        return now

    monkeypatch.setattr(telematics, "vehicle_position", lambda plate: VAN_POS)
    return _set


def courier_plan(client: TestClient) -> list[dict[str, Any]]:
    resp = client.get(f"/internal/courier-routes?day={DAY}", headers=TOKEN)
    assert resp.status_code == 200, resp.text
    routes: list[dict[str, Any]] = resp.json()["routes"]
    return routes


def post_events(
    client: TestClient,
    events: list[dict[str, Any]],
    etas: list[dict[str, Any]] | None = None,
    sim: datetime | None = None,
) -> dict[str, Any]:
    body = {
        "simTime": (sim or datetime.now(UTC)).isoformat(),
        "events": events,
        "etas": etas or [],
    }
    resp = client.post("/internal/events/couriers", json=body, headers=TOKEN)
    assert resp.status_code == 200, resp.text
    out: dict[str, Any] = resp.json()
    return out


def iso(t: datetime) -> str:
    return t.isoformat()


def load_all(client: TestClient, route: dict[str, Any], when: datetime) -> None:
    post_events(
        client,
        [
            {"routeId": route["routeId"], "kind": "loaded", "stopId": s["stopId"], "at": iso(when)}
            for s in route["stops"]
        ],
        etas=[
            {"stopId": s["stopId"], "eta": iso(when + timedelta(hours=1, minutes=5 * i))}
            for i, s in enumerate(route["stops"])
        ],
    )


def token_of(db: Session, parcel_barcode: str) -> str:
    """The token from the simulated SMS (the only place where it exists in plain text)."""
    note = db.execute(
        select(CustomerNotification)
        .join(Parcel, CustomerNotification.parcel_id == Parcel.id)
        .where(Parcel.barcode == parcel_barcode)
    ).scalar_one()
    m = re.search(r"/track/([A-Za-z0-9_-]+)$", note.link)
    assert m and m.group(0) in note.message
    return m.group(1)


def courier_login(client: TestClient, username: str = "kurier01") -> None:
    resp = client.post(
        "/api/auth/login", json={"username": username, "password": "courier-test-heslo"}
    )
    assert resp.status_code == 200, resp.text


# ------------------------------------------------------------------ routes


@pytest.mark.usefixtures("seeded")
def test_every_district_gets_a_route_that_keeps_the_windows(db: Session) -> None:
    budimir = select(Direction.id).where(Direction.code.like("KE-%"))
    routes = list(
        db.execute(
            select(CourierRoute).where(CourierRoute.rajon_direction_id.in_(budimir))
        ).scalars()
    )
    assert len(routes) == 8
    assert {r.date for r in routes} == {DELIVERY}
    local = {
        d.id
        for d in db.execute(
            select(Direction).where(Direction.type == DirectionType.LOCAL)
        ).scalars()
    }
    for r in routes:
        rows = db.execute(
            select(RouteStop, Parcel)
            .join(Parcel, RouteStop.parcel_id == Parcel.id)
            .where(RouteStop.route_id == r.id)
            .order_by(RouteStop.sequence)
        ).all()
        assert [s.sequence for s, _ in rows] == list(range(1, len(rows) + 1))
        assert r.rajon_direction_id in local
        assert all(p.direction_id == r.rajon_direction_id for _, p in rows)
        etas = [s.planned_eta for s, _ in rows]
        assert etas == sorted(etas)
        # personal handovers are planned inside their window (ADR-062; a heuristic: <= 1 % may miss)
        handovers = [(s, p) for s, p in rows if p.delivery_type == "handover"]
        outside = 0
        for s, p in handovers:
            assert s.planned_eta is not None and p.window_from and p.window_to
            outside += not (p.window_from <= s.planned_eta.astimezone(TZ).time() <= p.window_to)
        assert outside <= max(1, len(handovers) // 100), (r.id, outside, len(handovers))


@pytest.mark.usefixtures("seeded")
def test_delivery_types_are_mixed_about_60_25_15(db: Session) -> None:
    kinds = Counter(db.execute(select(Parcel.delivery_type)).scalars())
    total = sum(kinds.values())
    assert set(kinds) == {"handover", "mailbox", "locker"}
    assert 0.5 < kinds["handover"] / total < 0.7
    assert 0.15 < kinds["mailbox"] / total < 0.35
    assert 0.07 < kinds["locker"] / total < 0.23
    windows = set(
        db.execute(
            select(Parcel.window_from, Parcel.window_to).where(Parcel.delivery_type == "handover")
        ).tuples()
    )
    assert windows == {(time(8), time(11)), (time(10), time(13)), (time(12), time(15))}
    assert (
        db.execute(
            select(Parcel.id).where(
                Parcel.delivery_type != "handover", Parcel.window_from.is_not(None)
            )
        ).first()
        is None
    )


@pytest.mark.usefixtures("seeded")
def test_migration_fills_the_same_profile_as_python(db: Session) -> None:
    import importlib.util
    from pathlib import Path

    from sqlalchemy import text

    path = next(Path(__file__).parents[1].glob("alembic/versions/*_delivery_windows.py"))
    spec = importlib.util.spec_from_file_location("delivery_windows", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    db.execute(text("UPDATE parcels SET delivery_type = 'x', window_from = NULL, window_to = NULL"))
    db.execute(text(module.FILL))
    db.commit()
    rows = db.execute(
        select(Parcel.barcode, Parcel.delivery_type, Parcel.window_from, Parcel.window_to)
    ).all()
    assert rows and all(tuple(r[1:]) == delivery_profile(r[0]) for r in rows)


def test_window_heuristic_beats_nearest_neighbour_on_windows() -> None:
    """Synthetic district: random places and windows. The phase 4 order misses most windows."""
    import random

    rng = random.Random(7)
    when = DELIVERY
    stops = []
    for i in range(80):
        kind, a, b = delivery_profile(f"DP-TEST-{i:03d}")
        window = (datetime.combine(when, a, TZ), datetime.combine(when, b, TZ)) if a and b else None
        stops.append(
            Stop(
                f"{i:03d}",
                48.72 + rng.uniform(-0.03, 0.03),
                21.25 + rng.uniform(-0.05, 0.05),
                kind,
                window,
            )
        )
    depot = (48.79256, 21.30710)
    depart = datetime.combine(when, time(7, 30), TZ)
    nn = nearest_neighbour_tour(depot, depart, stops)
    ours = plan_tour(depot, depart, stops)
    missed = lambda tour: sum(1 for v in tour if v.missed)  # noqa: E731
    windows = sum(1 for s in stops if s.window)
    assert sorted(v.stop.key for v in ours) == sorted(s.key for s in stops)
    assert missed(ours) <= windows // 100 and missed(nn) > windows // 3
    assert plan_tour(depot, depart, stops) == ours  # deterministic


@pytest.mark.usefixtures("seeded")
def test_internal_courier_plan(client: TestClient) -> None:
    routes = courier_plan(client)
    assert len(routes) == 8 + 4 + 3  # Budimír, Žilina and Ivanka (phase 7c)
    assert {r["depot"]["code"] for r in routes} == {"BUD", "ZIL", "BAH"}
    first = routes[0]
    assert first["vehiclePlate"] == "KE-301KR"
    assert first["courierUsername"] == "kurier01"
    assert first["districtCode"] == "KE-01"
    assert first["stagingBay"] == "SB-01"
    assert first["stops"][0]["sequence"] == 1
    assert client.get(f"/internal/courier-routes?day={DAY}").status_code == 401


@pytest.mark.usefixtures("seeded")
def test_zilina_couriers_deliver_the_parcels_of_the_za_truck(
    client: TestClient, db: Session, at: SetTime
) -> None:
    """Phase 7c (ADR-065): the parcels of direction ZA ride the evening truck to Žilina, the 4
    couriers of Žilina deliver them the next morning, each in a quadrant around the town."""
    from depotrack.seed.depots import built_depots, inside
    from depotrack.seed.operations import ZIL_OPS, district_of

    za = db.execute(select(Direction).where(Direction.code == "ZA")).scalar_one()
    zil = db.execute(select(Depot).where(Depot.code == "ZIL")).scalar_one()
    assert za.destination_depot_id == zil.id and (za.dest_lat, za.dest_lon) == (zil.lat, zil.lon)
    za_parcels = {
        p.barcode: p
        for p in db.execute(select(Parcel).where(Parcel.direction_id == za.id)).scalars()
    }
    routes = [r for r in courier_plan(client) if r["depot"]["code"] == "ZIL"]
    assert [r["courierUsername"] for r in routes] == [f"kurierza0{i}" for i in range(1, 5)][
        : len(routes)
    ]
    delivered = [s["barcode"] for r in routes for s in r["stops"]]
    assert sorted(delivered) == sorted(za_parcels)  # every ZA parcel, exactly once
    for r in routes:
        assert r["vehiclePlate"].startswith("ZA-3") and r["stagingBay"].startswith("ZI-SB")
        assert all(
            district_of(ZIL_OPS, s["lat"], s["lon"]) == r["districtCode"] for s in r["stops"]
        )
        # the van parks and loads inside the Žilina yard
        layout = built_depots()["ZIL"].layout
        site = [tuple(p) for p in layout["site"]]
        from depotrack.seed.depots import Frame

        frame = Frame(tuple(layout["origin"]), layout["hall"]["rotationDeg"])
        assert inside(frame.local(*r["parking"]), site) and inside(frame.local(*r["loading"]), site)

    # a parcel that missed the ZA truck is still in Budimír: the courier of Žilina cannot load it
    at("06:40")
    courier_login(client, "kurierza01")
    first = za_parcels[routes[0]["stops"][0]["barcode"]]
    assert client.post("/api/courier/scan", json={"barcode": first.barcode}).status_code == 409
    # the courier of Žilina loads a parcel that came on the linehaul truck (status loaded)
    first.status = ParcelStatus.LOADED
    db.commit()
    at("06:40")
    courier_login(client, "kurierza01")
    res = client.post("/api/courier/scan", json={"barcode": first.barcode})
    assert res.status_code == 200, res.text
    assert res.json()["action"] == "loaded"


@pytest.mark.usefixtures("seeded")
def test_ivanka_couriers_deliver_bratislava_east_and_senec(client: TestClient, db: Session) -> None:
    """Phase 7c (ADR-066): the couriers of the Bratislava hub deliver the BA parcels addressed to
    Bratislava-východ and the villages of okres Senec, by postcode; the rest of Bratislava stays."""
    from depotrack.seed.depots import Frame, built_depots, inside
    from depotrack.seed.operations import BAH_OPS, district_of, postcode_of

    ba = db.execute(select(Direction).where(Direction.code == "BA")).scalar_one()
    bah = db.execute(select(Depot).where(Depot.code == "BAH")).scalar_one()
    assert ba.destination_depot_id == bah.id
    parcels = list(db.execute(select(Parcel).where(Parcel.direction_id == ba.id)).scalars())
    ours = {p.barcode for p in parcels if district_of(BAH_OPS, p.lat, p.lon, p.address)}
    assert ours and len(ours) < len(parcels)  # Staré Mesto, Petržalka … are not Ivanka's
    routes = [r for r in courier_plan(client) if r["depot"]["code"] == "BAH"]
    assert {r["courierUsername"] for r in routes} <= {"kurierba01", "kurierba02", "kurierba03"}
    assert sorted(s["barcode"] for r in routes for s in r["stops"]) == sorted(ours)
    by_barcode = {p.barcode: p for p in parcels}
    layout = built_depots()["BAH"].layout
    frame = Frame(tuple(layout["origin"]), layout["hall"]["rotationDeg"])
    site = [tuple(p) for p in layout["site"]]
    for r in routes:
        assert r["vehiclePlate"].startswith("BA-3") and r["stagingBay"].startswith("BA-SB")
        for s in r["stops"]:
            p = by_barcode[s["barcode"]]
            assert district_of(BAH_OPS, p.lat, p.lon, p.address) == r["districtCode"]
        assert inside(frame.local(*r["parking"]), site) and inside(frame.local(*r["loading"]), site)
    assert postcode_of("Ružinovská 1, 821 05 Bratislava") == "82105"
    assert postcode_of("Hlavná 5, 90028 Ivanka pri Dunaji") == "90028"
    assert district_of(BAH_OPS, 0, 0, "Obchodná 1, 811 06 Bratislava") is None
    assert district_of(BAH_OPS, 0, 0, "Hlavná 5, 900 41 Rovinka") == "BA-03"


# ------------------------------------------------------------------ token lifecycle


@pytest.mark.usefixtures("seeded")
def test_loading_issues_link_and_only_the_hash_is_stored(
    client: TestClient, db: Session, at: SetTime
) -> None:
    route = courier_plan(client)[0]
    load_all(client, route, at("07:05"))

    stop = route["stops"][0]
    parcel = db.execute(select(Parcel).where(Parcel.barcode == stop["barcode"])).scalar_one()
    assert parcel.status == ParcelStatus.OUT_FOR_DELIVERY
    token = token_of(db, stop["barcode"])
    assert len(token) >= 43
    stored = db.execute(
        select(TrackingToken).where(TrackingToken.parcel_id == parcel.id)
    ).scalar_one()
    assert stored.token_hash == hashlib.sha256(token.encode()).hexdigest()
    assert token not in stored.token_hash
    # hard expiry at the end of the delivery day
    assert stored.expires_at == datetime(2026, 10, 25, 0, 0, tzinfo=TZ)

    # loading the same parcel again (retry) does not send a second SMS
    load_all(client, route, at("07:06"))
    assert len(db.execute(select(CustomerNotification)).all()) == len(route["stops"])


@pytest.mark.usefixtures("seeded")
def test_track_lifecycle_until_delivered(client: TestClient, db: Session, at: SetTime) -> None:
    route = courier_plan(client)[0]
    load_all(client, route, at("07:05"))
    stop = route["stops"][1]
    token = token_of(db, stop["barcode"])

    before = client.get(f"/api/track/{token}").json()
    assert before["status"] == "preparing"
    assert before["positionInLine"] == 2
    assert "courier" not in before

    post_events(client, [{"routeId": route["routeId"], "kind": "departed", "at": iso(at("07:30"))}])
    on_way = client.get(f"/api/track/{token}")
    assert on_way.status_code == 200
    assert on_way.headers["cache-control"] == "no-store"
    body = on_way.json()
    assert body["status"] == "on_the_way"
    assert body["courierName"] == "Tomáš"  # first name only
    assert body["etaFrom"] < body["etaTo"]
    assert body["courier"]["exact"] is True

    post_events(
        client,
        [
            {
                "routeId": route["routeId"],
                "kind": "delivered",
                "stopId": stop["stopId"],
                "at": iso(at("09:12")),
            }
        ],
    )
    done = client.get(f"/api/track/{token}").json()
    # after delivery: only the time, nothing about the courier, no map data
    assert done == {
        "status": "delivered",
        "barcode": stop["barcode"],
        "deliveredAt": done["deliveredAt"],
    }
    assert datetime.fromisoformat(done["deliveredAt"]).astimezone(TZ).strftime("%H:%M") == "09:12"
    revoked = db.execute(
        select(TrackingToken.revoked_at).join(Parcel).where(Parcel.barcode == stop["barcode"])
    ).scalar_one()
    assert revoked is not None

    # the link dies at the end of the day
    at("23:59")
    assert client.get(f"/api/track/{token}").status_code == 200
    tomorrow = datetime(2026, 10, 25, 0, 1, tzinfo=TZ)
    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(telematics, "sim_now", lambda: tomorrow)
        assert client.get(f"/api/track/{token}").status_code == 404


@pytest.mark.usefixtures("seeded")
def test_unknown_or_malformed_token(client: TestClient) -> None:
    assert client.get("/api/track/" + "A" * 43).status_code == 404
    assert client.get("/api/track/short").status_code == 422
    assert client.get("/api/track/" + "a" * 40 + "%3Cscript%3E").status_code == 422


# ------------------------------------------------------------------ privacy


def inside(center: tuple[float, float], radius_m: float, p: tuple[float, float]) -> bool:
    dlat = (p[0] - center[0]) * 111_320
    dlon = (p[1] - center[1]) * 111_320 * math.cos(math.radians(center[0]))
    return math.hypot(dlat, dlon) <= radius_m


@pytest.mark.usefixtures("seeded")
def test_privacy_exact_position_only_for_next_three(
    client: TestClient, db: Session, at: SetTime
) -> None:
    route = courier_plan(client)[0]
    load_all(client, route, at("07:05"))
    post_events(client, [{"routeId": route["routeId"], "kind": "departed", "at": iso(at("07:30"))}])

    third = client.get(f"/api/track/{token_of(db, route['stops'][2]['barcode'])}").json()
    assert third["positionInLine"] == 3
    assert third["courier"] == {"exact": True, "lat": 48.7301, "lon": 21.2588, "heading": 90}

    fifth = client.get(f"/api/track/{token_of(db, route['stops'][4]['barcode'])}").json()
    assert fifth["positionInLine"] == 5
    c = fifth["courier"]
    assert c["exact"] is False
    assert c["radiusM"] == 2000
    assert (c["lat"], c["lon"]) != (VAN_POS["lat"], VAN_POS["lon"])
    assert inside((c["lat"], c["lon"]), c["radiusM"], (VAN_POS["lat"], VAN_POS["lon"]))
    assert fifth["district"] == "Košice – sever"

    # nothing about other stops: no addresses, names or barcodes of other parcels
    allowed = {
        "status",
        "barcode",
        "district",
        "courierName",
        "positionInLine",
        "stopsAhead",
        "etaFrom",
        "etaTo",
        "destination",
        "courier",
        "updatedAt",
    }
    assert set(fifth) <= allowed
    text = str(fifth)
    for other in route["stops"][:4] + route["stops"][5:8]:
        assert other["barcode"] not in text
    own = db.execute(
        select(Parcel).where(Parcel.barcode == route["stops"][4]["barcode"])
    ).scalar_one()
    assert own.recipient_name not in text and own.address not in text

    # once the stops before are done, the customer moves up the line and sees the van exactly
    post_events(
        client,
        [
            {
                "routeId": route["routeId"],
                "kind": "delivered",
                "stopId": s["stopId"],
                "at": iso(at("08:00")),
            }
            for s in route["stops"][:2]
        ],
    )
    moved = client.get(f"/api/track/{token_of(db, route['stops'][4]['barcode'])}").json()
    assert moved["positionInLine"] == 3
    assert moved["courier"]["exact"] is True


@pytest.mark.usefixtures("seeded")
def test_failed_delivery_shows_no_courier(client: TestClient, db: Session, at: SetTime) -> None:
    route = courier_plan(client)[0]
    load_all(client, route, at("07:05"))
    stop = route["stops"][0]
    post_events(
        client,
        [
            {"routeId": route["routeId"], "kind": "departed", "at": iso(at("07:30"))},
            {
                "routeId": route["routeId"],
                "kind": "failed",
                "stopId": stop["stopId"],
                "at": iso(at("07:50")),
            },
        ],
    )
    body = client.get(f"/api/track/{token_of(db, stop['barcode'])}").json()
    assert body["status"] == "failed"
    assert "courier" not in body and "destination" not in body


# ------------------------------------------------------------------ rate limit


def poll_minute(client: TestClient, token: str) -> list[int]:
    """One customer window for a minute: the page polls every 5 s (TRACK_POLL_MS)."""
    return [client.get(f"/api/track/{token}").status_code for _ in range(12)]


def poll_windows(client: TestClient, tokens: list[str]) -> list[int]:
    """Several windows polling concurrently, one per token."""
    with ThreadPoolExecutor(len(tokens)) as pool:
        windows = pool.map(lambda t: poll_minute(client, t), tokens)
        return [code for window in windows for code in window]


@pytest.mark.usefixtures("seeded")
def test_track_open_windows_behind_one_ip_are_not_limited(
    client: TestClient, db: Session, at: SetTime
) -> None:
    route = courier_plan(client)[0]
    load_all(client, route, at("07:10"))
    tokens = [token_of(db, s["barcode"]) for s in route["stops"][:6]]
    at("07:20")
    # 5 customers with their own links at once (the demo: every client is one docker IP)
    assert poll_windows(client, tokens[1:]) == [200] * 60
    # one link open in 5 windows: 60/min per link
    assert poll_windows(client, [tokens[0]] * 5) == [200] * 60
    assert client.get(f"/api/track/{tokens[0]}").status_code == 429
    assert client.get(f"/api/track/{tokens[1]}").status_code == 200


@pytest.mark.usefixtures("seeded")
def test_track_guessing_is_limited_per_ip(client: TestClient, db: Session, at: SetTime) -> None:
    route = courier_plan(client)[0]
    load_all(client, route, at("07:10"))
    valid = token_of(db, route["stops"][0]["barcode"])
    at("07:20")
    codes = [client.get(f"/api/track/guess{i:02d}" + "B" * 36).status_code for i in range(11)]
    assert codes == [404] * 10 + [429]
    # blocked for valid links too: the limit must not tell which tokens exist
    assert client.get(f"/api/track/{valid}").status_code == 429

    # a client that is not the trusted proxy cannot dodge the limit with X-Forwarded-For
    direct = TestClient(ProxyHeadersMiddleware(create_app(), trusted_hosts="127.0.0.1"))
    spoofed = direct.get(f"/api/track/{valid}", headers={"X-Forwarded-For": "203.0.113.7"})
    assert spoofed.status_code == 429

    # behind a trusted proxy, another customer (X-Forwarded-For) is not affected
    proxied = TestClient(ProxyHeadersMiddleware(create_app(), trusted_hosts="testclient"))
    other = proxied.get(f"/api/track/{valid}", headers={"X-Forwarded-For": "203.0.113.7"})
    assert other.status_code == 200
    blocked = proxied.get(f"/api/track/{valid}", headers={"X-Forwarded-For": "testclient"})
    assert blocked.status_code == 429


# ------------------------------------------------------------------ courier screen


@pytest.mark.usefixtures("seeded")
def test_courier_sees_only_own_route_and_finishes_stops(
    client: TestClient, db: Session, at: SetTime
) -> None:
    routes = courier_plan(client)
    mine, other = routes[0], routes[1]
    at("07:00")
    courier_login(client, "kurier01")

    resp = client.get("/api/courier/route?courier=kurier02")  # ignored for a courier
    assert resp.status_code == 200
    body = resp.json()
    assert body["courierUsername"] == "kurier01"
    assert body["vehiclePlate"] == "KE-301KR"
    assert len(body["stopList"]) == len(mine["stops"])
    assert body["vehicle"]["lat"] == VAN_POS["lat"]

    first = mine["stops"][0]["stopId"]
    # not in the van yet
    assert (
        client.post(f"/api/courier/stops/{first}", json={"outcome": "delivered"}).status_code == 409
    )
    # someone else's stop
    resp = client.post(
        f"/api/courier/stops/{other['stops'][0]['stopId']}", json={"outcome": "delivered"}
    )
    assert resp.status_code == 403

    load_all(client, mine, at("07:10"))
    token = token_of(db, mine["stops"][0]["barcode"])
    at("08:15")
    ok = client.post(f"/api/courier/stops/{first}", json={"outcome": "delivered"})
    assert ok.status_code == 200, ok.text
    assert ok.json()["outcome"] == "delivered"
    assert client.post(f"/api/courier/stops/{first}", json={"outcome": "failed"}).status_code == 409
    assert client.get(f"/api/track/{token}").json()["status"] == "delivered"

    # the simulator reporting the same stop later does not overwrite the courier's result
    out = post_events(
        client,
        [{"routeId": mine["routeId"], "kind": "failed", "stopId": first, "at": iso(at("09:00"))}],
    )
    assert out["ignored"] == 1
    stop = db.get(RouteStop, first)
    assert stop is not None
    db.refresh(stop)
    assert stop.outcome == "delivered"

    second = mine["stops"][1]["stopId"]
    failed = client.post(f"/api/courier/stops/{second}", json={"outcome": "failed"})
    assert failed.json()["parcelStatus"] == "failed_delivery"
    summary = client.get("/api/courier/routes").json()
    assert [(r["delivered"], r["failed"]) for r in summary] == [(1, 1)]


@pytest.mark.usefixtures("seeded")
def test_courier_screen_rbac(
    client: TestClient, make_user: Callable[..., Any], at: SetTime
) -> None:
    at("07:00")
    make_user("op", role=UserRole.OPERATOR)
    assert (
        client.post(
            "/api/auth/login", json={"username": "op", "password": "spravne-heslo-123"}
        ).status_code
        == 200
    )
    assert client.get("/api/courier/route").status_code == 403
    client.post("/api/auth/logout")
    make_user("disp", role=UserRole.DISPATCHER)
    client.post("/api/auth/login", json={"username": "disp", "password": "spravne-heslo-123"})
    assert client.get("/api/courier/route?courier=kurier03").json()["districtCode"] == "KE-03"
    assert client.post("/api/courier/stops/1", json={"outcome": "delivered"}).status_code == 403


@pytest.mark.usefixtures("seeded")
def test_paired_scanner_loads_before_departure_then_selects_the_stop(
    client: TestClient, db: Session, at: SetTime
) -> None:
    mine, other = courier_plan(client)[0], courier_plan(client)[1]
    at("07:05")
    courier_login(client, "kurier01")
    route = client.get("/api/courier/route").json()
    assert route["stagingBay"] == "SB-01" and route["loaded"] == 0
    assert route["plannedDeparture"].startswith(f"{DELIVERY.isoformat()}T07:30")
    stop = route["stopList"][0]
    assert stop["deliveryType"] in {"handover", "mailbox", "locker"}
    if stop["deliveryType"] == "handover":
        assert stop["windowFrom"] < stop["windowTo"]
    else:
        assert stop["windowFrom"] is None

    barcode = mine["stops"][0]["barcode"]
    # at night the parcel is still on the belts: no loading, no SMS to the customer
    at("06:29")
    assert client.post("/api/courier/scan", json={"barcode": barcode}).status_code == 409
    at("06:35")  # loading starts at 06:30 (phase 7b)
    first = client.post("/api/courier/scan", json={"barcode": barcode.lower()})
    assert first.status_code == 200, first.text
    assert first.json()["action"] == "loaded"
    assert first.json()["stop"]["parcelStatus"] == "out_for_delivery"
    assert token_of(db, barcode)  # the customer got the tracking SMS
    again = client.post("/api/courier/scan", json={"barcode": barcode}).json()
    assert again["action"] == "selected" and again["stop"]["id"] == mine["stops"][0]["stopId"]
    assert client.get("/api/courier/route").json()["loaded"] == 1

    foreign = client.post("/api/courier/scan", json={"barcode": other["stops"][0]["barcode"]})
    assert foreign.status_code == 404
    assert client.post("/api/courier/scan", json={"barcode": "DP000"}).status_code == 404

    # after the departure a parcel left at the bay is not loaded any more
    post_events(
        client,
        [{"routeId": mine["routeId"], "kind": "departed", "stopId": None, "at": iso(at("07:35"))}],
    )
    left_behind = client.post("/api/courier/scan", json={"barcode": mine["stops"][1]["barcode"]})
    assert left_behind.status_code == 409

    client.post(f"/api/courier/stops/{mine['stops'][0]['stopId']}", json={"outcome": "delivered"})
    assert client.post("/api/courier/scan", json={"barcode": barcode}).json()["action"] == "done"

    client.post("/api/auth/logout")
    client.post(
        "/api/auth/login", json={"username": "dispecer", "password": "dispatcher-test-heslo"}
    )
    assert client.post("/api/courier/scan", json={"barcode": barcode}).status_code == 403


# ------------------------------------------------------------------ admin notifications, reset


@pytest.mark.usefixtures("seeded")
def test_notifications_are_admin_only(client: TestClient, at: SetTime) -> None:
    route = courier_plan(client)[0]
    load_all(client, route, at("07:05"))
    courier_login(client)
    assert client.get("/api/admin/notifications").status_code == 403
    client.post("/api/auth/logout")
    client.post("/api/auth/login", json={"username": "admin", "password": "admin-test-heslo"})
    notes = client.get("/api/admin/notifications?limit=5").json()
    assert len(notes) == 5
    assert notes[0]["link"].startswith("http://localhost:8000/track/")
    assert "Kuriér Tomáš" in notes[0]["message"]
    # Depot 5.0 branding (ADR-044): no SPS in the SMS or in new barcodes
    assert notes[0]["message"].startswith("Depot 5.0: Váš balík DP")
    one = client.get(f"/api/admin/notifications?q={route['stops'][0]['barcode']}").json()
    assert [n["barcode"] for n in one] == [route["stops"][0]["barcode"]]


@pytest.mark.usefixtures("seeded")
def test_reset_day_restores_routes_and_removes_links(
    client: TestClient, db: Session, at: SetTime
) -> None:
    route = courier_plan(client)[0]
    load_all(client, route, at("07:05"))
    post_events(client, [{"routeId": route["routeId"], "kind": "departed", "at": iso(at("07:30"))}])
    result = reset_operating_day(db, DAY)
    assert result["courierRoutes"] == 8 + 4 + 3  # Budimír, Žilina and Ivanka
    assert db.execute(select(TrackingToken)).first() is None
    assert db.execute(select(CustomerNotification)).first() is None
    r = db.get(CourierRoute, route["routeId"])
    assert r is not None and r.departed_at is None
    assert (
        db.execute(select(Parcel).where(Parcel.status == ParcelStatus.OUT_FOR_DELIVERY)).first()
        is None
    )


def test_districts_are_balanced_by_address_density() -> None:
    points = addresses().get("Košice")
    if not points:
        pytest.skip("address file missing")
    counts = Counter(kosice_rajon(p[3], p[4]) for p in points)
    assert sorted(counts) == [f"KE-{i:02d}" for i in range(1, 9)]
    assert max(counts.values()) / min(counts.values()) < 1.02
