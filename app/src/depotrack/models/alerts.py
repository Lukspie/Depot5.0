"""Alerts shown to dispatchers (ADR-009) and seed bookkeeping."""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from depotrack.models.base import Base, pg_enum, utcnow_column
from depotrack.models.enums import AlertKind, AlertSeverity


class Alert(Base):
    __tablename__ = "alerts"
    __table_args__ = (Index("ix_alerts_open", "acknowledged_at", "created_at"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    kind: Mapped[AlertKind] = mapped_column(pg_enum(AlertKind, "alert_kind"))
    severity: Mapped[AlertSeverity] = mapped_column(pg_enum(AlertSeverity, "alert_severity"))
    message: Mapped[str] = mapped_column(Text)
    # what the alert is about, e.g. ("trip", 12) or ("device", "DOCK-SCN-03")
    ref_type: Mapped[str | None] = mapped_column(String(32))
    ref_id: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = utcnow_column()
    acknowledged_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    acknowledged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class SeedMeta(Base):
    """Which seed steps have already run, so seeding on startup is idempotent."""

    __tablename__ = "seed_meta"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    applied_at: Mapped[datetime] = utcnow_column()
