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


def broadcast_many(channel: str, type_: str, events: list[dict[str, Any]]) -> None:
    """Push events to WebSocket clients subscribed to `channel` (alerts, loading scans…)."""
    url = f"{get_settings().telematics_internal_url}/internal/broadcast"
    try:
        httpx.post(
            url,
            json={"channel": channel, "type": type_, "events": events},
            headers=_headers(),
            timeout=_TIMEOUT,
        ).raise_for_status()
    except httpx.HTTPError as exc:
        log.warning("broadcast to telematics failed: %s", exc)


_devices_cache: tuple[float, list[dict[str, Any]]] | None = None


def devices() -> list[dict[str, Any]]:
    """Device states from telematics (status, read rate); [] if unreachable. Cached 3 s."""
    global _devices_cache
    now = time.monotonic()
    if _devices_cache and now - _devices_cache[0] < 3.0:
        return _devices_cache[1]
    try:
        resp = httpx.get(
            f"{get_settings().telematics_internal_url}/devices",
            headers=_headers(),
            timeout=_TIMEOUT,
        )
        resp.raise_for_status()
        data: list[dict[str, Any]] = resp.json()["devices"]
    except (httpx.HTTPError, KeyError, ValueError) as exc:
        log.warning("cannot read devices from telematics: %s", exc)
        return []
    _devices_cache = (now, data)
    return data


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
