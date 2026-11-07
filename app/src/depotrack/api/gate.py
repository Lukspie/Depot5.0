"""Gate camera (phase 6, PROMPT §8.1, ADR-059) and the decisions at the gate (ADR-061):
image -> vehicle type and plate (model), identity from the plate (fleet, allowed plates),
decision by the rules, security decides the uncertain cases. Every decision is audited."""

from datetime import date, datetime
from typing import Annotated, Literal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request, status
from fastapi.concurrency import run_in_threadpool
from pydantic import Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from depotrack.core.rbac import DbSession, require_role
from depotrack.ml.gate import decode_image, gate_models, normalize_plate
from depotrack.models import GateAllowedPlate, GateAudit, GateEvent, User, Vehicle
from depotrack.models.enums import UserRole
from depotrack.schemas.internal import CamelModel
from depotrack.services import gate as rules
from depotrack.services import telematics
from depotrack.services.alerts import AlertChange, alert_event, day_start
from depotrack.services.trip_plan import operating_day_of

router = APIRouter(prefix="/api/gate", tags=["gate"])

Guard = Annotated[User, Depends(require_role(UserRole.SECURITY))]
MAX_BYTES = 8 * 1024 * 1024


class VehicleOut(CamelModel):
    type: str
    confidence: float
    box: tuple[int, int, int, int]
    detail: str | None = None  # ImageNet class of the type classifier, e.g. "moving van"


class GateDetectOut(CamelModel):
    vehicles: list[VehicleOut]
    vehicle_type: str | None
    plate: str | None
    plate_confidence: float | None
    text: str
    # the plate belongs to the fleet (truck or courier van) or to an allowed external vehicle
    expected: bool
    fleet_kind: str | None
    recorded: bool
    # decision of the rules (ADR-061); event_id is None when only read (record=false)
    decision: str
    reason: str
    event_id: int | None


class GateAuditOut(CamelModel):
    at: datetime
    actor: str | None  # None = the rules
    action: str
    reason: str


class GateEventOut(CamelModel):
    id: int
    at: datetime
    source: str
    direction: str
    vehicle_type: str | None
    vehicle_confidence: float | None
    plate: str | None
    plate_confidence: float | None
    fleet_kind: str | None
    allowed_holder: str | None
    decision: str
    reason: str
    resolution: str | None
    resolved_by: str | None
    resolved_at: datetime | None
    note: str | None
    audit: list[GateAuditOut]


class GateDecisionIn(CamelModel):
    action: Literal["allow", "deny", "verify"]
    note: str = Field(default="", max_length=500)


class AllowedPlateIn(CamelModel):
    plate: str = Field(max_length=16)
    holder: str = Field(min_length=2, max_length=120)
    valid_until: date | None = None


class AllowedPlateOut(CamelModel):
    id: int
    plate: str
    holder: str
    valid_until: date | None


@router.post("/detect", response_model=GateDetectOut, response_model_by_alias=True)
async def detect(
    request: Request,
    _: Guard,
    db: DbSession,
    background: BackgroundTasks,
    direction: Annotated[Literal["in", "out"], Query()] = "in",
    record: Annotated[bool, Query()] = True,
) -> GateDetectOut:
    """Body: the image (image/jpeg, image/png, image/webp). With `record` the passage is stored
    with its decision and goes to telematics (yard in the digital shadow)."""
    if not (request.headers.get("content-type") or "").startswith(
        ("image/", "application/octet-stream")
    ):
        raise HTTPException(
            status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "send the image as the request body"
        )
    declared = request.headers.get("content-length")
    if declared is not None and (not declared.isdigit() or int(declared) > MAX_BYTES):
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "image larger than 8 MB")
    data = bytearray()
    async for chunk in request.stream():  # stop reading as soon as the limit is passed
        data += chunk
        if len(data) > MAX_BYTES:
            raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "image larger than 8 MB")
    if not data:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "empty body")
    # decoding, the models, the database and the calls to telematics block: not on the event loop
    return await run_in_threadpool(_process, bytes(data), direction, record, db, background)


