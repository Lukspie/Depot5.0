"""KPIs of the operating day, shared by the dispatcher dashboard and the digital shadow."""

from collections import Counter
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from depotrack.models import Alert, LoadingScan, Parcel, Trip
from depotrack.models.enums import ParcelStatus, ScanResult, TripKind, TripStatus
from depotrack.schemas.wms import DashboardKpis, DirectionRow
from depotrack.services.parcels import LOADABLE, in_day
from depotrack.services.views import DONE, Lookup

WAITING = (ParcelStatus.COLLECTED, ParcelStatus.ON_BELT)


def open_alerts(db: Session, limit: int = 50) -> list[Alert]:
    return list(
        db.execute(
            select(Alert)
            .where(Alert.acknowledged_at.is_(None))
            .order_by(Alert.created_at.desc(), Alert.id.desc())
            .limit(limit)
        ).scalars()
    )


def day_read_rate(db: Session, day: date) -> float | None:
    """Share of items at the loading doors whose label was read (operating day)."""
    rows = dict(
        db.execute(
            select(LoadingScan.result, func.count())
            .join(Trip, LoadingScan.trip_id == Trip.id)
            .where(Trip.operating_day == day)
            .group_by(LoadingScan.result)
        )
        .tuples()
        .all()
    )
    counted = sum(rows.values())
    if counted == 0:
        return None
    return round(1 - rows.get(ScanResult.UNIDENTIFIED, 0) / counted, 4)


def day_overview(
    db: Session, day: date, trips: list[Trip], look: Lookup
) -> tuple[DashboardKpis, list[DirectionRow]]:
    """Parcel counts per direction and the KPI row of the operating day."""
    departed_dirs = {
        t.direction_id for t in trips if t.kind == TripKind.OUTBOUND and t.status in DONE
    }
    counts = db.execute(
        select(Parcel.direction_id, Parcel.status, func.count())
        .where(in_day(day))
        .group_by(Parcel.direction_id, Parcel.status)
    ).all()
    per_dir: dict[int, Counter[ParcelStatus]] = {}
    for direction_id, st, n in counts:
        per_dir.setdefault(direction_id, Counter())[st] += n

    rows: list[DirectionRow] = []
    for d in sorted(look.directions.values(), key=lambda d: (d.type.value, d.code)):
        c = per_dir.get(d.id, Counter())
        loadable = sum(c[s] for s in LOADABLE)
        missing = loadable if d.id in departed_dirs else 0
        rows.append(
            DirectionRow(
                code=d.code,
                name=d.name,
                type=d.type,
                total=sum(c.values()),
                loaded=c[ParcelStatus.LOADED],
                staged=c[ParcelStatus.STAGED] + c[ParcelStatus.SORTED],
                waiting=sum(c[s] for s in WAITING),
                missing=missing,
            )
        )

    totals: Counter[ParcelStatus] = Counter()
    for c in per_dir.values():
        totals.update(c)
    unidentified = db.execute(
        select(func.count())
        .select_from(LoadingScan)
        .join(Trip, LoadingScan.trip_id == Trip.id)
        .where(Trip.operating_day == day, LoadingScan.result == ScanResult.UNIDENTIFIED)
    ).scalar_one()
    on_site = {t.vehicle_id for t in trips if t.status in (TripStatus.AT_DOOR, TripStatus.LOADING)}
    kpis = DashboardKpis(
        parcels_total=sum(totals.values()),
        parcels_loaded=totals[ParcelStatus.LOADED],
        parcels_staged=totals[ParcelStatus.STAGED],
        parcels_sorted=totals[ParcelStatus.SORTED],
        parcels_waiting=sum(totals[s] for s in WAITING),
        parcels_missing=sum(r.missing for r in rows),
        trucks_on_site=len(on_site),
        read_rate=day_read_rate(db, day),
        unidentified=unidentified,
        open_alerts=db.execute(
            select(func.count()).select_from(Alert).where(Alert.acknowledged_at.is_(None))
        ).scalar_one(),
    )
    return kpis, rows
