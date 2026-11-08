"""Courier screen (/courier, ADR-011): my stops for today and "Doručené" / "Nezastihnutý".

A courier sees only their own route. Admin and dispatcher may look at any courier's route
(?courier=kurier03); finishing a stop is for the route's courier (and admin).
"""

from datetime import date, datetime, time
from typing import Annotated, Literal, cast

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select

from depotrack.core.clock import TZ
from depotrack.core.config import get_settings
from depotrack.core.rbac import DbSession, require_role
from depotrack.models import CourierRoute, Direction, Parcel, RouteStop, User, Vehicle
from depotrack.models.enums import EventSource, ParcelStatus, StopOutcome, UserRole
from depotrack.schemas.delivery import (
    CourierRouteBrief,
    CourierRouteOut,
    CourierStopOut,
    RouteDepot,
    ScanIn,
    ScanOut,
    StopResultIn,
    VehiclePosition,
)
from depotrack.services import telematics
from depotrack.services.couriers import (
    DEPARTURE,
    LOADING_START,
    complete_stop,
    depot_of_route,
    load_parcel,
    staging_bay,
)
from depotrack.services.routing import DeliveryType

router = APIRouter(prefix="/api/courier", tags=["courier"])

Viewer = Annotated[User, Depends(require_role(UserRole.COURIER, UserRole.DISPATCHER))]
Courier = Annotated[User, Depends(require_role(UserRole.COURIER))]

IN_VAN = (ParcelStatus.OUT_FOR_DELIVERY, ParcelStatus.DELIVERED, ParcelStatus.FAILED_DELIVERY)


def today() -> date:
    """Delivery day = local date of the simulated clock."""
    return telematics.sim_now().astimezone(TZ).date()


def _stops(db: DbSession, route: CourierRoute) -> list[tuple[RouteStop, Parcel]]:
    return [
        (s, p)
        for s, p in db.execute(
            select(RouteStop, Parcel)
            .join(Parcel, RouteStop.parcel_id == Parcel.id)
            .where(RouteStop.route_id == route.id)
            .order_by(RouteStop.sequence)
        ).tuples()
    ]


def _window(day: date, t: time | None) -> datetime | None:
    return datetime.combine(day, t, TZ) if t is not None else None


def _stop_out(s: RouteStop, p: Parcel, day: date) -> CourierStopOut:
    return CourierStopOut(
        id=s.id,
        sequence=s.sequence,
        parcel_id=p.id,
        barcode=p.barcode,
        recipient_name=p.recipient_name,
        address=p.address,
        lat=p.lat,
        lon=p.lon,
        weight_kg=p.weight_kg,
        parcel_status=p.status,
        planned_eta=s.planned_eta,
        predicted_eta=s.predicted_eta,
        delivered_at=s.delivered_at,
        outcome=s.outcome,
        delivery_type=cast(DeliveryType, p.delivery_type),
        window_from=_window(day, p.window_from),
        window_to=_window(day, p.window_to),
    )


def _brief(
    db: DbSession, route: CourierRoute, stops: list[tuple[RouteStop, Parcel]]
) -> CourierRouteBrief:
    courier = db.get(User, route.courier_user_id)
    van = db.get(Vehicle, route.vehicle_id)
    district = db.get(Direction, route.rajon_direction_id)
    return CourierRouteBrief(
        id=route.id,
        date=route.date,
        courier_username=courier.username if courier else "?",
        courier_name=courier.full_name if courier else "?",
        vehicle_plate=van.plate if van else "?",
        district_code=district.code if district else "?",
        district_name=district.name if district else "?",
        departed_at=route.departed_at,
        returned_at=route.returned_at,
        stops=len(stops),
        delivered=sum(1 for s, _ in stops if s.outcome == StopOutcome.DELIVERED),
        failed=sum(1 for s, _ in stops if s.outcome == StopOutcome.FAILED),
        loaded=sum(1 for _, p in stops if p.status in IN_VAN),
        staging_bay=bay.code if (bay := staging_bay(db, route.rajon_direction_id)) else None,
        planned_departure=datetime.combine(route.date, DEPARTURE, TZ),
    )


@router.get("/routes", response_model=list[CourierRouteBrief], response_model_by_alias=True)
def routes(
    user: Viewer, db: DbSession, day: Annotated[date | None, Query()] = None
) -> list[CourierRouteBrief]:
    """Routes of a delivery day (default today). A courier gets only their own."""
    stmt = select(CourierRoute).where(CourierRoute.date == (day or today()))
    if user.role == UserRole.COURIER:
        stmt = stmt.where(CourierRoute.courier_user_id == user.id)
    return [
        _brief(db, r, _stops(db, r)) for r in db.execute(stmt.order_by(CourierRoute.id)).scalars()
    ]


