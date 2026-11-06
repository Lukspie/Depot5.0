"""ML arrival prediction for trips that have not started yet (phase 6, ADR-057).

Before a truck leaves, telematics knows nothing about its arrival; the delay model predicts it from
the plan, the simulated weather and yesterday's delay of the same trip. Once telematics reports
its own prediction (position, breakdown) that one wins (`Trip.predicted_by`).
"""

from datetime import date, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from depotrack.core.clock import TZ
from depotrack.ml.delay import DelayFeatures, DelayModel
from depotrack.models import Direction, Trip
from depotrack.models.enums import TripKind, TripStatus
from depotrack.services.alerts import AlertChange
from depotrack.services.cascade import evaluate_cascade

ML = "ml"
TELEMATICS = "telematics"
# planned trips only: once on the road telematics predicts from the position
OPEN = (TripStatus.PLANNED,)


def _planned_at(trip: Trip) -> datetime | None:
    return trip.planned_arrival if trip.kind == TripKind.INBOUND else trip.planned_departure


def _actual_delay(trip: Trip) -> float | None:
    planned = _planned_at(trip)
    actual = trip.actual_arrival if trip.kind == TripKind.INBOUND else trip.actual_departure
    if planned is None or actual is None:
        return None
    return (actual - planned).total_seconds() / 60


def features(db: Session, trip: Trip, weather: str) -> DelayFeatures | None:
    planned = _planned_at(trip)
    direction = db.get(Direction, trip.direction_id)
    if planned is None or direction is None:
        return None
    local = planned.astimezone(TZ)
    yesterday = db.execute(
        select(Trip).where(
            Trip.direction_id == trip.direction_id,
            Trip.kind == trip.kind,
            Trip.operating_day == trip.operating_day - timedelta(days=1),
        )
    ).scalar_one_or_none()
    prev = _actual_delay(yesterday) if yesterday else None
    return DelayFeatures(
        direction=direction.code,
        kind=str(trip.kind),
        weekday=local.isoweekday(),
        month=local.month,
        hour=local.hour,
        weather=weather,
        prev_delay_min=max(prev, 0.0) if prev is not None else 0.0,
    )


def predict_delay(db: Session, model: DelayModel, trip: Trip, weather: str) -> float | None:
    f = features(db, trip, weather)
    return None if f is None else model.predict([f])[0]


def refresh_ml_eta(
    db: Session, model: DelayModel, day: date, weather: str, now: datetime, buffer: timedelta
) -> tuple[int, list[AlertChange]]:
    """Predict the arrival of the planned inbound trips of `day` that telematics has not predicted
    yet; re-evaluates the cascade for night trucks whose prediction changed.
    Returns the number of changed trips and the alert changes (for the WebSocket)."""
    trips = db.execute(
        select(Trip).where(
            Trip.operating_day == day,
            Trip.kind == TripKind.INBOUND,
            Trip.status.in_(OPEN),
            Trip.planned_arrival.is_not(None),
        )
    ).scalars()
    changed = 0
    alerts: list[AlertChange] = []
    for trip in trips:
        if trip.predicted_by == TELEMATICS or trip.planned_arrival is None:
            continue
        delay = predict_delay(db, model, trip, weather)
        if delay is None:
            continue
        eta = trip.planned_arrival + timedelta(minutes=round(delay))
        if trip.predicted_arrival != eta or trip.predicted_by != ML:
            trip.predicted_arrival = eta
            trip.predicted_by = ML
            alerts.extend(evaluate_cascade(db, trip, buffer, now))
            changed += 1
    return changed, alerts
