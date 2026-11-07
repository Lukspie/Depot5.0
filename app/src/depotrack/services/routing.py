"""Order of the courier stops with delivery time windows (ADR-062).

Three kinds of delivery: personal handover (the customer must be at home, 3 h window), mailbox
and parcel locker (any time). The tour is a time-oriented nearest neighbour (Solomon 1987): the
next stop minimises

    0.7 × driving minutes + 0.7 × waiting for the window + 0.1 × minutes left in the window,

where a mailbox or locker counts as FLEX_URGENCY_MIN minutes left, so they fill the gaps between
handovers instead of pushing them out of their windows. A handover already late goes first.

On 16 real routes (80–100 stops) the plain nearest neighbour of phase 4 missed 69 % of the
windows, this one 0 %, for ~80 % more kilometres (measured in ADR-062). O(n²) per route, so it
runs in the seed step without delay.
"""

import hashlib
import math
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime, time, timedelta

HANDOVER, MAILBOX, LOCKER = "handover", "mailbox", "locker"
# 3 h windows of personal handovers (morning, midday, afternoon)
WINDOWS = [(time(8, 0), time(11, 0)), (time(10, 0), time(13, 0)), (time(12, 0), time(15, 0))]
PLAN_SPEED_KMH = 28.0
ROAD_FACTOR = 1.35  # street distance vs. straight line
SERVICE_MIN = {HANDOVER: 4.0, MAILBOX: 2.0, LOCKER: 3.0}
W_DRIVE, W_WAIT, W_URGENCY = 0.7, 0.7, 0.1
FLEX_URGENCY_MIN = 240.0


def delivery_profile(barcode: str) -> tuple[str, time | None, time | None]:
    """Kind of delivery and window of a parcel, fixed by its barcode (~60 / 25 / 15 %). The same
    formula is in the migration that filled the existing parcels (md5, first 7 hex digits)."""
    h = int(hashlib.md5(barcode.encode(), usedforsecurity=False).hexdigest()[:7], 16)
    r = h % 100
    if r < 60:
        start, end = WINDOWS[(h // 100) % len(WINDOWS)]
        return HANDOVER, start, end
    return (MAILBOX if r < 85 else LOCKER), None, None


def delivery_columns(barcode: str) -> dict[str, object]:
    kind, start, end = delivery_profile(barcode)
    return {"delivery_type": kind, "window_from": start, "window_to": end}


def km(a: tuple[float, float], b: tuple[float, float]) -> float:
    dlat = math.radians(b[0] - a[0])
    dlon = math.radians(b[1] - a[1])
    h = (
        math.sin(dlat / 2) ** 2
        + math.cos(math.radians(a[0])) * math.cos(math.radians(b[0])) * math.sin(dlon / 2) ** 2
    )
    return 2 * 6371.0 * math.asin(math.sqrt(h))


def drive_min(a: tuple[float, float], b: tuple[float, float]) -> float:
    return km(a, b) * ROAD_FACTOR / PLAN_SPEED_KMH * 60


@dataclass(frozen=True)
class Stop:
    key: str  # barcode: ties are broken by it, so the order is deterministic
    lat: float
    lon: float
    kind: str
    window: tuple[datetime, datetime] | None

    @property
    def pos(self) -> tuple[float, float]:
        return (self.lat, self.lon)


@dataclass(frozen=True)
class Visit:
    stop: Stop
    eta: datetime  # arrival after any wait for the window
    late_min: float  # after the end of the window (0 = in time)


def plan_tour(start: tuple[float, float], depart: datetime, stops: Sequence[Stop]) -> list[Visit]:
    left = sorted(stops, key=lambda s: s.key)
    here, t = start, depart
    out: list[Visit] = []
    while left:
        best: tuple[tuple[float, str], Stop, datetime, float] | None = None
        for s in left:
            drive = drive_min(here, s.pos)
            arrive = t + timedelta(minutes=drive)
            wait, urgency = 0.0, FLEX_URGENCY_MIN
            if s.window is not None:
                wait = max(0.0, (s.window[0] - arrive).total_seconds() / 60)
                urgency = (s.window[1] - arrive).total_seconds() / 60
                if urgency < 0:  # already late: as soon as possible
                    urgency *= 3
            cost = W_DRIVE * drive + W_WAIT * wait + W_URGENCY * urgency
            if best is None or (cost, s.key) < best[0]:
                best = ((cost, s.key), s, arrive, wait)
        assert best is not None
        _, nxt, arrive, wait = best
        eta = arrive + timedelta(minutes=wait)
        late = 0.0 if nxt.window is None else max(0.0, (eta - nxt.window[1]).total_seconds() / 60)
        out.append(Visit(nxt, eta, late))
        left.remove(nxt)
        here, t = nxt.pos, eta + timedelta(minutes=SERVICE_MIN.get(nxt.kind, 4.0))
    return out


def nearest_neighbour_tour(
    start: tuple[float, float], depart: datetime, stops: Sequence[Stop]
) -> list[Visit]:
    """The phase 4 order (closest stop next, no waiting), for comparison in tests and the ADR."""
    left = sorted(stops, key=lambda s: s.key)
    here, t = start, depart
    out: list[Visit] = []
    while left:
        nxt = min(left, key=lambda s: (km(here, s.pos), s.key))
        eta = t + timedelta(minutes=drive_min(here, nxt.pos))
        late = 0.0
        if nxt.window is not None:
            eta = max(eta, nxt.window[0])
            late = max(0.0, (eta - nxt.window[1]).total_seconds() / 60)
        out.append(Visit(nxt, eta, late))
        left.remove(nxt)
        here, t = nxt.pos, eta + timedelta(minutes=SERVICE_MIN.get(nxt.kind, 4.0))
    return out


def tour_km(start: tuple[float, float], visits: Sequence[Visit]) -> float:
    total, here = 0.0, start
    for v in visits:
        total += km(here, v.stop.pos)
        here = v.stop.pos
    return total + km(here, start)
