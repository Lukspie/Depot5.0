"""Deterministic generator of simulated parcels for one day."""

import math
import random
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta

from depotrack.core.clock import TZ
from depotrack.seed.reference import (
    FEMALE_FIRST,
    FIRST_NAMES,
    KOSICE_LAT,
    KOSICE_LON,
    KOSICE_RADIUS_KM,
    KOSICE_STREETS,
    LAST_NAMES_M,
    LINEHAUL,
    LOCAL,
    SENDERS,
    TOWN_STREETS,
    TRANSIT,
    DirectionDef,
)

KM_PER_DEG_LAT = 111.32

# share of the daily volume by direction type
TYPE_SHARE = {"local": 0.30, "transit": 0.35, "linehaul": 0.35}


@dataclass(frozen=True)
class ParcelSpec:
    barcode: str
    direction_code: str
    weight_kg: float
    length_cm: int
    width_cm: int
    height_cm: int
    recipient_name: str
    address: str
    lat: float
    lon: float
    sender: str
    collected_at: datetime


def km_offset(lat: float, lon: float, north_km: float, east_km: float) -> tuple[float, float]:
    d_lat = north_km / KM_PER_DEG_LAT
    d_lon = east_km / (KM_PER_DEG_LAT * math.cos(math.radians(lat)))
    return lat + d_lat, lon + d_lon


def random_point(
    rng: random.Random, lat: float, lon: float, radius_km: float
) -> tuple[float, float]:
    """Uniform random point in a circle of `radius_km`."""
    r = radius_km * math.sqrt(rng.random())
    theta = rng.uniform(0, 2 * math.pi)
    return km_offset(lat, lon, r * math.cos(theta), r * math.sin(theta))


def kosice_rajon(lat: float, lon: float) -> str:
    """Courier district KE-01..KE-08: compass sector (45°) around the Košice centre, from north."""
    north = (lat - KOSICE_LAT) * KM_PER_DEG_LAT
    east = (lon - KOSICE_LON) * KM_PER_DEG_LAT * math.cos(math.radians(KOSICE_LAT))
    bearing = math.degrees(math.atan2(east, north)) % 360
    sector = int(((bearing + 22.5) % 360) // 45)
    return f"KE-{sector + 1:02d}"


def parcel_weight(rng: random.Random) -> float:
    """Log-normal weight: median 1.8 kg, most parcels between 0.5 and 5 kg, clipped to 0.1-30 kg."""
    w = rng.lognormvariate(math.log(1.8), 0.8)
    return round(min(max(w, 0.1), 30.0), 2)


def parcel_dimensions(rng: random.Random, weight_kg: float) -> tuple[int, int, int]:
    volume = weight_kg * rng.uniform(3000, 8000)  # cm3, density ~125-330 kg/m3
    side = volume ** (1 / 3)
    length = max(5, round(side * rng.uniform(1.1, 1.6)))
    width = max(5, round(side * rng.uniform(0.8, 1.1)))
    height = max(3, round(volume / (length * width)))
    return length, width, height


def person_name(rng: random.Random) -> str:
    first = rng.choice(FIRST_NAMES)
    last = rng.choice(LAST_NAMES_M)
    if first in FEMALE_FIRST:
        last = last[:-1] + "á" if last.endswith("ý") else last + "ová"
    return f"{first} {last}"


def _pick_direction(rng: random.Random) -> DirectionDef:
    kind = rng.choices(list(TYPE_SHARE), weights=list(TYPE_SHARE.values()))[0]
    group = {"linehaul": LINEHAUL, "transit": TRANSIT}.get(kind)
    if group is None:
        return LOCAL[0]  # placeholder; the real district is derived from the address
    return rng.choices(group, weights=[d.share for d in group])[0]


def generate_parcels(day: date, count: int, seed: int) -> list[ParcelSpec]:
    """Parcels collected during `day` (08:00-15:30) that arrive for the evening wave."""
    rng = random.Random(seed * 100_000 + day.toordinal())
    day_start = datetime.combine(day, time(8, 0), TZ)
    span_s = int(timedelta(hours=7, minutes=30).total_seconds())
    parcels: list[ParcelSpec] = []

    for i in range(1, count + 1):
        direction = _pick_direction(rng)
        if direction.type == "local":
            lat, lon = random_point(rng, KOSICE_LAT, KOSICE_LON, KOSICE_RADIUS_KM)
            code = kosice_rajon(lat, lon)
            street, town, postcode = rng.choice(KOSICE_STREETS), "Košice", "040 01"
        else:
            radius = 15.0 if direction.type == "linehaul" else 8.0
            lat, lon = random_point(rng, direction.lat, direction.lon, radius)
            code = direction.code
            street, town, postcode = rng.choice(TOWN_STREETS), direction.town, direction.postcode

        weight = parcel_weight(rng)
        length, width, height = parcel_dimensions(rng, weight)
        parcels.append(
            ParcelSpec(
                barcode=f"SPS{day:%y%m%d}{i:05d}",
                direction_code=code,
                weight_kg=weight,
                length_cm=length,
                width_cm=width,
                height_cm=height,
                recipient_name=person_name(rng),
                address=f"{street} {rng.randint(1, 120)}, {postcode} {town}",
                lat=round(lat, 6),
                lon=round(lon, 6),
                sender=rng.choice(SENDERS),
                collected_at=day_start + timedelta(seconds=rng.randrange(span_s)),
            )
        )
    return parcels
