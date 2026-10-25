"""Login, logout and the current user."""

from datetime import timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import select

from depotrack.core.config import Settings, get_settings
from depotrack.core.ratelimit import limiter
from depotrack.core.rbac import CurrentUser, DbSession
from depotrack.core.security import verify_password
from depotrack.core.sessions import create_session, delete_session
from depotrack.models import User
from depotrack.schemas.users import LoginIn, UserOut

router = APIRouter(prefix="/api/auth", tags=["auth"])

SettingsDep = Annotated[Settings, Depends(get_settings)]


@router.post(
    "/login",
    response_model=UserOut,
    responses={401: {"description": "Bad credentials"}, 403: {"description": "Account disabled"}},
)
@limiter.limit(lambda: get_settings().login_rate_limit)
def login(
    request: Request, response: Response, body: LoginIn, db: DbSession, settings: SettingsDep
) -> User:
    user = db.execute(select(User).where(User.username == body.username)).scalar_one_or_none()
    # verify_password runs even for unknown usernames, so timing does not leak which exist
    if not verify_password(user.password_hash if user else None, body.password) or user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid username or password")
    if not user.active:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Account disabled")

    ttl = timedelta(hours=settings.session_ttl_hours)
    token = create_session(
        db,
        user,
        ttl,
        ip=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    response.set_cookie(
        settings.session_cookie_name,
        token,
        max_age=int(ttl.total_seconds()),
        httponly=True,
        samesite="strict",
        secure=settings.session_cookie_secure,
        path="/",
    )
    return user


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(request: Request, response: Response, db: DbSession, settings: SettingsDep) -> None:
    token = request.cookies.get(settings.session_cookie_name)
    if token:
        delete_session(db, token)
    response.delete_cookie(
        settings.session_cookie_name,
        path="/",
        httponly=True,
        samesite="strict",
        secure=settings.session_cookie_secure,
    )


@router.get("/me", response_model=UserOut)
def me(user: CurrentUser) -> User:
    return user
