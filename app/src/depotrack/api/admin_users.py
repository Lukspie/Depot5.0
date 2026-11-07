"""User management for administrators."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select

from depotrack.core.rbac import DbSession, require_role
from depotrack.core.security import hash_password
from depotrack.core.sessions import delete_user_sessions
from depotrack.models import User
from depotrack.models.enums import UserRole
from depotrack.schemas.users import UserCreate, UserOut, UserUpdate

router = APIRouter(prefix="/api/admin/users", tags=["admin"])

Admin = Annotated[User, Depends(require_role(UserRole.ADMIN))]


@router.get("", response_model=list[UserOut])
def list_users(_: Admin, db: DbSession) -> list[User]:
    return list(db.execute(select(User).order_by(User.role, User.username)).scalars())


@router.post(
    "",
    response_model=UserOut,
    status_code=status.HTTP_201_CREATED,
    responses={409: {"description": "Username already exists"}},
)
def create_user(body: UserCreate, _: Admin, db: DbSession) -> User:
    exists = db.execute(select(User.id).where(User.username == body.username)).first()
    if exists:
        raise HTTPException(status.HTTP_409_CONFLICT, "Username already exists")
    user = User(
        username=body.username,
        full_name=body.full_name,
        role=body.role,
        password_hash=hash_password(body.password),
        active=True,
        shift=body.shift,
    )
    db.add(user)
    db.commit()
    return user


@router.patch(
    "/{user_id}",
    response_model=UserOut,
    responses={
        400: {"description": "Admin cannot deactivate or demote themselves"},
        404: {"description": "User not found"},
    },
)
def update_user(user_id: int, body: UserUpdate, admin: Admin, db: DbSession) -> User:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")

    # an admin must not lock themselves out
    if user.id == admin.id and (
        body.active is False or (body.role is not None and body.role != UserRole.ADMIN)
    ):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Cannot deactivate or demote yourself")

    if body.full_name is not None:
        user.full_name = body.full_name
    if body.role is not None:
        user.role = body.role
    if body.active is not None:
        user.active = body.active
    if body.password is not None:
        user.password_hash = hash_password(body.password)
    if "shift" in body.model_fields_set:
        user.shift = body.shift

    # deactivation, role or password change ends the user's other sessions
    if user.id != admin.id and (
        body.active is False or body.role is not None or body.password is not None
    ):
        delete_user_sessions(db, user.id)

    db.commit()
    return user
