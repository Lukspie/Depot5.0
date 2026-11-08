"""Layouts of the depots from OSM geometry and a few notes per depot (phase 7c, ADR-064).

`data/depots_osm.json` (tools/osm/extract_depots.py) has the outline of every hall and its site.
This module turns it into the layout the digital shadow and the map draw (`depots.layout`,
`doors`): metres in the frame of the hall, x along the long side, y across it ("south" when the
hall is not rotated), the frame turned by `hall.rotationDeg` clockwise from east (ADR-040) and
anchored at `origin` (the centre of the hall). Sides are given as compass directions and resolved
against the rotation, so the notes read like a description of the place ("ramps on the west").

What OSM does not have (ramps, gate, stands, parking) is an assumption until the team's satellite
pictures are checked; `source.assumed` lists it for every depot. The routing point of a depot
(`depots.lat/lon`) stays where it was for Budimír and Ivanka: the simulator computes the routes
from it and must stay deterministic.
"""

import hashlib
import json
import math
from dataclasses import dataclass
from functools import cache
from pathlib import Path

DATA = Path(__file__).resolve().parent / "data" / "depots_osm.json"
COMPASS = {"N": (0.0, -1.0), "S": (0.0, 1.0), "E": (1.0, 0.0), "W": (-1.0, 0.0)}  # east, south
STAND = (17.0, 4.0)  # semi-trailer stand: length, width (m)
VAN = (6.0, 2.8)
CAR = (5.0, 2.5)


@dataclass(frozen=True)
class Doors:
    """A group of doors on one wall: `part` is the share of the wall (0..1 from its low end)."""

    side: str  # compass
    kind: str  # loading_dock | staging_bay
    codes: tuple[str, ...]
    equipment: tuple[str, str] = ("electric", "dock_leveler")
    part: tuple[float, float] = (0.0, 1.0)


@dataclass(frozen=True)
class Slots:
    """Parking slots in the yard beyond a side of the hall, optionally only near one end."""

    side: str  # compass
    count: int
    end: str | None = None  # compass of the hall end the slots keep to


@dataclass(frozen=True)
class Spec:
    code: str
    name: str
    kind: str  # depot | hub
    height: float
    doors: tuple[Doors, ...]
    reserved_end: tuple[str, float] | None  # offices at an end of the hall: no doors there
    gate: tuple[str, float]  # side of the site and position along the hall (-1 .. 1)
    gate_code: str | None
    stands: tuple[Slots, ...]
    vans: tuple[Slots, ...]
    belt: bool
    assumed: tuple[str, ...]
    cars: tuple[Slots, ...] = ()  # staff car park
    gatehouse: bool = False
    # no plot of the depot in OSM: the yard is the hall plus these margins (compass -> metres)
    yard_margins: tuple[tuple[str, float], ...] = ()


MANUAL = ("manual", "none")

# Budimír: ramps to the east (52-57 m of yard), courier bays along the west wall, the large south
# yard (122 m) holds the trailers and the vans. Codes and equipment as before (ADR-050). Satellite
# pictures and a description of the real depot follow (plan 7c), until then an assumption.
BUD = Spec(
    code="BUD",
    name="Budimír",
    kind="depot",
    height=10,
    doors=(
        Doors("E", "loading_dock", ("LD-01", "LD-02"), ("electric", "dock_leveler"), (0.0, 0.25)),
        Doors(
            "E",
            "loading_dock",
            ("LD-03", "LD-04", "LD-05"),
            ("electric", "telescopic_conveyor"),
            (0.25, 0.625),
        ),
        Doors("E", "loading_dock", ("LD-06", "LD-07", "LD-08"), ("electric", "none"), (0.625, 1.0)),
        Doors("W", "staging_bay", tuple(f"SB-{i:02d}" for i in range(1, 9)), MANUAL),
    ),
    reserved_end=None,
    gate=("S", 0.0),
    gate_code="GATE-01",
    stands=(Slots("S", 8, None),),
    vans=(Slots("S", 8, None),),
    belt=True,
    assumed=("ramps side and count", "gate", "trailer stands", "van parking"),
)

# Ivanka pri Dunaji: 85 m of yard to the west, only 28 m to the east: the ramps face west.
BAH = Spec(
    code="BAH",
    name="Ivanka pri Dunaji",
    kind="hub",
    height=12,
    doors=(Doors("W", "loading_dock", tuple(f"BA-R{i:02d}" for i in range(1, 7))),),
    reserved_end=None,
    gate=("W", 0.6),
    gate_code=None,
    stands=(Slots("W", 8),),
    vans=(Slots("N", 6),),
    belt=False,
    assumed=("ramps side and count", "gate", "trailer stands", "van parking"),
)

