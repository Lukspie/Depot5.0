"""REST client app -> telematics (service token). Failures are logged, never raised:
telematics being briefly unavailable must not break business requests."""

import logging
import time
from datetime import UTC, datetime
from typing import Any

import httpx

from depotrack.core.config import get_settings

log = logging.getLogger(__name__)

_TIMEOUT = httpx.Timeout(2.0)
_clock_cache: tuple[float, datetime] | None = None


def _headers() -> dict[str, str]:
    return {"X-Service-Token": get_settings().service_token}


def broadcast(channel: str, event: dict[str, Any]) -> None:
    """Push an event to WebSocket clients subscribed to `channel` (e.g. alerts)."""
    url = f"{get_settings().telematics_internal_url}/internal/broadcast"
    try:
        httpx.post(
            url, json={"channel": channel, "event": event}, headers=_headers(), timeout=_TIMEOUT
        ).raise_for_status()
    except httpx.HTTPError as exc:
        log.warning("broadcast to telematics failed: %s", exc)


def sim_now() -> datetime:
    """Simulated time owned by telematics; falls back to wall-clock time if unreachable."""
    global _clock_cache
    now = time.monotonic()
    if _clock_cache and now - _clock_cache[0] < 1.0:
        return _clock_cache[1]
    try:
        resp = httpx.get(f"{get_settings().telematics_internal_url}/sim/clock", timeout=_TIMEOUT)
        resp.raise_for_status()
        sim = datetime.fromisoformat(resp.json()["simTime"])
    except (httpx.HTTPError, KeyError, ValueError) as exc:
        log.warning("cannot read simulated clock, using wall clock: %s", exc)
        return datetime.now(UTC)
    _clock_cache = (now, sim)
    return sim
