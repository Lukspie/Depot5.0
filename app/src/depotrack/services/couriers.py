"""Courier routes (Phase 4, ADR-041).

Courier kurier0N drives district KE-0N with van KE-30NKR. The route of operating day D is driven
on the morning of D+1 (still inside operating day D, which ends at 15:00): from 07:00 the courier
scans the parcels into the van at staging bay SB-0N, leaves Budimír at ~07:30 and visits the
stops in the order of services/routing.py (handover windows, mailboxes and lockers fill the gaps,
ADR-062). Stops = the district's parcels of day D.

The planned ETAs here are a rough estimate (straight line × road factor, waiting for windows).
Telematics drives the real route on the street graph and reports what happens
(POST /internal/events/couriers):
parcel loaded -> out_for_delivery + tracking link (SMS), departed, delivered / failed, returned.
The courier can also finish a stop by hand on /courier.
"""

import re
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta

from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from depotrack.core.clock import TZ
from depotrack.core.config import Settings
from depotrack.models import (
    CourierRoute,
    CustomerNotification,
    Depot,
    Direction,
    Door,
    Parcel,
    ParcelEvent,
    RouteStop,
    TrackingToken,
    User,
    Vehicle,
)
from depotrack.models.enums import DoorKind, EventSource, ParcelStatus, StopOutcome, UserRole
from depotrack.services import tracking
from depotrack.services.parcels import LOADABLE, in_day
from depotrack.services.routing import Stop, Visit, plan_tour

LOADING_START = time(7, 0)
DEPARTURE = time(7, 30)
COURIER_USERNAME = re.compile(r"^kurier(\d{2})$")


def delivery_date(day: date) -> date:
    """Parcels of operating day D are delivered on the morning of D+1."""
    return day + timedelta(days=1)


def operating_day_of_route(route: CourierRoute) -> date:
    return route.date - timedelta(days=1)


@dataclass(frozen=True)
class Assignment:
    courier: User
    district: Direction
    van: Vehicle


def assignments(db: Session, depot: Depot) -> list[Assignment]:
    """kurier0N -> district KE-0N and van KE-30NKR (active couriers only)."""
    districts = {
        d.code: d
        for d in db.execute(select(Direction).where(Direction.depot_id == depot.id)).scalars()
    }
    vans = {v.plate: v for v in db.execute(select(Vehicle)).scalars()}
    couriers = db.execute(
        select(User)
        .where(User.role == UserRole.COURIER, User.active.is_(True))
        .order_by(User.username)
    ).scalars()
    out = []
    for user in couriers:
        m = COURIER_USERNAME.match(user.username)
        if not m:
            continue
        district = districts.get(f"KE-{m.group(1)}")
        van = vans.get(f"KE-3{m.group(1)}KR")
        if district is not None and van is not None:
            out.append(Assignment(user, district, van))
    return out


def build_courier_routes(db: Session, day: date) -> list[CourierRoute]:
    """Routes of the district couriers for parcels of operating day `day` (caller commits)."""
    depot = db.execute(select(Depot).where(Depot.code == "BUD")).scalar_one()
    when = delivery_date(day)
    routes: list[CourierRoute] = []
    for a in assignments(db, depot):
        parcels = list(
            db.execute(
                select(Parcel).where(Parcel.direction_id == a.district.id, in_day(day))
            ).scalars()
        )
        if not parcels:
            continue
        route = CourierRoute(
            courier_user_id=a.courier.id,
            vehicle_id=a.van.id,
            date=when,
            rajon_direction_id=a.district.id,
        )
        db.add(route)
        db.flush()
        by_barcode = {p.barcode: p for p in parcels}
        for seq, v in enumerate(_tour(depot, when, parcels), start=1):
            p = by_barcode[v.stop.key]
            db.add(RouteStop(route_id=route.id, parcel_id=p.id, sequence=seq, planned_eta=v.eta))
        routes.append(route)
    db.flush()
    return routes


def _tour(depot: Depot, when: date, parcels: list[Parcel]) -> list[Visit]:
    stops = [
        Stop(
            p.barcode,
            p.lat,
            p.lon,
            p.delivery_type,
            (datetime.combine(when, p.window_from, TZ), datetime.combine(when, p.window_to, TZ))
            if p.window_from and p.window_to
            else None,
        )
        for p in parcels
    ]
    return plan_tour((depot.lat, depot.lon), datetime.combine(when, DEPARTURE, TZ), stops)