def _process(
    data: bytes,
    direction: Literal["in", "out"],
    record: bool,
    db: Session,
    background: BackgroundTasks,
) -> GateDetectOut:
    models = gate_models()
    if models is None:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "gate models unavailable")
    try:
        bgr = decode_image(data)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "not an image") from exc
    reading = models.read(bgr)

    largest = max(
        reading.vehicles,
        key=lambda v: (v.box[2] - v.box[0]) * (v.box[3] - v.box[1]),
        default=None,
    )
    seen = rules.Reading(
        direction=direction,
        vehicle_type=largest.type if largest else None,
        vehicle_confidence=largest.confidence if largest else None,
        plate=reading.plate,
        plate_confidence=reading.plate_confidence,
    )
    at = telematics.sim_now()
    verdict = rules.decide(db, seen, at)
    fleet = verdict.vehicle
    vehicle_type = seen.vehicle_type
    if fleet is not None and vehicle_type is None:
        vehicle_type = "truck" if fleet.kind == "truck" else "van"
    expected = fleet is not None or verdict.allowed is not None
    event_id = None
    recorded = False
    if record and (vehicle_type or reading.plate):
        stored = rules.record(db, seen, at=at, source="camera")
        assert stored is not None  # camera events have no idempotency key
        event, alert = stored
        event_id = event.id
        db.commit()
        _broadcast(background, alert)
        recorded = telematics.post_gate_passage(
            {
                "direction": direction,
                "vehicleType": vehicle_type or "car",
                "plate": reading.plate,
                "plateConfidence": reading.plate_confidence,
                "expected": expected,
            }
        )
    return GateDetectOut(
        vehicles=[
            VehicleOut(type=v.type, confidence=v.confidence, box=v.box, detail=v.detail)
            for v in reading.vehicles
        ],
        vehicle_type=vehicle_type,
        plate=reading.plate,
        plate_confidence=reading.plate_confidence,
        text=reading.text,
        expected=expected,
        fleet_kind=str(fleet.kind) if fleet else None,
        recorded=recorded,
        decision=verdict.decision,
        reason=verdict.reason,
        event_id=event_id,
    )


def _broadcast(background: BackgroundTasks, alert: AlertChange | None) -> None:
    if alert is not None:
        background.add_task(
            telematics.broadcast_many, "alerts", "alert", [alert_event(alert.alert)]
        )


def _events_out(db: Session, events: list[GateEvent]) -> list[GateEventOut]:
    ids = [e.id for e in events]
    audits = list(
        db.execute(
            select(GateAudit).where(GateAudit.event_id.in_(ids)).order_by(GateAudit.id)
        ).scalars()
    )
    user_ids = {a.actor_id for a in audits if a.actor_id} | {
        e.resolved_by for e in events if e.resolved_by
    }
    names = {
        u.id: u.full_name for u in db.execute(select(User).where(User.id.in_(user_ids))).scalars()
    }
    kinds = {
        v.id: str(v.kind)
        for v in db.execute(
            select(Vehicle).where(Vehicle.id.in_({e.vehicle_id for e in events if e.vehicle_id}))
        ).scalars()
    }
    holders = {
        p.id: p.holder
        for p in db.execute(
            select(GateAllowedPlate).where(
                GateAllowedPlate.id.in_({e.allowed_plate_id for e in events if e.allowed_plate_id})
            )
        ).scalars()
    }
    return [
        GateEventOut(
            id=e.id,
            at=e.at,
            source=e.source,
            direction=e.direction,
            vehicle_type=e.vehicle_type,
            vehicle_confidence=e.vehicle_confidence,
            plate=e.plate,
            plate_confidence=e.plate_confidence,
            fleet_kind=kinds.get(e.vehicle_id) if e.vehicle_id else None,
            allowed_holder=holders.get(e.allowed_plate_id) if e.allowed_plate_id else None,
            decision=e.decision,
            reason=e.reason,
            resolution=e.resolution,
            resolved_by=names.get(e.resolved_by) if e.resolved_by else None,
            resolved_at=e.resolved_at,
            note=e.note,
            audit=[
                GateAuditOut(
                    at=a.at,
                    actor=names.get(a.actor_id) if a.actor_id else None,
                    action=a.action,
                    reason=a.reason,
                )
                for a in audits
                if a.event_id == e.id
            ],
        )
        for e in events
    ]


