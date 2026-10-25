"""Sorting waves of an operating day.

- evening wave 15:30-22:00: parcels for linehaul trucks are loaded; parcels for regional
  directions and Košice districts are set aside on the staging areas until the morning
- night/morning wave 01:00-06:00: night trucks arrive, everything for the east passes the line
  scanner and is loaded onto the regional trucks / prepared for couriers
"""

from datetime import date, datetime, time

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from depotrack.core.clock import TZ
from depotrack.models import Direction, Parcel, ParcelEvent, SeedMeta
from depotrack.models.enums import DirectionType, EventSource, ParcelStatus
from depotrack.services.parcels import in_day

EVENING = (time(15, 30), time(22, 0))
NIGHT = (time(1, 0), time(6, 0))


def current_wave(at: datetime) -> str | None:
    local = at.astimezone(TZ).time()
    if EVENING[0] <= local < EVENING[1]:
        return "evening"
    if NIGHT[0] <= local < NIGHT[1]:
        return "night"
    return None


def evening_wave_end(day: date) -> datetime:
    return datetime.combine(day, EVENING[1], TZ)


def close_evening_wave(db: Session, day: date, now: datetime) -> int:
    """After 22:00, regional and Košice parcels still waiting from the evening are staged.
    Runs once per operating day (recorded in seed_meta). Returns how many parcels were staged."""
    end = evening_wave_end(day)
    key = f"staged:{day.isoformat()}"
    if now < end or db.get(SeedMeta, key) is not None:
        return 0
    ids = list(
        db.execute(
            select(Parcel.id)
            .join(Direction, Parcel.direction_id == Direction.id)
            .where(
                Direction.type.in_((DirectionType.TRANSIT, DirectionType.LOCAL)),
                Parcel.status == ParcelStatus.COLLECTED,
                in_day(day),
                Parcel.created_at < end,
                # parcels still travelling on a night truck are not in the depot yet
                Parcel.id.not_in(
                    select(ParcelEvent.parcel_id).where(
                        ParcelEvent.status == ParcelStatus.COLLECTED,
                        ParcelEvent.trip_id.is_not(None),
                    )
                ),
            )
        ).scalars()
    )
    if ids:
        db.execute(update(Parcel).where(Parcel.id.in_(ids)).values(status=ParcelStatus.STAGED))
        db.add_all(
            ParcelEvent(
                parcel_id=pid, status=ParcelStatus.STAGED, at=end, source=EventSource.SYSTEM
            )
            for pid in ids
        )
    db.add(SeedMeta(key=key))
    return len(ids)
