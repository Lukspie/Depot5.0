"""Data of an operating day and the whole seed (idempotent steps recorded in seed_meta)."""

from datetime import date, datetime, timedelta

from sqlalchemy import delete, or_, select, update
from sqlalchemy.orm import Session

from depotrack.core.clock import TZ
from depotrack.core.config import Settings
from depotrack.models import (
    Alert,
    Door,
    LoadingScan,
    MaintenanceOrder,
    Parcel,
    ParcelEvent,
    SeedMeta,
    Trip,
)
from depotrack.models.enums import DoorKind, ParcelStatus, TripStatus
from depotrack.seed import (
    seed_gate_plates,
    seed_parcels,
    seed_reference,
    seed_users,
    seed_users_v2,
    seed_waves,
    step,
)
from depotrack.seed.depots import data_version
from depotrack.seed.geo import seed_depot_layouts, seed_geo
from depotrack.seed.operations import (
    BAH_OPS,
    ZIL_OPS,
    seed_depot_operations,
    seed_home_depots,
    seed_parked_vans,
)
from depotrack.services.alerts import close_stale_alerts
from depotrack.services.couriers import build_courier_routes, replan_routes, reset_routes
from depotrack.services.gate import close_stale_events, delete_day
from depotrack.services.parcels import in_day, night_parcels_for
from depotrack.services.trip_plan import OPERATING_DAY_START, build_trip_plan


def ensure_operating_day(db: Session, settings: Settings, day: date) -> None:
    """Waves, parcels and the trip plan of one operating day (each step only once)."""
    step(db, f"waves:{day.isoformat()}", lambda: seed_waves(db, day))
    step(
        db,
        f"parcels:{day.isoformat()}",
        lambda: seed_parcels(db, day, settings.seed_parcels_per_day, settings.seed_random_seed),
    )
    step(db, f"trips:{day.isoformat()}", lambda: build_trip_plan(db, day))
    step(
        db,
        f"night-parcels:{day.isoformat()}",
        lambda: night_parcels_for(db, day, settings.seed_random_seed),
    )
    step(db, f"couriers:{day.isoformat()}", lambda: build_courier_routes(db, day))
    # depots added in phase 7c on a day that was planned before them
    step(
        db,
        f"couriers-depots:{day.isoformat()}:v2",
        lambda: build_courier_routes(db, day, only=("ZIL", "BAH")),
    )
    step(db, f"courier-windows:{day.isoformat()}", lambda: replan_routes(db, day))
    if close_stale_alerts(db, day) + close_stale_events(db, day):
        db.commit()


def run_seed(db: Session, settings: Settings, day: date | None = None) -> None:
    day = day or settings.seed_date or datetime.now(TZ).date()
    step(db, "reference:v1", lambda: seed_reference(db))
    step(db, "users:v1", lambda: seed_users(db, settings))
    step(db, "users:v2", lambda: seed_users_v2(db, settings))
    step(db, "geo:v1", lambda: seed_geo(db))
    step(db, "gate-plates:v1", lambda: seed_gate_plates(db))
    step(db, f"depot-layouts:{data_version()}", lambda: seed_depot_layouts(db))
    step(db, "depot-ops:ZIL:v1", lambda: seed_depot_operations(db, settings, ZIL_OPS))
    step(db, "depot-ops:BAH:v1", lambda: seed_depot_operations(db, settings, BAH_OPS))
    step(db, "depot-fleet:DS-TN:v1", lambda: seed_parked_vans(db))
    step(db, "users-home-depot:v1", lambda: seed_home_depots(db))
    ensure_operating_day(db, settings, day)


def reset_operating_day(db: Session, day: date, *, clean: bool = False) -> dict[str, int]:
    """Undo the execution of a day (the simulation replays it from 15:00, ADR-033):
    trips back to planned, parcels back to collected, loading scans and the day's alerts removed,
    courier routes back to planned (tracking links and simulated SMS removed).
    The plan and the parcels themselves stay, so the replay is deterministic; trips moved to
    another door from the digital shadow go back to the default door (ADR-048).

    `clean` (clean reset, ADR-053) also removes the day's maintenance orders and closes the open
    alerts of older days (closed by the system at the start of the day, kept for the audit)."""
    start = datetime.combine(day, OPERATING_DAY_START, TZ)
    trip_ids = list(db.execute(select(Trip.id).where(Trip.operating_day == day)).scalars())
    parcel_ids = select(Parcel.id).where(in_day(day)).scalar_subquery()
    scans = db.execute(delete(LoadingScan).where(LoadingScan.trip_id.in_(trip_ids)))
    events = db.execute(
        delete(ParcelEvent).where(
            ParcelEvent.parcel_id.in_(parcel_ids),
            or_(ParcelEvent.status != ParcelStatus.COLLECTED, ParcelEvent.checkpoint.is_not(None)),
        )
    )
    parcels = db.execute(update(Parcel).where(in_day(day)).values(status=ParcelStatus.COLLECTED))
    default_dock = (
        select(Door.id)
        .where(Door.direction_id == Trip.direction_id, Door.kind == DoorKind.LOADING_DOCK)
        .limit(1)
        .scalar_subquery()
    )
    db.execute(
        update(Trip)
        .where(Trip.id.in_(trip_ids))
        .values(
            status=TripStatus.PLANNED,
            actual_arrival=None,
            actual_departure=None,
            predicted_arrival=None,
            predicted_by=None,
            door_id=default_dock,
        )
        .execution_options(synchronize_session=False)
    )
    end = start + timedelta(days=1)
    # only this day: alerts of later days (already simulated) stay for the audit
    alerts = db.execute(delete(Alert).where(Alert.created_at >= start, Alert.created_at < end))
    gate = delete_day(db, start, end)
    maintenance = closed = 0
    if clean:
        maintenance = _rowcount(
            db.execute(
                delete(MaintenanceOrder).where(
                    MaintenanceOrder.created_at >= start, MaintenanceOrder.created_at < end
                )
            )
        )
        closed = _rowcount(
            db.execute(
                update(Alert)
                .where(Alert.acknowledged_at.is_(None), Alert.created_at < start)
                .values(acknowledged_at=start)
            )
        )
    routes = reset_routes(db, day)
    # nothing of the routes happened now: they get the window-aware order (ADR-062)
    replan_routes(db, day)
    db.execute(delete(SeedMeta).where(SeedMeta.key == f"staged:{day.isoformat()}"))
    db.commit()
    return {
        "trips": len(trip_ids),
        "parcels": int(getattr(parcels, "rowcount", 0) or 0),
        "events": int(getattr(events, "rowcount", 0) or 0),
        "scans": int(getattr(scans, "rowcount", 0) or 0),
        "alerts": int(getattr(alerts, "rowcount", 0) or 0),
        "courierRoutes": routes,
        "maintenanceOrders": maintenance,
        "alertsClosed": closed,
        "gateEvents": gate,
    }


def _rowcount(result: object) -> int:
    return int(getattr(result, "rowcount", 0) or 0)
