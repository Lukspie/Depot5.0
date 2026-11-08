"""Depot 5.0 as a product for a network of depots (phase 7d, ADR-068): every user has a home
depot, admins and dispatchers may switch, the other roles see only their own depot. Each rule
through HTTP, for each role."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from conftest import MakeUser, login
from depotrack.models import Depot, Direction, GateEvent, Parcel, User
from depotrack.models.enums import UserRole
from test_gate_rules import passage, send
from test_wms import at_time, local, seeded

__all__ = ["at_time", "seeded"]


def depot_id(db: Session, code: str) -> int:
    return db.execute(select(Depot.id).where(Depot.code == code)).scalar_one()


def user_at(db: Session, make_user: MakeUser, name: str, role: UserRole, depot: str) -> User:
    user = make_user(name, role)
    user.home_depot_id = depot_id(db, depot)
    db.commit()
    return user


def as_user(client: TestClient, name: str) -> TestClient:
    client.post("/api/auth/logout")
    assert login(client, name) == 200
    return client


@pytest.mark.usefixtures("seeded")
def test_seed_gives_every_user_a_home_depot(db: Session) -> None:
    home = {
        u.username: u.home_depot_code
        for u in db.execute(select(User)).scalars()
        if u.username in ("kurier01", "kurierza01", "kurierba01", "dispecer", "ochranka", "admin")
    }
    assert home == {
        "kurier01": "BUD",
        "kurierza01": "ZIL",
        "kurierba01": "BAH",
        "dispecer": "BUD",
        "ochranka": "BUD",
        "admin": "BUD",
    }


@pytest.mark.usefixtures("seeded", "at_time")
def test_dispatcher_switches_every_depot(
    client: TestClient, db: Session, make_user: MakeUser
) -> None:
    user_at(db, make_user, "disp", UserRole.DISPATCHER, "BUD")
    c = as_user(client, "disp")
    me = c.get("/api/auth/me").json()
    assert me["home_depot"] == "BUD" and me["can_switch_depot"] is True
    assert me["depots"] == ["BUD", "BAH", "ZIL", "DS", "TN"]
    for code in me["depots"]:
        assert c.get(f"/api/shadow/{code}").status_code == 200
        assert c.get(f"/api/layout?depot={code}").json()["depot"]["code"] == code
        assert c.get(f"/api/shell?depot={code}").status_code == 200
    assert c.get("/api/shadow/XX").status_code == 404
    # search in Žilina: the parcels of the ZA truck, not the Košice districts
    za = (
        db.execute(
            select(Parcel)
            .join(Direction, Parcel.direction_id == Direction.id)
            .where(Direction.code == "ZA")
        )
        .scalars()
        .first()
    )
    ke = (
        db.execute(
            select(Parcel)
            .join(Direction, Parcel.direction_id == Direction.id)
            .where(Direction.code == "KE-01")
        )
        .scalars()
        .first()
    )
    assert za is not None and ke is not None
    hits = c.get(f"/api/search?q={za.barcode}&depot=ZIL").json()["hits"]
    assert [h["key"] for h in hits if h["kind"] == "parcel"] == [za.barcode]
    assert c.get(f"/api/search?q={ke.barcode}&depot=ZIL").json()["hits"] == []
    assert any(
        h["key"] == ke.barcode
        for h in c.get(f"/api/search?q={ke.barcode}&depot=BUD").json()["hits"]
    )
    # courier rounds of one depot
    routes = c.get("/api/courier/routes?day=2026-10-24&depot=ZIL").json()
    assert routes and all(r["districtCode"].startswith("ZA-") for r in routes)


@pytest.mark.usefixtures("seeded", "at_time")
def test_guard_sees_only_the_gate_and_shadow_of_their_depot(
    client: TestClient, db: Session, make_user: MakeUser
) -> None:
    send(
        client,
        passage("bud", local(16, 0), plate="TT-111AB", plateConfidence=0.9),
        passage("zil", local(16, 5), plate="TT-222AB", plateConfidence=0.9) | {"depot": "ZIL"},
    )
    user_at(db, make_user, "guard-za", UserRole.SECURITY, "ZIL")
    c = as_user(client, "guard-za")
    me = c.get("/api/auth/me").json()
    assert me["depots"] == ["ZIL"] and me["can_switch_depot"] is False
    # gate: the queue and the passages of Žilina only, another depot's gate is forbidden
    assert [e["plate"] for e in c.get("/api/gate/queue").json()] == ["TT-222AB"]
    assert {e["depot"] for e in c.get("/api/gate/events").json()} == {"ZIL"}
    assert c.get("/api/gate/queue?depot=BUD").status_code == 403
    bud_event = db.execute(select(GateEvent).where(GateEvent.plate == "TT-111AB")).scalar_one()
    res = c.post(
        f"/api/gate/events/{bud_event.id}/decision", json={"action": "allow", "note": "známy"}
    )
    assert res.status_code == 403
    # shadow and layout of Žilina only
    assert c.get("/api/shadow/ZIL").status_code == 200
    assert c.get("/api/shadow/BUD").status_code == 403
    assert c.get("/api/layout").json()["depot"]["code"] == "ZIL"
    assert c.get("/api/layout?depot=BUD").status_code == 403
    assert c.get("/api/depots/BUD/state").status_code == 403
    # alerts: the held car at the Žilina gate, not the one at Budimír
    messages = [a["message"] for a in c.get("/api/alerts").json()["alerts"]]
    assert any("TT-222AB" in m for m in messages) and not any("TT-111AB" in m for m in messages)
    assert c.get("/api/alerts?depot=BUD").status_code == 403
    shell = c.get("/api/shell").json()
    assert shell["gateQueue"] == 1 and shell["openAlerts"] == 1
    assert c.get("/api/shell?depot=BUD").status_code == 403
    # search: vehicles of Žilina only
    assert [h["key"] for h in c.get("/api/search?q=ZA-30").json()["hits"]] == [
        f"ZA-30{i}KR" for i in range(1, 5)
    ]
    assert c.get("/api/search?q=KE-30").json()["hits"] == []
    assert c.get("/api/search?q=KE&depot=BUD").status_code == 403
    # a parcel of another depot cannot be located
    ke = (
        db.execute(
            select(Parcel)
            .join(Direction, Parcel.direction_id == Direction.id)
            .where(Direction.code == "KE-01")
        )
        .scalars()
        .first()
    )
    assert ke is not None
    assert c.get(f"/api/shadow/parcels/{ke.barcode}").status_code == 403


@pytest.mark.usefixtures("seeded", "at_time")
def test_operator_loads_only_at_the_doors_of_their_depot(
    client: TestClient, db: Session, make_user: MakeUser
) -> None:
    user_at(db, make_user, "op-za", UserRole.OPERATOR, "ZIL")
    c = as_user(client, "op-za")
    doors = [d["code"] for d in c.get("/api/loading/doors").json()]
    assert doors and all(d.startswith("ZI-R") for d in doors)
    assert c.get("/api/loading/doors?depot=BUD").status_code == 403
    assert c.get("/api/loading/doors/LD-01").status_code == 403
    assert c.post("/api/loading/doors/LD-01/scan", json={"barcode": "DP1"}).status_code == 403
    # the search finds the doors of Žilina, nothing of Budimír
    assert {h["kind"] for h in c.get("/api/search?q=ZI-R").json()["hits"]} == {"door"}
    assert c.get("/api/search?q=LD-0").json()["hits"] == []


@pytest.mark.usefixtures("seeded", "at_time")
def test_courier_and_admin(client: TestClient, db: Session, make_user: MakeUser) -> None:
    # the seeded couriers have the password of the environment; a test courier instead
    user_at(db, make_user, "kur-za", UserRole.COURIER, "ZIL")
    c = as_user(client, "kur-za")
    me = c.get("/api/auth/me").json()
    assert me["home_depot"] == "ZIL" and me["depots"] == ["ZIL"]
    assert c.get("/api/search?q=ZA").status_code == 403  # couriers have no search
    assert c.get("/api/layout?depot=BUD").status_code == 403
    # the admin sets the home depot in user management
    make_user("adm", UserRole.ADMIN)
    a = as_user(client, "adm")
    created = a.post(
        "/api/admin/users",
        json={
            "username": "op-ba",
            "full_name": "Ivan Novák",
            "role": "operator",
            "password": "heslo-12345",
            "home_depot": "BAH",
        },
    )
    assert created.status_code == 201 and created.json()["home_depot"] == "BAH"
    uid = created.json()["id"]
    assert (
        a.patch(f"/api/admin/users/{uid}", json={"home_depot": "ZIL"}).json()["home_depot"] == "ZIL"
    )
    assert a.patch(f"/api/admin/users/{uid}", json={"home_depot": "XX"}).status_code == 422
    assert {u["username"]: u["home_depot"] for u in a.get("/api/admin/users").json()}[
        "op-ba"
    ] == "ZIL"
