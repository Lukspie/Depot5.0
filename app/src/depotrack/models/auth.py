"""Users and server-side sessions."""

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, true
from sqlalchemy.orm import Mapped, mapped_column

from depotrack.models.base import Base, pg_enum, utcnow_column
from depotrack.models.enums import UserRole


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(32), unique=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    full_name: Mapped[str] = mapped_column(String(120))
    role: Mapped[UserRole] = mapped_column(pg_enum(UserRole, "user_role"))
    active: Mapped[bool] = mapped_column(Boolean, server_default=true())
    created_at: Mapped[datetime] = utcnow_column()
    # work shift of a dispatcher: morning | afternoon | night (phase 7b)
    shift: Mapped[str | None] = mapped_column(String(10))


class UserSession(Base):
    """A login session.

    `id` is the SHA-256 hex digest of the cookie value, never the value itself.
    """

    __tablename__ = "sessions"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime] = utcnow_column()
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    ip: Mapped[str | None] = mapped_column(String(64))
    user_agent: Mapped[str | None] = mapped_column(String(255))
