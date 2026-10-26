"""Maintenance orders for IoT devices, created from the digital shadow (ADR-048)."""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from depotrack.models.base import Base


class MaintenanceOrder(Base):
    """A device taken out of service for `minutes` of simulated time (e.g. cleaning the optics).

    `device_code` is the device code from db-telemetry (no FK across databases).
    """

    __tablename__ = "maintenance_orders"

    id: Mapped[int] = mapped_column(primary_key=True)
    device_code: Mapped[str] = mapped_column(String(32), index=True)
    note: Mapped[str | None] = mapped_column(Text)
    minutes: Mapped[int] = mapped_column(Integer)
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    # simulated time
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    until: Mapped[datetime] = mapped_column(DateTime(timezone=True))
