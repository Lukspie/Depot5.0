"""Domain enumerations (stored as native PostgreSQL enums)."""

from enum import StrEnum


class UserRole(StrEnum):
    ADMIN = "admin"
    DISPATCHER = "dispatcher"
    OPERATOR = "operator"
    SECURITY = "security"
    COURIER = "courier"


class DirectionType(StrEnum):
    LINEHAUL = "linehaul"
    TRANSIT = "transit"
    LOCAL = "local"


class WaveKind(StrEnum):
    EVENING = "evening"
    NIGHT = "night"


class DoorKind(StrEnum):
    LOADING_DOCK = "loading_dock"
    STAGING_BAY = "staging_bay"
    YARD_GATE = "yard_gate"


class VehicleKind(StrEnum):
    TRUCK = "truck"
    VAN = "van"


class TripKind(StrEnum):
    INBOUND = "inbound"
    OUTBOUND = "outbound"


class TripStatus(StrEnum):
    PLANNED = "planned"
    EN_ROUTE = "en_route"
    AT_DOOR = "at_door"
    LOADING = "loading"
    DEPARTED = "departed"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


class ParcelStatus(StrEnum):
    COLLECTED = "collected"
    ON_BELT = "on_belt"
    SORTED = "sorted"
    LOADED = "loaded"
    STAGED = "staged"
    OUT_FOR_DELIVERY = "out_for_delivery"
    DELIVERED = "delivered"
    FAILED_DELIVERY = "failed_delivery"
    RETURNED = "returned"


class EventSource(StrEnum):
    IOT = "iot"
    MANUAL = "manual"
    SYSTEM = "system"


class ScanResult(StrEnum):
    OK = "ok"
    WRONG_DIRECTION = "wrong_direction"
    UNIDENTIFIED = "unidentified"
    DUPLICATE = "duplicate"


class StopOutcome(StrEnum):
    DELIVERED = "delivered"
    FAILED = "failed"


class AlertKind(StrEnum):
    WRONG_DIRECTION = "wrong_direction"
    CASCADE_DELAY = "cascade_delay"
    SCANNER_DEGRADATION = "scanner_degradation"
    DEVICE_OFFLINE = "device_offline"
    OTHER = "other"


class AlertSeverity(StrEnum):
    INFO = "info"
    WARNING = "warning"
    CRITICAL = "critical"
