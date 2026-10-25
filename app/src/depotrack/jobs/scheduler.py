"""Periodic background jobs (APScheduler, runs inside the app process)."""

import logging

from apscheduler.schedulers.background import BackgroundScheduler

from depotrack.core.db import get_session_factory
from depotrack.core.sessions import purge_expired_sessions

log = logging.getLogger(__name__)


def purge_sessions_job() -> None:
    with get_session_factory()() as db:
        removed = purge_expired_sessions(db)
    if removed:
        log.info("purged %d expired sessions", removed)


def create_scheduler() -> BackgroundScheduler:
    scheduler = BackgroundScheduler(timezone="UTC")
    scheduler.add_job(purge_sessions_job, "interval", minutes=15, id="purge_sessions")
    return scheduler
