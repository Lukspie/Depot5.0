"""Authentication and role-based access control as FastAPI dependencies.

Usage:
    @router.get("/x", dependencies=[Depends(require_role(UserRole.ADMIN))])
    def x(user: CurrentUser) -> ...
"""

from collections.abc import Callable
from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from depotrack.core.config import Settings, get_settings
from depotrack.core.db import get_db
from depotrack.core.sessions import get_session_user
from depotrack.models import User
from depotrack.models.enums import UserRole

DbSession = Annotated[Session, Depends(get_db)]


def get_current_user(
    request: Request,
    db: DbSession,
    settings: Annotated[Settings, Depends(get_settings)],
) -> User:
    token = request.cookies.get(settings.session_cookie_name)
    user = get_session_user(db, token) if token else None
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


def require_role(*roles: UserRole) -> Callable[[User], User]:
    """Dependency that allows only the listed roles (401 if not logged in, 403 otherwise)."""
    allowed = frozenset(roles)

    def check(user: CurrentUser) -> User:
        if user.role not in allowed:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Insufficient role")
        return user

    return check
