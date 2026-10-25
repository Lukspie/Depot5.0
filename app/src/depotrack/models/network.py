"""Depot network: directions, sorting waves, doors, vehicles and trips."""

from datetime import date, datetime, time

from sqlalchemy import (
    ARRAY,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Time,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from depotrack.models.base import Base, pg_enum
from depotrack.models.enums import (
    DirectionType,
    DoorKind,
    TripKind,
    TripStatus,
    VehicleKind,
    WaveKind,
)


class Direction(Base):
    __tablename__ = "directions"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(16), unique=True)
    name: Mapped[str] = mapped_column(String(80))
    type: Mapped[DirectionType] = mapped_column(pg_enum(DirectionType, "direction_type"))
    cutoff_time: Mapped[time | None] = mapped_column(Time)
    planned_departure: Mapped[time | None] = mapped_column(Time)
    # transit only: codes of the linehaul directions whose night trucks feed this one
    depends_on_linehaul: Mapped[list[str]] = mapped_column(
        ARRAY(String(16)), server_default=text("'{}'")
    )


class Wave(Base):
    __tablename__ = "waves"
    __table_args__ = (UniqueConstraint("date", "kind"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    date: Mapped[date] = mapped_column(Date)
    kind: Mapped[WaveKind] = mapped_column(pg_enum(WaveKind, "wave_kind"))
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class Door(Base):
    """Loading dock, courier staging bay or yard gate. Positions (metres) feed the digital twin.

    `direction_id` is only the default direction;
    the actual assignment is `trips.door_id` (ADR-007).
    """

    __tablename__ = "doors"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(16), unique=True)
    kind: Mapped[DoorKind] = mapped_column(pg_enum(DoorKind, "door_kind"))
    direction_id: Mapped[int | None] = mapped_column(ForeignKey("directions.id"))
    position_x: Mapped[float] = mapped_column(Float)
    position_y: Mapped[float] = mapped_column(Float)


class Vehicle(Base):
    __tablename__ = "vehicles"

    id: Mapped[int] = mapped_column(primary_key=True)
    plate: Mapped[str] = mapped_column(String(16), unique=True)
    kind: Mapped[VehicleKind] = mapped_column(pg_enum(VehicleKind, "vehicle_kind"))
    capacity_kg: Mapped[int] = mapped_column(Integer)
    capacity_parcels: Mapped[int] = mapped_column(Integer)


class Trip(Base):
    __tablename__ = "trips"

    id: Mapped[int] = mapped_column(primary_key=True)
    vehicle_id: Mapped[int] = mapped_column(ForeignKey("vehicles.id"), index=True)
    direction_id: Mapped[int] = mapped_column(ForeignKey("directions.id"), index=True)
    door_id: Mapped[int | None] = mapped_column(ForeignKey("doors.id"))
    kind: Mapped[TripKind] = mapped_column(pg_enum(TripKind, "trip_kind"))
    planned_arrival: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    actual_arrival: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    predicted_arrival: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    planned_departure: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    actual_departure: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    status: Mapped[TripStatus] = mapped_column(
        pg_enum(TripStatus, "trip_status"), server_default=TripStatus.PLANNED.value
    )
