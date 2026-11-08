"""Sorting lines (phase 7d step 5d, ADR-071): graphs in the layout, checkpoint passages as
parcel events, the timeline shows them."""

from datetime import date, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from conftest import MakeUser, login
from depotrack.core.clock import TZ
from depotrack.core.config import get_settings
from depotrack.models import Direction, Parcel, ParcelEvent
from depotrack.models.enums import ParcelStatus, UserRole
from depotrack.seed.depots import built_depots
from depotrack.services.operating_day import reset_operating_day, run_seed

DAY = date(2026, 10, 23)
TOKEN = {"X-Service-Token": "test-service-token"}


def local(hh: int, mm: int, day: date = DAY) -> datetime:
    return datetime(day.year, day.month, day.day, hh, mm, tzinfo=TZ)


@pytest.fixture(autouse=True)
def seeded(db: Session) -> None:
    run_seed(db, get_settings(), DAY)


def parcel_of(db: Session, code: str) -> Parcel:
    return db.execute(
        select(Parcel)
        .join(Direction, Parcel.direction_id == Direction.id)
        .where(Direction.code == code)
        .order_by(Parcel.barcode)
        .limit(1)
    ).scalar_one()


def events_of(db: Session, parcel: Parcel) -> list[ParcelEvent]:
    db.expire_all()
    return list(
        db.execute(
            select(ParcelEvent)
            .where(ParcelEvent.parcel_id == parcel.id)
            .order_by(ParcelEvent.at, ParcelEvent.id)
        ).scalars()
    )


def test_every_line_is_a_connected_graph_with_both_variants_only_in_budimir() -> None:
    for code, built in built_depots().items():
        line = built.layout["line"]
        assert isinstance(line, dict)
        variants = line["variants"]
        assert set(variants) == ({"current", "proposal"} if code == "BUD" else {"current"})
        for g in variants.values():
            ids = {n["id"] for n in g["nodes"]}
            assert len(ids) == len(g["nodes"])
            for e in g["edges"]:
                assert e["from"] in ids and e["to"] in ids, (code, e)
                assert e["length"] > 0 and e["speed"] > 0
            # every staging place is reached by something, every input leads somewhere
            targets = {e["to"] for e in g["edges"]}
            sources = {e["from"] for e in g["edges"]}
            for n in g["nodes"]:
                if n["kind"] == "staging":
                    assert n["id"] in targets, (code, n["id"])
                if n["kind"] == "input":
                    assert n["id"] in sources, (code, n["id"])
    bud = built_depots()["BUD"].layout["line"]
    assert isinstance(bud, dict)
    current = {n["id"]: n for n in bud["variants"]["current"]["nodes"]}
    proposal = {n["id"]: n for n in bud["variants"]["proposal"]["nodes"]}
    # the same inputs in both variants (the proposal starts the parcel where it started)
    assert {k for k, n in current.items() if n["kind"] == "input"} == {
        k for k, n in proposal.items() if n["kind"] == "input"
    }
    assert current["SC"]["checkpoint"] == "LINE-SCN-01" and current["SC"]["kind"] == "scanner"
    assert proposal["SC"]["kind"] == "tunnel" and "MAN" not in proposal and "DK" in proposal


def test_lines_for_the_simulator_need_the_service_token(client: TestClient) -> None:
    assert client.get("/internal/lines").status_code in (401, 403)
    body = client.get("/internal/lines", headers=TOKEN).json()
    assert set(body["depots"]["BUD"]["variants"]) == {"current", "proposal"}
    assert body["doorDirections"]["LD-02"] == "BA"
    assert body["doorDirections"]["SB-01"] == "KE-01"


def test_passages_become_events_with_the_status_of_that_time_once(
    client: TestClient, db: Session
) -> None:
    ba = parcel_of(db, "BA")
    at = local(18, 30)
    body = {
        "passages": [
            {"checkpoint": "CP-BUD-ZB", "barcode": ba.barcode, "at": at.isoformat()},
            {
                "checkpoint": "LINE-SCN-01",
                "barcode": ba.barcode,
                "at": (at + timedelta(seconds=40)).isoformat(),
            },
            {"checkpoint": "LINE-SCN-01", "barcode": "NOPE-0000", "at": at.isoformat()},
        ]
    }
    first = client.post("/internal/events/checkpoints", json=body, headers=TOKEN).json()
    assert first == {"stored": 2, "skipped": 1}
    # a restart of telematics sends them again: nothing doubles
    again = client.post("/internal/events/checkpoints", json=body, headers=TOKEN).json()
    assert again == {"stored": 0, "skipped": 3}
    marked = [e for e in events_of(db, ba) if e.checkpoint]
    assert [e.checkpoint for e in marked] == ["CP-BUD-ZB", "LINE-SCN-01"]
    assert all(e.status == ParcelStatus.COLLECTED for e in marked)
    db.refresh(ba)
    assert ba.status == ParcelStatus.COLLECTED  # a passage changes no status


def test_line_scan_marks_its_checkpoint_and_the_timeline_names_it(
    client: TestClient, db: Session, make_user: MakeUser
) -> None:
    mi = parcel_of(db, "MI")
    scan = {
        "device": "LINE-SCN-01",
        "doorCode": None,
        "at": local(2, 0, DAY + timedelta(days=1)).isoformat(),
        "barcode": mi.barcode,
        "readOk": True,
    }
    assert (
        client.post("/internal/events/scans", json={"scans": [scan]}, headers=TOKEN).status_code
        == 200
    )
    on_belt = [e for e in events_of(db, mi) if e.status == ParcelStatus.ON_BELT]
    assert [e.checkpoint for e in on_belt] == ["LINE-SCN-01"]
    make_user("disp", UserRole.DISPATCHER)
    assert login(client, "disp") == 200
    detail = client.get(f"/api/parcels/{mi.id}").json()
    step = next(e for e in detail["events"] if e["status"] == "on_belt")
    assert step["checkpoint"] == "LINE-SCN-01"
    assert step["checkpointLabel"] == "Skener na mostíku"
    located = client.get(f"/api/shadow/parcels/{mi.barcode}").json()
    assert any(e["checkpointLabel"] == "Skener na mostíku" for e in located["events"])


def test_reset_of_the_day_removes_the_passages(client: TestClient, db: Session) -> None:
    ba = parcel_of(db, "BA")
    body = {
        "passages": [
            {"checkpoint": "CP-BUD-ZB", "barcode": ba.barcode, "at": local(18, 0).isoformat()}
        ]
    }
    assert (
        client.post("/internal/events/checkpoints", json=body, headers=TOKEN).json()["stored"] == 1
    )
    reset_operating_day(db, DAY)
    db.commit()
    assert [e for e in events_of(db, ba) if e.checkpoint] == []
    assert [e.status for e in events_of(db, ba)] == [ParcelStatus.COLLECTED]
