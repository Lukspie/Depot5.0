"""Depot time zone and formatting helpers."""

from datetime import datetime
from zoneinfo import ZoneInfo

TZ = ZoneInfo("Europe/Bratislava")


def local_hhmm(instant: datetime) -> str:
    return instant.astimezone(TZ).strftime("%H:%M")
