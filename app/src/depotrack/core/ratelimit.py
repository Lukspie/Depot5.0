"""Rate limits (in-memory: fine for a single app instance).

`limiter` is the shared slowapi limiter keyed by client IP (login, ETA board). The public
tracking endpoint has its own two-level limits (ADR-042), see `TrackLimits`. Behind a reverse
proxy the client IP comes from X-Forwarded-For, which uvicorn trusts only from
FORWARDED_ALLOW_IPS (`--proxy-headers`).
"""

from fastapi import HTTPException, status
from limits import parse
from limits.storage import MemoryStorage
from limits.strategies import MovingWindowRateLimiter
from slowapi import Limiter
from slowapi.util import get_remote_address

from depotrack.core.config import get_settings

limiter = Limiter(key_func=get_remote_address)


class TrackLimits:
    """GET /api/track/{token}: a valid link is limited per token (several windows of one or more
    links behind one IP keep working), failed lookups are limited strictly per IP (guessing).

    An IP over the failed-lookup limit gets 429 for every token, valid ones included, so the
    limit cannot be used as an oracle for which tokens exist.
    """

    def __init__(self) -> None:
        self._storage = MemoryStorage()
        self._window = MovingWindowRateLimiter(self._storage)

    def check(self, ip: str, token_hash: str) -> None:
        """Before the lookup: raise 429 if the IP or the link is over its limit."""
        settings = get_settings()
        for limit, namespace, key in (
            (parse(settings.track_miss_rate_limit), "track-miss", ip),
            (parse(settings.track_token_rate_limit), "track-token", token_hash),
        ):
            if not self._window.test(limit, namespace, key):
                raise HTTPException(
                    status.HTTP_429_TOO_MANY_REQUESTS,
                    "Too many requests",
                    headers={"Retry-After": str(limit.get_expiry())},
                )

    def found(self, token_hash: str) -> None:
        self._window.hit(parse(get_settings().track_token_rate_limit), "track-token", token_hash)

    def miss(self, ip: str) -> None:
        self._window.hit(parse(get_settings().track_miss_rate_limit), "track-miss", ip)

    def reset(self) -> None:
        self._storage.reset()


track_limits = TrackLimits()
