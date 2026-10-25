"""Daily trip plan of the depot. The app owns the plan, telematics only executes it (ADR-022).

Operating day D runs from 15:00 on D to 15:00 on D+1 (Europe/Bratislava):
- 15:45-16:45 D   regional (transit) trucks return with parcels from the regions   (inbound)
- 17:00 D         linehaul trucks stand at their docks, depart 20:30-21:30           (outbound)
- 01:00-02:00 D+1 night linehaul trucks arrive with parcels for the east            (inbound)
- 03:00 D+1       regional trucks at their docks, depart 05:45-06:30                 (outbound)
"""

from datetime import date, datetime, time, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from depotrack.core.clock import TZ
from depotrack.models import Direction, Door, Trip, Vehicle
from depotrack.models.enums import DirectionType, DoorKind, TripKind, TripStatus, VehicleKind
from depotrack.seed.reference import TRUCK_ROTATION

OPERATING_DAY_START = time(15, 0)

TRANSIT_RETURN_FIRST = time(15, 45)
TRANSIT_RETURN_STEP = timedelta(minutes=15)
LINEHAUL_AT_DOOR = time(17, 0)
NIGHT_ARRIVAL_FIRST = time(1, 0)
NIGHT_ARRIVAL_STEP = timedelta(minutes=30)
TRANSIT_AT_DOOR = time(3, 0)


def operating_day_of(instant: datetime) -> date:
    """Operating day an instant belongs to (the day starts at 15:00 local time)."""
    local = instant.astimezone(TZ)
    start = datetime.combine(local.date(), OPERATING_DAY_START, TZ)
    return local.date() if local >= start else local.date() - timedelta(days=1)


def _at(day: date, t: time, offset: timedelta = timedelta(0)) -> datetime:
    return datetime.combine(day, t, TZ) + offset


def _trucks(db: Session, suffix: str) -> list[Vehicle]:
    rows = db.execute(
        select(Vehicle)
        .where(Vehicle.kind == VehicleKind.TRUCK, Vehicle.plate.like(f"%{suffix}"))
        .order_by(Vehicle.plate)
    ).scalars()
    return list(rows)


def build_trip_plan(db: Session, day: date) -> list[Trip]:
    """Create the trips of operating day `day` (caller commits; idempotency via seed_meta)."""
    directions = list(db.execute(select(Direction).order_by(Direction.id)).scalars())
    linehaul = [d for d in directions if d.type == DirectionType.LINEHAUL]
    transit = [d for d in directions if d.type == DirectionType.TRANSIT]
    dock_of = {
        door.direction_id: door.id
        for door in db.execute(select(Door).where(Door.kind == DoorKind.LOADING_DOCK)).scalars()
    }
    lh_trucks = _trucks(db, "LH")
    tr_trucks = _trucks(db, "TR")
    extra = sum(TRUCK_ROTATION.get(d.code, 1) - 1 for d in transit)
    if len(lh_trucks) < 2 * len(linehaul) or len(tr_trucks) < len(transit) + extra:
        raise RuntimeError("not enough trucks for the trip plan")

    # linehaul trucks shuttle: the one that arrived at night leaves the next evening
    parity = day.toordinal() % 2

    # one truck per regional direction; long ones (Senica) alternate two trucks by day (ADR-031)
    spares = iter(tr_trucks[len(transit) :])
    transit_truck: dict[int, Vehicle] = {}
    for i, d in enumerate(transit):
        rotation = [tr_trucks[i]] + [next(spares) for _ in range(TRUCK_ROTATION.get(d.code, 1) - 1)]
        transit_truck[d.id] = rotation[day.toordinal() % len(rotation)]
    n = len(linehaul)
    next_day = day + timedelta(days=1)
    trips: list[Trip] = []

    def add(**kw: object) -> None:
        trips.append(Trip(operating_day=day, status=TripStatus.PLANNED, **kw))

    for i, d in enumerate(transit):
        add(
            vehicle_id=transit_truck[d.id].id,
            direction_id=d.id,
            door_id=dock_of.get(d.id),
            kind=TripKind.INBOUND,
            planned_arrival=_at(day, TRANSIT_RETURN_FIRST, i * TRANSIT_RETURN_STEP),
        )
    for i, d in enumerate(linehaul):
        add(
            vehicle_id=lh_trucks[i + n * parity].id,
            direction_id=d.id,
            door_id=dock_of.get(d.id),
            kind=TripKind.OUTBOUND,
            planned_arrival=_at(day, LINEHAUL_AT_DOOR),
            planned_departure=_at(day, d.planned_departure or time(21, 0)),
        )
        add(
            vehicle_id=lh_trucks[i + n * (1 - parity)].id,
            direction_id=d.id,
            door_id=dock_of.get(d.id),
            kind=TripKind.INBOUND,
            planned_arrival=_at(next_day, NIGHT_ARRIVAL_FIRST, i * NIGHT_ARRIVAL_STEP),
        )
    for d in transit:
        add(
            vehicle_id=transit_truck[d.id].id,
            direction_id=d.id,
            door_id=dock_of.get(d.id),
            kind=TripKind.OUTBOUND,
            planned_arrival=_at(next_day, TRANSIT_AT_DOOR),
            planned_departure=_at(next_day, d.planned_departure or time(6, 0)),
        )

    db.add_all(trips)
    db.flush()
    return trips
