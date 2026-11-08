"""Passages of parcels through the checkpoints of the sorting line (phase 7d step 5d, ADR-071).

Telematics simulates the passages (current variant only, the proposal is never stored) and sends
them here; they become parcel events with the checkpoint, so the timeline of a parcel shows where
on the line it was. A passage does not change the status: the event carries the status the parcel
had at that time. Scans that already make an event (line scanner in the morning, dock scanners)
get their checkpoint there and are not sent again.
"""

from dataclasses import dataclass
from datetime import datetime
from functools import cache

from sqlalchemy import select, tuple_
from sqlalchemy.orm import Session

from depotrack.models import Parcel, ParcelEvent
from depotrack.models.enums import EventSource
from depotrack.seed.depots import built_depots


@dataclass(frozen=True)
class Passage:
    checkpoint: str
    barcode: str
    at: datetime


def record_passages(db: Session, passages: list[Passage]) -> tuple[int, int]:
    """Store passages as parcel events; returns (stored, skipped). Idempotent: a passage resent
    after a restart of telematics (same parcel, checkpoint and time) is skipped."""
    if not passages:
        return 0, 0
    parcels = {
        p.barcode: p
        for p in db.execute(
            select(Parcel).where(Parcel.barcode.in_({x.barcode for x in passages}))
        ).scalars()
    }
    ids = [p.id for p in parcels.values()]
    history: dict[int, list[ParcelEvent]] = {}
    for e in db.execute(
        select(ParcelEvent).where(ParcelEvent.parcel_id.in_(ids)).order_by(ParcelEvent.at)
    ).scalars():
        history.setdefault(e.parcel_id, []).append(e)
    seen = set(
        db.execute(
            select(ParcelEvent.parcel_id, ParcelEvent.checkpoint, ParcelEvent.at).where(
                ParcelEvent.parcel_id.in_(ids),
                tuple_(ParcelEvent.checkpoint, ParcelEvent.at).in_(
                    [(x.checkpoint, x.at) for x in passages]
                ),
            )
        )
        .tuples()
        .all()
    )
    stored = skipped = 0
    for x in passages:
        parcel = parcels.get(x.barcode)
        if parcel is None or (parcel.id, x.checkpoint, x.at) in seen:
            skipped += 1
            continue
        before = [e for e in history.get(parcel.id, []) if e.at <= x.at and e.checkpoint is None]
        db.add(
            ParcelEvent(
                parcel_id=parcel.id,
                status=before[-1].status if before else parcel.status,
                at=x.at,
                source=EventSource.IOT,
                checkpoint=x.checkpoint,
            )
        )
        seen.add((parcel.id, x.checkpoint, x.at))
        stored += 1
    db.flush()
    return stored, skipped


@cache
def checkpoint_labels() -> dict[str, str]:
    """Device code -> what the checkpoint is ("Skener na mostíku", "K2", "LD-04")."""
    out: dict[str, str] = {}
    for b in built_depots().values():
        line = b.layout.get("line")
        if not isinstance(line, dict):
            continue
        for g in line["variants"].values():
            for n in g["nodes"]:
                if "checkpoint" in n:
                    out.setdefault(str(n["checkpoint"]), str(n.get("label", n["id"])))
    return out
