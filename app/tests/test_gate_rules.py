"""Decisions at the gate (ADR-061): every branch of the rules through HTTP, security decisions
with the audit, allowed external plates and the day reset."""

from datetime import datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from conftest import MakeUser, login
from depotrack.models import Alert, GateAudit, GateEvent
from depotrack.models.enums import UserRole
from depotrack.services.gate import close_stale_events
from test_wms import DAY, TOKEN, at_time, local, seeded

__all__ = ["at_time", "seeded"]

FLEET_VAN, FLEET_TRUCK, ALLOWED_CAR = "KE-301KR", "KE-102LH", "PO-215CL"


def passage(key: str, at: datetime, **kw: Any) -> dict[str, Any]:
    return {
        "key": key,
        "at": at.isoformat(),
        "direction": "in",
        "vehicleType": "car",
        "vehicleConfidence": 0.9,
        "plate": None,
        "plateConfidence": None,
    } | kw


def send(client: TestClient, *passages: dict[str, Any]) -> Any:
    res = client.post("/internal/events/gate", json={"passages": list(passages)}, headers=TOKEN)
    assert res.status_code == 200, res.text
    return res.json()


def event(db: Session, plate: str | None = None, key: str | None = None) -> GateEvent:
    q = select(GateEvent)
    q = q.where(GateEvent.external_key == key) if key else q.where(GateEvent.plate == plate)
    return db.execute(q.order_by(GateEvent.id.desc()).limit(1)).scalar_one()


@pytest.fixture
def guard(client: TestClient, make_user: MakeUser) -> TestClient:
    make_user("gate", UserRole.SECURITY)
    assert login(client, "gate") == 200
    return client


@pytest.mark.usefixtures("seeded", "at_time")
@pytest.mark.parametrize(
    ("kw", "decision", "reason"),
    [
        (
            {"vehicleType": "van", "plate": FLEET_VAN, "plateConfidence": 0.95},
            "auto_pass",
            "fleet_vehicle",
        ),
        (
            {"vehicleType": "truck", "plate": FLEET_TRUCK, "plateConfidence": 0.95},
            "auto_pass",
            "fleet_vehicle",
        ),
        (
            {"vehicleType": "car", "plate": ALLOWED_CAR, "plateConfidence": 0.9},
            "auto_pass",
            "allowed_plate",
        ),
        (
            {"vehicleType": "truck", "plate": "TT-482XA", "plateConfidence": 0.9},
            "pass_verify",
            "truck_unknown_plate",
        ),
        ({"vehicleType": "truck", "plate": None}, "pass_verify", "truck_no_plate"),
        (
            {"vehicleType": "car", "plate": "ZA-999XY", "plateConfidence": 0.9},
            "hold",
            "unknown_plate",
        ),
        ({"vehicleType": "van", "plate": None}, "hold", "no_plate"),
        # no vehicle in the picture counts as confidence 0, even for a fleet plate
        ({"vehicleType": None, "plate": FLEET_VAN, "plateConfidence": 0.95}, "hold", "no_vehicle"),
        # a passenger car on a fleet plate looks like a cloned plate
        (
            {"vehicleType": "car", "plate": FLEET_VAN, "plateConfidence": 0.95},
            "hold",
            "type_mismatch",
        ),
        ({"vehicleType": "van", "plate": FLEET_VAN}, "hold", "low_plate_confidence"),
        # low confidence: security decides even for a fleet plate
        (
            {"vehicleType": "van", "plate": FLEET_VAN, "plateConfidence": 0.6},
            "hold",
            "low_plate_confidence",
        ),
        (
            {
                "vehicleType": "truck",
                "vehicleConfidence": 0.3,
                "plate": FLEET_TRUCK,
                "plateConfidence": 0.95,
            },
            "hold",
            "low_vehicle_confidence",
        ),
    ],
)
def test_rules_decide_every_branch(
    client: TestClient, db: Session, kw: dict[str, Any], decision: str, reason: str
) -> None:
    body = send(client, passage("k1", local(18, 0), **kw))
    assert body["decisions"] == {decision: 1}
    e = event(db, key="k1")
    assert (e.decision, e.reason, e.source) == (decision, reason, "sim")
    audit = db.execute(select(GateAudit).where(GateAudit.event_id == e.id)).scalar_one()
    assert (audit.actor_id, audit.action, audit.reason) == (None, decision, reason)
    alert = db.execute(select(Alert).where(Alert.ref_type == "gate")).scalar_one_or_none()
    assert (alert is not None) == (decision == "hold")


