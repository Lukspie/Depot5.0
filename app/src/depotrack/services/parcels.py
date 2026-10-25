"""Parcels of an operating day and the parcels brought by the night linehaul trucks."""

import random
from datetime import date, datetime, time, timedelta

from sqlalchemy import ColumnElement, and_, insert, select
from sqlalchemy.orm import Session

from depotrack.core.clock import TZ
from depotrack.models import Direction, Parcel, ParcelEvent, Trip
from depotrack.models.enums import DirectionType, EventSource, ParcelStatus, TripKind
from depotrack.seed.generator import (
    kosice_rajon,
    parcel_dimensions,
    parcel_weight,
    person_name,
    pick_address,
)
from depotrack.seed.reference import (
    KOSICE_LAT,
    KOSICE_LON,
    KOSICE_RADIUS_KM,
    SENDERS,
    TRANSIT,
)

# parcels that can still be loaded onto a truck
LOADABLE = (ParcelStatus.COLLECTED, ParcelStatus.ON_BELT, ParcelStatus.SORTED, ParcelStatus.STAGED)


def day_window(day: date) -> tuple[datetime, datetime]:
    """Parcels of operating day D: collected during D (evening wave) and brought by D's night
    trucks (registered the evening before arrival). Ends before the next day's collection."""
    start = datetime.combine(day, time(0, 0), TZ)
    end = datetime.combine(day + timedelta(days=1), time(7, 0), TZ)
    return start, end


def in_day(day: date) -> ColumnElement[bool]:
    start, end = day_window(day)
    return and_(Parcel.created_at >= start, Parcel.created_at < end)


def night_parcels_for(db: Session, day: date, random_seed: int) -> int:
    """Parcels for the east (regional + Košice) on each night linehaul truck of `day`.

    They are registered when picked up in the west (~6 h before the planned arrival) and travel
    on the night truck: their 'collected' event carries the trip id, so the simulator knows they
    can be scanned only after that truck arrived.
    """
    directions = {d.code: d for d in db.execute(select(Direction)).scalars()}
    night_trips = db.execute(
        select(Trip, Direction)
        .join(Direction, Trip.direction_id == Direction.id)
        .where(
            Trip.operating_day == day,
            Trip.kind == TripKind.INBOUND,
            Direction.type == DirectionType.LINEHAUL,
        )
        .order_by(Trip.id)
    ).all()
    created = 0
    for trip, feeder in night_trips:
        if trip.planned_arrival is None:
            continue
        rng = random.Random(f"{random_seed}|{day.isoformat()}|night|{feeder.code}")
        registered = trip.planned_arrival - timedelta(hours=6)
        # regional directions fed by this truck + Košice districts
        targets = [d for d in TRANSIT if feeder.code in d.depends_on]
        rows = []
        specs = []
        day_code = f"{trip.planned_arrival.astimezone(TZ):%y%m%d}"
        for i in range(1, rng.randint(110, 190) + 1):
            if rng.random() < 0.45 and targets:
                d = rng.choices(targets, weights=[t.share for t in targets])[0]
                street, number, postcode, lat, lon = pick_address(rng, d.town, d.lat, d.lon, 8.0)
                code, town, postcode = d.code, d.town, postcode or d.postcode
            else:
                street, number, postcode, lat, lon = pick_address(
                    rng, "Košice", KOSICE_LAT, KOSICE_LON, KOSICE_RADIUS_KM
                )
                code, town, postcode = kosice_rajon(lat, lon), "Košice", postcode or "040 01"
            weight = parcel_weight(rng)
            length, width, height = parcel_dimensions(rng, weight)
            rows.append(
                {
                    "barcode": f"SPS{day_code}N{feeder.code}{i:03d}",
                    "weight_kg": weight,
                    "length_cm": length,
                    "width_cm": width,
                    "height_cm": height,
                    "recipient_name": person_name(rng),
                    "address": f"{street} {number}, {postcode} {town}",
                    "lat": round(lat, 6),
                    "lon": round(lon, 6),
                    "direction_id": directions[code].id,
                    "status": ParcelStatus.COLLECTED,
                    "sender": rng.choice(SENDERS),
                    "created_at": registered,
                }
            )
            specs.append(registered)
        ids = (
            db.execute(insert(Parcel).returning(Parcel.id, sort_by_parameter_order=True), rows)
            .scalars()
            .all()
        )
        db.execute(
            insert(ParcelEvent),
            [
                {
                    "parcel_id": pid,
                    "status": ParcelStatus.COLLECTED,
                    "at": at,
                    "source": EventSource.SYSTEM,
                    "trip_id": trip.id,
                }
                for pid, at in zip(ids, specs, strict=True)
            ],
        )
        created += len(rows)
    return created