@router.get(
    "/route",
    response_model=CourierRouteOut,
    response_model_by_alias=True,
    responses={404: {"description": "No route today"}},
)
def my_route(
    user: Viewer,
    db: DbSession,
    courier: Annotated[str | None, Query(max_length=32)] = None,
) -> CourierRouteOut:
    owner = user
    if user.role != UserRole.COURIER and courier:
        found = db.execute(select(User).where(User.username == courier)).scalar_one_or_none()
        if found is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Courier not found")
        owner = found
    route = db.execute(
        select(CourierRoute).where(
            CourierRoute.courier_user_id == owner.id, CourierRoute.date == today()
        )
    ).scalar_one_or_none()
    if route is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No route today")
    stops = _stops(db, route)
    van = db.get(Vehicle, route.vehicle_id)
    pos = telematics.vehicle_position(van.plate) if van else None
    depot = depot_of_route(db, route)
    return CourierRouteOut(
        **_brief(db, route, stops).model_dump(),
        vehicle=(
            VehiclePosition(
                lat=float(pos["lat"]),
                lon=float(pos["lon"]),
                heading=int(pos.get("heading") or 0),
                moving=bool(pos.get("moving")),
            )
            if pos
            else None
        ),
        depot=RouteDepot(code=depot.code, name=depot.name, lat=depot.lat, lon=depot.lon),
        stop_list=[_stop_out(s, p, route.date) for s, p in stops],
    )


@router.post(
    "/stops/{stop_id}",
    response_model=CourierStopOut,
    response_model_by_alias=True,
    responses={403: {"description": "Not your route"}, 409: {"description": "Stop not open"}},
)
def finish_stop(stop_id: int, body: StopResultIn, user: Courier, db: DbSession) -> CourierStopOut:
    """The courier marks a stop: delivered (revokes the tracking link) or not reached."""
    stop = db.get(RouteStop, stop_id)
    route = db.get(CourierRoute, stop.route_id) if stop else None
    if stop is None or route is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Stop not found")
    if user.role != UserRole.ADMIN and route.courier_user_id != user.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not your route")
    parcel = db.get(Parcel, stop.parcel_id)
    if stop.outcome is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Zastávka je už uzavretá.")
    if parcel is None or parcel.status != ParcelStatus.OUT_FOR_DELIVERY:
        raise HTTPException(status.HTTP_409_CONFLICT, "Balík ešte nie je naložený v dodávke.")
    complete_stop(
        db,
        stop=stop,
        outcome=body.outcome,
        at=telematics.sim_now(),
        source=EventSource.MANUAL,
        user_id=user.id,
    )
    db.commit()
    return _stop_out(stop, parcel, route.date)


@router.post(
    "/scan",
    response_model=ScanOut,
    response_model_by_alias=True,
    responses={
        404: {"description": "Not a parcel of your route today"},
        409: {
            "description": "Not loading time (before 06:30 or after the departure), or the "
            "parcel is not in this depot (it did not come on the linehaul truck, ADR-065)"
        },
    },
)
def scan(body: ScanIn, user: Courier, db: DbSession) -> ScanOut:
    """The Bluetooth scanner paired with the van (simulated on /courier): before the departure a
    scan loads the parcel into the van (out_for_delivery + tracking SMS), later it selects the
    stop of the parcel, so the app shows it on the map."""
    route = db.execute(
        select(CourierRoute).where(
            CourierRoute.courier_user_id == user.id, CourierRoute.date == today()
        )
    ).scalar_one_or_none()
    row = (
        db.execute(
            select(RouteStop, Parcel)
            .join(Parcel, RouteStop.parcel_id == Parcel.id)
            .where(RouteStop.route_id == route.id, Parcel.barcode == body.barcode.strip().upper())
        ).first()
        if route
        else None
    )
    if route is None or row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Parcel is not on your route today")
    stop, parcel = row
    now = telematics.sim_now()
    action: Literal["loaded", "selected", "done"] = "selected"
    if stop.outcome is not None:
        action = "done"
    elif parcel.status not in IN_VAN:
        # loading only at the staging bay: from 06:30 of the delivery day until the departure
        if route.departed_at is not None or now < datetime.combine(route.date, LOADING_START, TZ):
            raise HTTPException(status.HTTP_409_CONFLICT, "Not loading time for this route")
        load_parcel(
            db,
            get_settings(),
            route=route,
            stop=stop,
            at=now,
            door=staging_bay(db, route.rajon_direction_id),
        )
        if parcel.status != ParcelStatus.OUT_FOR_DELIVERY:
            # e.g. a parcel that did not come on the linehaul truck to this depot (ADR-065)
            db.rollback()
            raise HTTPException(status.HTTP_409_CONFLICT, "Parcel is not in this depot")
        db.commit()
        action = "loaded"
    return ScanOut(action=action, stop=_stop_out(stop, parcel, route.date))
