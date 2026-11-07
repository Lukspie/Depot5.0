"""Pydantic schemas for authentication and user management."""

from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field, StringConstraints

from depotrack.models.enums import UserRole


def _normalize_username(value: object) -> object:
    return value.strip().lower() if isinstance(value, str) else value


# usernames are case-insensitive: normalized before the pattern check
Username = Annotated[
    str,
    BeforeValidator(_normalize_username),
    StringConstraints(pattern=r"^[a-z0-9._-]{3,32}$"),
]
Password = Annotated[str, Field(min_length=8, max_length=128)]
FullName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=120)]
Shift = Literal["morning", "afternoon", "night"]


class LoginIn(BaseModel):
    username: Annotated[str, BeforeValidator(_normalize_username), StringConstraints(max_length=64)]
    password: Annotated[str, Field(max_length=128)]


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    full_name: str
    role: UserRole
    active: bool
    created_at: datetime
    shift: Shift | None = None


class UserCreate(BaseModel):
    username: Username
    full_name: FullName
    role: UserRole
    password: Password
    shift: Shift | None = None


class UserUpdate(BaseModel):
    full_name: FullName | None = None
    role: UserRole | None = None
    active: bool | None = None
    password: Password | None = None
    # sent as null: no shift
    shift: Shift | None = None
