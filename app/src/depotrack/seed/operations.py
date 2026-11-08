"""Operations of the depots besides Budimír (phase 7c, ADR-065): courier districts, vans,
couriers and the trucks that end at the depot.

Žilina (ZIL): the parcels of the linehaul direction ZA travel from Budimír on the evening truck
and the couriers of Žilina deliver them the next morning, in 4 districts (compass quadrants around
the town centre). The ZA trucks end and start at the depot instead of a point in the town.
Budimír itself does not change (golden test, tests/test_golden_bud.py).
"""

import math
from dataclasses import dataclass
from datetime import time

from sqlalchemy import select
from sqlalchemy.orm import Session

from depotrack.core.config import Settings
from depotrack.core.security import hash_password
from depotrack.models import Depot, Direction, Door, User, Vehicle
from depotrack.models.enums import DirectionType, DoorKind, UserRole, VehicleKind
from depotrack.seed import _role_password


@dataclass(frozen=True)
class DepotOps:
    depot: str
    # the direction whose parcels this depot's couriers deliver, and whose trucks end here
    feeder: str
    centre: tuple[float, float]  # town centre: districts are compass sectors around it
    town: str
    courier_prefix: str  # usernames kurierza01 ..
    district_prefix: str  # districts ZA-01 ..
    van_plate: str  # van of courier N: format with the number
    sectors: tuple[str, ...]
    couriers: tuple[str, ...]  # fictional names


ZIL_OPS = DepotOps(
    depot="ZIL",
    feeder="ZA",
    centre=(49.2232, 18.7394),
    town="Žilina",
    courier_prefix="kurierza",
    district_prefix="ZA",
    van_plate="ZA-3{n:02d}KR",
    sectors=("sever", "východ", "juh", "západ"),
    couriers=("Pavol Hrnčiar", "Monika Gažová", "Juraj Kubala", "Simona Bielik"),
)

OPS = (ZIL_OPS,)


def district_of(ops: DepotOps, lat: float, lon: float) -> str:
    """District code of an address: the compass quadrant around the town centre (north first)."""
    dy = (lat - ops.centre[0]) * 110_574
    dx = (lon - ops.centre[1]) * 111_320 * math.cos(math.radians(ops.centre[0]))
    bearing = (math.degrees(math.atan2(dx, dy)) + 360) % 360
    n = len(ops.sectors)
    sector = int(((bearing + 180 / n) % 360) // (360 / n))
    return f"{ops.district_prefix}-{sector + 1:02d}"


def courier_username(ops: DepotOps, n: int) -> str:
    return f"{ops.courier_prefix}{n:02d}"


def seed_depot_operations(db: Session, settings: Settings, ops: DepotOps) -> None:
    """Districts, staging bays, vans and couriers of a depot; its feeder trucks end there.
    Idempotent per item, so it also completes an existing database."""
    depot = db.execute(select(Depot).where(Depot.code == ops.depot)).scalar_one()
    directions = {d.code: d for d in db.execute(select(Direction)).scalars()}
    bays = sorted(
        (
            d
            for d in db.execute(select(Door).where(Door.depot_id == depot.id)).scalars()
            if d.kind == DoorKind.STAGING_BAY
        ),
        key=lambda d: d.code,
    )
    vans = set(db.execute(select(Vehicle.plate)).scalars())
    users = set(db.execute(select(User.username)).scalars())
    password = hash_password(_role_password(settings, UserRole.COURIER))
    for i, sector in enumerate(ops.sectors, start=1):
        code = f"{ops.district_prefix}-{i:02d}"
        district = directions.get(code)
        if district is None:
            district = Direction(
                depot_id=depot.id,
                code=code,
                name=f"{ops.town} – {sector}",
                type=DirectionType.LOCAL,
                cutoff_time=time(7, 0),
                planned_departure=time(7, 30),
                depends_on_linehaul=[],
            )
            db.add(district)
            db.flush()
        if i <= len(bays):
            bays[i - 1].direction_id = district.id
        plate = ops.van_plate.format(n=i)
        if plate not in vans:
            db.add(
                Vehicle(
                    depot_id=depot.id,
                    plate=plate,
                    kind=VehicleKind.VAN,
                    capacity_kg=1100,
                    capacity_parcels=160,
                )
            )
        username = courier_username(ops, i)
        if username not in users:
            db.add(
                User(
                    username=username,
                    full_name=ops.couriers[i - 1],
                    role=UserRole.COURIER,
                    password_hash=password,
                    active=True,
                )
            )
    feeder = directions.get(ops.feeder)
    if feeder is not None:
        # the linehaul trucks drive to the depot, not to a point in the town
        feeder.destination_depot_id = depot.id
        feeder.dest_lat, feeder.dest_lon = depot.lat, depot.lon
