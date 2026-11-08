"""Which depots a user may see (phase 7d, ADR-068).

Depot 5.0 runs a network of depots. Every user has a home depot. Administrators and dispatchers
may switch between all depots, the other roles (operator, security, courier) see only their own.
The backend decides (ADR-017): an endpoint resolves the depot from the request with
`resolve_depot`, which answers 403 for a depot the user may not see.
"""

from collections.abc import Iterable

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from depotrack.models import Alert, Depot, Direction, Door, GateEvent, Parcel, Trip, User
from depotrack.models.enums import UserRole

SWITCHERS = frozenset({UserRole.ADMIN, UserRole.DISPATCHER})


def can_switch(user: User) -> bool:
    return user.role in SWITCHERS


def main_depot(db: Session) -> Depot:
    """The depot of a user without a home depot: the first one (Budimír, where the plan runs)."""
    return db.execute(select(Depot).order_by(Depot.id).limit(1)).scalar_one()


def home_depot(db: Session, user: User) -> Depot:
    if user.home_depot_id is not None:
        return db.get_one(Depot, user.home_depot_id)
    return main_depot(db)


def allowed_depots(db: Session, user: User) -> list[Depot]:
    if can_switch(user):
        return list(db.execute(select(Depot).order_by(Depot.id)).scalars())
    return [home_depot(db, user)]


def resolve_depot(db: Session, user: User, code: str | None) -> Depot:
    """The depot the request is about: the given code or the user's home depot. 404 for an
    unknown code, 403 for a depot of the network the user may not see."""
    if code is None:
        return home_depot(db, user)
    depot = db.execute(select(Depot).where(Depot.code == code)).scalar_one_or_none()
    if depot is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown depot")
    if not can_switch(user) and depot.id != home_depot(db, user).id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not your depot")
    return depot


def check_depot(db: Session, user: User, depot_id: int | None) -> None:
    """403 when an object of another depot is touched by a user bound to their own."""
    if can_switch(user) or depot_id is None:
        return
    if depot_id != home_depot(db, user).id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not your depot")


def door_depot(db: Session, code: str) -> int | None:
    return db.execute(select(Door.depot_id).where(Door.code == code)).scalar_one_or_none()


def parcel_depots(db: Session, parcel: Parcel) -> set[int]:
    """Depots a parcel passes: where its direction starts and where its trucks end (a ZA parcel
    is in Budimír and then in Žilina)."""
    direction = db.get_one(Direction, parcel.direction_id)
    return {d for d in (direction.depot_id, direction.destination_depot_id) if d is not None}


def check_parcel(db: Session, user: User, parcel: Parcel) -> None:
    if can_switch(user):
        return
    if home_depot(db, user).id not in parcel_depots(db, parcel):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not your depot")


def alert_depots(db: Session, alerts: Iterable[Alert]) -> dict[int, int | None]:
    """Alert id -> depot id: a gate alert by its passage, a cascade by its regional trip, a
    wrong-direction alert by the parcel's direction, a scanner alert by the door of the device.
    None when the alert cannot be placed (shown only to those who see every depot)."""
    from depotrack.services import ml_scanner  # the scanner model knows the door of a device

    alerts = list(alerts)
    out: dict[int, int | None] = {}
    refs = [a.ref_id or "" for a in alerts if a.ref_type == "gate"]
    gate_ids = {int(r) for r in refs if r.isdigit()}
    gate = (
        dict(
            db.execute(select(GateEvent.id, GateEvent.depot_id).where(GateEvent.id.in_(gate_ids)))
            .tuples()
            .all()
        )
        if gate_ids
        else {}
    )
    for a in alerts:
        ref = a.ref_id or ""
        depot: int | None = None
        if a.ref_type == "gate" and ref.isdigit():
            depot = gate.get(int(ref))
        elif a.ref_type == "cascade" and ref.split(":")[0].isdigit():
            trip = db.get(Trip, int(ref.split(":")[0]))
            depot = trip.depot_id if trip else None
        elif a.ref_type == "parcel":
            depot = db.execute(
                select(Direction.depot_id)
                .join(Parcel, Parcel.direction_id == Direction.id)
                .where(Parcel.barcode == ref)
            ).scalar_one_or_none()
        elif a.ref_type == "device":
            risk = ml_scanner.LATEST.get(ref)
            if risk is not None and risk.door_code:
                depot = door_depot(db, risk.door_code)
        out[a.id] = depot
    return out


def alerts_of_depot(
    db: Session, alerts: list[Alert], depot: Depot, *, unplaced: bool
) -> list[Alert]:
    """The alerts of one depot; `unplaced` adds those that belong to no depot."""
    where = alert_depots(db, alerts)
    return [a for a in alerts if where[a.id] == depot.id or (unplaced and where[a.id] is None)]
