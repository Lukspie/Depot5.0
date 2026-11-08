"""Dispatching view of design system v2 (phase 7d, maketa-dispecing): everything the page shows,
computed for the depot, so the same layout serves a transshipment depot (Budimír) and a
delivery depot (Žilina, Ivanka)."""

from datetime import datetime
from typing import Literal

from depotrack.models.enums import AlertKind, AlertSeverity, TripKind, TripStatus
from depotrack.schemas.internal import CamelModel
from depotrack.schemas.wms import ClockOut

Tone = Literal["ok", "info", "warn", "danger", "neutral", "brand"]


class DispatchDepot(CamelModel):
    code: str
    name: str
    label: str
    # transship: waves, linehaul and transit trucks; delivery: a feeder truck and couriers
    mode: Literal["transship", "delivery"]


class Delta(CamelModel):
    value: str
    tone: Tone


class KpiOut(CamelModel):
    key: str
    label: str
    tone: Tone
    value: str
    unit: str | None = None
    # values every 30 min since 15:00 (oldest first)
    spark: list[float]
    delta: Delta | None = None
    context: str | None = None


class Risk(CamelModel):
    label: str
    tone: Tone
    reason: str


class TripRow(CamelModel):
    # "trip-12" or "route-5"
    key: str
    group: str
    kind: TripKind
    status: TripStatus | Literal["loading", "on_round", "back", "planned"]
    status_label: str
    status_tone: Tone
    plan: datetime | None
    direction: str
    plate: str
    type_label: str
    door: str | None
    loaded: int
    expected: int
    # departed with parcels left behind; None while still loading
    missing: int | None
    # when loading starts (the truck at the door, the couriers at 06:30)
    loading_from: datetime | None
    eta: datetime | None
    delta_min: int | None
    # where the estimate comes from: "ml", "telematics", "cascade"
    eta_by: str | None
    risk: Risk | None
    # where the row opens (truck in the shadow, courier route)
    href: str | None


class TripGroup(CamelModel):
    key: str
    tab: Literal["out", "in"]
    title: str
    sub: str
    tone: Tone


class AlertAction(CamelModel):
    label: str
    # link: open href; maintenance: send the device to maintenance; scenario: what-if in the shadow
    kind: Literal["link", "maintenance", "scenario"]
    target: str


class AlertCard(CamelModel):
    id: int
    kind: AlertKind
    severity: AlertSeverity
    at: datetime
    source: str | None
    title: str
    facts: list[str]
    action: AlertAction | None


class DirectionBar(CamelModel):
    name: str
    # transship: loaded / staged / waiting; delivery: delivered / out for delivery / in the depot
    parts: list[int]
    total: int


class TimelineSegment(CamelModel):
    name: str
    start: datetime
    end: datetime
    # colour of the bar: primary = black (the morning departures in the mockup)
    tone: Tone | Literal["primary"]
    state: str
    state_tone: Tone


class DispatchOut(CamelModel):
    depot: DispatchDepot
    clock: ClockOut
    summary: str
    kpis: list[KpiOut]
    groups: list[TripGroup]
    trips: list[TripRow]
    alerts: list[AlertCard]
    # names of the three parts of the direction bars, with their totals
    legend: list[str]
    legend_totals: list[int]
    directions: list[DirectionBar]
    day_start: datetime
    timeline: list[TimelineSegment]
