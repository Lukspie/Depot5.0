"""Loading screen (/loading): doors, live state of the truck at a door, manual hand-scanner."""

from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy import select

from depotrack.core.rbac import DbSession, require_role
from depotrack.models import Door, LoadingScan, User
from depotrack.models.enums import EventSource, ScanResult, UserRole
from depotrack.schemas.wms import DoorSummary, LoadingView, ManualScanIn, ManualScanOut, ScanOut
from depotrack.services import telematics
from depotrack.services.alerts import alert_event
from depotrack.services.loading import (
    active_trip_at,
    depot_docks,
    loading_dock,
    missing_parcels,
    process_scan,
    scan_event,
)
from depotrack.services.views import Lookup, parcel_brief, scan_out, trip_brief

router = APIRouter(prefix="/api/loading", tags=["loading"])

Operator = Annotated[User, Depends(require_role(UserRole.OPERATOR))]

MESSAGES = {
    ScanResult.OK: "Naložené",
    ScanResult.WRONG_DIRECTION: "ZLÝ SMER – balík nepatrí do tohto kamióna, vyložte ho",
    ScanResult.DUPLICATE: "Balík už je naložený (duplicitný sken)",
    ScanResult.UNIDENTIFIED: "Neznámy čiarový kód",
}


def _door_summary(db: DbSession, door: Door, look: Lookup) -> DoorSummary:
    now = telematics.sim_now()
    trip = active_trip_at(db, door)
    default = look.directions.get(door.direction_id) if door.direction_id else None
    return DoorSummary(
        code=door.code,
        default_direction=default.code if default else None,
        trip=trip_brief(db, trip, look, now, with_load=True) if trip else None,
    )


def _door_or_404(db: DbSession, code: str) -> Door:
    door = loading_dock(db, code)
    if door is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown loading door")
    return door


@router.get("/doors", response_model=list[DoorSummary], response_model_by_alias=True)
def doors(_: Operator, db: DbSession) -> list[DoorSummary]:
    look = Lookup(db)
    return [_door_summary(db, d, look) for d in depot_docks(db)]


@router.get("/doors/{code}", response_model=LoadingView, response_model_by_alias=True)
def door_view(code: str, _: Operator, db: DbSession) -> LoadingView:
    door = _door_or_404(db, code)
    look = Lookup(db)
    summary = _door_summary(db, door, look)
    trip = active_trip_at(db, door)
    missing = [parcel_brief(p, look) for p in missing_parcels(db, trip)] if trip else []
    recent: list[ScanOut] = []
    if trip:
        scans = db.execute(
            select(LoadingScan)
            .where(LoadingScan.trip_id == trip.id)
            .order_by(LoadingScan.at.desc(), LoadingScan.id.desc())
            .limit(40)
        ).scalars()
        recent = [scan_out(db, s, look) for s in scans]
    return LoadingView(door=summary, missing=missing, recent=recent)


@router.post(
    "/doors/{code}/scan",
    response_model=ManualScanOut,
    response_model_by_alias=True,
    responses={409: {"description": "No truck is loading at this door"}},
)
def manual_scan(
    code: str, body: ManualScanIn, user: Operator, db: DbSession, background: BackgroundTasks
) -> ManualScanOut:
    """Hand-scanner simulation: the operator types or scans a barcode at the door."""
    door = _door_or_404(db, code)
    outcome = process_scan(
        db,
        door=door,
        at=telematics.sim_now(),
        barcode=body.barcode.strip().upper(),
        source=EventSource.MANUAL,
        device="MANUAL",
        user_id=user.id,
    )
    if outcome is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "No truck is loading at this door")
    db.commit()
    background.add_task(telematics.broadcast_many, "devices", "loading_scan", [scan_event(outcome)])
    if outcome.alert:
        background.add_task(
            telematics.broadcast_many, "alerts", "alert", [alert_event(outcome.alert.alert)]
        )
    look = Lookup(db)
    return ManualScanOut(
        result=outcome.result,
        parcel=parcel_brief(outcome.parcel, look) if outcome.parcel else None,
        trip_direction=outcome.trip_direction.code if outcome.trip_direction else None,
        message=MESSAGES[outcome.result],
    )
