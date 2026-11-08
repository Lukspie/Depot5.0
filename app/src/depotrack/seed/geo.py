"""Geography of the network (ADR-039): destinations of directions, the Bratislava hub ramps, and
real address points from OpenStreetMap (data/addresses.json.gz, © OpenStreetMap contributors)."""

import gzip
import json
from functools import lru_cache
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from depotrack.models import Depot, Direction, Door, Trip, Vehicle
from depotrack.models.enums import DepotKind, DockEquipment, DoorDrive, DoorKind
from depotrack.seed.depots import built_depots
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


def seed_depot_layouts(db: Session) -> None:
    """Layouts of all depots from OSM (seed/depots.py, ADR-064). Runs on clean and existing
    databases alike (the step key carries the data version), so both end up equal. New depots get
    the centre of the hall as their routing point; Budimír and Ivanka keep theirs (the simulator
    computes the routes from it)."""
    depots = {d.code: d for d in db.execute(select(Depot)).scalars()}
    doors = {d.code: d for d in db.execute(select(Door)).scalars()}
    for code, b in built_depots().items():
        depot = depots.get(code)
        if depot is None:
            depot = Depot(
                code=code, name=b.name, kind=DepotKind(b.kind), lat=b.origin[0], lon=b.origin[1]
            )
            db.add(depot)
            db.flush()
        depot.name = b.name
        depot.layout = b.layout
        if code not in ("BUD", "BAH"):
            # new depots route from the centre of their hall; Budimír and Ivanka keep their point
            depot.lat, depot.lon = b.origin
            depot.kind = DepotKind(b.kind)
        wanted = {p.code for p in b.doors}
        for old in [x for x in doors.values() if x.depot_id == depot.id and x.code not in wanted]:
            # a door the notes no longer have (fewer ramps): removed unless a trip uses it
            used = db.execute(select(Trip.id).where(Trip.door_id == old.id).limit(1)).first()
            if used is None:
                db.delete(old)
        for p in b.doors:
            door = doors.get(p.code)
            if door is None:
                door = Door(code=p.code, kind=DoorKind(p.kind), depot_id=depot.id)
                db.add(door)
            door.depot_id = depot.id
            door.position_x, door.position_y = p.x, p.y
            door.door_drive = DoorDrive(p.door_drive)
            door.dock_equipment = DockEquipment(p.dock_equipment)
