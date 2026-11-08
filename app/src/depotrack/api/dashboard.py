"""Dispatcher dashboard (/), alerts and the public ETA board (/board)."""

import hmac
from collections import Counter
from datetime import datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request, status
from sqlalchemy import select

from depotrack.core.config import Settings, get_settings
from depotrack.core.ratelimit import limiter
from depotrack.core.rbac import DbSession, require_role
from depotrack.models import Alert, Trip, User
from depotrack.models.enums import (
    AlertKind,
    TripKind,
    UserRole,
)
from depotrack.schemas.internal import AlertOut
from depotrack.schemas.wms import (
    AlertListOut,
    BoardOut,
    DashboardOut,
    DeviceSummary,
    TripBrief,
)
from depotrack.services import telematics
from depotrack.services.alerts import alert_event
from depotrack.services.kpis import day_overview, day_read_rate, open_alerts
from depotrack.services.views import DONE, Lookup, clock, sort_key, trip_brief, trips_of

router = APIRouter(prefix="/api", tags=["dashboard"])

Dispatcher = Annotated[User, Depends(require_role(UserRole.DISPATCHER))]
Staff = Annotated[
    User, Depends(require_role(UserRole.DISPATCHER, UserRole.OPERATOR, UserRole.SECURITY))
]


@router.get("/dashboard", response_model=DashboardOut, response_model_by_alias=True)
def dashboard(_: Dispatcher, db: DbSession) -> DashboardOut:
    clk = clock()
    day = clk.operating_day
    look = Lookup(db)
    trips = sorted(trips_of(db, day), key=sort_key)
    kpis, rows = day_overview(db, day, trips, look, clk.sim_time)
    alerts = open_alerts(db, day=day)
    return DashboardOut(
        clock=clk,
        kpis=kpis,
        directions=rows,
        trips=[trip_brief(db, t, look, clk.sim_time, with_load=True) for t in trips],
        alerts=[AlertOut.model_validate(a) for a in alerts],
    )


@router.get("/alerts", response_model=AlertListOut, response_model_by_alias=True)
def list_alerts(
    _: Staff,
    db: DbSession,
    include_closed: Annotated[bool, Query(alias="all")] = False,
    current: Annotated[bool, Query()] = False,
) -> AlertListOut:
    """Open alerts; `current` keeps those of the current operating day, as counted in the KPI
    and the top bar (phase 7d); `all` adds the closed ones."""
    if current:
        rows = open_alerts(db, 100, clock().operating_day)
    elif include_closed:
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
    warnings = [
        a for a in open_alerts(db, 100, clk.operating_day) if a.kind == AlertKind.CASCADE_DELAY
    ]

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
