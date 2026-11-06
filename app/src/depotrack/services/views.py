"""Read models shared by the WMS screens: trips with their load, parcels, the simulated clock."""

from datetime import date, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from depotrack.models import Direction, Door, LoadingScan, Parcel, Trip, Vehicle
from depotrack.models.enums import TripKind, TripStatus
from depotrack.schemas.wms import ClockOut, LoadStats, ParcelBrief, ScanOut, TripBrief
from depotrack.services import telematics
from depotrack.services.loading import trip_load_stats
from depotrack.services.trip_plan import operating_day_of
from depotrack.services.waves import current_wave

DONE = (TripStatus.DEPARTED, TripStatus.COMPLETED, TripStatus.CANCELLED)


def clock() -> ClockOut:
    now = telematics.sim_now()
    return ClockOut(sim_time=now, operating_day=operating_day_of(now), wave=current_wave(now))


class Lookup:
    """Directions, doors and vehicles by id, loaded once per request."""

    def __init__(self, db: Session) -> None:
        self.directions = {d.id: d for d in db.execute(select(Direction)).scalars()}
        self.doors = {d.id: d for d in db.execute(select(Door)).scalars()}
        self.vehicles = {v.id: v for v in db.execute(select(Vehicle)).scalars()}


def delay_minutes(trip: Trip, now: datetime) -> int | None:
    if trip.kind == TripKind.INBOUND:
        expected = trip.actual_arrival or trip.predicted_arrival
        if trip.planned_arrival is None:
            return None
        if expected is None:
            # not reported yet: late only if the planned time has already passed
            return max(0, int((now - trip.planned_arrival).total_seconds() // 60)) or None
        return int((expected - trip.planned_arrival).total_seconds() // 60)
    if trip.planned_departure is None:
        return None
    if trip.actual_departure is not None:
        return int((trip.actual_departure - trip.planned_departure).total_seconds() // 60)
    if now > trip.planned_departure:
        return int((now - trip.planned_departure).total_seconds() // 60)
    return 0


def trip_brief(
    db: Session, trip: Trip, look: Lookup, now: datetime, with_load: bool = False
) -> TripBrief:
    direction = look.directions[trip.direction_id]
    vehicle = look.vehicles[trip.vehicle_id]
    door = look.doors.get(trip.door_id) if trip.door_id else None
    load = None
    if with_load and trip.kind == TripKind.OUTBOUND:
        s = trip_load_stats(db, trip)
        load = LoadStats(**s.__dict__)
    return TripBrief(
        id=trip.id,
        operating_day=trip.operating_day,
        kind=trip.kind,
        status=trip.status,
        direction_code=direction.code,
        direction_name=direction.name,
        direction_type=direction.type,
        vehicle_plate=vehicle.plate,
        vehicle_kind=vehicle.kind,
        capacity_kg=vehicle.capacity_kg,
        capacity_parcels=vehicle.capacity_parcels,
        door_code=door.code if door else None,
        planned_arrival=trip.planned_arrival,
        planned_departure=trip.planned_departure,
        actual_arrival=trip.actual_arrival,
        actual_departure=trip.actual_departure,
        predicted_arrival=trip.predicted_arrival,
        predicted_by=trip.predicted_by,
        delay_min=delay_minutes(trip, now),
        load=load,
    )


def trips_of(db: Session, day: date) -> list[Trip]:
    return list(
        db.execute(select(Trip).where(Trip.operating_day == day).order_by(Trip.id)).scalars()
    )


def sort_key(trip: Trip) -> float:
    """Chronological order: outbound by departure, inbound by arrival."""
    t = trip.planned_departure if trip.kind == TripKind.OUTBOUND else trip.planned_arrival
    return t.timestamp() if t else float("inf")


def parcel_brief(p: Parcel, look: Lookup) -> ParcelBrief:
    return ParcelBrief(
        id=p.id,
        barcode=p.barcode,
        status=p.status,
        direction_code=look.directions[p.direction_id].code,
        weight_kg=p.weight_kg,
        recipient_name=p.recipient_name,
        address=p.address,
    )


def around(day: date) -> tuple[date, date]:
    return day - timedelta(days=1), day + timedelta(days=1)


def scan_out(db: Session, s: LoadingScan, look: Lookup) -> ScanOut:
    parcel = db.get(Parcel, s.parcel_id) if s.parcel_id else None
    return ScanOut(
        id=s.id,
        at=s.at,
        result=s.result,
        barcode=parcel.barcode if parcel else None,
        parcel_id=parcel.id if parcel else None,
        parcel_direction=look.directions[parcel.direction_id].code if parcel else None,
        device=s.device_id,
    )
