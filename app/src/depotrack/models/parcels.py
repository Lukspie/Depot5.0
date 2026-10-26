"""Parcels, their timeline, loading scans, customer tracking tokens and simulated SMS."""

from datetime import datetime

from sqlalchemy import BigInteger, DateTime, Float, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from depotrack.models.base import Base, pg_enum, utcnow_column
from depotrack.models.enums import EventSource, ParcelStatus, ScanResult


class Parcel(Base):
    __tablename__ = "parcels"
    __table_args__ = (Index("ix_parcels_direction_status", "direction_id", "status"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    barcode: Mapped[str] = mapped_column(String(32), unique=True)
    weight_kg: Mapped[float] = mapped_column(Float)
    length_cm: Mapped[int] = mapped_column(Integer)
    width_cm: Mapped[int] = mapped_column(Integer)
    height_cm: Mapped[int] = mapped_column(Integer)
    recipient_name: Mapped[str] = mapped_column(String(120))
    address: Mapped[str] = mapped_column(String(255))
    lat: Mapped[float] = mapped_column(Float)
    lon: Mapped[float] = mapped_column(Float)
    direction_id: Mapped[int] = mapped_column(ForeignKey("directions.id"))
    status: Mapped[ParcelStatus] = mapped_column(pg_enum(ParcelStatus, "parcel_status"))
    sender: Mapped[str] = mapped_column(String(120))
    created_at: Mapped[datetime] = utcnow_column()


class ParcelEvent(Base):
    """Status timeline of a parcel."""

    __tablename__ = "parcel_events"
    __table_args__ = (Index("ix_parcel_events_parcel_at", "parcel_id", "at"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    parcel_id: Mapped[int] = mapped_column(ForeignKey("parcels.id", ondelete="CASCADE"))
    status: Mapped[ParcelStatus] = mapped_column(pg_enum(ParcelStatus, "parcel_status"))
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    source: Mapped[EventSource] = mapped_column(pg_enum(EventSource, "event_source"))
    door_id: Mapped[int | None] = mapped_column(ForeignKey("doors.id"))
    trip_id: Mapped[int | None] = mapped_column(ForeignKey("trips.id"))
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))


class LoadingScan(Base):
    """One scan at a loading door.

    `device_id` is the device code from db-telemetry (no FK across databases).
    """

    __tablename__ = "loading_scans"
    __table_args__ = (Index("ix_loading_scans_trip_at", "trip_id", "at"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    parcel_id: Mapped[int | None] = mapped_column(ForeignKey("parcels.id", ondelete="SET NULL"))
    trip_id: Mapped[int] = mapped_column(ForeignKey("trips.id"))
    door_id: Mapped[int] = mapped_column(ForeignKey("doors.id"))
    device_id: Mapped[str | None] = mapped_column(String(32))
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    result: Mapped[ScanResult] = mapped_column(pg_enum(ScanResult, "scan_result"))


class TrackingToken(Base):
    """Customer tracking link. Only the SHA-256 hash of the token is stored (ADR-010)."""

    __tablename__ = "tracking_tokens"

    id: Mapped[int] = mapped_column(primary_key=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    parcel_id: Mapped[int] = mapped_column(ForeignKey("parcels.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime] = utcnow_column()
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class CustomerNotification(Base):
    """A simulated SMS as it was sent, including the full /track/<token> link (ADR-010)."""

    __tablename__ = "customer_notifications"

    id: Mapped[int] = mapped_column(primary_key=True)
    parcel_id: Mapped[int] = mapped_column(ForeignKey("parcels.id", ondelete="CASCADE"), index=True)
    channel: Mapped[str] = mapped_column(String(16), server_default="sms")
    recipient: Mapped[str] = mapped_column(String(120))
    message: Mapped[str] = mapped_column(Text)
    link: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = utcnow_column(index=True)
