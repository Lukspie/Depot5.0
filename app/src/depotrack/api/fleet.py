"""Fleet (/fleet): vehicles with their current trip and cargo; parcel detail with timeline."""

from datetime import date, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_, select
from sqlalchemy.orm import aliased

from depotrack.core.rbac import DbSession, require_role
from depotrack.models import LoadingScan, Parcel, ParcelEvent, Trip, User, Vehicle
from depotrack.models.enums import ParcelStatus, ScanResult, TripKind, TripStatus, UserRole
from depotrack.schemas.wms import (
    ParcelBrief,
    ParcelDetail,
    ParcelEventOut,
    VehicleDetail,
    VehicleOut,
)
from depotrack.services.views import Lookup, clock, parcel_brief, scan_out, trip_brief

router = APIRouter(prefix="/api", tags=["fleet"])

Dispatcher = Annotated[User, Depends(require_role(UserRole.DISPATCHER))]

ACTIVE = (TripStatus.EN_ROUTE, TripStatus.AT_DOOR, TripStatus.LOADING, TripStatus.DEPARTED)


def current_trip(db: DbSession, vehicle: Vehicle, day: date) -> Trip | None:
    """Running trip of the vehicle, else the next planned one, else the last one."""
    trips = list(
        db.execute(
            select(Trip)
            .where(
                Trip.vehicle_id == vehicle.id,
                Trip.operating_day.between(day - timedelta(days=1), day + timedelta(days=1)),
            )
            .order_by(Trip.operating_day, Trip.id)
        ).scalars()
    )
    for t in trips:
        if t.status in ACTIVE:
            return t
    planned = [t for t in trips if t.status == TripStatus.PLANNED and t.operating_day >= day]
    if planned:
        return planned[0]
    return trips[-1] if trips else None


@router.get("/fleet/vehicles", response_model=list[VehicleOut], response_model_by_alias=True)
def vehicles(_: Dispatcher, db: DbSession) -> list[VehicleOut]:
    clk = clock()
    look = Lookup(db)
    out = []
    for v in sorted(look.vehicles.values(), key=lambda v: (v.kind.value, v.plate)):
        trip = current_trip(db, v, clk.operating_day)
        out.append(
            VehicleOut(
                plate=v.plate,
                kind=v.kind,
                capacity_kg=v.capacity_kg,
                capacity_parcels=v.capacity_parcels,
                trip=trip_brief(db, trip, look, clk.sim_time) if trip else None,
            )
        )
    return out


def trip_cargo(db: DbSession, trip: Trip) -> list[Parcel]:
    if trip.kind == TripKind.OUTBOUND:
        stmt = (
            select(Parcel)
            .join(LoadingScan, LoadingScan.parcel_id == Parcel.id)
            .where(LoadingScan.trip_id == trip.id, LoadingScan.result == ScanResult.OK)
        )
    else:
        # parcels travelling on an inbound (night) truck
        stmt = (
            select(Parcel)
            .join(ParcelEvent, ParcelEvent.parcel_id == Parcel.id)
            .where(ParcelEvent.trip_id == trip.id, ParcelEvent.status == ParcelStatus.COLLECTED)
        )
    return list(db.execute(stmt.order_by(Parcel.barcode)).scalars())


@router.get("/fleet/vehicles/{plate}", response_model=VehicleDetail, response_model_by_alias=True)
def vehicle_detail(plate: str, _: Dispatcher, db: DbSession) -> VehicleDetail:
    v = db.execute(select(Vehicle).where(Vehicle.plate == plate)).scalar_one_or_none()
    if v is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Vehicle not found")
    clk = clock()
    look = Lookup(db)
    trip = current_trip(db, v, clk.operating_day)
    cargo = trip_cargo(db, trip) if trip else []
    return VehicleDetail(
        plate=v.plate,
        kind=v.kind,
        capacity_kg=v.capacity_kg,
        capacity_parcels=v.capacity_parcels,
        trip=trip_brief(db, trip, look, clk.sim_time, with_load=True) if trip else None,
        parcels=[parcel_brief(p, look) for p in cargo[:300]],
        parcels_count=len(cargo),
        parcels_kg=round(sum(p.weight_kg for p in cargo), 1),
        # courier stops arrive in phase 4 (ADR-028)
        remaining_stops=[],
    )


@router.get("/parcels", response_model=list[ParcelBrief], response_model_by_alias=True)
def search_parcels(
    _: Dispatcher, db: DbSession, q: Annotated[str, Query(min_length=3, max_length=64)]
) -> list[ParcelBrief]:
    """Search by barcode (prefix) or recipient name."""
    look = Lookup(db)
    term = q.strip()
    rows = db.execute(
        select(Parcel)
        .where(
            or_(
                Parcel.barcode.ilike(f"{term}%"),
                Parcel.recipient_name.ilike(f"%{term}%"),
            )
        )
        .order_by(Parcel.barcode)
        .limit(20)
    ).scalars()
    return [parcel_brief(p, look) for p in rows]


@router.get("/parcels/{parcel_id}", response_model=ParcelDetail, response_model_by_alias=True)
def parcel_detail(parcel_id: int, _: Dispatcher, db: DbSession) -> ParcelDetail:
    p = db.get(Parcel, parcel_id)
    if p is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Parcel not found")
    look = Lookup(db)
    trip = aliased(Trip)
    events = db.execute(
        select(ParcelEvent, trip, User)
        .outerjoin(trip, ParcelEvent.trip_id == trip.id)
        .outerjoin(User, ParcelEvent.user_id == User.id)
        .where(ParcelEvent.parcel_id == p.id)
        .order_by(ParcelEvent.at, ParcelEvent.id)
    ).all()
    scans = db.execute(
        select(LoadingScan).where(LoadingScan.parcel_id == p.id).order_by(LoadingScan.at)
    ).scalars()
    direction = look.directions[p.direction_id]
    brief = parcel_brief(p, look)
    return ParcelDetail(
        **brief.model_dump(),
        direction_name=direction.name,
        direction_type=direction.type,
        sender=p.sender,
        length_cm=p.length_cm,
        width_cm=p.width_cm,
        height_cm=p.height_cm,
        lat=p.lat,
        lon=p.lon,
        created_at=p.created_at,
        events=[
            ParcelEventOut(
                status=e.status,
                at=e.at,
                source=e.source,
                door_code=look.doors[e.door_id].code if e.door_id else None,
                trip_id=e.trip_id,
                vehicle_plate=look.vehicles[t.vehicle_id].plate if t else None,
                user_name=u.full_name if u else None,
            )
            for e, t, u in events
        ],
        scans=[scan_out(db, s, look) for s in scans],
    )
