"""Courier routes and their ordered stops."""

from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, Integer, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from depotrack.models.base import Base, pg_enum
from depotrack.models.enums import StopOutcome


class CourierRoute(Base):
    __tablename__ = "courier_routes"
    __table_args__ = (UniqueConstraint("courier_user_id", "date"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    courier_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    vehicle_id: Mapped[int] = mapped_column(ForeignKey("vehicles.id"))
    date: Mapped[date] = mapped_column(Date)
    rajon_direction_id: Mapped[int] = mapped_column(ForeignKey("directions.id"))


class RouteStop(Base):
    __tablename__ = "route_stops"
    __table_args__ = (UniqueConstraint("route_id", "sequence"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    route_id: Mapped[int] = mapped_column(ForeignKey("courier_routes.id", ondelete="CASCADE"))
    parcel_id: Mapped[int] = mapped_column(ForeignKey("parcels.id"), index=True)
    sequence: Mapped[int] = mapped_column(Integer)
    planned_eta: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    predicted_eta: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    outcome: Mapped[StopOutcome | None] = mapped_column(pg_enum(StopOutcome, "stop_outcome"))
