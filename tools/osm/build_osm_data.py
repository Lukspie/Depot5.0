"""Build DepoTrack's offline geodata from an OpenStreetMap extract of Slovakia (ADR-038).

Run once (see tools/osm/README.md); the outputs are committed, so nothing at runtime needs the
internet and the simulation stays deterministic:

  telematics/data/roads.json.gz
      Road graph for truck and courier routing (A* in telematics). Main roads of the whole
      country (motorway … secondary) plus every drivable street around Košice and Budimír.
      Ways are split at junctions; each edge keeps a simplified geometry for drawing.

  app/src/depotrack/seed/data/addresses.json.gz
      Real address points (addr:street + addr:housenumber) around Košice and the destination
      towns, used by the parcel seed (deterministic selection by seed).

Data © OpenStreetMap contributors, ODbL 1.0.
"""

from __future__ import annotations

import argparse
import gzip
import json
import math
import random
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path

import osmium

# ---------------------------------------------------------------- configuration

MAIN = {
    "motorway": 0, "motorway_link": 0, "trunk": 1, "trunk_link": 1,
    "primary": 2, "primary_link": 2, "secondary": 3, "secondary_link": 3,
}
LOCAL = {
    "tertiary": 4, "tertiary_link": 4, "unclassified": 5, "residential": 5,
    "living_street": 6, "service": 6,
}
SKIP_SERVICE = {"parking_aisle", "driveway", "drive-through", "emergency_access"}

# all streets inside this box: Košice + Budimír + the road between them
LOCAL_BBOX = (48.60, 21.10, 48.86, 21.42)  # south, west, north, east

# address areas: (name, lat, lon, radius_km, cap)
ADDRESS_AREAS = [
    ("Košice", 48.7164, 21.2611, 7.0, 25000),
    ("Michalovce", 48.7543, 21.9195, 5.0, 3000),
    ("Trebišov", 48.6286, 21.7178, 4.0, 3000),
    ("Humenné", 48.9371, 21.9063, 4.0, 3000),
    ("Stará Ľubovňa", 49.2986, 20.6866, 4.0, 3000),
    ("Senica", 48.6794, 17.3667, 4.0, 3000),
    ("Banská Bystrica", 48.7363, 19.1462, 8.0, 4000),
    ("Bratislava", 48.1486, 17.1077, 12.0, 6000),
    ("Žilina", 49.2232, 18.7394, 8.0, 4000),
]

SIMPLIFY_M = 8.0  # Douglas-Peucker tolerance for edge geometry


def km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2
    return 2 * 6371.0 * math.asin(math.sqrt(a))


def in_local(lat: float, lon: float) -> bool:
    s, w, n, e = LOCAL_BBOX
    return s <= lat <= n and w <= lon <= e


# ---------------------------------------------------------------- pass 1: ways and addresses


@dataclass
class Way:
    nodes: list[int]
    cls: int
    oneway: int  # 0 both, 1 forward, -1 backward


@dataclass
class Collector(osmium.SimpleHandler):
    ways: list[Way] = field(default_factory=list)
    coords: dict[int, tuple[float, float]] = field(default_factory=dict)
    addresses: dict[str, list[tuple[str, str, str, float, float]]] = field(default_factory=lambda: defaultdict(list))
    depot_candidates: list[tuple[float, float, float, str]] = field(default_factory=list)

    def __post_init__(self) -> None:
        osmium.SimpleHandler.__init__(self)

    def _address(self, tags: osmium.osm.TagList, lat: float, lon: float) -> None:
        street = tags.get("addr:street") or tags.get("addr:place")
        number = tags.get("addr:housenumber") or tags.get("addr:conscriptionnumber")
        if not street or not number:
            return
        for name, alat, alon, radius, _ in ADDRESS_AREAS:
            if km(lat, lon, alat, alon) <= radius:
                self.addresses[name].append((street, number, tags.get("addr:postcode", ""), round(lat, 6), round(lon, 6)))
                return

    def node(self, n: osmium.osm.Node) -> None:
        if n.location.valid() and "addr:housenumber" in n.tags:
            self._address(n.tags, n.location.lat, n.location.lon)

    def way(self, w: osmium.osm.Way) -> None:
        tags = w.tags
        hw = tags.get("highway")
        try:
            locs = [(nd.ref, nd.location.lat, nd.location.lon) for nd in w.nodes if nd.location.valid()]
        except osmium.InvalidLocationError:
            return
        if not locs:
            return
        lat = sum(p[1] for p in locs) / len(locs)
        lon = sum(p[2] for p in locs) / len(locs)
        if "addr:housenumber" in tags:
            self._address(tags, lat, lon)
        b = tags.get("building")
        if b in ("warehouse", "industrial", "commercial") and km(lat, lon, 48.8003, 21.3035) < 5:
            # rough footprint size for picking the depot hall
            lats = [p[1] for p in locs]
            lons = [p[2] for p in locs]
            size = km(min(lats), min(lons), max(lats), max(lons)) * 1000
            self.depot_candidates.append((round(size), round(lat, 5), round(lon, 5), f"{b} {tags.get('name', '')}".strip()))
        if hw is None:
            return
        if hw in MAIN:
            cls = MAIN[hw]
        elif hw in LOCAL and in_local(lat, lon):
            if hw == "service" and tags.get("service") in SKIP_SERVICE:
                return
            cls = LOCAL[hw]
        else:
            return
        if tags.get("access") in ("private", "no") and hw != "service":
            return
        ow = tags.get("oneway")
        oneway = 1 if ow in ("yes", "1", "true") else -1 if ow == "-1" else 0
        if hw in ("motorway", "motorway_link") and ow != "no":
            oneway = oneway or 1
        if tags.get("junction") == "roundabout" and ow != "no":
            oneway = oneway or 1
        for ref, la, lo in locs:
            self.coords[ref] = (la, lo)
        self.ways.append(Way([p[0] for p in locs], cls, oneway))


