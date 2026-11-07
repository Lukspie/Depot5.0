"""Gate passages and the decisions about them (ADR-061): the model recommends, rules decide,
security decides when unsure. Every decision is in the audit (who, when, why)."""

from datetime import date, datetime

from sqlalchemy import Date, DateTime, Float, ForeignKey, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from depotrack.models.base import Base, utcnow_column


class GateEvent(Base):
    """One vehicle at the gate, from the camera (`/api/gate/detect`) or the simulator."""

    __tablename__ = "gate_events"
    __table_args__ = (Index("ix_gate_events_open", "resolution", "decision"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    # simulated time
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    source: Mapped[str] = mapped_column(String(8))  # camera | sim
    # idempotency key of a simulated passage (telematics may resend a batch)
    external_key: Mapped[str | None] = mapped_column(String(80), unique=True)
    direction: Mapped[str] = mapped_column(String(3))  # in | out
    # what the model saw: car | van | truck | bus, None = no vehicle found
    vehicle_type: Mapped[str | None] = mapped_column(String(8))
    vehicle_confidence: Mapped[float | None] = mapped_column(Float)
    plate: Mapped[str | None] = mapped_column(String(16), index=True)
    plate_confidence: Mapped[float | None] = mapped_column(Float)
    # identity: decided by the plate, never by the image
    vehicle_id: Mapped[int | None] = mapped_column(ForeignKey("vehicles.id"))
    allowed_plate_id: Mapped[int | None] = mapped_column(
        ForeignKey("gate_allowed_plates.id", ondelete="SET NULL")
    )
    # rules: auto_pass | pass_verify (passed, security confirms later) | hold (waits for security)
    decision: Mapped[str] = mapped_column(String(12))
    reason: Mapped[str] = mapped_column(String(40))
    # security: allowed | denied (hold), verified (pass_verify), expired (closed by the system)
    resolution: Mapped[str | None] = mapped_column(String(10))
    resolved_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    note: Mapped[str | None] = mapped_column(Text)


class GateAudit(Base):
    """Append-only log of every decision: the rules (actor None) and security."""

    __tablename__ = "gate_audit"

    id: Mapped[int] = mapped_column(primary_key=True)
    event_id: Mapped[int] = mapped_column(
        ForeignKey("gate_events.id", ondelete="CASCADE"), index=True
    )
    # simulated time of the decision; created_at is the wall clock
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    actor_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    action: Mapped[str] = mapped_column(String(12))
    reason: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = utcnow_column()


class GateAllowedPlate(Base):
    """External vehicles allowed in without asking (contract carriers, services)."""

    __tablename__ = "gate_allowed_plates"

    id: Mapped[int] = mapped_column(primary_key=True)
    plate: Mapped[str] = mapped_column(String(16), unique=True)
    holder: Mapped[str] = mapped_column(String(120))
    valid_until: Mapped[date | None] = mapped_column(Date)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = utcnow_column()