# Žilina (team + satelit-zilina.png): ~12 ramps on the west long side towards the SNP street,
# offices at the south end, trailers on the east, the entrance from SNP with the gatehouse on an
# island, cars and vans in the south-west corner. Courier doors are not visible: north end wall.
ZIL = Spec(
    code="ZIL",
    name="Žilina",
    kind="depot",
    height=10,
    doors=(
        Doors("W", "loading_dock", tuple(f"ZI-R{i:02d}" for i in range(1, 13))),
        Doors("N", "staging_bay", tuple(f"ZI-SB{i:02d}" for i in range(1, 5)), MANUAL),
    ),
    reserved_end=("S", 20.0),
    gate=("W", -0.55),
    gate_code="ZI-GATE",
    stands=(Slots("E", 8),),
    vans=(Slots("W", 4, "S"),),
    cars=(Slots("W", 10, "S"),),
    gatehouse=True,
    belt=True,
    assumed=("courier doors on the north end", "exact ramp count"),
)

# Dunajská Streda (Malé Dvorníky 610, team + satelit-dunajska-streda.png): a small depot fed from
# Ivanka, hall NE-SW with a yard around it. Courier doors and vans (3 + 3) on both long sides,
# the entrance from the south-west (Obchodná street), the trailer from Ivanka stops at the SW end.
# OSM has only part of the hall (way 388660269, 30 x 15.6 m) and no plot: see ADR-064.
DS = Spec(
    code="DS",
    name="Dunajská Streda",
    kind="depot",
    height=7,
    doors=(
        Doors("S", "loading_dock", ("DS-R01",)),
        Doors("W", "staging_bay", ("DS-SB01", "DS-SB02", "DS-SB03"), MANUAL),
        Doors("E", "staging_bay", ("DS-SB04", "DS-SB05", "DS-SB06"), MANUAL),
    ),
    reserved_end=None,
    gate=("S", 0.0),
    gate_code="DS-GATE",
    stands=(Slots("S", 1),),
    vans=(Slots("W", 3), Slots("E", 3)),
    belt=False,
    assumed=("hall size (OSM has one part)", "yard outline", "door counts"),
    yard_margins=(("W", 16.0), ("E", 16.0), ("N", 10.0), ("S", 34.0)),
)

# Trenčín (Záblatie 785, way 1195263485 "Slovak Parcel Service"): a long narrow hall with the
# offices (also UPS) at one end. In OSM the hall runs WSW-ENE (long side 23° from east), the
# team's satellite picture shows it upright, so it is turned: sides are taken relative to the hall
# (offices at the WSW end, ramps with the trailer row on the SSE long side).
TN = Spec(
    code="TN",
    name="Trenčín",
    kind="depot",
    height=9,
    doors=(
        Doors("S", "loading_dock", tuple(f"TN-R{i:02d}" for i in range(1, 7)), part=(0.3, 1.0)),
        Doors(
            "S", "staging_bay", tuple(f"TN-SB{i:02d}" for i in range(1, 5)), MANUAL, part=(0.0, 0.3)
        ),
    ),
    reserved_end=("W", 28.0),
    gate=("W", 0.0),
    gate_code="TN-GATE",
    stands=(Slots("S", 8),),
    vans=(Slots("N", 4),),
    cars=(Slots("W", 10),),
    belt=True,
    assumed=(
        "orientation of the satellite picture",
        "ramp and courier door counts",
        "yard outline",
        "gate",
    ),
    yard_margins=(("S", 48.0), ("N", 16.0), ("W", 34.0), ("E", 16.0)),
)

SPECS = (BUD, BAH, ZIL, DS, TN)


@dataclass(frozen=True)
class DoorPlace:
    code: str
    kind: str  # loading_dock | staging_bay | yard_gate
    x: float
    y: float
    door_drive: str
    dock_equipment: str


@dataclass(frozen=True)
class Built:
    code: str
    name: str
    kind: str
    origin: tuple[float, float]  # centre of the hall: lat, lon
    layout: dict[str, object]
    doors: tuple[DoorPlace, ...]


def _r(v: float) -> float:
    return round(v, 1)


