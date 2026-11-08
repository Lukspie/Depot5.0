"""Geometry of the depots from the OSM extract (phase 7c, ADR-064).

    docker run --rm -v "$PWD:/repo" -w /repo python:3.12-slim sh -c \\
      "apt-get update -qq && apt-get install -y -qq libexpat1 && pip install -q 'osmium>=4' && \\
       python tools/osm/extract_depots.py tools/osm/cache/slovakia-latest.osm.pbf"

Reads tools/osm/depots.json (which OSM way is the hall and which the site of every depot, or a
point inside the hall; "siteWay": null when OSM has no plot of the depot, only a shared zone) and writes app/src/depotrack/seed/data/depots_osm.json: hall and site
outlines in lat/lon, the hall's oriented bounding box (centre, width >= depth, angle of the long
side counter-clockwise from east). Nothing is guessed: a point that lies in no building, or in
more than one, stops the script and lists the buildings around it. The output is in git, the
system never reads OSM at run time (ADR-038).
"""

import json
import math
import sys
from pathlib import Path

import osmium

ROOT = Path(__file__).resolve().parents[2]
SPEC = ROOT / "tools" / "osm" / "depots.json"
OUT = ROOT / "app" / "src" / "depotrack" / "seed" / "data" / "depots_osm.json"
MARGIN = 0.01  # degrees around every depot that are read


def obb(points: list[tuple[float, float]]) -> dict[str, float]:
    """Oriented bounding box of a ring: centre, width >= depth (m), angle of the long side."""
    lat0 = sum(p[0] for p in points) / len(points)
    lon0 = sum(p[1] for p in points) / len(points)
    kx = 111_320 * math.cos(math.radians(lat0))
    xy = [((lon - lon0) * kx, (lat - lat0) * 110_574) for lat, lon in points]
    best = (math.inf, 0.0, 0.0, 0.0, 0.0, 0.0)
    for (x1, y1), (x2, y2) in zip(xy, xy[1:]):
        a = math.atan2(y2 - y1, x2 - x1)
        c, s = math.cos(a), math.sin(a)
        us = [x * c + y * s for x, y in xy]
        vs = [-x * s + y * c for x, y in xy]
        w, d = max(us) - min(us), max(vs) - min(vs)
        if w * d < best[0]:
            uc, vc = (max(us) + min(us)) / 2, (max(vs) + min(vs)) / 2
            best = (w * d, w, d, math.degrees(a), uc * c - vc * s, uc * s + vc * c)
    _, w, d, ang, cx, cy = best
    if d > w:
        w, d, ang = d, w, ang + 90
    return {
        "lat": round(lat0 + cy / 110_574, 6),
        "lon": round(lon0 + cx / kx, 6),
        "width": round(w, 1),
        "depth": round(d, 1),
        "angleCcw": round(ang % 180, 1),
    }


def inside(p: tuple[float, float], ring: list[tuple[float, float]]) -> bool:
    y, x = p
    hit = False
    for (y1, x1), (y2, x2) in zip(ring, ring[1:] + ring[:1]):
        if (y1 > y) != (y2 > y) and x < x1 + (y - y1) * (x2 - x1) / (y2 - y1):
            hit = not hit
    return hit


class Collector(osmium.SimpleHandler):  # type: ignore[misc]
    def __init__(self, boxes: list[tuple[float, float, float, float]]) -> None:
        super().__init__()
        self.boxes = boxes
        self.areas: dict[str, tuple[dict[str, str], list[tuple[float, float]]]] = {}

    def area(self, a: osmium.osm.Area) -> None:
        tags = {t.k: t.v for t in a.tags}
        if "building" not in tags and "landuse" not in tags and "amenity" not in tags:
            return
        for ring in a.outer_rings():
            pts = [(round(n.lat, 7), round(n.lon, 7)) for n in ring]
            if len(pts) < 4:
                continue
            lat = sum(p[0] for p in pts) / len(pts)
            lon = sum(p[1] for p in pts) / len(pts)
            if any(s <= lat <= n and w <= lon <= e for s, w, n, e in self.boxes):
                kind = "w" if a.from_way() else "r"
                self.areas[f"{kind}{a.orig_id()}"] = (tags, pts)
            break


def main() -> None:
    spec = json.loads(SPEC.read_text(encoding="utf-8"))
    boxes = [(d["near"][0] - MARGIN, d["near"][1] - MARGIN, d["near"][0] + MARGIN, d["near"][1] + MARGIN) for d in spec]
    c = Collector(boxes)
    c.apply_file(sys.argv[1], locations=True)
    out = []
    for d in spec:
        if "hallWay" in d:
            hall_id = f"w{d['hallWay']}"
        else:
            p = tuple(d["hallAt"])
            hits = [k for k, (t, r) in c.areas.items() if "building" in t and inside(p, r)]
            if len(hits) != 1:
                def centre(k: str) -> tuple[float, float]:
                    b = obb(c.areas[k][1])
                    return (b["lat"], b["lon"])

                near = sorted((k for k, (t, _) in c.areas.items() if "building" in t), key=lambda k: math.dist(p, centre(k)))[:8]
                for k in near:
                    print(f"  {d['code']} candidate {k} {obb(c.areas[k][1])} {c.areas[k][0]}")
                sys.exit(f"{d['code']}: point {p} lies in {len(hits)} buildings, pick hallWay in depots.json")
            hall_id = hits[0]
        if hall_id not in c.areas:
            sys.exit(f"{d['code']}: way {hall_id} not in the extract")
        hall_tags, hall_ring = c.areas[hall_id]
        box = obb(hall_ring)
        if "siteWay" in d:
            # null: the depot has no plot of its own in OSM (only a shared industrial zone)
            site_id = f"w{d['siteWay']}" if d["siteWay"] else None
        else:
            # the smallest landuse / amenity area that contains the whole hall
            sites = [
                k
                for k, (t, r) in c.areas.items()
                if "building" not in t and all(inside(q, r) for q in hall_ring)
            ]
            site_id = min(sites, key=lambda k: obb(c.areas[k][1])["width"] * obb(c.areas[k][1])["depth"]) if sites else None
        site = c.areas.get(site_id) if site_id else None
        print(f"{d['code']}: hall {hall_id} {box} {hall_tags}")
        print(f"{d['code']}: site {site_id} {obb(site[1]) if site else None} {site[0] if site else None}")
        out.append(
            {
                "code": d["code"],
                "hallWay": hall_id,
                "hallTags": hall_tags,
                "hall": box,
                "hallRing": hall_ring,
                "siteWay": site_id,
                "siteTags": site[0] if site else None,
                "siteRing": site[1] if site else None,
            }
        )
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"written {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
