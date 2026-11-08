"""Depots and hubs for the map and the digital shadow (ADR-039).

GET /api/depots                    all depots/hubs with position
GET /api/layout?depot=BUD          hall layout + doors (the same data drives /shadow and the 3D map)
GET /api/depots/{code}/state       live state: occupied doors and staged parcels (depot), or trucks
                                   arriving / waiting / leaving (hub)
"""

from datetime import timedelta
from typing import Annotated, Any

from fastapi import APIRouter, Query
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
    ParkedVehicle,
    StagedBay,
)
from depotrack.seed.operations import parked_spots
from depotrack.services.depot_scope import resolve_depot
from depotrack.services.parcels import in_day
from depotrack.services.views import Lookup, clock

router = APIRouter(prefix="/api", tags=["depots"])


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
    directions = list(db.execute(select(Direction)).scalars())
    return [
        _out(d).model_copy(update={"label": depot_label(d, directions)})
        for d in db.execute(select(Depot).order_by(Depot.id)).scalars()
    ]


def depot_label(d: Depot, directions: list[Direction]) -> str:
    """What a depot is, from the data: a depot with its own linehaul directions transships, a
    hub is named after the directions that end there, the others deliver."""
    if d.kind == DepotKind.HUB:
        towns = sorted({x.name for x in directions if x.destination_depot_id == d.id})
        return " ".join(["hub", *towns])
    if any(x.depot_id == d.id and x.type == DirectionType.LINEHAUL for x in directions):
        return "prekládkové depo"
    return "depo"


@router.get("/layout", response_model=LayoutOut, response_model_by_alias=True)
def layout(
    user: CurrentUser, db: DbSession, depot: Annotated[str | None, Query(max_length=8)] = None
) -> LayoutOut:
    """Layout of a depot: the user's own when absent; another depot only for who may switch."""
    d = resolve_depot(db, user, depot)
    look = Lookup(db)
    doors = db.execute(select(Door).where(Door.depot_id == d.id).order_by(Door.code)).scalars()
    directions = list(db.execute(select(Direction)).scalars())
    return LayoutOut(
        depot=_out(d).model_copy(update={"label": depot_label(d, directions)}),
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
        parked=[
            ParkedVehicle(
                plate=plate, x=float(s["x"]), y=float(s["y"]), heading=float(s["heading"])
            )
            for plate, s in parked_spots(db, d).items()
        ],
    )


@router.get("/depots/{code}/state", response_model=DepotState, response_model_by_alias=True)
def depot_state(code: str, user: CurrentUser, db: DbSession) -> DepotState:
    d = resolve_depot(db, user, code)
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
    # trucks of other depots' directions that end here (Žilina: the ZA linehaul, ADR-065)
    arriving = (
        _hub_state(db, d, look, day).trucks
        if any(x.destination_depot_id == d.id for x in look.directions.values())
        else []
    )
    # own trucks arriving within half an hour (the label "prichádza" in the shadow, phase 7d)
    soon = clk.sim_time + timedelta(minutes=30)
    for t in db.execute(
        select(Trip).where(
            Trip.depot_id == d.id,
            Trip.kind == TripKind.INBOUND,
            Trip.status == TripStatus.EN_ROUTE,
            Trip.operating_day.in_((day, day - timedelta(days=1))),
        )
    ).scalars():
        eta = t.predicted_arrival or t.planned_arrival
        if eta is not None and eta <= soon:
            arriving.append(
                HubTruck(
                    plate=look.vehicles[t.vehicle_id].plate, trip_id=t.id, state="arriving", at=eta
                )
            )
    return DepotState(
        depot=_out(d), sim_time=clk.sim_time, occupied=occupied, staged=staged, trucks=arriving
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
