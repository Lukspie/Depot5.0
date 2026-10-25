"""Loading: every scan at a loading door (IoT camera or the operator's hand scanner) is checked
against the truck currently loading at that door.

Result of a scan (loading_scans.result):
- ok               parcel belongs to the truck's direction -> parcel status 'loaded'
- wrong_direction  parcel of another direction -> red alarm at the door, parcel is NOT loaded
- duplicate        parcel already loaded on this truck (seen twice by the camera)
- unidentified     item counted but label unreadable, or unknown barcode
"""

from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from depotrack.models import Direction, Door, LoadingScan, Parcel, ParcelEvent, Trip
from depotrack.models.enums import (
    AlertKind,
    AlertSeverity,
    DoorKind,
    EventSource,
    ParcelStatus,
    ScanResult,
    TripKind,
    TripStatus,
)
from depotrack.services.alerts import AlertChange, upsert_alert
from depotrack.services.parcels import LOADABLE, in_day

FINISHED = (TripStatus.DEPARTED, TripStatus.COMPLETED, TripStatus.CANCELLED)


@dataclass
class ScanOutcome:
    result: ScanResult
    door: Door
    trip: Trip
    scan: LoadingScan
    parcel: Parcel | None = None
    parcel_direction: Direction | None = None
    trip_direction: Direction | None = None
    alert: AlertChange | None = None


def loading_dock(db: Session, code: str) -> Door | None:
    return db.execute(
        select(Door).where(Door.code == code, Door.kind == DoorKind.LOADING_DOCK)
    ).scalar_one_or_none()


def active_trip_at(db: Session, door: Door) -> Trip | None:
    """The outbound trip loading at the door: the earliest one that has not left yet."""
    return (
        db.execute(
            select(Trip)
            .where(
                Trip.door_id == door.id,
                Trip.kind == TripKind.OUTBOUND,
                Trip.status.not_in(FINISHED),
            )
            .order_by(Trip.planned_departure)
            .limit(1)
        )
        .scalars()
        .first()
    )


def process_scan(
    db: Session,
    *,
    door: Door,
    at: datetime,
    barcode: str | None,
    source: EventSource,
    device: str | None,
    user_id: int | None = None,
) -> ScanOutcome | None:
    """Record one scan; returns None when no truck is loading at the door."""
    trip = active_trip_at(db, door)
    if trip is None:
        return None
    trip_direction = db.get(Direction, trip.direction_id)
    parcel = (
        db.execute(select(Parcel).where(Parcel.barcode == barcode)).scalar_one_or_none()
        if barcode
        else None
    )

    result = ScanResult.OK
    if parcel is None:
        result = ScanResult.UNIDENTIFIED
    else:
        already = db.execute(
            select(LoadingScan.id).where(
                LoadingScan.parcel_id == parcel.id,
                LoadingScan.trip_id == trip.id,
                LoadingScan.result == ScanResult.OK,
            )
        ).first()
        if already is not None:
            result = ScanResult.DUPLICATE
        elif parcel.direction_id != trip.direction_id:
            result = ScanResult.WRONG_DIRECTION

    scan = LoadingScan(
        parcel_id=parcel.id if parcel else None,
        trip_id=trip.id,
        door_id=door.id,
        device_id=device,
        at=at,
        result=result,
    )
    db.add(scan)
    outcome = ScanOutcome(result, door, trip, scan, parcel, None, trip_direction)

    if parcel is not None:
        outcome.parcel_direction = db.get(Direction, parcel.direction_id)
    if parcel is not None and result == ScanResult.OK:
        parcel.status = ParcelStatus.LOADED
        db.add(
            ParcelEvent(
                parcel_id=parcel.id,
                status=ParcelStatus.LOADED,
                at=at,
                source=source,
                door_id=door.id,
                trip_id=trip.id,
                user_id=user_id,
            )
        )
        if trip.status in (TripStatus.PLANNED, TripStatus.AT_DOOR):
            trip.status = TripStatus.LOADING
    elif parcel is not None and result == ScanResult.WRONG_DIRECTION:
        wrong = outcome.parcel_direction
        expected = trip_direction
        outcome.alert = upsert_alert(
            db,
            kind=AlertKind.WRONG_DIRECTION,
            severity=AlertSeverity.CRITICAL,
            message=(
                f"Zlý smer pri bráne {door.code}: balík {parcel.barcode} patrí do smeru "
                f"{wrong.name if wrong else '?'}, "
                f"kamión nakladá {expected.name if expected else '?'} – balík vyložiť."
            ),
            ref_type="parcel",
            ref_id=parcel.barcode,
            at=at,
        )
    db.flush()
    return outcome


