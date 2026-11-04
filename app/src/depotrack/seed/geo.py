"""Geography of the network (ADR-039): destinations of directions, the Bratislava hub ramps, and
real address points from OpenStreetMap (data/addresses.json.gz, © OpenStreetMap contributors)."""

import gzip
import json
from functools import lru_cache
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from depotrack.models import Depot, Direction, Door, Vehicle
from depotrack.models.enums import DockEquipment, DoorKind
from depotrack.seed.reference import HUB_RAMPS, LINEHAUL, TRANSIT

ADDRESSES_FILE = Path(__file__).with_name("data") / "addresses.json.gz"

BUD = "BUD"
HUB = "BAH"
# the linehaul direction whose trucks drive to the hub
HUB_DIRECTION = "BA"

Address = tuple[str, str, str, float, float]  # street, number, postcode, lat, lon


@lru_cache
def addresses() -> dict[str, list[Address]]:
    """Address points per town (sorted, so a seeded choice is deterministic). {} if missing."""
    if not ADDRESSES_FILE.is_file():
        return {}
    with gzip.open(ADDRESSES_FILE, "rt", encoding="utf-8") as f:
        raw = json.load(f)
    return {
        town: [(str(a[0]), str(a[1]), str(a[2]), float(a[3]), float(a[4])) for a in rows]
        for town, rows in raw["areas"].items()
    }


def depot_by_code(db: Session, code: str) -> Depot:
    return db.execute(select(Depot).where(Depot.code == code)).scalar_one()


def seed_geo(db: Session) -> None:
    """Destinations of directions (hub for BA), hub ramps, home depot of vehicles."""
    bud = depot_by_code(db, BUD)
    hub = depot_by_code(db, HUB)
    by_code = {d.code: d for d in db.execute(select(Direction)).scalars()}
    for d in LINEHAUL + TRANSIT:
        direction = by_code.get(d.code)
        if direction is None:
            continue
        if d.code == HUB_DIRECTION:
            direction.dest_lat, direction.dest_lon = hub.lat, hub.lon
            direction.destination_depot_id = hub.id
        else:
            direction.dest_lat, direction.dest_lon = d.lat, d.lon
    ba = by_code.get(HUB_DIRECTION)
    for i, (x, y) in enumerate(HUB_RAMPS):
        db.add(
            Door(
                code=f"BA-R{i + 1:02d}",
                kind=DoorKind.LOADING_DOCK,
                depot_id=hub.id,
                direction_id=ba.id if ba else None,
                position_x=x,
                position_y=y,
                dock_equipment=DockEquipment.DOCK_LEVELER,
            )
        )
    for v in db.execute(select(Vehicle).where(Vehicle.depot_id.is_(None))).scalars():
        v.depot_id = bud.id
