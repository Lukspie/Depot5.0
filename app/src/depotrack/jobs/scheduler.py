"""Periodic background jobs (APScheduler, runs inside the app process)."""

import logging
from datetime import datetime, timedelta

from apscheduler.schedulers.background import BackgroundScheduler

from depotrack.core.config import get_settings
from depotrack.core.db import get_session_factory
from depotrack.core.sessions import purge_expired_sessions
from depotrack.ml.delay import delay_model
from depotrack.ml.scanner import scanner_model
from depotrack.services import telematics
from depotrack.services.alerts import alert_event
from depotrack.services.ml_eta import refresh_ml_eta
from depotrack.services.ml_scanner import score_scanners
from depotrack.services.trip_plan import operating_day_of

log = logging.getLogger(__name__)


def purge_sessions_job() -> None:
    with get_session_factory()() as db:
        removed = purge_expired_sessions(db)
    if removed:
        log.info("purged %d expired sessions", removed)


ML_EVERY = timedelta(minutes=5)  # simulated time (PROMPT §8)
_last_ml_run: datetime | None = None


def ml_job() -> None:
    """Every 5 simulated minutes: scanner risk scores (ADR-058) and the ML arrival prediction
    of the planned trips (ADR-057). Each part on its own: one failing does not stop the other."""
    global _last_ml_run
    now = telematics.sim_now_or_none()
    if now is None:  # never compute with the wall clock
        return
    if _last_ml_run is not None and timedelta(0) <= now - _last_ml_run < ML_EVERY:
        return
    _last_ml_run = now
    try:
        _scanner_part(now)
    except Exception:
        log.exception("ML scanner scoring failed")
    try:
        _eta_part(now)
    except Exception:
        log.exception("ML arrival prediction failed")


def _scanner_part(now: datetime) -> None:
    scanners = scanner_model()
    if scanners is None:
        return
    with get_session_factory()() as db:
        alerts = score_scanners(db, scanners, telematics.devices(), telematics.device_metrics, now)
        db.commit()
        events = [alert_event(c.alert) for c in alerts if c.created]
    if events:
        telematics.broadcast_many("alerts", "alert", events)


def _eta_part(now: datetime) -> None:
    model = delay_model()
    if model is None:
        return
    day = operating_day_of(now)
    weather = telematics.weather_of(day)
    if weather is None:
        return
    buffer = timedelta(minutes=get_settings().cascade_buffer_min)
    with get_session_factory()() as db:
        changed, alerts = refresh_ml_eta(db, model, day, weather, now, buffer)
        db.commit()
        events = [alert_event(c.alert) for c in alerts]
    if changed:
        log.info("ML ETA updated for %d trips", changed)
    if events:
        telematics.broadcast_many("alerts", "alert", events)


def create_scheduler() -> BackgroundScheduler:
    scheduler = BackgroundScheduler(timezone="UTC")
    scheduler.add_job(purge_sessions_job, "interval", minutes=15, id="purge_sessions")
    # real seconds; the job itself waits for 5 simulated minutes
    scheduler.add_job(ml_job, "interval", seconds=5, id="ml", max_instances=1, coalesce=True)
    return scheduler