@router.get("/queue", response_model=list[GateEventOut], response_model_by_alias=True)
def queue(_: Guard, db: DbSession) -> list[GateEventOut]:
    """Open decisions for security, oldest first: held vehicles and lorries to verify."""
    events = list(
        db.execute(
            select(GateEvent)
            .where(GateEvent.resolution.is_(None), GateEvent.decision != rules.AUTO_PASS)
            .order_by(GateEvent.at, GateEvent.id)
            .limit(100)
        ).scalars()
    )
    return _events_out(db, events)


@router.get("/events", response_model=list[GateEventOut], response_model_by_alias=True)
def events(
    _: Guard, db: DbSession, limit: Annotated[int, Query(ge=1, le=200)] = 40
) -> list[GateEventOut]:
    """Passages of the current operating day with their decisions and audit, newest first."""
    start = day_start(operating_day_of(telematics.sim_now()))
    rows = list(
        db.execute(
            select(GateEvent)
            .where(GateEvent.at >= start)
            .order_by(GateEvent.at.desc(), GateEvent.id.desc())
            .limit(limit)
        ).scalars()
    )
    return _events_out(db, rows)


@router.post(
    "/events/{event_id}/decision", response_model=GateEventOut, response_model_by_alias=True
)
def decide_event(
    event_id: int,
    body: GateDecisionIn,
    user: Guard,
    db: DbSession,
    background: BackgroundTasks,
) -> GateEventOut:
    """Security decides: allow / deny a held vehicle (note required), verify a lorry."""
    event = db.get(GateEvent, event_id)
    if event is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "gate event not found")
    note = body.note.strip()
    if body.action in ("allow", "deny") and len(note) < 3:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "a note is required")
    at = telematics.sim_now()
    try:
        closed = rules.resolve(db, event, user, body.action, note or "overené ochrankou", at)
    except rules.GateDecisionError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc
    db.commit()
    if closed is not None:
        _broadcast(background, AlertChange(closed, created=False))
    return _events_out(db, [event])[0]


@router.get("/allowed-plates", response_model=list[AllowedPlateOut], response_model_by_alias=True)
def allowed_plates(_: Guard, db: DbSession) -> list[AllowedPlateOut]:
    rows = db.execute(select(GateAllowedPlate).order_by(GateAllowedPlate.plate)).scalars()
    return [
        AllowedPlateOut(id=p.id, plate=p.plate, holder=p.holder, valid_until=p.valid_until)
        for p in rows
    ]


@router.post(
    "/allowed-plates",
    response_model=AllowedPlateOut,
    response_model_by_alias=True,
    status_code=status.HTTP_201_CREATED,
)
def add_allowed_plate(body: AllowedPlateIn, user: Guard, db: DbSession) -> AllowedPlateOut:
    plate = normalize_plate(body.plate)
    if plate is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "not a Slovak plate")
    row = GateAllowedPlate(
        plate=plate, holder=body.holder.strip(), valid_until=body.valid_until, created_by=user.id
    )
    db.add(row)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "plate already allowed") from exc
    return AllowedPlateOut(
        id=row.id, plate=row.plate, holder=row.holder, valid_until=row.valid_until
    )


@router.delete("/allowed-plates/{plate_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_allowed_plate(plate_id: int, _: Guard, db: DbSession) -> None:
    row = db.get(GateAllowedPlate, plate_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "allowed plate not found")
    db.delete(row)
    db.commit()