@pytest.mark.usefixtures("seeded", "at_time")
def test_resend_is_ignored_and_exit_after_allowed_entry_passes(
    client: TestClient, guard: TestClient, db: Session
) -> None:
    car = {"vehicleType": "car", "plate": "ZA-999XY", "plateConfidence": 0.9}
    send(client, passage("in1", local(16, 0), **car))
    assert send(client, passage("in1", local(16, 0), **car))["duplicates"] == 1
    held = event(db, key="in1")
    res = guard.post(
        f"/api/gate/events/{held.id}/decision",
        json={"action": "allow", "note": "kuriér na návšteve"},
    )
    assert res.status_code == 200, res.text
    out = send(client, passage("out1", local(17, 0), direction="out", **car))
    assert out["decisions"] == {"auto_pass": 1}
    assert event(db, key="out1").reason == "exit_after_entry"

    # a denied car that turns around at the gate is not "leaving after entry"
    other = {"vehicleType": "car", "plate": "KS-455HK", "plateConfidence": 0.9}
    send(client, passage("in2", local(16, 20), **other))
    denied = event(db, key="in2")
    guard.post(
        f"/api/gate/events/{denied.id}/decision", json={"action": "deny", "note": "bez povolenia"}
    )
    assert send(client, passage("out2", local(16, 25), direction="out", **other))["decisions"] == {
        "hold": 1
    }


@pytest.mark.usefixtures("seeded", "at_time")
def test_security_decides_from_the_queue_with_audit(
    client: TestClient, guard: TestClient, db: Session, make_user: MakeUser
) -> None:
    send(
        client,
        passage("h", local(16, 0), vehicleType="car", plate="ZA-999XY", plateConfidence=0.9),
        passage("v", local(16, 5), vehicleType="truck", plate=None),
        passage("ok", local(16, 10), vehicleType="van", plate=FLEET_VAN, plateConfidence=0.95),
    )
    queue = guard.get("/api/gate/queue").json()
    assert [(q["decision"], q["plate"]) for q in queue] == [
        ("hold", "ZA-999XY"),
        ("pass_verify", None),
    ]
    hold_id, verify_id = queue[0]["id"], queue[1]["id"]

    decide = lambda i, **b: guard.post(f"/api/gate/events/{i}/decision", json=b)  # noqa: E731
    assert decide(hold_id, action="deny").status_code == 422  # a note is required
    assert decide(hold_id, action="verify", note="x").status_code == 409  # not for a held car
    res = decide(hold_id, action="deny", note="bez objednávky, odkázaný na recepciu")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["resolution"] == "denied" and body["resolvedBy"] == "Test gate"
    assert [(a["actor"], a["action"]) for a in body["audit"]] == [
        (None, "hold"),
        ("Test gate", "denied"),
    ]
    assert body["audit"][1]["reason"] == "bez objednávky, odkázaný na recepciu"
    alert = db.execute(select(Alert).where(Alert.ref_type == "gate")).scalar_one()
    db.refresh(alert)
    assert alert.acknowledged_at is not None
    assert decide(hold_id, action="allow", note="znova").status_code == 409  # already decided

    verified = decide(verify_id, action="verify").json()
    assert verified["resolution"] == "verified" and verified["note"] == "overené ochrankou"
    assert guard.get("/api/gate/queue").json() == []
    events = guard.get("/api/gate/events").json()
    assert {e["resolution"] for e in events} == {"denied", "verified", None}
    assert decide(999999, action="verify").status_code == 404

    make_user("disp", UserRole.DISPATCHER)
    login(client, "disp")
    assert client.get("/api/gate/queue").status_code == 403
    assert client.get("/api/gate/events").status_code == 403
    assert decide(verify_id, action="verify").status_code == 403
    assert client.get("/api/gate/allowed-plates").status_code == 403
    assert (
        client.post(
            "/api/gate/allowed-plates", json={"plate": "BA-123CD", "holder": "x y"}
        ).status_code
        == 403
    )
    assert client.delete("/api/gate/allowed-plates/1").status_code == 403
    # internal endpoint: service token only
    assert client.post("/internal/events/gate", json={"passages": []}).status_code == 401


