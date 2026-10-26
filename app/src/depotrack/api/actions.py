"""WMS actions started from the digital shadow (ADR-048). The scene only mirrors reality; these
ordinary API calls with RBAC are the human decisions that change it (ADR-045).

PATCH /api/trips/{id}/door              move an outbound trip to another loading door (dispatcher)
POST  /api/devices/{code}/maintenance   take a device out of service for a while (dispatcher)
GET   /api/maintenance                  recent maintenance orders (dispatcher, security)

Acknowledging an alarm uses the existing POST /api/alerts/{id}/ack.
"""

import logging
from datetime import datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path, status
from sqlalchemy import select

from depotrack.core.rbac import DbSession, require_role
from depotrack.models import Door, MaintenanceOrder, Trip, User
from depotrack.models.enums import DoorKind, TripKind, TripStatus, UserRole
from depotrack.schemas.shadow import DoorChangeIn, MaintenanceIn, MaintenanceOut
from depotrack.schemas.wms import TripBrief
from depotrack.services import telematics
from depotrack.services.loading import FINISHED
from depotrack.services.views import Lookup, trip_brief

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["actions"])

Dispatcher = Annotated[User, Depends(require_role(UserRole.DISPATCHER))]
Viewer = Annotated[User, Depends(require_role(UserRole.DISPATCHER, UserRole.SECURITY))]
DeviceCode = Annotated[str, Path(min_length=3, max_length=32, pattern=r"^[A-Z0-9-]+$")]

MOVABLE = (TripStatus.PLANNED, TripStatus.AT_DOOR)
# without a planned arrival the truck is expected at the door this long before departure
AT_DOOR_BEFORE = timedelta(hours=4)


def _window(t: Trip) -> tuple[datetime, datetime] | None:
    if t.planned_departure is None:
        return None
    return (t.planned_arrival or t.planned_departure - AT_DOOR_BEFORE, t.planned_departure)


@router.patch("/trips/{trip_id}/door", response_model=TripBrief, response_model_by_alias=True)
def move_trip(trip_id: int, body: DoorChangeIn, user: Dispatcher, db: DbSession) -> TripBrief:
    trip = db.get(Trip, trip_id)
    if trip is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown trip")
    if trip.kind != TripKind.OUTBOUND:
        raise HTTPException(status.HTTP_409_CONFLICT, "Only outbound trips load at a door")
    if trip.status not in MOVABLE:
        raise HTTPException(status.HTTP_409_CONFLICT, "The trip is already loading or has left")
    # the row lock serialises two dispatchers moving trucks to the same door at once
    door = db.execute(
        select(Door)
        .where(Door.code == body.door_code, Door.kind == DoorKind.LOADING_DOCK)
        .with_for_update()
    ).scalar_one_or_none()
    if door is None or door.depot_id != trip.depot_id:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "Not a loading door of this depot"
        )
    look = Lookup(db)
    if door.id != trip.door_id:
        mine = _window(trip)
        others = db.execute(
            select(Trip).where(
                Trip.door_id == door.id,
                Trip.kind == TripKind.OUTBOUND,
                Trip.id != trip.id,
                Trip.status.not_in(FINISHED),
            )
        ).scalars()
        for other in others:
            theirs = _window(other)
            if mine and theirs and mine[0] < theirs[1] and theirs[0] < mine[1]:
                name = look.directions[other.direction_id].name
                raise HTTPException(
                    status.HTTP_409_CONFLICT, f"Door {door.code} is taken by the trip to {name}"
                )
        old = look.doors[trip.door_id].code if trip.door_id else None
        trip.door_id = door.id
        db.commit()
        log.info("trip %s moved from door %s to %s by %s", trip.id, old, door.code, user.username)
        # the simulator scans this truck at the new door from now on; if telematics is down,
        # it picks the change up with the next day it loads (ADR-048)
        if not telematics.reload_plan():
            log.warning("telematics did not reload the plan after moving trip %s", trip.id)
    return trip_brief(db, trip, Lookup(db), telematics.sim_now(), with_load=True)


@router.post(
    "/devices/{code}/maintenance",
    response_model=MaintenanceOut,
    response_model_by_alias=True,
    status_code=status.HTTP_201_CREATED,
)
def start_maintenance(
    code: DeviceCode, body: MaintenanceIn, user: Dispatcher, db: DbSession
) -> MaintenanceOrder:
    known = telematics.devices()
    if not known:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Telematics is not available")
    if code not in {str(d.get("code")) for d in known}:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown device")
    now = telematics.sim_now()
    order = MaintenanceOrder(
        device_code=code,
        note=body.note,
        minutes=body.minutes,
        created_by=user.id,
        created_at=now,
        until=now + timedelta(minutes=body.minutes),
    )
    db.add(order)
    db.flush()  # the order is valid before the device goes out of service
    if telematics.start_maintenance(code, body.minutes) is None:
        db.rollback()
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Telematics is not available")
    db.commit()
    log.info("device %s in maintenance for %s min (by %s)", code, body.minutes, user.username)
    return order


@router.get("/maintenance", response_model=list[MaintenanceOut], response_model_by_alias=True)
def maintenance_orders(_: Viewer, db: DbSession) -> list[MaintenanceOrder]:
    return list(
        db.execute(
            select(MaintenanceOrder)
            .order_by(MaintenanceOrder.created_at.desc(), MaintenanceOrder.id.desc())
            .limit(20)
        ).scalars()
    )
