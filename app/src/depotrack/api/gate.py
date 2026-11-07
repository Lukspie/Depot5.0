"""Gate camera (phase 6, PROMPT §8.1, ADR-059): image -> vehicle type, licence plate, passage."""

from typing import Annotated, Literal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request, status
from fastapi.concurrency import run_in_threadpool
from sqlalchemy import select

from depotrack.core.rbac import DbSession, require_role
from depotrack.ml.gate import decode_image, gate_models
from depotrack.models import User, Vehicle
from depotrack.models.enums import AlertKind, AlertSeverity, UserRole
from depotrack.schemas.internal import CamelModel
from depotrack.services import telematics
from depotrack.services.alerts import alert_event, upsert_alert

router = APIRouter(prefix="/api/gate", tags=["gate"])

Guard = Annotated[User, Depends(require_role(UserRole.SECURITY))]
MAX_BYTES = 8 * 1024 * 1024


class VehicleOut(CamelModel):
    type: str
    confidence: float
    box: tuple[int, int, int, int]


class GateDetectOut(CamelModel):
    vehicles: list[VehicleOut]
    vehicle_type: str | None
    plate: str | None
    plate_confidence: float | None
    text: str
    # the plate belongs to a vehicle of the fleet (truck or courier van)
    expected: bool
    fleet_kind: str | None
    recorded: bool


@router.post("/detect", response_model=GateDetectOut, response_model_by_alias=True)
async def detect(
    request: Request,
    _: Guard,
    db: DbSession,
    background: BackgroundTasks,
    direction: Annotated[Literal["in", "out"], Query()] = "in",
    record: Annotated[bool, Query()] = True,
) -> GateDetectOut:
    """Body: the image (image/jpeg, image/png, image/webp). With `record` a passage goes to
    telematics (yard in the digital shadow) and an unknown plate raises an alert."""
    if not (request.headers.get("content-type") or "").startswith(
        ("image/", "application/octet-stream")
    ):
        raise HTTPException(
            status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "send the image as the request body"
        )
    data = await request.body()
    if not data:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "empty body")
    if len(data) > MAX_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "image larger than 8 MB")
    models = gate_models()
    if models is None:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "gate models unavailable")
    try:
        bgr = decode_image(data)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "not an image") from exc
    reading = await run_in_threadpool(models.read, bgr)

    largest = max(
        reading.vehicles,
        key=lambda v: (v.box[2] - v.box[0]) * (v.box[3] - v.box[1]),
        default=None,
    )
    vehicle_type = largest.type if largest else None
    fleet = (
        db.execute(select(Vehicle).where(Vehicle.plate == reading.plate)).scalar_one_or_none()
        if reading.plate
        else None
    )
    expected = fleet is not None
    if fleet is not None and vehicle_type is None:
        vehicle_type = "truck" if fleet.kind == "truck" else "van"
    recorded = False
    if record and (vehicle_type or reading.plate):
        recorded = telematics.post_gate_passage(
            {
                "direction": direction,
                "vehicleType": vehicle_type or "car",
                "plate": reading.plate,
                "plateConfidence": reading.plate_confidence,
                "expected": expected,
            }
        )
        if reading.plate and not expected:
            change = upsert_alert(
                db,
                kind=AlertKind.OTHER,
                severity=AlertSeverity.WARNING,
                message=f"Neznáma ŠPZ na bráne: {reading.plate} ({vehicle_type or 'vozidlo'})",
                ref_type="plate",
                ref_id=reading.plate,
                at=telematics.sim_now(),
            )
            db.commit()
            background.add_task(
                telematics.broadcast_many, "alerts", "alert", [alert_event(change.alert)]
            )
    return GateDetectOut(
        vehicles=[
            VehicleOut(type=v.type, confidence=v.confidence, box=v.box) for v in reading.vehicles
        ],
        vehicle_type=vehicle_type,
        plate=reading.plate,
        plate_confidence=reading.plate_confidence,
        text=reading.text,
        expected=expected,
        fleet_kind=str(fleet.kind) if fleet else None,
        recorded=recorded,
    )
