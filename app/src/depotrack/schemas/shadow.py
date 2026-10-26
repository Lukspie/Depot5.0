"""Schemas of the digital shadow (/shadow, ADR-045). camelCase on the wire.

Read by dispatchers and security: no recipient names or addresses here.
"""

from datetime import datetime
from typing import Literal

from depotrack.models.enums import DirectionType, ParcelStatus
from depotrack.schemas.internal import AlertOut, CamelModel
from depotrack.schemas.wms import ClockOut, DashboardKpis, DepotOut, HubTruck, StagedBay, TripBrief


class ShadowDock(CamelModel):
    code: str
    default_direction: str | None
    default_direction_name: str | None
    # outbound trip at the door (with load counters), if any
    trip: TripBrief | None
    # open cascade warning about this departure
    cascade: AlertOut | None


class ShadowOut(CamelModel):
    depot: DepotOut
    clock: ClockOut
    # depot only (the hub is not simulated inside)
    kpis: DashboardKpis | None
    docks: list[ShadowDock]
    staged: list[StagedBay]
    trucks: list[HubTruck]
    alerts: list[AlertOut]


class MissingParcel(CamelModel):
    barcode: str
    status: ParcelStatus
    weight_kg: float


class WrongScan(CamelModel):
    at: datetime
    barcode: str | None
    parcel_direction: str | None


class ShadowDockDetail(CamelModel):
    dock: ShadowDock
    missing: list[MissingParcel]
    missing_count: int
    wrong_direction: list[WrongScan]


class ParcelPlace(CamelModel):
    # belt: on the sorting line, door: at a loading door (waiting or in the truck there),
    # bay: on a courier staging bay, outside: not in the hall (collected, on the road, delivered)
    kind: Literal["belt", "door", "bay", "outside"]
    code: str | None


class ParcelStep(CamelModel):
    status: ParcelStatus
    at: datetime
    door_code: str | None


class ParcelLocate(CamelModel):
    barcode: str
    status: ParcelStatus
    direction_code: str
    direction_name: str
    direction_type: DirectionType
    place: ParcelPlace
    events: list[ParcelStep]
