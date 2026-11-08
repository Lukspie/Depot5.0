"""Operations of the depots besides Budimír (phase 7c, ADR-065): courier districts, vans,
couriers and the trucks that end at the depot.

Žilina (ZIL): the parcels of the linehaul direction ZA travel from Budimír on the evening truck
and the couriers of Žilina deliver them the next morning, in 4 districts (compass quadrants around
the town centre). The ZA trucks end and start at the depot instead of a point in the town.
Ivanka pri Dunaji (BAH, ADR-066): the hub of Bratislava. Its couriers deliver the parcels of the
linehaul direction BA addressed to Bratislava-východ (okres Bratislava II and III) and to the
villages of okres Senec; the rest of Bratislava is not simulated.
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
    # districts by postcode instead of compass sectors: prefixes of district N (no spaces); an
    # address with no matching prefix is not delivered from this depot
    postcodes: tuple[tuple[str, ...], ...] = ()


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

BAH_OPS = DepotOps(
    depot="BAH",
    feeder="BA",
    centre=(48.1486, 17.1077),
    town="",
    courier_prefix="kurierba",
    district_prefix="BA",
    van_plate="BA-3{n:02d}KR",
    sectors=(
        "Bratislava-východ – Ružinov, Vrakuňa, Podunajské Biskupice",
        "Bratislava-východ – Nové Mesto, Rača, Vajnory",
        "Senec – Ivanka, Rovinka, Chorvátsky Grob",
    ),
    couriers=("Tomáš Lehotský", "Zuzana Kráľová", "Martin Hudec"),
    # okres Bratislava II (821 xx), Bratislava III (831 xx), the villages of okres Senec
    postcodes=(("82",), ("83",), ("90025", "90028", "90041", "90046")),
)

OPS = (ZIL_OPS, BAH_OPS)


def postcode_of(address: str) -> str:
    """Digits of the postcode in "street 1, 821 05 Bratislava" ("82105"); "" if there is none."""
    tail = address.rsplit(", ", 1)[-1]
    digits = "".join(ch for ch in tail[:7] if ch.isdigit())
    return digits if len(digits) == 5 else ""


def district_of(ops: DepotOps, lat: float, lon: float, address: str = "") -> str | None:
    """District code of an address: by postcode where the depot defines them (None when it is
    not delivered from there), otherwise the compass quadrant around the town centre (north
    first)."""
    if ops.postcodes:
        code = postcode_of(address)
        for i, prefixes in enumerate(ops.postcodes, start=1):
            if code and code.startswith(prefixes):
                return f"{ops.district_prefix}-{i:02d}"
        return None
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
                name=f"{ops.town} – {sector}" if ops.town else sector,
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


# Depots shown with their layout and parked vans only (Dunajská Streda, Trenčín, ADR-066): their
# couriers and feeder trucks come after the hand-in. Vans as many as van parking spots.
PARKED_FLEETS: dict[str, tuple[str, int]] = {"DS": ("DS-3{n:02d}KR", 6), "TN": ("TN-3{n:02d}KR", 4)}
# depots whose vans the simulator drives
OPERATING = frozenset({"BUD", *(o.depot for o in OPS)})


def seed_parked_vans(db: Session) -> None:
    """The vans of the depots without operations (idempotent per van)."""
    plates = set(db.execute(select(Vehicle.plate)).scalars())
    for code, (plate, count) in PARKED_FLEETS.items():
        depot = db.execute(select(Depot).where(Depot.code == code)).scalar_one()
        for n in range(1, count + 1):
            if plate.format(n=n) not in plates:
                db.add(
                    Vehicle(
                        depot_id=depot.id,
                        plate=plate.format(n=n),
                        kind=VehicleKind.VAN,
                        capacity_kg=1100,
                        capacity_parcels=160,
                    )
                )


def parked_spots(db: Session, depot: Depot) -> dict[str, dict[str, float]]:
    """Plate -> van parking spot of the layout ({x, y, heading}) for the vans of a depot without
    operations: they stand there all day. {} for depots whose vans the simulator drives (their
    place comes from telematics, never assumed)."""
    if depot.code in OPERATING or not isinstance(depot.layout, dict):
        return {}
    yard = depot.layout.get("yard")
    spots = yard.get("vanParking") if isinstance(yard, dict) else None
    if not isinstance(spots, list):
        return {}
    vans = db.execute(
        select(Vehicle.plate)
        .where(Vehicle.depot_id == depot.id, Vehicle.kind == VehicleKind.VAN)
        .order_by(Vehicle.plate)
    ).scalars()
    return {plate: spot for plate, spot in zip(vans, spots, strict=False)}
