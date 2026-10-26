"""Public customer tracking (zadanie 6): GET /api/track/{token}, no login, rate-limited per IP."""

from typing import Annotated

from fastapi import APIRouter, HTTPException, Path, Request, Response, status

from depotrack.core.config import get_settings
from depotrack.core.ratelimit import limiter
from depotrack.core.rbac import DbSession
from depotrack.schemas.delivery import TrackOut
from depotrack.services import telematics
from depotrack.services.tracking import TrackingGoneError, track_view

router = APIRouter(prefix="/api", tags=["tracking"])

# token_urlsafe(32) = 43 characters of [A-Za-z0-9_-]
TokenPath = Annotated[str, Path(min_length=32, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")]


@router.get(
    "/track/{token}",
    response_model=TrackOut,
    response_model_by_alias=True,
    response_model_exclude_none=True,
    responses={
        404: {"description": "Unknown, expired or revoked link"},
        429: {"description": "Too many requests from this IP"},
    },
)
@limiter.limit(lambda: get_settings().track_rate_limit)
def track(request: Request, response: Response, token: TokenPath, db: DbSession) -> TrackOut:
    response.headers["Cache-Control"] = "no-store"
    response.headers["Referrer-Policy"] = "no-referrer"
    try:
        return track_view(db, token, telematics.sim_now())
    except TrackingGoneError:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, "Odkaz je neplatný alebo jeho platnosť skončila."
        ) from None
