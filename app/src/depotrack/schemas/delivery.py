"""Schemas of the delivery part (Phase 4): public tracking, courier screen, notifications."""

from datetime import date, datetime
from typing import Literal

from depotrack.models.enums import ParcelStatus, StopOutcome
from depotrack.schemas.internal import CamelModel

# ------------------------------------------------------------------ public tracking


class TrackPoint(CamelModel):
    lat: float
    lon: float


class TrackCourier(CamelModel):
    """Exact position (customer ≤ 3rd in line) or an approximate circle (ADR-042)."""

    exact: bool
    lat: float
    lon: float
    heading: int | None
    radius_m: int | None


class TrackOut(CamelModel):
    """What a customer sees. Fields stay null unless they may be shown."""

    status: Literal["preparing", "on_the_way", "delivered", "failed"]
    barcode: str
    district: str | None = None
    courier_name: str | None = None
    position_in_line: int | None = None
    stops_ahead: int | None = None
    eta_from: datetime | None = None
    eta_to: datetime | None = None
    destination: TrackPoint | None = None
    courier: TrackCourier | None = None
    delivered_at: datetime | None = None
    failed_at: datetime | None = None
    updated_at: datetime | None = None


# ------------------------------------------------------------------ courier screen


class CourierStopOut(CamelModel):
    id: int
    sequence: int
    parcel_id: int
    barcode: str
    recipient_name: str
    address: str
    lat: float
    lon: float
    weight_kg: float
    parcel_status: ParcelStatus
    planned_eta: datetime | None
    predicted_eta: datetime | None
    delivered_at: datetime | None
    outcome: StopOutcome | None


class VehiclePosition(CamelModel):
    lat: float
    lon: float
    heading: int
    moving: bool


class CourierRouteBrief(CamelModel):
    id: int
    date: date
    courier_username: str
    courier_name: str
    vehicle_plate: str
    district_code: str
    district_name: str
    departed_at: datetime | None
    returned_at: datetime | None
    stops: int
    delivered: int
    failed: int
    loaded: int


class CourierRouteOut(CourierRouteBrief):
    vehicle: VehiclePosition | None
    depot: TrackPoint
    stop_list: list[CourierStopOut]


class StopResultIn(CamelModel):
    outcome: StopOutcome


# ------------------------------------------------------------------ admin: simulated SMS


class NotificationOut(CamelModel):
    id: int
    parcel_id: int
    barcode: str
    channel: str
    recipient: str
    message: str
    link: str
    created_at: datetime
