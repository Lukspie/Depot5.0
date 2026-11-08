"""Search of the top bar (Ctrl K, phase 7d): parcels, vehicles, trips and loading doors of one
depot, by what the role may open. The depot is resolved like everywhere else (ADR-068): a guard
or an operator searches only their own depot."""

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy import or_, select

from depotrack.core.rbac import DbSession, require_role
from depotrack.models import Depot, Direction, Door, Parcel, Trip, User, Vehicle
from depotrack.models.enums import DoorKind, UserRole
from depotrack.schemas.internal import CamelModel
from depotrack.services.depot_scope import resolve_depot
from depotrack.services.views import clock

router = APIRouter(prefix="/api", tags=["search"])

Searcher = Annotated[
    User, Depends(require_role(UserRole.DISPATCHER, UserRole.OPERATOR, UserRole.SECURITY))
]
LIMIT = 6


class SearchHit(CamelModel):
    kind: Literal["parcel", "vehicle", "trip", "door"]
    key: str
    title: str
    subtitle: str
    # where the frontend opens it
    href: str


class SearchOut(CamelModel):
    depot: str
    hits: list[SearchHit]


def _parcels(db: DbSession, depot: Depot, term: str) -> list[SearchHit]:
    rows = db.execute(
        select(Parcel, Direction)
        .join(Direction, Parcel.direction_id == Direction.id)
        .where(
            or_(Direction.depot_id == depot.id, Direction.destination_depot_id == depot.id),
            or_(Parcel.barcode.ilike(f"{term}%"), Parcel.recipient_name.ilike(f"%{term}%")),
        )
        .order_by(Parcel.barcode)
        .limit(LIMIT)
    ).tuples()
    return [
        SearchHit(
            kind="parcel",
            key=p.barcode,
            title=p.barcode,
            subtitle=f"{p.recipient_name} · {d.name}",
            href=f"/parcels/{p.id}",
        )
        for p, d in rows
    ]


def _vehicles(db: DbSession, depot: Depot, term: str, href: str) -> list[SearchHit]:
    """Vehicles of the depot and the linehaul trucks that end there (ZA trucks in Žilina)."""
    ending = select(Trip.vehicle_id).join(Direction, Trip.direction_id == Direction.id)
    ending = ending.where(Direction.destination_depot_id == depot.id)
    rows = db.execute(
        select(Vehicle)
        .where(
            Vehicle.plate.ilike(f"%{term}%"),
            or_(Vehicle.depot_id == depot.id, Vehicle.id.in_(ending)),
        )
        .order_by(Vehicle.plate)
        .limit(LIMIT)
    ).scalars()
    return [
        SearchHit(
            kind="vehicle",
            key=v.plate,
            title=v.plate,
            subtitle="kamión" if v.kind == "truck" else "dodávka",
            href=href.format(plate=v.plate, depot=depot.code),
        )
        for v in rows
    ]


def _trips(db: DbSession, depot: Depot, term: str) -> list[SearchHit]:
    day = clock().operating_day
    rows = db.execute(
        select(Trip, Direction, Vehicle)
        .join(Direction, Trip.direction_id == Direction.id)
        .join(Vehicle, Trip.vehicle_id == Vehicle.id)
        .where(
            Trip.operating_day == day,
            or_(Trip.depot_id == depot.id, Direction.destination_depot_id == depot.id),
            or_(Direction.name.ilike(f"%{term}%"), Direction.code.ilike(f"{term}%")),
        )
        .order_by(Trip.id)
        .limit(LIMIT)
    ).tuples()
    return [
        SearchHit(
            kind="trip",
            key=str(t.id),
            title=f"{d.name} · {v.plate}",
            subtitle="odchod" if t.kind == "outbound" else "príchod",
            href=f"/fleet?plate={v.plate}",
        )
        for t, d, v in rows
    ]


def _doors(db: DbSession, depot: Depot, term: str, href: str) -> list[SearchHit]:
    rows = db.execute(
        select(Door)
        .where(
            Door.depot_id == depot.id,
            Door.kind == DoorKind.LOADING_DOCK,
            Door.code.ilike(f"%{term}%"),
        )
        .order_by(Door.code)
        .limit(LIMIT)
    ).scalars()
    return [
        SearchHit(
            kind="door",
            key=d.code,
            title=d.code,
            subtitle=f"brána · {depot.name}",
            href=href.format(code=d.code, depot=depot.code),
        )
        for d in rows
    ]


@router.get("/search", response_model=SearchOut, response_model_by_alias=True)
def search(
    user: Searcher,
    db: DbSession,
    q: Annotated[str, Query(min_length=2, max_length=64)],
    depot: Annotated[str | None, Query(max_length=8)] = None,
) -> SearchOut:
    """What the role can open: a dispatcher parcels, vehicles, trips and doors; an operator the
    loading doors; a guard the vehicles (ADR-068)."""
    d = resolve_depot(db, user, depot)
    term = q.strip()
    hits: list[SearchHit] = []
    if user.role in (UserRole.ADMIN, UserRole.DISPATCHER):
        hits += _parcels(db, d, term)
        hits += _vehicles(db, d, term, "/fleet?plate={plate}")
        hits += _trips(db, d, term)
        hits += _doors(db, d, term, "/shadow?depot={depot}&door={code}")
    elif user.role == UserRole.OPERATOR:
        hits += _doors(db, d, term, "/loading?door={code}")
    elif user.role == UserRole.SECURITY:
        hits += _vehicles(db, d, term, "/gate?plate={plate}")
    return SearchOut(depot=d.code, hits=hits)
