"""Public customer tracking (zadanie 6): GET /api/track/{token}, no login, rate limits ADR-042."""

from typing import Annotated

from fastapi import APIRouter, HTTPException, Path, Request, Response, status
from slowapi.util import get_remote_address

from depotrack.core.ratelimit import track_limits
from depotrack.core.rbac import DbSession
from depotrack.schemas.delivery import TrackOut
from depotrack.services import telematics
from depotrack.services.tracking import TrackingGoneError, hash_token, track_view

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
        429: {"description": "Too many requests for this link, or failed lookups from this IP"},
    },
)
def track(request: Request, response: Response, token: TokenPath, db: DbSession) -> TrackOut:
    ip = get_remote_address(request)
    token_hash = hash_token(token)
    track_limits.check(ip, token_hash)
    response.headers["Cache-Control"] = "no-store"
    response.headers["Referrer-Policy"] = "no-referrer"
    try:
        view = track_view(db, token, telematics.sim_now())
    except TrackingGoneError:
        track_limits.miss(ip)
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, "Odkaz je neplatný alebo jeho platnosť skončila."
        ) from None
    track_limits.found(token_hash)
    return view
