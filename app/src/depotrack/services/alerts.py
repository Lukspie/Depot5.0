"""Alerts: one open alert per (kind, subject); repeated detections update it instead of spamming."""

from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any

from sqlalchemy import ColumnElement, or_, select, update
from sqlalchemy.orm import Session

from depotrack.core.clock import TZ
from depotrack.models import Alert
from depotrack.models.enums import AlertKind, AlertSeverity
from depotrack.services.trip_plan import OPERATING_DAY_START

# alerts about the live state of a device stay open across days until the device recovers
DEVICE_KINDS = (AlertKind.DEVICE_OFFLINE, AlertKind.SCANNER_DEGRADATION)


def day_start(day: date) -> datetime:
    return datetime.combine(day, OPERATING_DAY_START, TZ)


def current_alerts(day: date) -> ColumnElement[bool]:
    """Alerts that belong to the operating day `day`: raised during it, or about a device."""
    return or_(Alert.kind.in_(DEVICE_KINDS), Alert.created_at >= day_start(day))


def close_stale_alerts(db: Session, day: date) -> int:
    """Close (by the system, kept for the audit) the open trip and parcel alerts of days before
    the previous one. Called when an operating day is loaded; the previous day stays untouched
    because telematics loads the next day 2 h before the current one ends (phase 5d)."""
    result = db.execute(
        update(Alert)
        .where(
            Alert.acknowledged_at.is_(None),
            Alert.kind.not_in(DEVICE_KINDS),
            Alert.created_at < day_start(day - timedelta(days=1)),
        )
        .values(acknowledged_at=day_start(day - timedelta(days=1)))
    )
    return int(getattr(result, "rowcount", 0) or 0)


@dataclass(frozen=True)
class AlertChange:
    alert: Alert
    created: bool


def upsert_alert(
    db: Session,
    *,
    kind: AlertKind,
    severity: AlertSeverity,
    message: str,
    ref_type: str | None,
    ref_id: str | None,
    at: datetime,
) -> AlertChange:
    existing = db.execute(
        select(Alert).where(
            Alert.kind == kind,
            Alert.ref_type == ref_type,
            Alert.ref_id == ref_id,
            Alert.acknowledged_at.is_(None),
        )
    ).scalar_one_or_none()
    if existing is not None:
        existing.message = message
        existing.severity = severity
        return AlertChange(existing, created=False)
    alert = Alert(
        kind=kind,
        severity=severity,
        message=message,
        ref_type=ref_type,
        ref_id=ref_id,
        created_at=at,
    )
    db.add(alert)
    db.flush()
    return AlertChange(alert, created=True)


def resolve_alert(
    db: Session, *, kind: AlertKind, ref_type: str, ref_id: str, at: datetime
) -> Alert | None:
    """Close an open alert whose cause disappeared (acknowledged by the system, no user)."""
    alert = db.execute(
        select(Alert).where(
            Alert.kind == kind,
            Alert.ref_type == ref_type,
            Alert.ref_id == ref_id,
            Alert.acknowledged_at.is_(None),
        )
    ).scalar_one_or_none()
    if alert is not None:
        alert.acknowledged_at = at
    return alert


def alert_event(alert: Alert) -> dict[str, Any]:
    """Payload for the WebSocket `alerts` channel."""
    return {
        "id": alert.id,
        "kind": alert.kind.value,
        "severity": alert.severity.value,
        "message": alert.message,
        "refType": alert.ref_type,
        "refId": alert.ref_id,
        "createdAt": alert.created_at.isoformat(),
        "acknowledgedAt": alert.acknowledged_at.isoformat() if alert.acknowledged_at else None,
    }