class Frame:
    def __init__(self, origin: tuple[float, float], rotation_deg: float) -> None:
        self.origin = origin
        t = math.radians(rotation_deg)
        self.c, self.s = math.cos(t), math.sin(t)
        self.kx = 111_320 * math.cos(math.radians(origin[0]))

    def local(self, lat: float, lon: float) -> tuple[float, float]:
        e, s = (lon - self.origin[1]) * self.kx, -(lat - self.origin[0]) * 110_574
        return (e * self.c + s * self.s, -e * self.s + s * self.c)

    def side(self, compass: str) -> tuple[str, int]:
        """("x" | "y", +1 | -1): the side of the hall that faces this compass direction."""
        sides = {("x", 1): (self.c, self.s), ("x", -1): (-self.c, -self.s)}
        sides |= {("y", 1): (-self.s, self.c), ("y", -1): (self.s, -self.c)}
        want = COMPASS[compass]
        return max(sides, key=lambda k: sides[k][0] * want[0] + sides[k][1] * want[1])


def inside(p: tuple[float, float], ring: list[tuple[float, float]]) -> bool:
    x, y = p
    hit = False
    for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1], strict=True):
        if (y1 > y) != (y2 > y) and x < x1 + (y - y1) * (x2 - x1) / (y2 - y1):
            hit = not hit
    return hit


def _ray(
    ring: list[tuple[float, float]], start: tuple[float, float], d: tuple[float, float]
) -> float:
    """Distance from `start` along `d` to the site boundary (inf when it never leaves)."""
    best = math.inf
    for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1], strict=True):
        den = d[0] * (y2 - y1) - d[1] * (x2 - x1)
        if abs(den) < 1e-9:
            continue
        t = ((x1 - start[0]) * (y2 - y1) - (y1 - start[1]) * (x2 - x1)) / den
        u = ((x1 - start[0]) * d[1] - (y1 - start[1]) * d[0]) / den
        if t > 0 and 0 <= u <= 1:
            best = min(best, t)
    return best


def _pt(axis: str, sign: int, along: float, out: float) -> tuple[float, float]:
    """A point `out` metres beyond the hall's side (axis, sign) at `along` along that side."""
    return (sign * out, along) if axis == "x" else (along, sign * out)


