"""Find the Bratislava hub of the carrier in the OSM extract (plan-doplnky 5c-4).

Looks for buildings / landuse in Ivanka pri Dunaji and around whose name or operator mentions
SPS or Slovak Parcel Service, and lists the largest warehouses there as candidates. Prints
OSM id, centre, size (m) and orientation; nothing is changed. Run like build_osm_data.py:

  docker run --rm -v "$PWD:/repo" -w /repo python:3.12-slim sh -c \\
    "apt-get update -qq && apt-get install -y -qq libexpat1 && pip install -q 'osmium>=4' && python tools/osm/find_hub.py tools/osm/cache/slovakia-latest.osm.pbf"
"""

import math
import re
import sys
from dataclasses import dataclass

import osmium

# Ivanka pri Dunaji with the D1 / R7 industrial zones around it
BBOX = (48.14, 17.17, 48.23, 17.33)  # south, west, north, east
SPS = re.compile(r"\bSPS\b|slovak\s+parcel", re.IGNORECASE)


@dataclass
class Area:
    osm_id: str
    tags: dict[str, str]
    lat: float
    lon: float
    width: float
    depth: float
    angle: float
    area: float


def footprint(points: list[tuple[float, float]]) -> tuple[float, float, float, float, float, float]:
    """Centre, oriented bounding box (width >= depth, metres), angle of the long side, area."""
    lat0 = sum(p[0] for p in points) / len(points)
    lon0 = sum(p[1] for p in points) / len(points)
    kx = 111_320 * math.cos(math.radians(lat0))
    xy = [((lon - lon0) * kx, (lat - lat0) * 110_574) for lat, lon in points]
    area = abs(sum(x1 * y2 - x2 * y1 for (x1, y1), (x2, y2) in zip(xy, xy[1:] + xy[:1]))) / 2
    best = (math.inf, 0.0, 0.0, 0.0)
    for (x1, y1), (x2, y2) in zip(xy, xy[1:]):
        a = math.atan2(y2 - y1, x2 - x1)
        c, s = math.cos(a), math.sin(a)
        us = [x * c + y * s for x, y in xy]
        vs = [-x * s + y * c for x, y in xy]
        w, d = max(us) - min(us), max(vs) - min(vs)
        if w * d < best[0]:
            best = (w * d, w, d, math.degrees(a))
    _, w, d, ang = best
    if d > w:
        w, d, ang = d, w, ang + 90
    return lat0, lon0, w, d, ang % 180, area


class Finder(osmium.SimpleHandler):  # type: ignore[misc]
    def __init__(self) -> None:
        super().__init__()
        self.areas: list[Area] = []

    def area(self, a: osmium.osm.Area) -> None:
        tags = {t.k: t.v for t in a.tags}
        if "building" not in tags and tags.get("landuse") != "industrial":
            return
        for ring in a.outer_rings():
            pts = [(n.lat, n.lon) for n in ring]
            if len(pts) < 4:
                continue
            lat, lon, w, d, ang, area = footprint(pts)
            s, wst, n, e = BBOX
            if not (s <= lat <= n and wst <= lon <= e):
                continue
            kind = "w" if a.from_way() else "r"
            self.areas.append(Area(f"{kind}{a.orig_id()}", tags, lat, lon, w, d, ang, area))
            break


def show(a: Area) -> str:
    label = " / ".join(v for k, v in a.tags.items() if k in ("name", "operator", "brand", "building", "landuse"))
    return (
        f"{a.osm_id:>14}  {a.lat:.5f}, {a.lon:.5f}  {a.width:6.0f} x {a.depth:4.0f} m  "
        f"{a.angle:5.1f}°  {a.area:8.0f} m²  {label}"
    )


def main() -> None:
    f = Finder()
    f.apply_file(sys.argv[1], locations=True)
    sps = [a for a in f.areas if any(SPS.search(a.tags.get(k, "")) for k in ("name", "operator", "brand"))]
    print(f"== objects with SPS / Slovak Parcel Service in name/operator/brand: {len(sps)}")
    for a in sorted(sps, key=lambda a: -a.area):
        print(show(a))
    warehouses = [a for a in f.areas if a.tags.get("building") in ("warehouse", "industrial", "commercial", "yes")]
    print("== largest buildings in the area (candidates)")
    for a in sorted(warehouses, key=lambda a: -a.area)[:12]:
        print(show(a))


if __name__ == "__main__":
    main()
