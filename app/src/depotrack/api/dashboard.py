"""Dispatcher dashboard (/), alerts and the public ETA board (/board)."""

import hmac
from collections import Counter
from datetime import date, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request, status
from sqlalchemy import func, select

from depotrack.core.config import Settings, get_settings
from depotrack.core.ratelimit import limiter
from depotrack.core.rbac import DbSession, require_role
from depotrack.models import Alert, LoadingScan, Parcel, Trip, User
from depotrack.models.enums import (
    AlertKind,
    ParcelStatus,
    ScanResult,
    TripKind,
    TripStatus,
    UserRole,
)
from depotrack.schemas.internal import AlertOut
from depotrack.schemas.wms import (
    AlertListOut,
    BoardOut,
    DashboardKpis,
    DashboardOut,
    DeviceSummary,
    DirectionRow,
    TripBrief,
)
from depotrack.services import telematics
from depotrack.services.alerts import alert_event
from depotrack.services.parcels import LOADABLE, in_day
from depotrack.services.views import DONE, Lookup, clock, sort_key, trip_brief, trips_of

router = APIRouter(prefix="/api", tags=["dashboard"])

Dispatcher = Annotated[User, Depends(require_role(UserRole.DISPATCHER))]
Staff = Annotated[
    User, Depends(require_role(UserRole.DISPATCHER, UserRole.OPERATOR, UserRole.SECURITY))
]

WAITING = (ParcelStatus.COLLECTED, ParcelStatus.ON_BELT)


def open_alerts(db: DbSession, limit: int = 50) -> list[Alert]:
    return list(
        db.execute(
            select(Alert)
            .where(Alert.acknowledged_at.is_(None))
            .order_by(Alert.created_at.desc(), Alert.id.desc())
            .limit(limit)
        ).scalars()
    )


def day_read_rate(db: DbSession, day: date) -> float | None:
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


@router.get("/dashboard", response_model=DashboardOut, response_model_by_alias=True)
def dashboard(_: Dispatcher, db: DbSession) -> DashboardOut:
    clk = clock()
    day = clk.operating_day
    look = Lookup(db)
    trips = sorted(trips_of(db, day), key=sort_key)
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
    alerts = open_alerts(db)
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
    return DashboardOut(
        clock=clk,
        kpis=kpis,
        directions=rows,
        trips=[trip_brief(db, t, look, clk.sim_time, with_load=True) for t in trips],
        alerts=[AlertOut.model_validate(a) for a in alerts],
    )


@router.get("/alerts", response_model=AlertListOut, response_model_by_alias=True)
def list_alerts(
    _: Staff, db: DbSession, include_closed: Annotated[bool, Query(alias="all")] = False
) -> AlertListOut:
    if include_closed:
        rows = list(
            db.execute(select(Alert).order_by(Alert.created_at.desc()).limit(100)).scalars()
        )
    else:
        rows = open_alerts(db, 100)
    return AlertListOut(alerts=[AlertOut.model_validate(a) for a in rows])


@router.post("/alerts/{alert_id}/ack", response_model=AlertOut, response_model_by_alias=True)
def ack_alert(alert_id: int, user: Dispatcher, db: DbSession, background: BackgroundTasks) -> Alert:
    alert = db.get(Alert, alert_id)
    if alert is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Alert not found")
    if alert.acknowledged_at is None:
        alert.acknowledged_at = telematics.sim_now()
        alert.acknowledged_by = user.id
        db.commit()
        background.add_task(telematics.broadcast_many, "alerts", "alert", [alert_event(alert)])
    return alert


def _check_board_key(key: str, settings: Settings) -> None:
    if not settings.board_key or not hmac.compare_digest(key.encode(), settings.board_key.encode()):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Invalid board key")


@router.get("/board", response_model=BoardOut, response_model_by_alias=True, tags=["board"])
@limiter.limit("120/minute")
def board(
    request: Request,
    key: Annotated[str, Query(max_length=128)],
    db: DbSession,
    settings: Annotated[Settings, Depends(get_settings)],
) -> BoardOut:
    """Public read-only ETA board for the depot screens (no login, BOARD_KEY in the URL)."""
    _check_board_key(key, settings)
    clk = clock()
    look = Lookup(db)
    trips = trips_of(db, clk.operating_day)
    # trips of the previous day that are still running (e.g. late night trucks after 15:00)
    trips += [
        t for t in trips_of(db, clk.operating_day - timedelta(days=1)) if t.status not in DONE
    ]

    def brief(t: Trip) -> TripBrief:
        return trip_brief(db, t, look, clk.sim_time)

    arrivals = sorted(
        (t for t in trips if t.kind == TripKind.INBOUND), key=lambda t: _eta(t) or clk.sim_time
    )
    departures = sorted((t for t in trips if t.kind == TripKind.OUTBOUND), key=sort_key)
    warnings = [a for a in open_alerts(db, 100) if a.kind == AlertKind.CASCADE_DELAY]

    devices = telematics.devices()
    states = Counter(str(d.get("status")) for d in devices)
    line = next((d for d in devices if d.get("kind") == "line_scanner"), None)
    return BoardOut(
        clock=clk,
        arrivals=[brief(t) for t in arrivals],
        departures=[brief(t) for t in departures],
        warnings=[AlertOut.model_validate(a) for a in warnings],
        devices=DeviceSummary(
            online=states["online"],
            degraded=states["degraded"],
            offline=states["offline"],
            read_rate=day_read_rate(db, clk.operating_day),
            line_status=str(line.get("status")) if line else "unknown",
        ),
    )


def _eta(t: Trip) -> datetime | None:
    return t.actual_arrival or t.predicted_arrival or t.planned_arrival
