"""Alerts: one open alert per (kind, subject); repeated detections update it instead of spamming."""

from dataclasses import dataclass
from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from depotrack.models import Alert
from depotrack.models.enums import AlertKind, AlertSeverity


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
