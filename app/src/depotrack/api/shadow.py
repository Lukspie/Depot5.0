"""Digital shadow of a depot (/shadow, ADR-045): the data the 3D scene and its panels need.

GET /api/shadow/{depot}                 KPIs, loading doors with their trucks, staging bays, alerts
GET /api/shadow/doors/{code}            truck at a door: load, missing parcels, wrong directions
GET /api/shadow/parcels/{barcode}       where a parcel is (belt / door / bay) and its timeline

Dispatchers and security (admin always). Live scans, devices and vehicles come from the
telematics WebSocket. No recipient names or addresses: security does not need them.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path, status
from sqlalchemy import func, select

from depotrack.api.depots import depot_state
from depotrack.core.rbac import DbSession, require_role
from depotrack.models import (
    Alert,
    Door,
    LoadingScan,
    Parcel,
    ParcelEvent,
    Trip,
    User,
)
from depotrack.models.enums import (
    AlertKind,
    DepotKind,
    DirectionType,
    DoorKind,
    ParcelStatus,
    ScanResult,
    TripKind,
    TripStatus,
    UserRole,
)
from depotrack.schemas.internal import AlertOut
from depotrack.schemas.shadow import (
    MissingParcel,
    ParcelLocate,
    ParcelPlace,
    ParcelStep,
    ShadowDock,
    ShadowDockDetail,
    ShadowOut,
    WrongScan,
)
from depotrack.schemas.wms import DepotOut
from depotrack.services.checkpoints import checkpoint_labels
from depotrack.services.depot_scope import (
    alerts_of_depot,
    can_switch,
    check_depot,
    check_parcel,
    resolve_depot,
)
from depotrack.services.kpis import day_overview, open_alerts
from depotrack.services.loading import active_trip_at, missing_parcels
from depotrack.services.parcels import LOADABLE, in_day
from depotrack.services.views import Lookup, clock, sort_key, trip_brief, trips_of

router = APIRouter(prefix="/api/shadow", tags=["shadow"])

Viewer = Annotated[User, Depends(require_role(UserRole.DISPATCHER, UserRole.SECURITY))]
DepotCode = Annotated[str, Path(max_length=8)]
DoorCode = Annotated[str, Path(max_length=16)]
Barcode = Annotated[str, Path(min_length=3, max_length=64)]

MISSING_SHOWN = 30


def _cascade(db: DbSession, trip: Trip) -> AlertOut | None:
    """Open cascade warning about this departure (ref "<transit trip>:<night trip>")."""
    alert = (
        db.execute(
            select(Alert)
            .where(
                Alert.kind == AlertKind.CASCADE_DELAY,
                Alert.ref_type == "cascade",
                Alert.ref_id.startswith(f"{trip.id}:"),
                Alert.acknowledged_at.is_(None),
            )
            .order_by(Alert.severity.desc(), Alert.created_at.desc())
            .limit(1)
        )
        .scalars()
        .first()
    )
    return AlertOut.model_validate(alert) if alert else None


def _dock(db: DbSession, door: Door, look: Lookup) -> ShadowDock:
    trip = active_trip_at(db, door, clock().sim_time)
    direction = look.directions.get(door.direction_id) if door.direction_id else None
    return ShadowDock(
        code=door.code,
        default_direction=direction.code if direction else None,
        default_direction_name=direction.name if direction else None,
        trip=trip_brief(db, trip, look, clock().sim_time, with_load=True) if trip else None,
        cascade=_cascade(db, trip) if trip else None,
    )


@router.get("/{depot}", response_model=ShadowOut, response_model_by_alias=True)
def shadow(depot: DepotCode, user: Viewer, db: DbSession) -> ShadowOut:
    d = resolve_depot(db, user, depot)  # security sees only its own depot (ADR-068)
    look = Lookup(db)
    clk = clock()
    state = depot_state(d.code, user, db)  # the same live state as the 3D map
    docks: list[ShadowDock] = []
    kpis = None
    # KPIs of the chosen depot only (phase 7c): a depot without its own trips yet has none,
    # instead of showing Budimír's numbers
    trips = sorted((t for t in trips_of(db, clk.operating_day) if t.depot_id == d.id), key=sort_key)
    if d.kind == DepotKind.DEPOT:
        if trips:
            kpis, _rows = day_overview(db, clk.operating_day, trips, look, clk.sim_time, d.id)
        doors = sorted(
            (
                x
                for x in look.doors.values()
                if x.depot_id == d.id and x.kind == DoorKind.LOADING_DOCK
            ),
            key=lambda x: x.code,
        )
        docks = [_dock(db, door, look) for door in doors]
    return ShadowOut(
        depot=DepotOut(code=d.code, name=d.name, kind=d.kind, lat=d.lat, lon=d.lon),
        clock=clk,
        kpis=kpis,
        docks=docks,
        staged=state.staged,
        trucks=state.trucks,
        # alerts of this depot; those of no depot only for who sees the whole network
        alerts=[
            AlertOut.model_validate(a)
            for a in alerts_of_depot(
                db, open_alerts(db, 30, clk.operating_day), d, unplaced=can_switch(user)
            )
        ],
    )


@router.get("/doors/{code}", response_model=ShadowDockDetail, response_model_by_alias=True)
def dock_detail(code: DoorCode, user: Viewer, db: DbSession) -> ShadowDockDetail:
    door = db.execute(
        select(Door).where(Door.code == code, Door.kind == DoorKind.LOADING_DOCK)
    ).scalar_one_or_none()
    if door is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown loading door")
    check_depot(db, user, door.depot_id)
    look = Lookup(db)
    dock = _dock(db, door, look)
    trip = active_trip_at(db, door, clock().sim_time)
    if trip is None:
        return ShadowDockDetail(dock=dock, missing=[], missing_count=0, wrong_direction=[])
    missing_count = db.execute(
        select(func.count())
        .select_from(Parcel)
        .where(
            Parcel.direction_id == trip.direction_id,
            Parcel.status.in_(LOADABLE),
            in_day(trip.operating_day),
        )
    ).scalar_one()
    wrong = db.execute(
        select(LoadingScan)
        .where(LoadingScan.trip_id == trip.id, LoadingScan.result == ScanResult.WRONG_DIRECTION)
        .order_by(LoadingScan.at.desc())
        .limit(20)
    ).scalars()
    parcels = {
        p.id: p
        for p in db.execute(
            select(Parcel).where(
                Parcel.id.in_(
                    select(LoadingScan.parcel_id).where(
                        LoadingScan.trip_id == trip.id,
                        LoadingScan.result == ScanResult.WRONG_DIRECTION,
                    )
                )
            )
        ).scalars()
    }

    def wrong_scan(s: LoadingScan) -> WrongScan:
        p = parcels.get(s.parcel_id) if s.parcel_id else None
        return WrongScan(
            at=s.at,
            barcode=p.barcode if p else None,
            parcel_direction=look.directions[p.direction_id].code if p else None,
        )

    return ShadowDockDetail(
        dock=dock,
        missing=[
            MissingParcel(barcode=p.barcode, status=p.status, weight_kg=p.weight_kg)
            for p in missing_parcels(db, trip, MISSING_SHOWN)
        ],
        missing_count=missing_count,
        wrong_direction=[wrong_scan(s) for s in wrong],
    )


def _place(db: DbSession, parcel: Parcel, look: Lookup, last_trip_id: int | None) -> ParcelPlace:
    direction = look.directions[parcel.direction_id]
    if parcel.status == ParcelStatus.ON_BELT:
        return ParcelPlace(kind="belt", code=None)
    if parcel.status in (ParcelStatus.SORTED, ParcelStatus.STAGED):
        if direction.type == DirectionType.LOCAL:
            bay = next(
                (
                    d
                    for d in look.doors.values()
                    if d.kind == DoorKind.STAGING_BAY and d.direction_id == direction.id
                ),
                None,
            )
            return ParcelPlace(kind="bay", code=bay.code if bay else None)
        dock = next(
            (
                d
                for d in look.doors.values()
                if d.kind == DoorKind.LOADING_DOCK and d.direction_id == direction.id
            ),
            None,
        )
        return ParcelPlace(kind="door", code=dock.code if dock else None)
    if parcel.status == ParcelStatus.LOADED and last_trip_id is not None:
        trip = db.get(Trip, last_trip_id)
        if trip and trip.door_id and trip.status in (TripStatus.AT_DOOR, TripStatus.LOADING):
            return ParcelPlace(kind="door", code=look.doors[trip.door_id].code)
    return ParcelPlace(kind="outside", code=None)


@router.get("/parcels/{barcode}", response_model=ParcelLocate, response_model_by_alias=True)
def locate_parcel(barcode: Barcode, user: Viewer, db: DbSession) -> ParcelLocate:
    parcel = db.execute(
        select(Parcel).where(Parcel.barcode == barcode.strip().upper())
    ).scalar_one_or_none()
    if parcel is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown parcel")
    check_parcel(db, user, parcel)
    look = Lookup(db)
    events = list(
        db.execute(
            select(ParcelEvent)
            .where(ParcelEvent.parcel_id == parcel.id)
            .order_by(ParcelEvent.at, ParcelEvent.id)
        ).scalars()
    )
    last_trip = next((e.trip_id for e in reversed(events) if e.trip_id is not None), None)
    direction = look.directions[parcel.direction_id]
    trip = db.get(Trip, last_trip) if last_trip is not None else None
    return ParcelLocate(
        id=parcel.id,
        barcode=parcel.barcode,
        status=parcel.status,
        direction_code=direction.code,
        direction_name=direction.name,
        direction_type=direction.type,
        place=_place(db, parcel, look, last_trip),
        weight_kg=parcel.weight_kg,
        vehicle_plate=look.vehicles[trip.vehicle_id].plate if trip else None,
        planned_departure=trip.planned_departure
        if trip and trip.kind == TripKind.OUTBOUND
        else None,
        events=[
            ParcelStep(
                status=e.status,
                at=e.at,
                door_code=look.doors[e.door_id].code if e.door_id else None,
                checkpoint=e.checkpoint,
                checkpoint_label=checkpoint_labels().get(e.checkpoint) if e.checkpoint else None,
            )
            for e in events
        ],
    )