def replan_routes(db: Session, day: date) -> int:
    """Routes built before ADR-062 (nearest neighbour) get the window-aware order, if nothing of
    them happened yet (not departed, no stop finished). Seed step, idempotent per day."""
    depot = db.execute(select(Depot).where(Depot.code == "BUD")).scalar_one()
    changed = 0
    for route in routes_of_day(db, day):
        if route.departed_at is not None:
            continue
        rows = list(
            db.execute(
                select(RouteStop, Parcel)
                .join(Parcel, RouteStop.parcel_id == Parcel.id)
                .where(RouteStop.route_id == route.id)
            ).tuples()
        )
        if any(s.outcome is not None for s, _ in rows):
            continue
        by_barcode = {p.barcode: s for s, p in rows}
        # two passes: the (route, sequence) pairs are unique
        for s, _ in rows:
            s.sequence = -s.sequence
        db.flush()
        for seq, v in enumerate(_tour(depot, route.date, [p for _, p in rows]), start=1):
            stop = by_barcode[v.stop.key]
            stop.sequence = seq
            stop.planned_eta = v.eta
        db.flush()
        changed += 1
    return changed


def routes_of_day(db: Session, day: date) -> list[CourierRoute]:
    """Routes for the parcels of operating day `day` (driven on day+1)."""
    return list(
        db.execute(
            select(CourierRoute)
            .where(CourierRoute.date == delivery_date(day))
            .order_by(CourierRoute.id)
        ).scalars()
    )


def staging_bay(db: Session, district_id: int) -> Door | None:
    return db.execute(
        select(Door).where(Door.kind == DoorKind.STAGING_BAY, Door.direction_id == district_id)
    ).scalar_one_or_none()


def load_parcel(
    db: Session,
    settings: Settings,
    *,
    route: CourierRoute,
    stop: RouteStop,
    at: datetime,
    door: Door | None,
) -> CustomerNotification | None:
    """The courier scans the parcel into the van: out_for_delivery + tracking link by SMS.
    Idempotent: a parcel already in the van (or delivered) is left alone."""
    parcel = db.get(Parcel, stop.parcel_id)
    if parcel is None or parcel.status not in LOADABLE:
        return None
    parcel.status = ParcelStatus.OUT_FOR_DELIVERY
    db.add(
        ParcelEvent(
            parcel_id=parcel.id,
            status=ParcelStatus.OUT_FOR_DELIVERY,
            at=at,
            source=EventSource.MANUAL,
            door_id=door.id if door else None,
            user_id=route.courier_user_id,
        )
    )
    courier = db.get(User, route.courier_user_id)
    return tracking.issue(
        db,
        settings,
        parcel=parcel,
        at=at,
        courier_first_name=tracking.first_name(courier.full_name if courier else ""),
        eta=stop.predicted_eta or stop.planned_eta,
    )


def complete_stop(
    db: Session,
    *,
    stop: RouteStop,
    outcome: StopOutcome,
    at: datetime,
    source: EventSource,
    user_id: int | None,
) -> bool:
    """Delivered / not reached. Only a parcel that is in the van; the first result wins
    (a stop finished by hand on /courier is not overwritten by the simulator)."""
    parcel = db.get(Parcel, stop.parcel_id)
    if stop.outcome is not None or parcel is None:
        return False
    if parcel.status != ParcelStatus.OUT_FOR_DELIVERY:
        return False
    status = (
        ParcelStatus.DELIVERED if outcome == StopOutcome.DELIVERED else ParcelStatus.FAILED_DELIVERY
    )
    stop.outcome = outcome
    stop.delivered_at = at
    parcel.status = status
    db.add(ParcelEvent(parcel_id=parcel.id, status=status, at=at, source=source, user_id=user_id))
    if outcome == StopOutcome.DELIVERED:
        # delivered = the tracking link stops working (ADR-010, zadanie 6.4)
        tracking.revoke(db, parcel.id, at)
    return True


def reset_routes(db: Session, day: date) -> int:
    """Replay of operating day `day` (ADR-033): routes back to planned, links and SMS removed."""
    route_ids = [r.id for r in routes_of_day(db, day)]
    if route_ids:
        db.execute(
            update(RouteStop)
            .where(RouteStop.route_id.in_(route_ids))
            .values(predicted_eta=None, delivered_at=None, outcome=None)
        )
        db.execute(
            update(CourierRoute)
            .where(CourierRoute.id.in_(route_ids))
            .values(departed_at=None, returned_at=None)
        )
    parcel_ids = select(Parcel.id).where(in_day(day)).scalar_subquery()
    db.execute(delete(TrackingToken).where(TrackingToken.parcel_id.in_(parcel_ids)))
    db.execute(delete(CustomerNotification).where(CustomerNotification.parcel_id.in_(parcel_ids)))
    return len(route_ids)