def _slots(
    axis: str,
    sign: int,
    wall: float,
    along_range: tuple[float, float],
    count: int,
    size: tuple[float, float],
    site: list[tuple[float, float]],
    taken: list[tuple[float, float, float, float]],
    gap: float,
) -> list[dict[str, float]]:
    """`count` parking slots in rows beyond the wall (axis, sign), inside the site and not on
    a slot placed before (`taken`, rectangles x0, y0, x1, y1 that this call extends)."""
    length, width = size
    pitch = width + 0.6
    heading = (0.0 if axis == "x" else 90.0) if sign > 0 else (180.0 if axis == "x" else 270.0)
    a0, a1 = along_range
    out: list[dict[str, float]] = []
    row = 0
    while len(out) < count and row < 8:
        dist = wall + gap + length / 2 + row * (length + 7)
        n = max(1, int((a1 - a0) // pitch))
        mid = (a0 + a1) / 2
        # from the middle of the range outwards, so a short row is centred
        alongs = sorted((a0 + pitch / 2 + i * pitch for i in range(n)), key=lambda a: abs(a - mid))
        fits: list[tuple[float, float, float]] = []
        for along in alongs:
            x, y = _pt(axis, sign, along, dist)
            hx, hy = (length / 2, width / 2) if axis == "x" else (width / 2, length / 2)
            rect = (x - hx, y - hy, x + hx, y + hy)
            corners = [
                (rect[0], rect[1]),
                (rect[2], rect[1]),
                (rect[2], rect[3]),
                (rect[0], rect[3]),
            ]
            overlap = any(
                rect[0] < t[2] and t[0] < rect[2] and rect[1] < t[3] and t[1] < rect[3]
                for t in taken
            )
            if all(inside(c, site) for c in corners) and not overlap:
                fits.append((along, x, y))
                taken.append(rect)
                if len(out) + len(fits) == count:
                    break
        out += [{"x": _r(x), "y": _r(y), "heading": heading} for _, x, y in sorted(fits)]
        row += 1
    return out


def build(spec: Spec, osm: dict[str, object]) -> Built:
    hall = osm["hall"]
    assert isinstance(hall, dict)
    rotation = (180 - float(hall["angleCcw"])) % 180
    origin = (float(hall["lat"]), float(hall["lon"]))
    frame = Frame(origin, rotation)
    w, d = float(hall["width"]), float(hall["depth"])
    half = {"x": w / 2, "y": d / 2}
    hall_ring = osm["hallRing"]
    assert isinstance(hall_ring, list)
    footprint = [frame.local(float(p[0]), float(p[1])) for p in hall_ring]
    site_ring = osm.get("siteRing")
    if site_ring:
        assert isinstance(site_ring, list)
        site = [frame.local(float(p[0]), float(p[1])) for p in site_ring]
    else:
        m = {frame.side(c): v for c, v in spec.yard_margins}
        x0, x1 = -w / 2 - m.get(("x", -1), 5.0), w / 2 + m.get(("x", 1), 5.0)
        y0, y1 = -d / 2 - m.get(("y", -1), 5.0), d / 2 + m.get(("y", 1), 5.0)
        site = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]

    # middle line of the real outline at x = 0 (rays start inside the hall and go out)
    y_mid = (_ray(footprint, (0.0, 0.0), (0.0, 1.0)) - _ray(footprint, (0.0, 0.0), (0.0, -1.0))) / 2

    def inner(axis: str, along: float) -> tuple[float, float]:
        return (0.0, along) if axis == "x" else (along, y_mid)

    def wall(axis: str, sign: int, along: float) -> float | None:
        """Outer wall of the real outline (not the bounding box) at `along` on that side, None
        where that line does not cross the hall (e.g. beside a narrower part)."""
        start = inner(axis, along)
        if not inside(start, footprint):
            return None
        t = _ray(footprint, start, (float(sign), 0.0) if axis == "x" else (0.0, float(sign)))
        base = start[0] if axis == "x" else start[1]
        return base + sign * t if math.isfinite(t) else None

    def spread(axis: str, sign: int, p0: float, p1: float, n: int) -> list[float]:
        """n positions along [p0, p1], only on the longest stretch where the wall exists."""
        steps = 200
        ok = [p0 + (p1 - p0) * i / steps for i in range(steps + 1)]
        runs: list[list[float]] = [[]]
        for a in ok:
            if wall(axis, sign, a) is not None:
                runs[-1].append(a)
            elif runs[-1]:
                runs.append([])
        run = max(runs, key=len)
        assert run, f"{spec.code}: no wall on side {axis}{sign}"
        q0, q1 = run[0], run[-1]
        pitch = (q1 - q0) / n
        return [q0 + pitch / 2 + i * pitch for i in range(n)]

    # usable length of the long walls: minus offices at one end
    lo, hi = -w / 2 + 4, w / 2 - 4
    if spec.reserved_end:
        axis, sign = frame.side(spec.reserved_end[0])
        assert axis == "x", "offices are expected at an end of the hall"
        if sign > 0:
            hi = w / 2 - spec.reserved_end[1]
        else:
            lo = -w / 2 + spec.reserved_end[1]

    doors: list[DoorPlace] = []
    van_loading: list[dict[str, object]] = []
    ramp_sides: set[tuple[str, int]] = set()
    for g in spec.doors:
        axis, sign = frame.side(g.side)
        a0, a1 = (lo, hi) if axis == "y" else (-d / 2 + 2, d / 2 - 2)
        p0, p1 = a0 + (a1 - a0) * g.part[0], a0 + (a1 - a0) * g.part[1]
        heading = (0.0 if axis == "x" else 90.0) if sign > 0 else (180.0 if axis == "x" else 270.0)
        for code, along in zip(g.codes, spread(axis, sign, p0, p1, len(g.codes)), strict=True):
            found = wall(axis, sign, along)
            assert found is not None
            wc = found
            if g.kind == "loading_dock":
                ramp_sides.add((axis, sign))
                x, y = _pt(axis, sign, along, sign * wc)
            else:
                # the bay is the floor inside the courier door, the van loads just outside it
                x, y = _pt(axis, sign, along, sign * wc - 4)
                vx, vy = _pt(axis, sign, along, sign * wc + 4)
                van_loading.append({"bay": code, "x": _r(vx), "y": _r(vy), "heading": heading})
            doors.append(DoorPlace(code, g.kind, _r(x), _r(y), *g.equipment))

    # gate: where a line from the hall side meets the site boundary
    g_axis, g_sign = frame.side(spec.gate[0])
    along = spec.gate[1] * (w / 2 if g_axis == "y" else d / 2)
    start = _pt(g_axis, g_sign, along, half[g_axis])
    reach = _ray(site, start, (g_sign, 0.0) if g_axis == "x" else (0.0, float(g_sign)))
    gate_pt = _pt(g_axis, g_sign, along, half[g_axis] + (reach - 2 if math.isfinite(reach) else 20))
    gate = (_r(gate_pt[0]), _r(gate_pt[1]))
    if spec.gate_code:
        doors.append(DoorPlace(spec.gate_code, "yard_gate", gate[0], gate[1], "electric", "none"))

    taken: list[tuple[float, float, float, float]] = []

    def place(groups: tuple[Slots, ...], size: tuple[float, float]) -> list[dict[str, float]]:
        out: list[dict[str, float]] = []
        for s in groups:
            axis, sign = frame.side(s.side)
            a0, a1 = (-w / 2 + 2, w / 2 - 2) if axis == "y" else (-d / 2, d / 2)
            if s.end and axis == "y":
                _e_axis, e_sign = frame.side(s.end)
                a0, a1 = (w / 6, w / 2 + 10) if e_sign > 0 else (-w / 2 - 10, -w / 6)
            # in front of ramps keep the apron free for the trucks
            gap = 18.0 if (axis, sign) in ramp_sides and not s.end else 4.0
            out += _slots(axis, sign, half[axis], (a0, a1), s.count, size, site, taken, gap)
        return out

    stands = place(spec.stands, STAND)
    vans = place(spec.vans, VAN)
    cars = place(spec.cars, CAR)

    # driving lane: a ring around the hall with room in front of the ramps, joined to the gate
    def room(axis: str, sign: int, want: float) -> float:
        free = _ray(
            site,
            _pt(axis, sign, 0.0, half[axis]),
            (sign, 0.0) if axis == "x" else (0.0, float(sign)),
        )
        return max(2.0, min(want, free - 3)) if math.isfinite(free) else want

    off = {
        k: room(*k, 22.0 if k in ramp_sides else 6.0)
        for k in (("x", 1), ("x", -1), ("y", 1), ("y", -1))
    }
    xa, xb = -w / 2 - off[("x", -1)], w / 2 + off[("x", 1)]
    ya, yb = -d / 2 - off[("y", -1)], d / 2 + off[("y", 1)]
    ring = [(_r(xa), _r(ya)), (_r(xb), _r(ya)), (_r(xb), _r(yb)), (_r(xa), _r(yb))]
    nearest = min(ring, key=lambda p: math.dist(p, gate))
    lanes = [[list(p) for p in [*ring, ring[0]]], [list(gate), list(nearest)]]

    yard: dict[str, object] = {
        "gate": list(gate),
        "truckStands": [{"code": f"{spec.code}-T{i + 1:02d}"} | s for i, s in enumerate(stands)],
        "vanParking": [{"code": f"{spec.code}-P{i + 1:02d}"} | v for i, v in enumerate(vans)],
        "vanLoading": van_loading,
        "carParking": [{"code": f"{spec.code}-C{i + 1:02d}"} | c for i, c in enumerate(cars)],
        "lanes": lanes,
    }
    if spec.gatehouse:
        # the guard house on an island just inside the gate
        inward = -g_sign * 9.0
        gx, gy = (
            (gate[0] + inward, gate[1] + 6) if g_axis == "x" else (gate[0] + 6, gate[1] + inward)
        )
        yard["gatehouse"] = [_r(gx), _r(gy)]
    layout: dict[str, object] = {
        "origin": [round(origin[0], 6), round(origin[1], 6)],
        "hall": {"width": w, "depth": d, "height": spec.height, "rotationDeg": round(rotation, 1)},
        "footprint": [[_r(x), _r(y)] for x, y in footprint],
        "site": [[_r(x), _r(y)] for x, y in site],
        "yardGate": list(gate),
        "yard": yard,
        "source": {
            "hallWay": osm["hallWay"],
            "siteWay": osm.get("siteWay"),
            "assumed": list(spec.assumed),
        },
    }
    if spec.belt:
        # along the middle of the real outline, a quarter of its width towards the ramps
        y_pos, y_neg = wall("y", 1, 0.0) or d / 2, wall("y", -1, 0.0) or -d / 2
        toward = next((sign for axis, sign in ramp_sides if axis == "y"), 0)
        by = _r((y_pos + y_neg) / 2 + toward * (y_pos - y_neg) / 4)
        layout["belt"] = [[_r(-w / 2 + 8), by], [_r(w / 2 - 8), by]]
        layout["lineScanner"] = [0.0, by]
        layout["sensors"] = [[_r(-w / 3), by], [0.0, by], [_r(w / 3), by]]
    return Built(spec.code, spec.name, spec.kind, origin, layout, tuple(doors))


@cache
def built_depots() -> dict[str, Built]:
    osm = {d["code"]: d for d in json.loads(DATA.read_text(encoding="utf-8"))}
    return {s.code: build(s, osm[s.code]) for s in SPECS}


def data_version() -> str:
    """Changes when the geometry or the notes change: the seed step re-applies the layouts."""
    blob = DATA.read_bytes() + repr(SPECS).encode()
    return hashlib.sha256(blob).hexdigest()[:12]
