"""Internal API used by telematics (X-Service-Token). The app is the source of truth for trips and
parcels: telematics reads the plan and manifests here and reports how the trips are executed."""

from datetime import date, datetime, time, timedelta
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import aliased

from depotrack.core.clock import TZ
from depotrack.core.config import Settings, get_settings
from depotrack.core.rbac import DbSession
from depotrack.core.service_auth import require_service_token
from depotrack.models import Alert, Direction, Door, Parcel, Trip, Vehicle
from depotrack.models.enums import DirectionType, ParcelStatus
from depotrack.schemas.internal import (
    AlertIn,
    AlertOut,
    ManifestOut,
    ManifestParcel,
    PlanOut,
    PlanTripOut,
    TripEventsIn,
    TripEventsOut,
)
from depotrack.seed import ensure_operating_day
from depotrack.services import telematics
from depotrack.services.alerts import AlertChange, alert_event, resolve_alert, upsert_alert
from depotrack.services.cascade import evaluate_cascade

router = APIRouter(
    prefix="/internal", tags=["internal"], dependencies=[Depends(require_service_token)]
)

SettingsDep = Annotated[Settings, Depends(get_settings)]

# parcels that can still be loaded onto a truck
LOADABLE = (ParcelStatus.COLLECTED, ParcelStatus.ON_BELT, ParcelStatus.SORTED, ParcelStatus.STAGED)


def _broadcast_alerts(background: BackgroundTasks, changes: list[AlertChange]) -> None:
    for change in changes:
        background.add_task(telematics.broadcast, "alerts", alert_event(change.alert))


@router.get("/plan", response_model=PlanOut, response_model_by_alias=True)
def get_plan(day: Annotated[date, Query()], db: DbSession, settings: SettingsDep) -> PlanOut:
    """Trip plan of an operating day; created on first request (with that day's parcels)."""
    ensure_operating_day(db, settings, day)
    door = aliased(Door)
    rows = db.execute(
        select(Trip, Vehicle, Direction, door.code)
        .join(Vehicle, Trip.vehicle_id == Vehicle.id)
        .join(Direction, Trip.direction_id == Direction.id)
        .outerjoin(door, Trip.door_id == door.id)
        .where(Trip.operating_day == day)
        .order_by(Trip.id)
    ).all()
    trips = [
        PlanTripOut(
            id=t.id,
            operating_day=t.operating_day,
            kind=t.kind,
            status=t.status,
            vehicle_plate=v.plate,
            vehicle_kind=v.kind,
            direction_code=d.code,
            direction_name=d.name,
            direction_type=d.type,
            depends_on_linehaul=list(d.depends_on_linehaul),
            door_code=door_code,
            planned_arrival=t.planned_arrival,
            planned_departure=t.planned_departure,
            actual_arrival=t.actual_arrival,
            actual_departure=t.actual_departure,
            predicted_arrival=t.predicted_arrival,
        )
        for t, v, d, door_code in rows
    ]
    local = db.execute(
        select(Direction.code).where(Direction.type == DirectionType.LOCAL).order_by(Direction.code)
    ).scalars()
    return PlanOut(
        day=day,
        cascade_buffer_min=settings.cascade_buffer_min,
        trips=trips,
        local_directions=list(local),
    )


@router.get("/manifest", response_model=ManifestOut, response_model_by_alias=True)
def get_manifest(
    direction: Annotated[str, Query(max_length=16)],
    day: Annotated[date, Query()],
    db: DbSession,
) -> ManifestOut:
    """Parcels of one direction collected on `day` that are still waiting to be loaded."""
    start = datetime.combine(day, time(0, 0), TZ)
    rows = db.execute(
        select(Parcel.barcode, Parcel.weight_kg)
        .join(Direction, Parcel.direction_id == Direction.id)
        .where(
            Direction.code == direction,
            Parcel.status.in_(LOADABLE),
            Parcel.created_at >= start,
            Parcel.created_at < start + timedelta(days=1),
        )
        .order_by(Parcel.barcode)
    ).all()
    return ManifestOut(
        direction=direction,
        day=day,
        parcels=[ManifestParcel(barcode=b, weight_kg=w) for b, w in rows],
    )


@router.post("/events/trips", response_model=TripEventsOut, response_model_by_alias=True)
def trip_events(
    body: TripEventsIn, db: DbSession, settings: SettingsDep, background: BackgroundTasks
) -> TripEventsOut:
    """Mirror the execution state of trips and re-evaluate the delay cascade."""
    unknown: list[int] = []
    touched: list[Trip] = []
    for ev in body.trips:
        trip = db.get(Trip, ev.trip_id)
        if trip is None:
            unknown.append(ev.trip_id)
            continue
        trip.status = ev.status
        trip.actual_arrival = ev.actual_arrival
        trip.actual_departure = ev.actual_departure
        trip.predicted_arrival = ev.predicted_arrival
        touched.append(trip)
    db.flush()

    buffer = timedelta(minutes=settings.cascade_buffer_min)
    changes: list[AlertChange] = []
    for trip in touched:
        changes.extend(evaluate_cascade(db, trip, buffer, body.sim_time))
    db.commit()
    _broadcast_alerts(background, changes)
    return TripEventsOut(updated=len(touched), unknown=unknown, alerts_changed=len(changes))


@router.post("/alerts", response_model=AlertOut | None, response_model_by_alias=True)
def post_alert(body: AlertIn, db: DbSession, background: BackgroundTasks) -> Alert | None:
    """Alert raised by telematics (e.g. device offline); `resolved=true` closes it."""
    at = body.at or telematics.sim_now()
    if body.resolved:
        if body.ref_type is None or body.ref_id is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "resolve needs refType+refId")
        alert = resolve_alert(db, kind=body.kind, ref_type=body.ref_type, ref_id=body.ref_id, at=at)
        db.commit()
        if alert is not None:
            _broadcast_alerts(background, [AlertChange(alert, created=False)])
        return alert
    change = upsert_alert(
        db,
        kind=body.kind,
        severity=body.severity,
        message=body.message,
        ref_type=body.ref_type,
        ref_id=body.ref_id,
        at=at,
    )
    db.commit()
    _broadcast_alerts(background, [change])
    return change.alert
