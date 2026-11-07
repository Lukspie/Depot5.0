"""ML models (phase 6, ADR-057): status for the UI and the delay prediction of one trip."""

from datetime import datetime, timedelta
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Path, status

from depotrack.core.rbac import DbSession, require_role
from depotrack.ml.delay import delay_model, model_card
from depotrack.ml.scanner import scanner_model
from depotrack.models import Trip, User
from depotrack.models.enums import TripKind, UserRole
from depotrack.schemas.internal import CamelModel
from depotrack.services import telematics
from depotrack.services.ml_eta import features, predict_delay
from depotrack.services.ml_scanner import LATEST

router = APIRouter(prefix="/api/ml", tags=["ml"])

Staff = Annotated[
    User, Depends(require_role(UserRole.DISPATCHER, UserRole.OPERATOR, UserRole.SECURITY))
]
Dispatcher = Annotated[User, Depends(require_role(UserRole.DISPATCHER))]
Viewer = Annotated[User, Depends(require_role(UserRole.DISPATCHER, UserRole.SECURITY))]


class ScannerRiskOut(CamelModel):
    device: str
    door_code: str | None
    risk: float | None
    alarm: bool
    rate_short: float | None  # read rate over the last 30 min
    rate_long: float | None  # over the last 2 h
    at: datetime


class ScannerRisksOut(CamelModel):
    available: bool
    threshold: float | None
    scanners: list[ScannerRiskOut]


class ModelStatus(CamelModel):
    name: str
    title: str
    available: bool
    metrics: dict[str, Any] | None


class MlStatusOut(CamelModel):
    models: list[ModelStatus]


class DelayPredictionOut(CamelModel):
    trip_id: int
    kind: str
    planned: datetime
    predicted_delay_min: float
    predicted: datetime
    weather: str
    features: dict[str, Any]
    predicted_by: str | None
    current_prediction: datetime | None


@router.get("/status", response_model=MlStatusOut, response_model_by_alias=True)
def ml_status(_: Staff) -> MlStatusOut:
    """Which models are loaded; the UI shows "model nedostupný" for the missing ones."""
    return MlStatusOut(
        models=[
            ModelStatus(
                name="delay",
                title="Predikcia meškania kamiónov",
                available=delay_model() is not None,
                metrics=model_card("delay_model"),
            ),
            ModelStatus(
                name="scanner",
                title="Prediktívna údržba skenerov",
                available=scanner_model() is not None,
                metrics=model_card("scanner_model"),
            ),
        ]
    )


@router.get(
    "/delay/trips/{trip_id}", response_model=DelayPredictionOut, response_model_by_alias=True
)
def predict_trip_delay(
    trip_id: Annotated[int, Path(ge=1)], _: Dispatcher, db: DbSession
) -> DelayPredictionOut:
    model = delay_model()
    if model is None:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "delay model unavailable")
    trip = db.get(Trip, trip_id)
    if trip is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "trip not found")
    planned = trip.planned_arrival if trip.kind == TripKind.INBOUND else trip.planned_departure
    weather = telematics.weather_of(trip.operating_day) or "clear"
    f = features(db, trip, weather)
    delay = predict_delay(db, model, trip, weather)
    if planned is None or f is None or delay is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "trip has no planned time")
    return DelayPredictionOut(
        trip_id=trip.id,
        kind=str(trip.kind),
        planned=planned,
        predicted_delay_min=round(delay, 1),
        predicted=planned + timedelta(minutes=round(delay)),
        weather=weather,
        features=f.__dict__,
        predicted_by=trip.predicted_by,
        current_prediction=trip.predicted_arrival,
    )


@router.get("/scanners", response_model=ScannerRisksOut, response_model_by_alias=True)
def scanner_risks(_: Viewer) -> ScannerRisksOut:
    """Latest risk score of every dock scanner (digital shadow device panel, ADR-058)."""
    model = scanner_model()
    return ScannerRisksOut(
        available=model is not None,
        threshold=model.threshold if model else None,
        scanners=[
            ScannerRiskOut(
                device=r.device,
                door_code=r.door_code,
                risk=None if r.risk is None else round(r.risk, 3),
                alarm=r.alarm,
                rate_short=r.rate_30m,
                rate_long=r.rate_2h,
                at=r.at,
            )
            for r in sorted(LATEST.values(), key=lambda x: x.device)
        ],
    )
