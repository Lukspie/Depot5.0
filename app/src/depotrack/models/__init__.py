"""SQLAlchemy models of db-wms. Importing this package registers every table on Base.metadata."""

from depotrack.models.alerts import Alert, SeedMeta
from depotrack.models.auth import User, UserSession
from depotrack.models.base import Base
from depotrack.models.delivery import CourierRoute, RouteStop
from depotrack.models.maintenance import MaintenanceOrder
from depotrack.models.network import Depot, Direction, Door, Trip, Vehicle, Wave
from depotrack.models.parcels import (
    CustomerNotification,
    LoadingScan,
    Parcel,
    ParcelEvent,
    TrackingToken,
)

__all__ = [
    "Alert",
    "Base",
    "CourierRoute",
    "CustomerNotification",
    "Depot",
    "Direction",
    "Door",
    "LoadingScan",
    "MaintenanceOrder",
    "Parcel",
    "ParcelEvent",
    "RouteStop",
    "SeedMeta",
    "TrackingToken",
    "Trip",
    "User",
    "UserSession",
    "Vehicle",
    "Wave",
]
