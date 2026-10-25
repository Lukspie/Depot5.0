"""Idempotent seed of db-wms, run on every container start (`python -m depotrack.seed`).

Each step is recorded in `seed_meta`; a step that already ran is skipped, so restarting the
container never duplicates data and never overwrites changes made in the admin UI.
"""

import logging
from collections.abc import Callable
from datetime import date, datetime, time, timedelta

from sqlalchemy import insert, select
from sqlalchemy.orm import Session

from depotrack.core.clock import TZ
from depotrack.core.config import Settings
from depotrack.core.security import hash_password
from depotrack.models import Direction, Door, Parcel, ParcelEvent, SeedMeta, User, Vehicle, Wave
from depotrack.models.enums import DoorKind, EventSource, ParcelStatus, UserRole, WaveKind
from depotrack.seed.generator import generate_parcels
from depotrack.seed.reference import DIRECTIONS, DOORS, USERS, VEHICLES
from depotrack.services.trip_plan import build_trip_plan

log = logging.getLogger(__name__)


def _step(db: Session, key: str, fn: Callable[[], object]) -> bool:
    """Run `fn` once per `key`, in a single transaction together with its seed_meta row."""
    if db.get(SeedMeta, key) is not None:
        log.info("seed step %s already applied, skipping", key)
        return False
    try:
        fn()
        db.add(SeedMeta(key=key))
        db.commit()
    except Exception:
        db.rollback()
        raise
    log.info("seed step %s applied", key)
    return True


def seed_reference(db: Session) -> None:
    for d in DIRECTIONS:
        db.add(
            Direction(
                code=d.code,
                name=d.name,
                type=d.type,
                cutoff_time=d.cutoff,
                planned_departure=d.departure,
                depends_on_linehaul=list(d.depends_on),
            )
        )
    db.flush()
    by_code = {d.code: d.id for d in db.execute(select(Direction)).scalars()}
    for door in DOORS:
        db.add(
            Door(
                code=door.code,
                kind=DoorKind(door.kind),
                direction_id=by_code[door.direction_code] if door.direction_code else None,
                position_x=door.x,
                position_y=door.y,
            )
        )
    for v in VEHICLES:
        db.add(
            Vehicle(
                plate=v.plate,
                kind=v.kind,
                capacity_kg=v.capacity_kg,
                capacity_parcels=v.capacity_parcels,
            )
        )


def _role_password(settings: Settings, role: UserRole) -> str:
    value = {
        UserRole.ADMIN: settings.seed_admin_password,
        UserRole.DISPATCHER: settings.seed_dispatcher_password,
        UserRole.OPERATOR: settings.seed_operator_password,
        UserRole.SECURITY: settings.seed_security_password,
        UserRole.COURIER: settings.seed_courier_password,
    }[role]
    if not value:
        raise RuntimeError(f"SEED_{role.value.upper()}_PASSWORD is not set (see .env.example)")
    return value


def seed_users(db: Session, settings: Settings) -> None:
    hashes = {role: hash_password(_role_password(settings, role)) for role in UserRole}
    for u in USERS:
        db.add(
            User(
                username=u.username,
                full_name=u.full_name,
                role=u.role,
                password_hash=hashes[u.role],
                active=True,
            )
        )


def seed_waves(db: Session, day: date) -> None:
    next_day = day + timedelta(days=1)
    db.add(
        Wave(
            date=day,
            kind=WaveKind.EVENING,
            starts_at=datetime.combine(day, time(15, 30), TZ),
            ends_at=datetime.combine(day, time(22, 0), TZ),
        )
    )
    db.add(
        Wave(
            date=next_day,
            kind=WaveKind.NIGHT,
            starts_at=datetime.combine(next_day, time(1, 0), TZ),
            ends_at=datetime.combine(next_day, time(6, 0), TZ),
        )
    )


def seed_parcels(db: Session, day: date, count: int, random_seed: int) -> None:
    by_code = {d.code: d.id for d in db.execute(select(Direction)).scalars()}
    specs = generate_parcels(day, count, random_seed)
    rows = [
        {
            "barcode": p.barcode,
            "weight_kg": p.weight_kg,
            "length_cm": p.length_cm,
            "width_cm": p.width_cm,
            "height_cm": p.height_cm,
            "recipient_name": p.recipient_name,
            "address": p.address,
            "lat": p.lat,
            "lon": p.lon,
            "direction_id": by_code[p.direction_code],
            "status": ParcelStatus.COLLECTED,
            "sender": p.sender,
            "created_at": p.collected_at,
        }
        for p in specs
    ]
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
                "at": spec.collected_at,
                "source": EventSource.SYSTEM,
            }
            for pid, spec in zip(ids, specs, strict=True)
        ],
    )


def ensure_operating_day(db: Session, settings: Settings, day: date) -> None:
    """Waves, parcels and the trip plan of one operating day (each step only once)."""
    _step(db, f"waves:{day.isoformat()}", lambda: seed_waves(db, day))
    _step(
        db,
        f"parcels:{day.isoformat()}",
        lambda: seed_parcels(db, day, settings.seed_parcels_per_day, settings.seed_random_seed),
    )
    _step(db, f"trips:{day.isoformat()}", lambda: build_trip_plan(db, day))


def run_seed(db: Session, settings: Settings, day: date | None = None) -> None:
    day = day or settings.seed_date or datetime.now(TZ).date()
    _step(db, "reference:v1", lambda: seed_reference(db))
    _step(db, "users:v1", lambda: seed_users(db, settings))
    ensure_operating_day(db, settings, day)
