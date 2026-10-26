"""Customer tracking links (zadanie 6, ADR-010, ADR-042).

- A link is issued when the parcel is scanned into the courier's van: `secrets.token_urlsafe(32)`;
  only its SHA-256 is stored. The simulated SMS (customer_notifications) keeps the full link.
- The public view is built here, and privacy is enforced here, never in the browser:
  the exact courier position only when the customer is at most 3rd in line, otherwise only the
  district name and an approximate circle; never other stops or addresses; courier first name only.
- Delivery revokes the link (only "Doručené o HH:MM" remains). Hard expiry at the end of the
  delivery day. All times are simulated time (the simulator owns the clock).
"""

import hashlib
import logging
import secrets
from dataclasses import dataclass
from datetime import datetime, time, timedelta

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from depotrack.core.clock import TZ, local_hhmm
from depotrack.core.config import Settings
from depotrack.models import (
    CourierRoute,
    CustomerNotification,
    Direction,
    Parcel,
    RouteStop,
    TrackingToken,
    User,
    Vehicle,
)
from depotrack.models.enums import ParcelStatus
from depotrack.schemas.delivery import TrackCourier, TrackOut, TrackPoint
from depotrack.services import telematics

log = logging.getLogger(__name__)

TOKEN_BYTES = 32
# exact courier position only for the next N customers in line
EXACT_WITHIN = 3
# approximate position: snapped to this grid (degrees) and drawn as a circle of this radius
APPROX_GRID_DEG = 0.02
APPROX_RADIUS_M = 2000


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("ascii")).hexdigest()


def first_name(full_name: str) -> str:
    return full_name.split()[0] if full_name.strip() else "kuriér"


def fake_phone(parcel_id: int) -> str:
    """Simulated recipient phone number (the data model has none; nothing is really sent)."""
    a = (parcel_id * 7919) % 100
    b = (parcel_id * 104729) % 1000
    c = (parcel_id * 1299709) % 1000
    return f"+421 9{a:02d} {b:03d} {c:03d}"


def end_of_day(at: datetime) -> datetime:
    local = at.astimezone(TZ).date()
    return datetime.combine(local + timedelta(days=1), time(0, 0), TZ)


def eta_window(eta: datetime, stops_ahead: int) -> tuple[datetime, datetime]:
    """Window around the prediction: ±10 min for the next stop, up to ±30 min further away,
    rounded outwards to 5 minutes."""
    margin = timedelta(minutes=min(30, 10 + 2 * max(stops_ahead, 0)))

    def floor5(t: datetime) -> datetime:
        t = t.astimezone(TZ).replace(second=0, microsecond=0)
        return t - timedelta(minutes=t.minute % 5)

    start = floor5(eta - margin)
    end = floor5(eta + margin)
    if end < eta + margin:
        end += timedelta(minutes=5)
    return start, end


def issue(
    db: Session,
    settings: Settings,
    *,
    parcel: Parcel,
    at: datetime,
    courier_first_name: str,
    eta: datetime | None,
) -> CustomerNotification:
    """New tracking link + the simulated SMS that carries it."""
    token = secrets.token_urlsafe(TOKEN_BYTES)
    db.add(
        TrackingToken(
            token_hash=hash_token(token),
            parcel_id=parcel.id,
            created_at=at,
            expires_at=end_of_day(at),
        )
    )
    link = f"{settings.public_base_url.rstrip('/')}/track/{token}"
    when = ""
    if eta is not None:
        start, end = eta_window(eta, 10)
        when = f" približne medzi {local_hhmm(start)} a {local_hhmm(end)}"
    note = CustomerNotification(
        parcel_id=parcel.id,
        channel="sms",
        recipient=f"{parcel.recipient_name}, {fake_phone(parcel.id)}"[:120],
        message=(
            f"SPS: Váš balík {parcel.barcode} je dnes na ceste. Kuriér {courier_first_name} "
            f"ho doručí{when}. Sledovanie: {link}"
        ),
        link=link,
        created_at=at,
    )
    db.add(note)
    # the log does not carry the token itself (the notification table does, ADR-010)
    log.info("simulated SMS for parcel %s to %s", parcel.barcode, fake_phone(parcel.id))
    return note