@pytest.mark.usefixtures("seeded", "at_time")
def test_allowed_plates_are_managed_by_security(client: TestClient, guard: TestClient) -> None:
    plates = guard.get("/api/gate/allowed-plates").json()
    assert ALLOWED_CAR in {p["plate"] for p in plates}
    res = guard.post(
        "/api/gate/allowed-plates", json={"plate": "sk ba 123 cd", "holder": "Kuriér DHL"}
    )
    assert res.status_code == 201, res.text
    assert res.json()["plate"] == "BA-123CD"
    dup = guard.post("/api/gate/allowed-plates", json={"plate": "BA-123CD", "holder": "x y"})
    assert dup.status_code == 409
    bad = guard.post("/api/gate/allowed-plates", json={"plate": "hello", "holder": "x y"})
    assert bad.status_code == 422
    plate = {"vehicleType": "car", "plate": "BA-123CD", "plateConfidence": 0.9}
    assert send(client, passage("a", local(16, 0), **plate))["decisions"] == {"auto_pass": 1}
    pid = res.json()["id"]
    assert guard.delete(f"/api/gate/allowed-plates/{pid}").status_code == 204
    assert "BA-123CD" not in {p["plate"] for p in guard.get("/api/gate/allowed-plates").json()}
    assert send(client, passage("b", local(16, 30), **plate))["decisions"] == {"hold": 1}
    # the earlier passage keeps its holder after the removal (logical delete)
    first = guard.get("/api/gate/events").json()
    assert [e["allowedHolder"] for e in first if e["plate"] == "BA-123CD"] == [None, "Kuriér DHL"]
    # added again: allowed again
    again = guard.post(
        "/api/gate/allowed-plates", json={"plate": "BA-123CD", "holder": "Kuriér GLS"}
    )
    assert again.status_code == 201 and again.json()["id"] == pid
    expired = guard.post(
        "/api/gate/allowed-plates",
        json={
            "plate": "BA-777CD",
            "holder": "stará zmluva",
            "validUntil": (DAY - timedelta(days=2)).isoformat(),
        },
    )
    assert expired.status_code == 201
    plate["plate"] = "BA-777CD"
    assert send(client, passage("c", local(16, 40), **plate))["decisions"] == {"hold": 1}


@pytest.mark.usefixtures("seeded", "at_time")
def test_day_reset_removes_passages_and_old_holds_expire(client: TestClient, db: Session) -> None:
    car = {"vehicleType": "car", "plate": "ZA-999XY", "plateConfidence": 0.9}
    send(client, passage("old", local(16, 0, DAY - timedelta(days=2)), **car))
    send(client, passage("now", local(16, 0), **car))
    assert close_stale_events(db, DAY) == 1
    db.commit()
    old = event(db, key="old")
    assert old.resolution == "expired"
    assert [
        a.action
        for a in db.execute(select(GateAudit).where(GateAudit.event_id == old.id)).scalars()
    ] == ["hold", "expired"]
    db.add(
        GateEvent(
            at=local(17, 0), source="camera", direction="in", vehicle_type="car",
            vehicle_confidence=0.9, decision="hold", reason="unknown_plate",
        )
    )  # fmt: skip
    db.commit()
    res = client.post(f"/internal/days/{DAY.isoformat()}/reset", headers=TOKEN)
    assert res.status_code == 200 and res.json()["gateEvents"] == 1
    # the simulated passage of the day goes (the replay sends it again), the camera one stays
    assert sorted(db.execute(select(GateEvent.source)).scalars().all()) == ["camera", "sim"]
    assert (
        db.execute(select(GateEvent.external_key).where(GateEvent.source == "sim")).scalar_one()
        == "old"
    )


@pytest.mark.usefixtures("seeded", "at_time")
def test_every_depot_has_its_own_gate(client: TestClient, guard: TestClient, db: Session) -> None:
    """Phase 7c: the simulator sends the passages of the Žilina gate with depot ZIL."""
    send(
        client,
        passage("bud", local(16, 0), vehicleType="car", plate="ZA-999XY", plateConfidence=0.9),
    )
    zil = passage("zil", local(16, 5), vehicleType="van", plate="ZA-301KR", plateConfidence=0.95)
    assert send(client, zil | {"depot": "ZIL"})["decisions"] == {"auto_pass": 1}  # a Žilina van
    events = guard.get("/api/gate/events?depot=ZIL").json()
    assert [(e["plate"], e["depot"]) for e in events] == [("ZA-301KR", "ZIL")]
    assert [e["depot"] for e in guard.get("/api/gate/queue?depot=BUD").json()] == ["BUD"]
    assert guard.get("/api/gate/queue?depot=ZIL").json() == []
    assert guard.get("/api/gate/events?depot=XX").status_code == 404
    # an unknown car at the Žilina gate: the alarm names the gate and shows in Žilina's shadow only
    car = passage(
        "zilcar", local(16, 10), vehicleType="car", plate="TT-123AB", plateConfidence=0.9
    )
    assert send(client, car | {"depot": "ZIL"})["decisions"] == {"hold": 1}
    alert = db.execute(select(Alert).where(Alert.message.contains("TT-123AB"))).scalar_one()
    assert alert.message.startswith("Brána Žilina:")
    in_shadow = {
        d: [a["message"] for a in guard.get(f"/api/shadow/{d}").json()["alerts"]]
        for d in ("ZIL", "BUD")
    }
    assert any("TT-123AB" in m for m in in_shadow["ZIL"])
    assert not any("TT-123AB" in m for m in in_shadow["BUD"])
    assert any("ZA-999XY" in m for m in in_shadow["BUD"])  # Budimír's own gate alarm, old text
    # a passage of a depot that does not exist: 422 for the batch, not a 500 resent forever
    bad = {"passages": [car | {"key": "x", "depot": "XX"}]}
    res = client.post("/internal/events/gate", json=bad, headers=TOKEN)
    assert res.status_code == 422
