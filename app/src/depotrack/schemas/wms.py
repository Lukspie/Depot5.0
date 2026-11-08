"""Schemas of the WMS screens (dashboard, loading, board, fleet, parcels). camelCase on the wire."""

from datetime import date, datetime, time
from typing import Literal

from pydantic import Field

from depotrack.models.enums import (
    DepotKind,
    DirectionType,
    DockEquipment,
    DoorDrive,
    DoorKind,
    EventSource,
    ParcelStatus,
    ScanResult,
    TripKind,
    TripStatus,
    VehicleKind,
)
from depotrack.schemas.internal import AlertOut, CamelModel


class LoadStats(CamelModel):
    expected: int
    loaded: int
    loaded_kg: float
    counted: int
    read: int
    unidentified: int
    wrong_direction: int
    duplicate: int


class TripBrief(CamelModel):
    id: int
    operating_day: date
    kind: TripKind
    status: TripStatus
    direction_code: str
    direction_name: str
    direction_type: DirectionType
    vehicle_plate: str
    vehicle_kind: VehicleKind
    capacity_kg: int
    capacity_parcels: int
    door_code: str | None
    planned_arrival: datetime | None
    planned_departure: datetime | None
    actual_arrival: datetime | None
    actual_departure: datetime | None
    predicted_arrival: datetime | None
    # "ml" (delay model before the trip) or "telematics" (position during it), ADR-057
    predicted_by: str | None = None
    # positive = late (arrival for inbound, departure for outbound)
    delay_min: int | None
    load: LoadStats | None = None


class ParcelBrief(CamelModel):
    id: int
    barcode: str
    status: ParcelStatus
    direction_code: str
    weight_kg: float
    recipient_name: str
    address: str


class ClockOut(CamelModel):
    sim_time: datetime
    operating_day: date
    wave: str | None


# ------------------------------------------------------------------ loading


class DoorSummary(CamelModel):
    code: str
    default_direction: str | None
    trip: TripBrief | None


class ScanOut(CamelModel):
    id: int
    at: datetime
    result: ScanResult
    barcode: str | None
    parcel_id: int | None
    parcel_direction: str | None
    device: str | None


class LoadingView(CamelModel):
    door: DoorSummary
    missing: list[ParcelBrief]
    recent: list[ScanOut]


class ManualScanIn(CamelModel):
    barcode: str = Field(min_length=3, max_length=64)


class ManualScanOut(CamelModel):
    result: ScanResult
    parcel: ParcelBrief | None
    trip_direction: str | None
    message: str


# ------------------------------------------------------------------ dashboard


class DashboardKpis(CamelModel):
    parcels_total: int
    parcels_loaded: int
    parcels_staged: int
    parcels_sorted: int
    parcels_waiting: int
    parcels_missing: int
    trucks_on_site: int
    read_rate: float | None
    unidentified: int
    open_alerts: int
    # parcels of the current sorting wave (services/waves.py): evening 15:30-22:00 = the day's
    # parcels except the night ones, night 01:00-06:00 = parcels brought by the night trucks;
    # outside the waves None and the start of the next wave (plan-doplnky 5c)
    wave_kind: Literal["evening", "night"] | None
    parcels_wave: int | None
    next_wave_at: datetime | None


class DirectionRow(CamelModel):
    code: str
    name: str
    type: DirectionType
    total: int
    loaded: int
    staged: int
    waiting: int
    missing: int


class DashboardOut(CamelModel):
    clock: ClockOut
    kpis: DashboardKpis
    directions: list[DirectionRow]
    trips: list[TripBrief]
    alerts: list[AlertOut]


# ------------------------------------------------------------------ board


class DeviceSummary(CamelModel):
    online: int
    degraded: int
    offline: int
    read_rate: float | None
    line_status: str


class BoardOut(CamelModel):
    # "Budimír · prekládkové depo": the depot whose trips the board shows (phase 7d)
    depot: str
    clock: ClockOut
    arrivals: list[TripBrief]
    departures: list[TripBrief]
    warnings: list[AlertOut]
    devices: DeviceSummary


# ------------------------------------------------------------------ fleet


class VehicleOut(CamelModel):
    plate: str
    kind: VehicleKind
    capacity_kg: int
    capacity_parcels: int
    trip: TripBrief | None
    # [lat, lon] of the parking spot of a van in a depot without simulated operations (ADR-066)
    parked_at: tuple[float, float] | None = None
    depot: str | None = None  # home depot code


class VehicleDetail(VehicleOut):
    parcels: list[ParcelBrief]
    parcels_count: int
    parcels_kg: float
    remaining_stops: list[str]


# ------------------------------------------------------------------ parcels


class ParcelEventOut(CamelModel):
    status: ParcelStatus
    at: datetime
    source: EventSource
    door_code: str | None
    trip_id: int | None
    vehicle_plate: str | None
    user_name: str | None
    # passage through a checkpoint of the sorting line (ADR-071): device code and what it is
    checkpoint: str | None = None
    checkpoint_label: str | None = None


class ParcelDetail(ParcelBrief):
    direction_name: str
    direction_type: DirectionType
    sender: str
    length_cm: int
    width_cm: int
    height_cm: int
    lat: float
    lon: float
    created_at: datetime
    events: list[ParcelEventOut]
    scans: list[ScanOut]


# ------------------------------------------------------------------ admin: directions


class DirectionOut(CamelModel):
    id: int
    code: str
    name: str
    type: DirectionType
    cutoff_time: time | None
    planned_departure: time | None
    depends_on_linehaul: list[str]
    door_code: str | None


class DirectionUpdate(CamelModel):
    name: str | None = Field(default=None, min_length=2, max_length=80)
    cutoff_time: time | None = None
    planned_departure: time | None = None


class AlertListOut(CamelModel):
    alerts: list[AlertOut]


# ------------------------------------------------------------------ depots (map, shadow)


class DepotOut(CamelModel):
    code: str
    name: str
    kind: DepotKind
    # routing point of the simulator
    lat: float
    lon: float
    # centre of the hall (layout.origin, ADR-064): where the map flies to
    center: tuple[float, float] | None = None
    # what the depot is, from the data (phase 7d): "prekládkové depo", "hub Bratislava", "depo"
    label: str | None = None


class LayoutDoor(CamelModel):
    code: str
    kind: DoorKind
    x: float
    y: float
    direction_code: str | None
    direction_name: str | None
    door_drive: DoorDrive
    dock_equipment: DockEquipment


class ParkedVehicle(CamelModel):
    plate: str
    x: float
    y: float
    heading: float


class LayoutOut(CamelModel):
    depot: DepotOut
    layout: dict[str, object]
    doors: list[LayoutDoor]
    # vans of a depot without simulated operations, standing on their parking spot (ADR-066)
    parked: list[ParkedVehicle] = Field(default_factory=list)


class OccupiedDoor(CamelModel):
    door_code: str
    plate: str
    trip_id: int
    trip_kind: TripKind
    status: TripStatus
    direction_code: str
    direction_type: DirectionType


class StagedBay(CamelModel):
    door_code: str
    direction_code: str
    parcels: int


class HubTruck(CamelModel):
    plate: str
    trip_id: int
    # arriving | at_hub | loading_at_hub | departed
    state: str
    at: datetime | None


class DepotState(CamelModel):
    depot: DepotOut
    sim_time: datetime
    occupied: list[OccupiedDoor]
    staged: list[StagedBay]
    trucks: list[HubTruck]