def revoke(db: Session, parcel_id: int, at: datetime) -> None:
    db.execute(
        update(TrackingToken)
        .where(TrackingToken.parcel_id == parcel_id, TrackingToken.revoked_at.is_(None))
        .values(revoked_at=at)
    )


class TrackingGoneError(Exception):
    """Unknown, expired or revoked link (the reason is not told apart for the public)."""


@dataclass
class _Stop:
    stop: RouteStop
    route: CourierRoute


def _stop_of(db: Session, parcel_id: int) -> _Stop | None:
    row = db.execute(
        select(RouteStop, CourierRoute)
        .join(CourierRoute, RouteStop.route_id == CourierRoute.id)
        .where(RouteStop.parcel_id == parcel_id)
        .order_by(CourierRoute.date.desc())
        .limit(1)
    ).first()
    return _Stop(row[0], row[1]) if row else None


def approximate(lat: float, lon: float) -> tuple[float, float]:
    """Snap to a ~2 km grid: the circle still contains the van but does not track it."""
    return (
        round(round(lat / APPROX_GRID_DEG) * APPROX_GRID_DEG, 4),
        round(round(lon / APPROX_GRID_DEG) * APPROX_GRID_DEG, 4),
    )


def track_view(db: Session, token: str, now: datetime) -> TrackOut:
    tt = db.execute(
        select(TrackingToken).where(TrackingToken.token_hash == hash_token(token))
    ).scalar_one_or_none()
    if tt is None or now >= tt.expires_at:
        raise TrackingGoneError
    parcel = db.get(Parcel, tt.parcel_id)
    if parcel is None:
        raise TrackingGoneError
    found = _stop_of(db, parcel.id)
    if parcel.status == ParcelStatus.DELIVERED:
        # after delivery only the time, nothing else (no map, no courier)
        delivered = found.stop.delivered_at if found else tt.revoked_at
        return TrackOut(status="delivered", barcode=parcel.barcode, delivered_at=delivered)
    if tt.revoked_at is not None or found is None:
        raise TrackingGoneError
    stop, route = found.stop, found.route
    district = db.get(Direction, route.rajon_direction_id)
    courier = db.get(User, route.courier_user_id)
    base = TrackOut(
        status="preparing",
        barcode=parcel.barcode,
        district=district.name if district else None,
        courier_name=first_name(courier.full_name) if courier else None,
        updated_at=now,
    )
    if parcel.status == ParcelStatus.FAILED_DELIVERY:
        base.status = "failed"
        base.failed_at = stop.delivered_at
        return base

    ahead = db.execute(
        select(func.count())
        .select_from(RouteStop)
        .where(
            RouteStop.route_id == route.id,
            RouteStop.sequence < stop.sequence,
            RouteStop.outcome.is_(None),
        )
    ).scalar_one()
    eta = stop.predicted_eta or stop.planned_eta
    base.position_in_line = ahead + 1
    base.stops_ahead = ahead
    if eta is not None:
        base.eta_from, base.eta_to = eta_window(eta, ahead)
    # the customer's own delivery point (they know their address); never other stops
    base.destination = TrackPoint(lat=round(parcel.lat, 5), lon=round(parcel.lon, 5))
    if route.departed_at is None or parcel.status != ParcelStatus.OUT_FOR_DELIVERY:
        return base

    base.status = "on_the_way"
    van = db.get(Vehicle, route.vehicle_id)
    pos = telematics.vehicle_position(van.plate) if van else None
    if pos is None:
        return base
    lat, lon = float(pos["lat"]), float(pos["lon"])
    if base.position_in_line <= EXACT_WITHIN:
        base.courier = TrackCourier(
            exact=True,
            lat=round(lat, 5),
            lon=round(lon, 5),
            heading=int(pos.get("heading") or 0),
            radius_m=None,
        )
    else:
        alat, alon = approximate(lat, lon)
        base.courier = TrackCourier(
            exact=False, lat=alat, lon=alon, heading=None, radius_m=APPROX_RADIUS_M
        )
    return base
