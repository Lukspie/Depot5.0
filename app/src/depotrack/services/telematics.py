"""REST client app -> telematics (service token). Failures are logged, never raised:
telematics being briefly unavailable must not break business requests."""

import logging
import time
from datetime import UTC, date, datetime
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


_weather_cache: tuple[float, dict[str, str]] | None = None


def weather_of(day: date) -> str | None:
    """Simulated weather of an operating day (telematics scenario, a delay model feature).
    None if telematics is unreachable or the day is not loaded. Cached 30 s."""
    global _weather_cache
    now = time.monotonic()
    if not _weather_cache or now - _weather_cache[0] > 30.0:
        try:
            resp = httpx.get(
                f"{get_settings().telematics_internal_url}/sim/scenario",
                headers=_headers(),
                timeout=_TIMEOUT,
            )
            resp.raise_for_status()
            days = resp.json()["days"]
            _weather_cache = (now, {str(d["day"]): str(d["weather"]) for d in days})
        except (httpx.HTTPError, KeyError, ValueError, TypeError) as exc:
            log.warning("cannot read the scenario weather: %s", exc)
            return None
    return _weather_cache[1].get(day.isoformat())


def device_metrics(code: str, hours: int = 2) -> list[dict[str, Any]] | None:
    """10-minute buckets of a device ({at, items, readRate}); None if telematics is unreachable."""
    try:
        resp = httpx.get(
            f"{get_settings().telematics_internal_url}/devices/{code}/metrics",
            params={"hours": hours},
            headers=_headers(),
            timeout=_TIMEOUT,
        )
        resp.raise_for_status()
        return list(resp.json()["buckets"])
    except (httpx.HTTPError, KeyError, ValueError, TypeError) as exc:
        log.warning("cannot read metrics of %s: %s", code, exc)
        return None


def post_gate_passage(passage: dict[str, Any]) -> bool:
    """A real gate camera passage to telematics (stored, broadcast; ADR-059); False on failure."""
    try:
        httpx.post(
            f"{get_settings().telematics_internal_url}/internal/gate/passages",
            json=passage,
            headers=_headers(),
            timeout=_TIMEOUT,
        ).raise_for_status()
        return True
    except httpx.HTTPError as exc:
        log.warning("gate passage to telematics failed: %s", exc)
        return False


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


def reload_plan() -> bool:
    """The plan changed (trip moved to another door): telematics reloads it (ADR-048)."""
    try:
        httpx.post(
            f"{get_settings().telematics_internal_url}/internal/plan/reload",
            headers=_headers(),
            timeout=_TIMEOUT,
        ).raise_for_status()
    except httpx.HTTPError as exc:
        log.warning("plan reload in telematics failed: %s", exc)
        return False
    return True


def start_maintenance(code: str, minutes: int) -> dict[str, Any] | None:
    """Put a device into maintenance in the simulator; None if telematics is unreachable."""
    global _devices_cache
    try:
        resp = httpx.post(
            f"{get_settings().telematics_internal_url}/internal/devices/{code}/maintenance",
            json={"minutes": minutes},
            headers=_headers(),
            timeout=_TIMEOUT,
        )
        resp.raise_for_status()
        data: dict[str, Any] = resp.json()
    except (httpx.HTTPError, ValueError) as exc:
        log.warning("maintenance of %s in telematics failed: %s", code, exc)
        return None
    _devices_cache = None
    return data


_positions: dict[str, tuple[float, dict[str, Any] | None]] = {}


def vehicle_position(plate: str) -> dict[str, Any] | None:
    """Current simulated position of a vehicle (lat, lon, heading, moving); None if unknown or
    telematics is unreachable. Cached 2 s per plate: many customers poll the same van."""
    now = time.monotonic()
    hit = _positions.get(plate)
    if hit and now - hit[0] < 2.0:
        return hit[1]
    try:
        resp = httpx.get(
            f"{get_settings().telematics_internal_url}/internal/vehicles/{plate}",
            headers=_headers(),
            timeout=_TIMEOUT,
        )
        if resp.status_code == 404:
            data = None
        else:
            resp.raise_for_status()
            data = resp.json()
    except (httpx.HTTPError, ValueError) as exc:
        log.warning("cannot read vehicle position from telematics: %s", exc)
        return None
    _positions[plate] = (now, data)
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
