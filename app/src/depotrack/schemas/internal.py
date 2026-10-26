"""Schemas of the internal app <-> telematics API (camelCase on the wire, like the WS events)."""

from datetime import date, datetime
from typing import Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from depotrack.models.enums import (
    AlertKind,
    AlertSeverity,
    DirectionType,
    TripKind,
    TripStatus,
    VehicleKind,
)


class CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class PlanTripOut(CamelModel):
    id: int
    operating_day: date
    kind: TripKind
    status: TripStatus
    vehicle_plate: str
    vehicle_kind: VehicleKind
    direction_code: str
    direction_name: str
    direction_type: DirectionType
    depends_on_linehaul: list[str]
    door_code: str | None
    planned_arrival: datetime | None
    planned_departure: datetime | None
    actual_arrival: datetime | None
    actual_departure: datetime | None
    predicted_arrival: datetime | None


class PlanDepot(CamelModel):
    code: str
    name: str
    lat: float
    lon: float


class PlanOut(CamelModel):
    day: date
    cascade_buffer_min: int
    trips: list[PlanTripOut]
    # where trucks start (Budimír) and where each direction drives to (ADR-039)
    depot: PlanDepot
    destinations: dict[str, tuple[float, float]]
    # courier districts (KE-01..): their parcels pass the line scanner in the morning wave
    local_directions: list[str]


class ManifestParcel(CamelModel):
    barcode: str
    weight_kg: float
    # night parcels: the inbound trip that brings them (scannable only after it arrived)
    arrives_with_trip_id: int | None = None


class ManifestOut(CamelModel):
    direction: str
    day: date
    parcels: list[ManifestParcel]


class TripExecution(CamelModel):
    """Execution state of one trip as simulated by telematics (full state, not a delta)."""

    trip_id: int
    status: TripStatus
    actual_arrival: AwareDatetime | None = None
    actual_departure: AwareDatetime | None = None
    predicted_arrival: AwareDatetime | None = None


class TripEventsIn(CamelModel):
    sim_time: AwareDatetime
    trips: list[TripExecution] = Field(max_length=500)


class TripEventsOut(CamelModel):
    updated: int
    unknown: list[int]
    alerts_changed: int


class ScanIn(CamelModel):
    device: str = Field(max_length=32)
    door_code: str | None = Field(default=None, max_length=16)
    at: AwareDatetime
    barcode: str | None = Field(default=None, max_length=64)
    read_ok: bool


class ScanEventsIn(CamelModel):
    scans: list[ScanIn] = Field(max_length=2000)


class ScanEventsOut(CamelModel):
    processed: int
    skipped: int
    results: dict[str, int]


class AlertIn(CamelModel):
    kind: AlertKind
    severity: AlertSeverity
    message: str = Field(max_length=500)
    ref_type: str | None = Field(default=None, max_length=32)
    ref_id: str | None = Field(default=None, max_length=64)
    at: AwareDatetime | None = None
    # true = the cause disappeared (e.g. device back online): close the open alert
    resolved: bool = False


class AlertOut(CamelModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, from_attributes=True)

    id: int
    kind: AlertKind
    severity: AlertSeverity
    message: str
    ref_type: str | None
    ref_id: str | None
    created_at: datetime
    acknowledged_at: datetime | None


class WsTicketOut(CamelModel):
    ticket: str
    expires_in: int
    ws_url: str


# ------------------------------------------------------------------ couriers (Phase 4)


class CourierPlanStop(CamelModel):
    stop_id: int
    sequence: int
    barcode: str
    lat: float
    lon: float


class CourierPlanRoute(CamelModel):
    route_id: int
    date: date
    vehicle_plate: str
    courier_username: str
    district_code: str
    staging_bay: str | None
    stops: list[CourierPlanStop]


class CourierPlanOut(CamelModel):
    day: date
    depot: PlanDepot
    routes: list[CourierPlanRoute]


class CourierEvent(CamelModel):
    route_id: int
    kind: Literal["loaded", "departed", "delivered", "failed", "returned"]
    stop_id: int | None = None
    at: AwareDatetime


class StopEta(CamelModel):
    stop_id: int
    eta: AwareDatetime


class CourierEventsIn(CamelModel):
    sim_time: AwareDatetime
    # predictions first (the SMS of a just-loaded parcel already uses them)
    etas: list[StopEta] = Field(default_factory=list, max_length=5000)
    events: list[CourierEvent] = Field(default_factory=list, max_length=5000)


class CourierEventsOut(CamelModel):
    applied: int
    ignored: int
    notifications: int