def line_scan(db: Session, *, at: datetime, barcode: str | None) -> Parcel | None:
    """Morning wave: a parcel read on the sorting line is on the belt and gets sorted."""
    if not barcode:
        return None
    parcel = db.execute(select(Parcel).where(Parcel.barcode == barcode)).scalar_one_or_none()
    if parcel is None or parcel.status not in (ParcelStatus.COLLECTED, ParcelStatus.STAGED):
        return parcel
    for status, offset in ((ParcelStatus.ON_BELT, 0), (ParcelStatus.SORTED, 1)):
        db.add(
            ParcelEvent(
                parcel_id=parcel.id,
                status=status,
                at=at + timedelta(seconds=offset),
                source=EventSource.IOT,
            )
        )
    parcel.status = ParcelStatus.SORTED
    return parcel


@dataclass
class TripLoadStats:
    expected: int
    loaded: int
    loaded_kg: float
    counted: int
    read: int
    unidentified: int
    wrong_direction: int
    duplicate: int


def trip_load_stats(db: Session, trip: Trip) -> TripLoadStats:
    by_result = dict(
        db.execute(
            select(LoadingScan.result, func.count())
            .where(LoadingScan.trip_id == trip.id)
            .group_by(LoadingScan.result)
        )
        .tuples()
        .all()
    )
    loaded_kg = db.execute(
        select(func.coalesce(func.sum(Parcel.weight_kg), 0.0))
        .join(LoadingScan, LoadingScan.parcel_id == Parcel.id)
        .where(LoadingScan.trip_id == trip.id, LoadingScan.result == ScanResult.OK)
    ).scalar_one()
    loaded = by_result.get(ScanResult.OK, 0)
    waiting = db.execute(
        select(func.count())
        .select_from(Parcel)
        .where(
            Parcel.direction_id == trip.direction_id,
            Parcel.status.in_(LOADABLE),
            in_day(trip.operating_day),
        )
    ).scalar_one()
    counted = sum(by_result.values())
    return TripLoadStats(
        expected=loaded + waiting,
        loaded=loaded,
        loaded_kg=float(loaded_kg),
        counted=counted,
        read=counted - by_result.get(ScanResult.UNIDENTIFIED, 0),
        unidentified=by_result.get(ScanResult.UNIDENTIFIED, 0),
        wrong_direction=by_result.get(ScanResult.WRONG_DIRECTION, 0),
        duplicate=by_result.get(ScanResult.DUPLICATE, 0),
    )


def missing_parcels(db: Session, trip: Trip, limit: int = 500) -> list[Parcel]:
    """Parcels of the trip's direction and day that have not been loaded yet."""
    return list(
        db.execute(
            select(Parcel)
            .where(
                Parcel.direction_id == trip.direction_id,
                Parcel.status.in_(LOADABLE),
                in_day(trip.operating_day),
            )
            .order_by(Parcel.barcode)
            .limit(limit)
        ).scalars()
    )


def scan_event(o: ScanOutcome) -> dict[str, object]:
    """Payload of a processed scan for the WebSocket ("devices" channel, type loading_scan)."""
    return {
        "door": o.door.code,
        "tripId": o.trip.id,
        "result": o.result.value,
        "barcode": o.parcel.barcode if o.parcel else None,
        "parcelId": o.parcel.id if o.parcel else None,
        "parcelDirection": o.parcel_direction.code if o.parcel_direction else None,
        "tripDirection": o.trip_direction.code if o.trip_direction else None,
        "device": o.scan.device_id,
        "at": o.scan.at.isoformat(),
    }
