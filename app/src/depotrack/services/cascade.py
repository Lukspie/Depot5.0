"""Delay cascade: a regional (transit) truck may leave only after the night linehaul trucks that
feed it have arrived and been sorted. If

    predicted arrival of the night truck + sorting buffer > planned departure of the transit truck

the transit departure is at risk and dispatchers get a warning (critical when even the arrival
itself is later than the departure).
"""

from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from depotrack.core.clock import local_hhmm
from depotrack.models import Direction, Trip
from depotrack.models.enums import (
    AlertKind,
    AlertSeverity,
    DirectionType,
    TripKind,
    TripStatus,
)
from depotrack.services.alerts import AlertChange, resolve_alert, upsert_alert


def expected_arrival(trip: Trip) -> datetime | None:
    return trip.actual_arrival or trip.predicted_arrival or trip.planned_arrival


def evaluate_cascade(
    db: Session, night_trip: Trip, buffer: timedelta, now: datetime
) -> list[AlertChange]:
    """Check every transit departure fed by `night_trip`; returns created/updated alerts."""
    feeder = db.get(Direction, night_trip.direction_id)
    if (
        feeder is None
        or feeder.type != DirectionType.LINEHAUL
        or night_trip.kind != TripKind.INBOUND
    ):
        return []
    eta = expected_arrival(night_trip)
    if eta is None:
        return []
    ready_at = eta + buffer

    rows = db.execute(
        select(Trip, Direction)
        .join(Direction, Trip.direction_id == Direction.id)
        .where(
            Direction.type == DirectionType.TRANSIT,
            Direction.depends_on_linehaul.contains([feeder.code]),
            Trip.kind == TripKind.OUTBOUND,
            Trip.operating_day == night_trip.operating_day,
        )
    ).all()

    changes: list[AlertChange] = []
    for transit_trip, transit in rows:
        # one alert per (transit departure, feeding night truck): "<transit id>:<night id>"
        ref_id = f"{transit_trip.id}:{night_trip.id}"
        departure = transit_trip.planned_departure
        if transit_trip.status in (TripStatus.DEPARTED, TripStatus.COMPLETED) or departure is None:
            continue
        if ready_at <= departure:
            # the feeder caught up: close a previous warning about this departure
            resolved = resolve_alert(
                db, kind=AlertKind.CASCADE_DELAY, ref_type="cascade", ref_id=ref_id, at=now
            )
            if resolved is not None:
                changes.append(AlertChange(resolved, created=False))
            continue
        severity = AlertSeverity.CRITICAL if eta > departure else AlertSeverity.WARNING
        late_min = int((ready_at - departure).total_seconds() // 60)
        message = (
            f"Prechod {transit.name} (odchod {local_hhmm(departure)}) je ohrozený: "
            f"nočný kamión {feeder.name} príde podľa predikcie o {local_hhmm(eta)}, "
            f"po triedení ({int(buffer.total_seconds() // 60)} min) až o {local_hhmm(ready_at)} "
            f"– oneskorenie odchodu približne {late_min} min."
        )
        changes.append(
            upsert_alert(
                db,
                kind=AlertKind.CASCADE_DELAY,
                severity=severity,
                message=message,
                ref_type="cascade",
                ref_id=ref_id,
                at=now,
            )
        )
    return changes
