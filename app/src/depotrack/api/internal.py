"""Internal API used by telematics (X-Service-Token). The app is the source of truth for trips and
parcels: telematics reads the plan and manifests here and reports how the trips are executed."""

from collections import Counter
from datetime import date, timedelta
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import aliased

from depotrack.core.config import Settings, get_settings
from depotrack.core.rbac import DbSession
from depotrack.core.service_auth import require_service_token
from depotrack.models import Alert, Direction, Door, Parcel, ParcelEvent, Trip, Vehicle
from depotrack.models.enums import DirectionType, EventSource, ParcelStatus
from depotrack.schemas.internal import (
    AlertIn,
    AlertOut,
    ManifestOut,
    ManifestParcel,
    PlanOut,
    PlanTripOut,
    ScanEventsIn,
    ScanEventsOut,
    TripEventsIn,
    TripEventsOut,
)
from depotrack.services import telematics
from depotrack.services.alerts import AlertChange, alert_event, resolve_alert, upsert_alert
from depotrack.services.cascade import evaluate_cascade
from depotrack.services.loading import line_scan, loading_dock, process_scan, scan_event
from depotrack.services.operating_day import ensure_operating_day, reset_operating_day
from depotrack.services.parcels import LOADABLE, in_day
from depotrack.services.trip_plan import operating_day_of
from depotrack.services.waves import close_evening_wave

router = APIRouter(
    prefix="/internal", tags=["internal"], dependencies=[Depends(require_service_token)]
)

SettingsDep = Annotated[Settings, Depends(get_settings)]


def _broadcast_alerts(background: BackgroundTasks, changes: list[AlertChange]) -> None:
    if changes:
        events = [alert_event(c.alert) for c in changes]
        background.add_task(telematics.broadcast_many, "alerts", "alert", events)


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
    """Parcels of one direction and operating day that are still waiting to be loaded.
    Night parcels carry the inbound trip that brings them."""
    collected = (
        select(ParcelEvent.parcel_id, ParcelEvent.trip_id)
        .where(ParcelEvent.status == ParcelStatus.COLLECTED, ParcelEvent.trip_id.is_not(None))
        .subquery()
    )
    rows = db.execute(
        select(Parcel.barcode, Parcel.weight_kg, collected.c.trip_id)
        .join(Direction, Parcel.direction_id == Direction.id)
        .outerjoin(collected, collected.c.parcel_id == Parcel.id)
        .where(Direction.code == direction, Parcel.status.in_(LOADABLE), in_day(day))
        .order_by(Parcel.barcode)
    ).all()
    return ManifestOut(
        direction=direction,
        day=day,
        parcels=[
            ManifestParcel(barcode=b, weight_kg=w, arrives_with_trip_id=t) for b, w, t in rows
        ],
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
    # after 22:00 the regional/Košice parcels left from the evening go to the staging areas
    today = operating_day_of(body.sim_time)
    for day in (today - timedelta(days=1), today):
        close_evening_wave(db, day, body.sim_time)
    db.commit()
    _broadcast_alerts(background, changes)
    return TripEventsOut(updated=len(touched), unknown=unknown, alerts_changed=len(changes))


@router.post("/events/scans", response_model=ScanEventsOut, response_model_by_alias=True)
def scan_events(body: ScanEventsIn, db: DbSession, background: BackgroundTasks) -> ScanEventsOut:
    """IoT scans from telematics: dock scanners -> loading check, line scanner -> sorting."""
    results: Counter[str] = Counter()
    skipped = 0
    events: list[dict[str, object]] = []
    alerts: list[AlertChange] = []
    for scan in body.scans:
        if scan.door_code is None:
            if line_scan(db, at=scan.at, barcode=scan.barcode if scan.read_ok else None):
                results["sorted"] += 1
            continue
        door = loading_dock(db, scan.door_code)
        outcome = (
            process_scan(
                db,
                door=door,
                at=scan.at,
                barcode=scan.barcode if scan.read_ok else None,
                source=EventSource.IOT,
                device=scan.device,
            )
            if door
            else None
        )
        if outcome is None:
            skipped += 1
            continue
        results[outcome.result.value] += 1
        events.append(scan_event(outcome))
        if outcome.alert:
            alerts.append(outcome.alert)
    db.commit()
    if events:
        background.add_task(telematics.broadcast_many, "devices", "loading_scan", events)
    _broadcast_alerts(background, alerts)
    return ScanEventsOut(processed=sum(results.values()), skipped=skipped, results=dict(results))


@router.post("/days/{day}/reset")
def reset_day(day: date, db: DbSession) -> dict[str, int]:
    """Telematics replays the day from 15:00 (new seed / restart): undo its execution here."""
    return reset_operating_day(db, day)


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
