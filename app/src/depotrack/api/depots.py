"""Depots and hubs for the map and the digital shadow (ADR-039).

GET /api/depots                    all depots/hubs with position
GET /api/layout?depot=BUD          hall layout + doors (the same data drives /shadow and the 3D map)
GET /api/depots/{code}/state       live state: occupied doors and staged parcels (depot), or trucks
                                   arriving / waiting / leaving (hub)
"""

from typing import Annotated, Any

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import func, select

from depotrack.core.rbac import CurrentUser, DbSession
from depotrack.models import Depot, Direction, Door, Parcel, Trip
from depotrack.models.enums import (
    DepotKind,
    DirectionType,
    DoorKind,
    ParcelStatus,
    TripKind,
    TripStatus,
)
from depotrack.schemas.wms import (
    DepotOut,
    DepotState,
    HubTruck,
    LayoutDoor,
    LayoutOut,
    OccupiedDoor,
    StagedBay,
)
from depotrack.services.parcels import in_day
from depotrack.services.views import Lookup, clock

router = APIRouter(prefix="/api", tags=["depots"])


def _depot(db: DbSession, code: str) -> Depot:
    depot = db.execute(select(Depot).where(Depot.code == code)).scalar_one_or_none()
    if depot is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown depot")
    return depot


def _out(d: Depot) -> DepotOut:
    origin = d.layout.get("origin") if isinstance(d.layout, dict) else None
    center = (
        (float(origin[0]), float(origin[1]))
        if isinstance(origin, list) and len(origin) == 2
        else None
    )
    return DepotOut(code=d.code, name=d.name, kind=d.kind, lat=d.lat, lon=d.lon, center=center)


@router.get("/depots", response_model=list[DepotOut], response_model_by_alias=True)
def depots(_: CurrentUser, db: DbSession) -> list[DepotOut]:
    return [_out(d) for d in db.execute(select(Depot).order_by(Depot.id)).scalars()]


@router.get("/layout", response_model=LayoutOut, response_model_by_alias=True)
def layout(
    _: CurrentUser, db: DbSession, depot: Annotated[str, Query(max_length=8)] = "BUD"
) -> LayoutOut:
    d = _depot(db, depot)
    look = Lookup(db)
    doors = db.execute(select(Door).where(Door.depot_id == d.id).order_by(Door.code)).scalars()
    return LayoutOut(
        depot=_out(d),
        layout=dict(d.layout),
        doors=[
            LayoutDoor(
                code=door.code,
                kind=door.kind,
                x=door.position_x,
                y=door.position_y,
                direction_code=look.directions[door.direction_id].code
                if door.direction_id
                else None,
                direction_name=look.directions[door.direction_id].name
                if door.direction_id
                else None,
                door_drive=door.door_drive,
                dock_equipment=door.dock_equipment,
            )
            for door in doors
        ],
    )


@router.get("/depots/{code}/state", response_model=DepotState, response_model_by_alias=True)
def depot_state(code: str, _: CurrentUser, db: DbSession) -> DepotState:
    d = _depot(db, code)
    look = Lookup(db)
    clk = clock()
    day = clk.operating_day
    if d.kind == DepotKind.HUB:
        return _hub_state(db, d, look, day)

    occupied: list[OccupiedDoor] = []
    rows = db.execute(
        select(Trip).where(
            Trip.depot_id == d.id,
            Trip.door_id.is_not(None),
            Trip.status.in_((TripStatus.AT_DOOR, TripStatus.LOADING)),
            # trips of older days are stale (services.loading.active_trip_at)
            Trip.operating_day == day,
        )
    ).scalars()
    for t in rows:
        door = look.doors.get(t.door_id) if t.door_id else None
        if door is None:
            continue
        direction = look.directions[t.direction_id]
        occupied.append(
            OccupiedDoor(
                door_code=door.code,
                plate=look.vehicles[t.vehicle_id].plate,
                trip_id=t.id,
                trip_kind=t.kind,
                status=t.status,
                direction_code=direction.code,
                direction_type=direction.type,
            )
        )
    # parcels waiting on the courier staging bays (Košice districts)
    counts: dict[int, int] = dict(
        db.execute(
            select(Parcel.direction_id, func.count())
            .join(Direction, Parcel.direction_id == Direction.id)
            .where(
                Direction.type == DirectionType.LOCAL,
                Parcel.status.in_((ParcelStatus.STAGED, ParcelStatus.SORTED)),
                in_day(day),
            )
            .group_by(Parcel.direction_id)
        )
        .tuples()
        .all()
    )
    staged = [
        StagedBay(
            door_code=door.code,
            direction_code=look.directions[door.direction_id].code,
            parcels=counts.get(door.direction_id, 0),
        )
        for door in look.doors.values()
        if door.depot_id == d.id and door.kind == DoorKind.STAGING_BAY and door.direction_id
    ]
    return DepotState(
        depot=_out(d), sim_time=clk.sim_time, occupied=occupied, staged=staged, trucks=[]
    )


def _hub_state(db: DbSession, hub: Depot, look: Lookup, day: Any) -> DepotState:
    """Trucks of the directions that end at the hub: on the way, at the hub, leaving."""
    clk = clock()
    direction_ids = [d.id for d in look.directions.values() if d.destination_depot_id == hub.id]
    trips = db.execute(
        select(Trip)
        .where(
            Trip.direction_id.in_(direction_ids),
            Trip.operating_day.between(day.fromordinal(day.toordinal() - 1), day),
        )
        .order_by(Trip.operating_day, Trip.id)
    ).scalars()
    trucks: list[HubTruck] = []
    for t in trips:
        plate = look.vehicles[t.vehicle_id].plate
        if t.kind == TripKind.OUTBOUND:
            # truck driving from the depot to the hub
            state = {
                TripStatus.DEPARTED: "arriving",
                TripStatus.COMPLETED: "at_hub",
            }.get(t.status)
            when = t.actual_departure or t.planned_departure
        else:
            # night truck leaving the hub for the depot
            state = {TripStatus.PLANNED: "loading_at_hub", TripStatus.EN_ROUTE: "departed"}.get(
                t.status
            )
            when = t.actual_departure or t.planned_arrival
        if state:
            trucks.append(HubTruck(plate=plate, trip_id=t.id, state=state, at=when))
    # a truck that arrived at the hub and later left with the night trip is no longer there
    leaving = {tr.plate for tr in trucks if tr.state in ("loading_at_hub", "departed")}
    trucks = [tr for tr in trucks if not (tr.state == "at_hub" and tr.plate in leaving)]
    return DepotState(depot=_out(hub), sim_time=clk.sim_time, occupied=[], staged=[], trucks=trucks)
