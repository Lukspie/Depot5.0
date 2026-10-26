"""Data of an operating day and the whole seed (idempotent steps recorded in seed_meta)."""

from datetime import date, datetime

from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from depotrack.core.clock import TZ
from depotrack.core.config import Settings
from depotrack.models import Alert, LoadingScan, Parcel, ParcelEvent, SeedMeta, Trip
from depotrack.models.enums import ParcelStatus, TripStatus
from depotrack.seed import seed_parcels, seed_reference, seed_users, seed_waves, step
from depotrack.seed.geo import seed_geo
from depotrack.services.couriers import build_courier_routes, reset_routes
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


def run_seed(db: Session, settings: Settings, day: date | None = None) -> None:
    day = day or settings.seed_date or datetime.now(TZ).date()
    step(db, "reference:v1", lambda: seed_reference(db))
    step(db, "users:v1", lambda: seed_users(db, settings))
    step(db, "geo:v1", lambda: seed_geo(db))
    ensure_operating_day(db, settings, day)


def reset_operating_day(db: Session, day: date) -> dict[str, int]:
    """Undo the execution of a day (the simulation replays it from 15:00, ADR-033):
    trips back to planned, parcels back to collected, loading scans and the day's alerts removed,
    courier routes back to planned (tracking links and simulated SMS removed).
    The plan and the parcels themselves stay, so the replay is deterministic."""
    start = datetime.combine(day, OPERATING_DAY_START, TZ)
    trip_ids = list(db.execute(select(Trip.id).where(Trip.operating_day == day)).scalars())
    parcel_ids = select(Parcel.id).where(in_day(day)).scalar_subquery()
    scans = db.execute(delete(LoadingScan).where(LoadingScan.trip_id.in_(trip_ids)))
    events = db.execute(
        delete(ParcelEvent).where(
            ParcelEvent.parcel_id.in_(parcel_ids), ParcelEvent.status != ParcelStatus.COLLECTED
        )
    )
    parcels = db.execute(update(Parcel).where(in_day(day)).values(status=ParcelStatus.COLLECTED))
    db.execute(
        update(Trip)
        .where(Trip.id.in_(trip_ids))
        .values(
            status=TripStatus.PLANNED,
            actual_arrival=None,
            actual_departure=None,
            predicted_arrival=None,
        )
    )
    alerts = db.execute(delete(Alert).where(Alert.created_at >= start))
    routes = reset_routes(db, day)
    db.execute(delete(SeedMeta).where(SeedMeta.key == f"staged:{day.isoformat()}"))
    db.commit()
    return {
        "trips": len(trip_ids),
        "parcels": int(getattr(parcels, "rowcount", 0) or 0),
        "events": int(getattr(events, "rowcount", 0) or 0),
        "scans": int(getattr(scans, "rowcount", 0) or 0),
        "alerts": int(getattr(alerts, "rowcount", 0) or 0),
        "courierRoutes": routes,
    }