# ---------------------------------------------------------------- graph building


def perp_m(p: tuple[float, float], a: tuple[float, float], b: tuple[float, float]) -> float:
    """Distance (m) of p from segment a-b, local equirectangular projection."""
    k = math.cos(math.radians(a[0]))
    ax, ay = a[1] * k, a[0]
    bx, by = b[1] * k, b[0]
    px, py = p[1] * k, p[0]
    dx, dy = bx - ax, by - ay
    if dx == dy == 0:
        return math.hypot(px - ax, py - ay) * 111_320
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy)) * 111_320


def simplify(points: list[tuple[float, float]]) -> list[tuple[float, float]]:
    if len(points) < 3:
        return points
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        i, j = stack.pop()
        best, idx = 0.0, -1
        for k in range(i + 1, j):
            d = perp_m(points[k], points[i], points[j])
            if d > best:
                best, idx = d, k
        if best > SIMPLIFY_M and idx > 0:
            keep[idx] = True
            stack += [(i, idx), (idx, j)]
    return [p for p, k in zip(points, keep, strict=True) if k]


def build_graph(c: Collector) -> dict[str, object]:
    use = defaultdict(int)
    for w in c.ways:
        for i, n in enumerate(w.nodes):
            use[n] += 2 if i in (0, len(w.nodes) - 1) else 1
    junction = {n for n, u in use.items() if u > 1}

    index: dict[int, int] = {}
    nodes: list[list[int]] = []

    def nid(ref: int) -> int:
        if ref not in index:
            lat, lon = c.coords[ref]
            index[ref] = len(nodes)
            nodes.append([round(lat * 1e5), round(lon * 1e5)])
        return index[ref]

    edges: list[list[object]] = []
    for w in c.ways:
        seg = [w.nodes[0]]
        for ref in w.nodes[1:]:
            seg.append(ref)
            if ref in junction or ref == w.nodes[-1]:
                pts = [c.coords[r] for r in seg]
                length = sum(km(*pts[i], *pts[i + 1]) for i in range(len(pts) - 1)) * 1000
                if length > 0.5:
                    inner = simplify(pts)[1:-1]
                    flat = [v for p in inner for v in (round(p[0] * 1e5), round(p[1] * 1e5))]
                    edges.append([nid(seg[0]), nid(seg[-1]), w.cls, w.oneway, round(length, 1), flat])
                seg = [ref]
    return {
        "format": "depotrack-roads/1",
        "attribution": "© OpenStreetMap contributors, ODbL 1.0",
        "classes": ["motorway", "trunk", "primary", "secondary", "tertiary", "residential", "service"],
        "nodes": nodes,
        "edges": edges,
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("pbf")
    ap.add_argument("--roads", default="telematics/data/roads.json.gz")
    ap.add_argument("--addresses", default="app/src/depotrack/seed/data/addresses.json.gz")
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()

    c = Collector()
    c.apply_file(args.pbf, locations=True, idx="flex_mem")
    print(f"ways {len(c.ways)}, way nodes {len(c.coords)}", file=sys.stderr)

    graph = build_graph(c)
    Path(args.roads).parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(args.roads, "wt", encoding="utf-8", compresslevel=9) as f:
        json.dump(graph, f, separators=(",", ":"))
    print(f"graph: {len(graph['nodes'])} nodes, {len(graph['edges'])} edges -> {args.roads}", file=sys.stderr)

    rng = random.Random(args.seed)
    out: dict[str, list[list[object]]] = {}
    for name, *_rest, cap in ADDRESS_AREAS:
        unique = sorted(set(c.addresses.get(name, [])))
        if len(unique) > cap:
            unique = sorted(rng.sample(unique, cap))
        out[name] = [list(a) for a in unique]
        print(f"addresses {name}: {len(unique)}", file=sys.stderr)
    Path(args.addresses).parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(args.addresses, "wt", encoding="utf-8", compresslevel=9) as f:
        json.dump({"attribution": "© OpenStreetMap contributors, ODbL 1.0", "areas": out}, f, ensure_ascii=False, separators=(",", ":"))

    print("largest warehouse-like buildings within 5 km of Budimír (size m, lat, lon, tags):", file=sys.stderr)
    for cand in sorted(c.depot_candidates, reverse=True)[:12]:
        print("  ", cand, file=sys.stderr)


if __name__ == "__main__":
    main()
